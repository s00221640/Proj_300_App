import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { DbService } from '../services/db.service.ts';
import { SessionMeta } from '../models';
import { v4 as uuid } from 'uuid';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-sessions',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
  <section style="max-width:900px;margin:16px auto;padding:12px">
    <h2>Sessions</h2>

    <form (submit)="create($event)" style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
      <input placeholder="Round name" [(ngModel)]="roundName" name="round">
      <input type="number" placeholder="Distance (m)" [(ngModel)]="distance" name="distance">
      <input placeholder="Target face" [(ngModel)]="targetFace" name="face">
      <button type="submit">Create</button>
    </form>

    <ul style="list-style:none;padding:0;margin:0">
      <li *ngFor="let s of sessions()" style="display:flex;justify-content:space-between;align-items:center;border:1px solid #eee;border-radius:8px;padding:10px;margin:8px 0">
        <div>
          <div style="font-weight:600">{{s.roundName || 'Session'}}</div>
          <div style="font-size:12px;color:#666">{{s.dateIso}} • {{s.distanceMeters || '—'}}m • {{s.targetFace || '—'}}</div>
        </div>
        <div style="display:flex;gap:8px">
          <a [routerLink]="['/session', s.id]">Open</a>
          <button (click)="remove(s.id)">Delete</button>
        </div>
      </li>
    </ul>
  </section>
  `
})
export class SessionsComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private db = inject(DbService);

  archerId = '';
  sessions = signal<SessionMeta[]>([]);

  roundName = '';
  distance?: number;
  targetFace = '';

  async ngOnInit() {
    this.archerId = this.route.snapshot.params['archerId'];
    await this.refresh();
  }

  async refresh() {
    this.sessions.set(await this.db.listSessionsByArcher(this.archerId));
  }

  async create(e: Event) {
    e.preventDefault();
    const now = Date.now();
    const s: SessionMeta = {
      id: uuid(),
      archerId: this.archerId,
      dateIso: new Date().toISOString(),
      roundName: this.roundName || undefined,
      distanceMeters: this.distance,
      targetFace: this.targetFace || undefined,
      createdAt: now,
      updatedAt: now
    };
    await this.db.upsertSession(s);
    this.roundName = '';
    this.distance = undefined;
    this.targetFace = '';
    await this.refresh();
  }

  async remove(id: string) {
    await this.db.deleteSessionCascade(id);
    await this.refresh();
  }
}
