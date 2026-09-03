// trips Repository — sync_trip/tombstone_trip의 저장 규칙(CAS · tombstone · 소유한 쪽 우선)을 트랜잭션으로 낸다.
// 누가 저장해도 되는가(역할)는 여기서 판정하지 않는다 — application(TripService)의 몫이다.
import { and, desc, eq, or, sql } from 'drizzle-orm';

import type { CasResult, MemberRole, TripRecord, TripRepository, TripView } from '../../repositories/types';
import type { Db } from './db';
import { tripMembers, trips } from './schema';

type Row = typeof trips.$inferSelect;

function toRecord(row: Row): TripRecord {
  return {
    id: row.id, ownerId: row.userId, clientId: row.clientId, data: row.data, revision: Number(row.revision),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null, updatedAt: row.updatedAt.toISOString()
  };
}

export class PgTripRepository implements TripRepository {
  constructor(private readonly db: Db) {}

  /** 호출자가 볼 수 있는 행 + 역할 + 활성 인원. 소유한 쪽이 먼저 오도록 정렬돼 있다 */
  private visibleQuery(userId: string) {
    const roleExpr = sql<string>`case when ${trips.userId} = ${userId} then 'OWNER' else ${tripMembers.role} end`;
    const countExpr = sql<number>`(select count(*)::int from ${tripMembers} m where m.trip_id = ${trips.id} and m.status = 'ACTIVE')`;
    return this.db.select({ row: trips, role: roleExpr, memberCount: countExpr }).from(trips)
      .leftJoin(tripMembers, and(eq(tripMembers.tripId, trips.id), eq(tripMembers.userId, userId), eq(tripMembers.status, 'ACTIVE')))
      .where(or(eq(trips.userId, userId), sql`${tripMembers.id} is not null`));
  }

  private toView(r: { row: Row; role: string; memberCount: number }): TripView {
    return { record: toRecord(r.row), role: r.role as MemberRole, memberCount: Number(r.memberCount) };
  }

  async listVisible(userId: string): Promise<TripView[]> {
    const rows = await this.visibleQuery(userId)
      .orderBy(desc(sql`${trips.userId} = ${userId}`), desc(trips.updatedAt));
    const seen = new Set<string>();
    const out: TripView[] = [];
    for (const r of rows) {
      if (r.row.deletedAt || seen.has(r.row.clientId)) continue;
      seen.add(r.row.clientId);
      out.push(this.toView(r));
    }
    return out.sort((a, b) => b.record.updatedAt.localeCompare(a.record.updatedAt));
  }

  async findVisible(userId: string, clientId: string): Promise<TripView | null> {
    const rows = await this.visibleQuery(userId)
      .orderBy(desc(sql`${trips.userId} = ${userId}`), trips.id);
    const r = rows.find((x) => x.row.clientId === clientId);
    return r ? this.toView(r) : null;
  }

  async create(input: { ownerId: string; clientId: string; data: unknown }): Promise<TripRecord> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(trips).values({ userId: input.ownerId, clientId: input.clientId, data: input.data, revision: 1 }).returning();
      await tx.insert(tripMembers)
        .values({ tripId: row.id, userId: input.ownerId, role: 'OWNER', status: 'ACTIVE', joinedAt: sql`now()` })
        .onConflictDoUpdate({ target: [tripMembers.tripId, tripMembers.userId], set: { role: 'OWNER', status: 'ACTIVE', updatedAt: sql`now()` } });
      return toRecord(row);
    });
  }

  async updateCas(id: string, data: unknown, expectedRevision: number, opts: { force?: boolean } = {}): Promise<CasResult> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(trips).where(eq(trips.id, id)).for('update');
      if (!current) throw new Error(`trip ${id} not found`);
      if (!opts.force && (current.deletedAt || Number(current.revision) !== expectedRevision)) {
        return { applied: false, conflict: true, record: toRecord(current) };
      }
      const [row] = await tx.update(trips)
        .set({ data, revision: Number(current.revision) + 1, deletedAt: null, updatedAt: sql`now()` })
        .where(eq(trips.id, id)).returning();
      return { applied: true, conflict: false, record: toRecord(row) };
    });
  }

  async tombstoneCas(id: string, expectedRevision: number, opts: { force?: boolean } = {}): Promise<CasResult> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(trips).where(eq(trips.id, id)).for('update');
      if (!current) throw new Error(`trip ${id} not found`);
      if (!opts.force && Number(current.revision) !== expectedRevision) {
        return { applied: false, conflict: true, record: toRecord(current) };
      }
      const [row] = await tx.update(trips)
        .set({ revision: Number(current.revision) + 1, deletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(trips.id, id)).returning();
      return { applied: true, conflict: false, record: toRecord(row) };
    });
  }
}
