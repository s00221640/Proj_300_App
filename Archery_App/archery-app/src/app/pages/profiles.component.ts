import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { DbService } from '../services/db.services';
import { ArcherProfile, BowType } from '../models';
import { v4 as uuid } from 'uuid';
import { FormsModule } from '@angular/forms';
import { StatsService } from '../services/stats.service';

@Component({
  selector: 'app-profiles',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
  <section style="max-width:900px;margin:16px auto;padding:12px">
    <h2>Archer Profiles</h2>
    <form (submit)="create($event)" style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
      <input placeholder="Name" [(ngModel)]="name" name="name" required>
      <select [(ngModel)]="bowType" name="bowType">
        <option [ngValue]="undefined">Bow Type</option>
        <option *ngFor="let b of bowTypes" [ngValue]="b">{{b}}</option>
      </select>
      <button type="submit">Add</button>
    </form>

    <ul style="list-style:none;padding:0;margin:0">
      <li *ngFor="let p of profiles()" style="display:flex;justify-content:space-between;align-items:center;border:1px solid #eee;border-radius:8px;padding:10px;margin:8px 0">
        <div>
          <div style="font-weight:600">{{p.name}}</div>
          <div style="font-size:12px;color:#666;display:flex;align-items:center;gap:6px">
            Sessions: {{stats()[p.id]?.sessions || 0}} •
            Shots: {{stats()[p.id]?.shots || 0}} •
            Avg: {{(stats()[p.id]?.avgScore || 0) | number:'1.1-1'}}
            <ng-container *ngIf="trendMap()[p.id] as t">
              <span 
                [style.background]="
                  t.deltaPct > 0.5 ? '#2ecc40' : 
                  t.deltaPct < -0.5 ? '#e74c3c' : '#bbb'"
                [style.color]="
                  t.deltaPct > 0.5 || t.deltaPct < -0.5 ? '#fff' : '#444'"
                style="border-radius:999px;padding:0 7px;font-size:11px;display:inline-flex;align-items:center;margin-left:4px;">
                <ng-container *ngIf="t.deltaPct > 0.5">▲</ng-container>
                <ng-container *ngIf="t.deltaPct < -0.5">▼</ng-container>
                <ng-container *ngIf="t.deltaPct >= -0.5 && t.deltaPct <= 0.5">•</ng-container>
                {{t.deltaPct | number:'1.1-1'}}%
              </span>
            </ng-container>
          </div>
          <div *ngIf="stats()[p.id]?.biasDirection" style="font-size:11px;color:#888;margin-top:2px;">
            Tends {{stats()[p.id]?.biasDirection}}
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <a [routerLink]="['/sessions', p.id]">Sessions</a>
          <button (click)="remove(p.id)">Delete</button>
        </div>
      </li>
    </ul>
  </section>
  `
})
export class ProfilesComponent {
  private db = inject(DbService);
  private router = inject(Router);
  private statsSvc = inject(StatsService);

  profiles = signal<ArcherProfile[]>([]);
  name = '';
  bowType?: BowType;
  bowTypes: BowType[] = ['recurve','compound','barebow','longbow'];
  stats = signal<Record<string, {sessions:number, shots:number, avgScore:number, biasDirection?: string}>>({});
  trendMap = signal<Record<string, { deltaPct: number } | null>>({});

  async ngOnInit() {
    const list = await this.db.listProfiles();
    this.profiles.set(list);
    const statsMap: Record<string, any> = {};
    const trendMap: Record<string, { deltaPct: number } | null> = {};
    for (const p of list) {
      statsMap[p.id] = await this.statsSvc.archerStats(p.id);
      trendMap[p.id] = await this.statsSvc.trendForArcher(p.id);
    }
    this.stats.set(statsMap);
    this.trendMap.set(trendMap);
  }

  async create(e: Event) {
    e.preventDefault();
    const now = Date.now();
    const p: ArcherProfile = { id: uuid(), name: this.name.trim(), bowType: this.bowType, createdAt: now, updatedAt: now };
    await this.db.upsertProfile(p);
    this.profiles.set(await this.db.listProfiles());
    this.name = '';
    this.bowType = undefined;
    await this.ngOnInit(); // reload stats and trends
  }

  async remove(id: string) {
    await this.db.deleteProfile(id);
    this.profiles.set(await this.db.listProfiles());
    await this.ngOnInit(); // reload stats and trends
  }

  async trendForArcher(archerId: string): Promise<{ deltaPct: number } | null> {
    const sessions = await this.db.listSessionsByArcher(archerId);
    if (sessions.length < 3) return null; // Only require 3 sessions

    // Sort sessions by date (assuming createdAt or dateIso)
    sessions.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

    // Compute avg score per session for this archer
    const avgs: number[] = [];
    for (const s of sessions) {
      // You may need to filter shots by archerId if sessions are shared
      const shots = await this.db.listShotsBySession(s.id);
      const archerShots = shots.filter(sh => sh.archerId === archerId);
      if (!archerShots.length) continue;
      const avg = archerShots.reduce((a, sh) => a + (sh.score ?? 0), 0) / archerShots.length;
      avgs.push(avg);
    }
    if (avgs.length < 3) return null;

    const last2 = avgs.slice(-2);
    const prev = avgs.slice(-3, -2);
    if (prev.length < 1) return null;

    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const deltaPct = 100 * (mean(last2) - mean(prev)) / mean(prev);

    return { deltaPct };
  }
}
