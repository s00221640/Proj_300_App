import { Component, ElementRef, ViewChild, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { DbService } from '../services/db.services';
import { MetricsService } from '../services/metrics.service';
import { Metrics, SessionMeta, Shot } from '../models';
import { v4 as uuid } from 'uuid';

type Mode = 'calibrate-center' | 'calibrate-ring' | 'mark-shots';

@Component({
  selector: 'app-session-detail',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
  <section style="max-width:1000px;margin:16px auto;padding:12px;display:grid;gap:12px">
    <header>
      <h2 style="margin:0">Session</h2>
      <div *ngIf="session() as s" style="color:#555">
        {{s.roundName || '—'}} • {{s.distanceMeters || '—'}}m • {{s.targetFace || '—'}}
      </div>
    </header>

    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">
      <label style="display:inline-block">
        <input type="file" accept="image/*" (change)="onFile($event)" hidden>
        <span style="padding:8px 12px;border:1px solid #ddd;border-radius:8px;cursor:pointer">Upload target photo</span>
      </label>

      <button (click)="setMode('calibrate-center')" [disabled]="mode() === 'calibrate-center'">Set centre</button>
      <button (click)="setMode('calibrate-ring')" [disabled]="!hasCenter() || mode() === 'calibrate-ring'">Set ring point</button>
      <button (click)="setMode('mark-shots')" [disabled]="!isCalibrated() || mode() === 'mark-shots'">Mark shots</button>
      <button (click)="undo()" [disabled]="shots().length===0">Undo</button>
      <button (click)="clearShots()" [disabled]="shots().length===0">Clear shots</button>
      <button (click)="exportSession()" [disabled]="!session()">Export JSON</button>
      <label style="display:inline-block">
        <input type="file" accept="application/json" (change)="importSession($event)" hidden>
        <span style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;cursor:pointer">Import JSON</span>
      </label>
    </div>

    <small style="color:#666">
      Tip: When choosing the ring point, I’ll auto-snap to the nearest ring edge. Calibration is saved automatically.
    </small>

    <div style="display:grid;grid-template-columns:1fr 320px;gap:16px">
      <div style="overflow:auto;border:1px solid #eee;border-radius:8px;padding:8px">
        <canvas #cnv (click)="onCanvasClick($event)" style="max-width:100%;display:block;cursor:crosshair"></canvas>
      </div>

      <aside style="display:grid;gap:12px;align-content:start">
        <div style="border:1px solid #eee;border-radius:8px;padding:10px">
          <div style="font-weight:600;margin-bottom:6px">Calibration</div>
          <div>Centre: {{cal().centerX ?? '—'}}, {{cal().centerY ?? '—'}}</div>
          <div>Ring radius (px): {{cal().ringRadiusPx ?? '—'}}</div>
        </div>

        <div style="border:1px solid #eee;border-radius:8px;padding:10px">
          <div style="font-weight:600;margin-bottom:6px">Shots ({{shots().length}})</div>
          <ul style="list-style:none;padding:0;margin:0;max-height:240px;overflow:auto">
            <li *ngFor="let sh of shots(); let i = index" style="border-bottom:1px solid #f0f0f0;padding:6px 0">
              #{{sh.order ?? i+1}} • ({{sh.x|number:'1.0-0'}}, {{sh.y|number:'1.0-0'}}) • <strong>{{sh.score ?? '—'}}</strong>
            </li>
          </ul>
        </div>

        <div style="border:1px solid #eee;border-radius:8px;padding:10px">
          <div style="font-weight:600;margin-bottom:6px">Metrics</div>
          <ng-container *ngIf="metrics(); else noM">
            <div>Mean radial error: {{metrics()?.meanRadialError | number:'1.0-1'}} px</div>
            <div>Group size (R95 proxy): {{metrics()?.groupSizeR95 | number:'1.0-1'}} px</div>
            <div>Bias distance: {{metrics()?.biasDistance | number:'1.0-1'}} px</div>
            <div>Bias angle: {{metrics()?.biasAngleDeg | number:'1.0-1'}}°</div>
          </ng-container>
          <ng-template #noM>Calibrate and add shots to compute.</ng-template>
        </div>
      </aside>
    </div>
  </section>
  `
})
export class SessionDetailComponent {
  private route = inject(ActivatedRoute);
  private db = inject(DbService);
  private metricsSvc = inject(MetricsService);

  @ViewChild('cnv', { static: true }) cnvRef!: ElementRef<HTMLCanvasElement>;

  session = signal<SessionMeta | undefined>(undefined);
  shots   = signal<Shot[]>([]);
  metrics = signal<Metrics | undefined>(undefined);

  mode = signal<Mode>('calibrate-center');

  cal = signal<{ centerX?: number; centerY?: number; ringRadiusPx?: number }>({});

  private img: HTMLImageElement | undefined;
  private scale = 1;
  private imgData?: ImageData; // for auto-snap

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;

    const s = await this.db.getSession(id);
    this.session.set(s || undefined);

    if (s?.photoPath) await this.loadImage(s.photoPath);

    if (s?.calibration) {
      this.cal.set({ ...s.calibration });
      this.mode.set('mark-shots');
    }

    await this.refreshShots();

    effect(() => this.draw());
    this.recompute();
  }

  // ---------- Image handling ----------
  async onFile(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const dataUrl = await fileToDataURL(file);
    const s = this.session();
    if (!s) return;

    s.photoPath = dataUrl;
    s.updatedAt = Date.now();
    await this.db.upsertSession(s);
    this.session.set(s);

    await this.loadImage(dataUrl);
    this.mode.set('calibrate-center');
    this.cal.set({});
    this.draw();
  }

  private async loadImage(dataUrl: string) {
    this.img = await loadImage(dataUrl);
    const canvas = this.cnvRef.nativeElement;
    const maxW = 900;
    const scale = this.img.width > maxW ? maxW / this.img.width : 1;
    this.scale = scale;
    canvas.width  = Math.round(this.img.width * scale);
    canvas.height = Math.round(this.img.height * scale);

    // prepare pixel data for auto-snap (source-space)
    const off = document.createElement('canvas');
    off.width = this.img.width;
    off.height = this.img.height;
    const octx = off.getContext('2d')!;
    octx.drawImage(this.img, 0, 0);
    this.imgData = octx.getImageData(0, 0, off.width, off.height);

    this.draw();
  }

  // ---------- Modes ----------
  setMode(m: Mode) { this.mode.set(m); }
  hasCenter() { return this.cal().centerX != null && this.cal().centerY != null; }
  hasRing() { return this.cal().ringRadiusPx != null && (this.cal().ringRadiusPx as number) > 0; }
  isCalibrated() { return this.hasCenter() && this.hasRing(); }

  // ---------- Canvas interaction ----------
  async onCanvasClick(ev: MouseEvent) {
    const s = this.session();
    if (!s) return;

    const canvas = this.cnvRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;

    const m = this.mode();

    if (m === 'calibrate-center') {
      this.cal.set({ ...this.cal(), centerX: x, centerY: y });
      // if we already had a ring, keep it; else move to ring step
      if (!this.cal().ringRadiusPx) this.mode.set('calibrate-ring');
      await this.autoSaveIfReady();
      this.draw();
      return;
    }

    if (m === 'calibrate-ring') {
      if (!this.hasCenter()) return;
      const cx = this.cal().centerX!;
      const cy = this.cal().centerY!;
      const approx = Math.hypot(x - cx, y - cy);

      // Auto-snap to nearest ring edge using pixel gradients
      const snapped = this.snapRadiusToEdge(cx, cy, x, y, approx);
      this.cal.set({ ...this.cal(), ringRadiusPx: Math.max(1, snapped ?? approx) });

      await this.autoSaveIfReady();
      this.mode.set('mark-shots');
      this.draw();
      return;
    }

    if (m === 'mark-shots' && this.isCalibrated()) {
      const now = Date.now();
      const score = this.scoreFor(x, y);
      const shot: Shot = { id: uuid(), sessionId: s.id, x, y, order: this.shots().length + 1, score, createdAt: now };
      await this.db.addShot(shot);
      this.shots.set(await this.db.listShotsBySession(s.id));
      this.recompute();
      this.draw();
    }
  }

  private async autoSaveIfReady() {
    if (!this.isCalibrated()) return;
    const s = this.session();
    if (!s) return;
    s.calibration = {
      centerX: this.cal().centerX!,
      centerY: this.cal().centerY!,
      ringRadiusPx: this.cal().ringRadiusPx!
    };
    s.updatedAt = Date.now();
    await this.db.upsertSession(s);
    this.session.set(s);
    this.recompute();
  }

  undo() {
    const arr = this.shots().slice(0, -1);
    this.shots.set(arr);
    this.persistShotsReplace(arr);
    this.recompute();
    this.draw();
  }

  clearShots() {
    this.shots.set([]);
    this.persistShotsReplace([]);
    this.recompute();
    this.draw();
  }

  private async persistShotsReplace(shots: Shot[]) {
    const s = this.session();
    if (!s) return;
    const keep = s;
    await this.db.deleteSessionCascade(s.id);
    await this.db.upsertSession(keep);
    for (const sh of shots) await this.db.addShot(sh);
  }

  // ---------- Scoring ----------
  private scoreFor(x: number, y: number): number | undefined {
    const s = this.session();
    if (!s?.calibration) return undefined;
    const { centerX, centerY, ringRadiusPx } = s.calibration;
    const dist = Math.hypot(x - centerX, y - centerY);
    const band = Math.floor(dist / Math.max(1, ringRadiusPx));
    return Math.max(0, 10 - band);
  }

  // ---------- Data / metrics ----------
  async refreshShots() {
    const s = this.session();
    if (!s) return;
    this.shots.set(await this.db.listShotsBySession(s.id));
  }

  async recompute() {
    const s = this.session();
    if (!s) return;
    const m = this.metricsSvc.compute(s.id, this.shots(), s.calibration);
    await this.db.upsertMetrics(m);
    this.metrics.set(m);
  }

  // ---------- Drawing ----------
  private draw() {
    const canvas = this.cnvRef?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (this.img) ctx.drawImage(this.img, 0, 0, canvas.width, canvas.height);

    const c = this.cal();
    if (c.centerX != null && c.centerY != null) {
      ctx.beginPath();
      ctx.arc(c.centerX, c.centerY, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#00aaff';
      ctx.fill();
    }
    if (this.isCalibrated()) {
      ctx.beginPath();
      ctx.arc(c.centerX!, c.centerY!, c.ringRadiusPx!, 0, Math.PI * 2);
      ctx.strokeStyle = '#00aaff';
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const sh of this.shots()) {
      ctx.beginPath();
      ctx.arc(sh.x, sh.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#e91e63';
      ctx.fill();
      if (sh.score != null) {
        ctx.font = '12px system-ui';
        ctx.fillStyle = '#222';
        ctx.fillText(String(sh.score), sh.x + 7, sh.y - 7);
      }
    }

    ctx.font = '13px system-ui';
    ctx.fillStyle = '#333';
    const hint =
      this.mode() === 'calibrate-center' ? 'Click target centre' :
      this.mode() === 'calibrate-ring'   ? 'Click near a ring edge — I will auto-snap' :
      'Click to add shots';
    ctx.fillText(hint, 8, 18);
  }

  // ---------- Auto-snap helper ----------
  private snapRadiusToEdge(cx: number, cy: number, x: number, y: number, approxR: number): number | undefined {
    if (!this.imgData || !this.img || approxR <= 0) return undefined;

    // convert canvas coords (x,y) & center to image source space
    const sx = x / this.scale;
    const sy = y / this.scale;
    const scx = cx / this.scale;
    const scy = cy / this.scale;

    const theta = Math.atan2(sy - scy, sx - scx);
    const search = 20; // px either side
    let bestR = approxR, bestG = 0;

    for (let dr = -search; dr <= search; dr++) {
      const r = approxR + dr;
      if (r <= 2) continue;
      const g = Math.abs(this.radialGradient(scx, scy, theta, r)); // edge strength
      if (g > bestG) { bestG = g; bestR = r; }
    }
    return bestR;
  }

  private radialGradient(cx: number, cy: number, theta: number, r: number): number {
    // sample luminance at r-1 and r+1 along theta
    const p1 = { x: cx + (r - 1) * Math.cos(theta), y: cy + (r - 1) * Math.sin(theta) };
    const p2 = { x: cx + (r + 1) * Math.cos(theta), y: cy + (r + 1) * Math.sin(theta) };
    const L1 = this.sampleLuma(p1.x, p1.y);
    const L2 = this.sampleLuma(p2.x, p2.y);
    return L2 - L1;
  }

  private sampleLuma(ix: number, iy: number): number {
    if (!this.imgData) return 0;
    const x = Math.max(0, Math.min(this.imgData.width - 1, Math.round(ix)));
    const y = Math.max(0, Math.min(this.imgData.height - 1, Math.round(iy)));
    const i = (y * this.imgData.width + x) * 4;
    const r = this.imgData.data[i], g = this.imgData.data[i+1], b = this.imgData.data[i+2];
    // Rec. 709 luma
    return 0.2126*r + 0.7152*g + 0.0722*b;
  }

  async exportSession() {
    const s = this.session();
    if (!s) return;
    const shots = await this.db.listShotsBySession(s.id);
    const metrics = await this.db.getMetrics?.(s.id);
    const payload = { session: s, shots, metrics };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `archery-session-${s.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async importSession(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const text = await file.text();
    const data = JSON.parse(text) as { session: SessionMeta, shots: Shot[], metrics?: Metrics };

    // Store under a new ID so we don’t overwrite accidentally
    const old = data.session;
    const newId = crypto.randomUUID?.() || (Math.random().toString(36).slice(2));
    const s: SessionMeta = { ...old, id: newId, createdAt: Date.now(), updatedAt: Date.now() };

    await this.db.upsertSession(s);
    for (const sh of data.shots || []) {
      await this.db.addShot({ ...sh, id: crypto.randomUUID?.() || (Math.random().toString(36).slice(2)), sessionId: s.id });
    }
    if (data.metrics) await this.db.upsertMetrics?.({ ...data.metrics, sessionId: s.id, computedAt: Date.now() });

    this.session.set(await this.db.getSession(s.id) || undefined);
    await this.refreshShots();
    this.recompute();
    this.draw();
  }

  ngAfterViewInit() {
    window.addEventListener('keydown', this.keyHandler);
  }
  ngOnDestroy() {
    window.removeEventListener('keydown', this.keyHandler);
  }
  keyHandler = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() === 'z') this.undo();
    if (e.key.toLowerCase() === 'c') this.clearShots();
  };
}

// ------------ helpers ------------
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}
function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
