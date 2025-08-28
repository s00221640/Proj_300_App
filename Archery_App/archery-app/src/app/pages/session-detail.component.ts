import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { DbService } from '../services/db.service';
import { MetricsService } from '../services/metrics.service';
import { SessionMeta, Shot } from '../models';
import { v4 as uuid } from 'uuid';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-session-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
  <section style="max-width:900px;margin:16px auto;padding:12px">
    <h2>Session</h2>

    <div *ngIf="session() as s" style="margin-bottom:12px;font-size:14px;color:#555">
      {{s.roundName || '—'}} • {{s.distanceMeters || '—'}}m • {{s.targetFace || '—'}}
    </div>

    <fieldset style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
      <legend>Calibration (px)</legend>
      <input type="number" placeholder="Center X" [(ngModel)]="cx">
      <input type="number" placeholder="Center Y" [(ngModel)]="cy">
      <input type="number" placeholder="Ring radius px" [(ngModel)]="rr">
      <button (click)="saveCalibration()">Save</button>
    </fieldset>

    <fieldset style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
      <legend>Add Shot</legend>
      <input type="number" placeholder="X (px)" [(ngModel)]="sx">
      <input type="number" placeholder="Y (px)" [(ngModel)]="sy">
      <input type="number" placeholder="Order" [(ngModel)]="order">
      <button (click)="addShot()">Add</button>
    </fieldset>

    <h3>Shots</h3>
    <ul style="list-style:none;padding:0;margin:0">
      <li *ngFor="let sh of shots()" style="border:1px solid #eee;border-radius:6px;padding:6px;margin:6px 0">
        #{{sh.order || '—'}} • ({{sh.x}}, {{sh.y}})
      </li>
    </ul>

    <h3>Metrics</h3>
    <div *ngIf="metrics() as m; else noM">
      Mean radial error: {{m.meanRadialError | number:'1.0-1'}} px<br>
      Group size (R95 proxy): {{m.groupSizeR95 | number:'1.0-1'}} px<br>
      Bias distance: {{m.biasDistance | number:'1.0-1'}} px<br>
      Bias angle: {{m.biasAngleDeg | number:'1.0-1'}}°
    </div>
    <ng-template #noM>Compute by adding shots and saving calibration.</ng-template>
  </section>
  `
})
export class SessionDetailComponent {
  private route = inject(ActivatedRoute);
  private db = inject(DbService);
  private metricsSvc = inject(MetricsService);

  session = signal<SessionMeta | undefined>(undefined);
  shots = signal<Shot[]>([]);
  metrics = signal<any>(undefined);

  cx?: number;
  cy?: number;
  rr?: number;

  sx?: number;
  sy?: number;
  order?: number;

  async ngOnInit() {
    const id = this.route.snapshot.params['id'];
    const s = await this.db.getSession(id);
    this.session.set(s || undefined);
    this.cx = s?.calibration?.centerX;
    this.cy = s?.calibration?.centerY;
    this.rr = s?.calibration?.ringRadiusPx;
    await this.refreshShots();
    this.recompute();
  }

  async refreshShots() {
    const sid = this.session()?.id!;
    this.shots.set(await this.db.listShotsBySession(sid));
  }

  async saveCalibration() {
    const s = this.session();
    if (!s) return;
    s.calibration = { centerX: this.cx || 0, centerY: this.cy || 0, ringRadiusPx: this.rr || 1 };
    s.updatedAt = Date.now();
    await this.db.upsertSession(s);
    this.session.set(s);
    this.recompute();
  }

  async addShot() {
    const sid = this.session()?.id!;
    if (!sid || this.sx === undefined || this.sy === undefined) return;
    const now = Date.now();
    await this.db.addShot({ id: uuid(), sessionId: sid, x: this.sx, y: this.sy, order: this.order, createdAt: now });
    this.sx = this.sy = this.order = undefined;
    await this.refreshShots();
    this.recompute();
  }

  async recompute() {
    const s = this.session();
    if (!s) return;
    const m = this.metricsSvc.compute(s.id, this.shots(), s.calibration);
    await this.db.upsertMetrics(m);
    this.metrics.set(m);
  }
}
