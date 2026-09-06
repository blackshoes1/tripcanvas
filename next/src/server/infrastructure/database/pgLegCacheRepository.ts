// 구간 캐시 — PostgreSQL. 웹 localStorage 캐시(`tripcanvas_legs_v4`)와 같은 키·같은 모양이다.
import { inArray } from 'drizzle-orm';

import type { LegCacheRepository, LegCacheRow } from '../../repositories/types';
import type { Db } from './db';
import { legCache } from './schema';

export class PgLegCacheRepository implements LegCacheRepository {
  constructor(private readonly db: Db) {}

  async getMany(keys: string[]): Promise<LegCacheRow[]> {
    const wanted = Array.from(new Set(keys.filter(Boolean)));
    if (!wanted.length) return [];
    const rows = await this.db.select().from(legCache).where(inArray(legCache.key, wanted));
    return rows.map((r) => ({
      key: r.key, sec: r.sec, m: r.m, path: r.path, taxi: r.taxi,
      snapped: r.snapped, fail: r.fail, provider: r.provider, fetchedAt: r.fetchedAt
    }));
  }

  async put(row: Omit<LegCacheRow, 'fetchedAt'>): Promise<void> {
    const values = {
      key: row.key, sec: row.sec, m: row.m, path: row.path, taxi: row.taxi,
      snapped: row.snapped, fail: row.fail, provider: row.provider, fetchedAt: new Date()
    };
    await this.db.insert(legCache).values(values)
      .onConflictDoUpdate({ target: legCache.key, set: values });
  }
}
