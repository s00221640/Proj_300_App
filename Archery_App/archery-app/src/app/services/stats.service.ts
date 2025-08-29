import { Injectable } from '@angular/core';
import { DbService } from './db.services';

@Injectable({ providedIn: 'root' })
export class StatsService {
  constructor(private db: DbService) {}

  // returns { sessions: number, shots: number, avgScore: number }
  async archerStats(archerId: string) {
    const sessions = await this.db.listSessionsByArcher(archerId);
    let shotsTotal = 0;
    let pointsTotal = 0;
    for (const s of sessions) {
      const shots = await this.db.listShotsBySession(s.id);
      shotsTotal += shots.length;
      pointsTotal += shots.reduce((a, sh) => a + (sh.score ?? 0), 0);
    }
    return {
      sessions: sessions.length,
      shots: shotsTotal,
      avgScore: shotsTotal ? (pointsTotal / shotsTotal) : 0
    };
  }
}