// 여행 버전 이력 저장소. 운영과 같은 규칙: 사람마다 제 행, 여행당 최근 15개.
import { and, desc, eq, sql } from 'drizzle-orm';

import type { TripSnapshotRecord, TripSnapshotRepository, TripSnapshotSummary } from '../../repositories/types';
import type { Db } from './db';
import { tripSnapshots } from './schema';

/** 운영 웹과 같은 보관 개수(app.js cloudSnapshot) */
export const SNAPSHOT_KEEP = 15;

export class PgTripSnapshotRepository implements TripSnapshotRepository {
  constructor(private readonly db: Db) {}

  async create(userId: string, clientId: string, input: { name: string; data: unknown; sourceRevision: number | null }): Promise<TripSnapshotSummary> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(tripSnapshots)
        .values({ userId, clientId, name: input.name, data: input.data, sourceRevision: input.sourceRevision })
        .returning();
      // 최근 15개만 남긴다 — 오래된 것부터 사라진다
      await tx.execute(sql`
        delete from trip_snapshots s
         where s.user_id = ${userId} and s.client_id = ${clientId}
           and s.id not in (
             select id from trip_snapshots
              where user_id = ${userId} and client_id = ${clientId}
              order by created_at desc, id desc
              limit ${SNAPSHOT_KEEP})`);
      return { id: Number(row.id), name: row.name, source_revision: row.sourceRevision, created_at: row.createdAt.toISOString() };
    });
  }

  async list(userId: string, clientId: string): Promise<TripSnapshotSummary[]> {
    const rows = await this.db.select().from(tripSnapshots)
      .where(and(eq(tripSnapshots.userId, userId), eq(tripSnapshots.clientId, clientId)))
      .orderBy(desc(tripSnapshots.createdAt), desc(tripSnapshots.id)).limit(SNAPSHOT_KEEP);
    return rows.map((r) => ({ id: Number(r.id), name: r.name, source_revision: r.sourceRevision, created_at: r.createdAt.toISOString() }));
  }

  /** 남의 스냅샷은 id를 알아도 돌려주지 않는다 */
  async find(userId: string, clientId: string, id: number): Promise<TripSnapshotRecord | null> {
    const [row] = await this.db.select().from(tripSnapshots)
      .where(and(eq(tripSnapshots.id, id), eq(tripSnapshots.userId, userId), eq(tripSnapshots.clientId, clientId))).limit(1);
    return row
      ? { id: Number(row.id), name: row.name, source_revision: row.sourceRevision, created_at: row.createdAt.toISOString(), data: row.data }
      : null;
  }
}
