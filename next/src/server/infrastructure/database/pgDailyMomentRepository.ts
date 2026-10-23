import { and, eq, sql } from 'drizzle-orm';
import type { SavedDailyMoment } from '../../../features/trip-state/domain/dailyMoments';
import { ApiError } from '../../api/errors';
import type { DailyMomentRepository } from '../../repositories/dailyMoments';
import type { Db } from './db';
import { tripDailyMoments, tripMembers, trips } from './schema';

export class PgDailyMomentRepository implements DailyMomentRepository {
  constructor(private readonly db: Db) {}

  async list(tripId: string, dayKey: string): Promise<SavedDailyMoment[]> {
    const rows = await this.db.select({ moment: tripDailyMoments, name: tripMembers.displayName, role: tripMembers.role })
      .from(tripDailyMoments).innerJoin(tripMembers, and(eq(tripMembers.tripId, tripDailyMoments.tripId), eq(tripMembers.userId, tripDailyMoments.userId)))
      .where(and(eq(tripDailyMoments.tripId, tripId), eq(tripDailyMoments.dayKey, dayKey), eq(tripMembers.status, 'ACTIVE')))
      .orderBy(tripMembers.id);
    return rows.map(row => ({ userId: row.moment.userId, label: row.name?.trim() || (row.role === 'OWNER' ? '주최자' : '멤버'),
      spotKey: row.moment.spotKey, spotName: row.moment.spotName }));
  }

  async save(input: { tripId: string; userId: string; expectedRevision: number; dayKey: string; spotKey: string | null; spotName: string | null }): Promise<void> {
    await this.db.transaction(async tx => {
      // Same order as document writes: trip first, then member. A membership removal or document edit cannot race the save.
      const [trip] = await tx.select().from(trips).where(eq(trips.id, input.tripId)).for('share');
      if (!trip || trip.deletedAt) throw new ApiError('NOT_FOUND');
      const [member] = await tx.select().from(tripMembers)
        .where(and(eq(tripMembers.tripId, input.tripId), eq(tripMembers.userId, input.userId))).for('share');
      if (!member || member.status !== 'ACTIVE') throw new ApiError('NOT_FOUND');
      if (trip.revision !== input.expectedRevision) throw new ApiError('STALE_VERSION', { details: { revision: trip.revision } });
      const key = and(eq(tripDailyMoments.tripId, input.tripId), eq(tripDailyMoments.dayKey, input.dayKey), eq(tripDailyMoments.userId, input.userId));
      if (input.spotKey === null) { await tx.delete(tripDailyMoments).where(key); }
      else await tx.insert(tripDailyMoments).values({ tripId: input.tripId, dayKey: input.dayKey, userId: input.userId,
        spotKey: input.spotKey, spotName: input.spotName ?? '' })
        .onConflictDoUpdate({ target: [tripDailyMoments.tripId, tripDailyMoments.dayKey, tripDailyMoments.userId],
          set: { spotKey: input.spotKey, spotName: input.spotName ?? '', updatedAt: sql`now()` } });
      // A signal, not an activity-feed row. PostgreSQL delivers NOTIFY only after commit.
      // id=0 identifies a non-durable invalidation; no wish/name/user content leaves the server.
      await tx.execute(sql`select pg_notify('tc_realtime', ${JSON.stringify({
        tripId: trip.id, clientId: trip.clientId, id: 0, kind: 'DAILY_MOMENT_CHANGED', actorId: input.userId
      })})`);
    });
  }
}
