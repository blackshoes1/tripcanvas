import { and, eq, sql } from 'drizzle-orm';

import type { CoverRepository, TripCover } from '../../application/trip/coverService';
import type { Db } from './db';
import { tripCovers } from './schema';

export class PgCoverRepository implements CoverRepository {
  constructor(private readonly db: Db) {}

  async get(tripId: string): Promise<TripCover> {
    const [row] = await this.db.select({ revision: tripCovers.revision, imageBase64: tripCovers.imageBase64 })
      .from(tripCovers).where(eq(tripCovers.tripId, tripId));
    return row ?? { revision: 0, imageBase64: null };
  }

  async save(tripId: string, expectedRevision: number, imageBase64: string | null): Promise<TripCover | null> {
    const values = { imageBase64, updatedAt: new Date() };
    const rows = expectedRevision === 0
      ? await this.db.insert(tripCovers).values({ tripId, revision: 1, ...values }).onConflictDoNothing().returning()
      : await this.db.update(tripCovers).set({ ...values, revision: sql`${tripCovers.revision} + 1` })
        .where(and(eq(tripCovers.tripId, tripId), eq(tripCovers.revision, expectedRevision))).returning();
    return rows[0] ? { revision: rows[0].revision, imageBase64: rows[0].imageBase64 } : null;
  }
}
