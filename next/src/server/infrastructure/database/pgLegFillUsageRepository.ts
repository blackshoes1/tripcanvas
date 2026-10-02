// 경로 조회 예산 — PostgreSQL. 하루(UTC)·갈래(`user:<id>` · `all`)마다 한 행이다.
import { and, eq, inArray, lt, sql } from 'drizzle-orm';

import type { LegFillScope, LegFillUsageRepository } from '../../repositories/types';
import type { Db } from './db';
import { legFillUsage } from './schema';

/** 이만큼 지난 날의 행은 지운다 — 세는 것은 오늘뿐이고, 사람 수 × 날짜만큼 쌓이게 두지 않는다 */
const KEEP_DAYS = 7;

export class PgLegFillUsageRepository implements LegFillUsageRepository {
  constructor(private readonly db: Db) {}

  async used(day: string, scopes: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!scopes.length) return out;
    const rows = await this.db.select({ scope: legFillUsage.scope, count: legFillUsage.count }).from(legFillUsage)
      .where(and(eq(legFillUsage.day, day), inArray(legFillUsage.scope, scopes)));
    for (const r of rows) out.set(r.scope, r.count);
    return out;
  }

  async reserve(day: string, scopes: LegFillScope[], want: number): Promise<number> {
    if (want <= 0 || !scopes.length) return 0;
    // 잠금 순서를 하나로 — 갈래 이름 순. 두 요청이 서로의 행을 붙잡고 기다리지 않는다
    const sorted = [...scopes].sort((a, b) => (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0));
    const names = sorted.map((s) => s.scope);
    return this.db.transaction(async (tx) => {
      const created = await tx.insert(legFillUsage).values(names.map((scope) => ({ scope, day, count: 0 })))
        .onConflictDoNothing().returning({ scope: legFillUsage.scope });
      const rows = await tx.select({ scope: legFillUsage.scope, count: legFillUsage.count }).from(legFillUsage)
        .where(and(eq(legFillUsage.day, day), inArray(legFillUsage.scope, names)))
        .orderBy(legFillUsage.scope).for('update');
      const used = new Map(rows.map((r) => [r.scope, r.count]));
      const grant = Math.max(0, Math.min(want, ...sorted.map((s) => s.limit - (used.get(s.scope) ?? 0))));
      if (grant > 0) {
        await tx.update(legFillUsage).set({ count: sql`${legFillUsage.count} + ${grant}`, updatedAt: sql`now()` })
          .where(and(eq(legFillUsage.day, day), inArray(legFillUsage.scope, names)));
      }
      // 그날 처음 생긴 전체 행이면 오래된 날을 치운다 — 하루 한 번
      if (created.some((c) => c.scope === 'all')) {
        const cutoff = new Date(Date.parse(`${day}T00:00:00Z`) - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
        await tx.delete(legFillUsage).where(lt(legFillUsage.day, cutoff));
      }
      return grant;
    });
  }
}
