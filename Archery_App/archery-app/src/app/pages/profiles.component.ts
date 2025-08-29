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
          <div style="font-size:12px;color:#666">
            Sessions: {{stats()[p.id]?.sessions || 0}} •
            Shots: {{stats()[p.id]?.shots || 0}} •
            Avg: {{(stats()[p.id]?.avgScore || 0) | number:'1.1-1'}}
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
  stats = signal<Record<string, {sessions:number, shots:number, avgScore:number}>>({});

  async ngOnInit() {
    const list = await this.db.listProfiles();
    this.profiles.set(list);
    const map: Record<string, any> = {};
    for (const p of list) {
      map[p.id] = await this.statsSvc.archerStats(p.id);
    }
    this.stats.set(map);
  }

  async create(e: Event) {
    e.preventDefault();
    const now = Date.now();
    const p: ArcherProfile = { id: uuid(), name: this.name.trim(), bowType: this.bowType, createdAt: now, updatedAt: now };
    await this.db.upsertProfile(p);
    this.profiles.set(await this.db.listProfiles());
    this.name = '';
    this.bowType = undefined;
  }

  async remove(id: string) {
    await this.db.deleteProfile(id);
    this.profiles.set(await this.db.listProfiles());
  }
}
