import { and, eq, inArray, sql } from 'drizzle-orm';

import type { MemberRole, MemberStatus, MembershipRepository } from '../../repositories/types';
import type { Db } from './db';
import { tripMembers, trips } from './schema';

export class PgMembershipRepository implements MembershipRepository {
  constructor(private readonly db: Db) {}

  async roleOf(userId: string, tripId: string): Promise<MemberRole | null> {
    const [owned] = await this.db.select({ id: trips.id }).from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.userId, userId))).limit(1);
    if (owned) return 'OWNER';
    const [m] = await this.db.select({ role: tripMembers.role }).from(tripMembers)
      .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId), eq(tripMembers.status, 'ACTIVE'))).limit(1);
    return (m?.role as MemberRole | undefined) ?? null;
  }

  async wasMember(userId: string, clientId: string): Promise<boolean> {
    const [row] = await this.db.select({ one: sql<number>`1` }).from(tripMembers)
      .innerJoin(trips, eq(trips.id, tripMembers.tripId))
      .where(and(eq(trips.clientId, clientId), eq(tripMembers.userId, userId), inArray(tripMembers.status, ['LEFT', 'REMOVED'])))
      .limit(1);
    return !!row;
  }

  async add(input: { tripId: string; userId: string; role: MemberRole; displayName: string | null; invitedBy: string | null }): Promise<void> {
    await this.db.insert(tripMembers)
      .values({ tripId: input.tripId, userId: input.userId, role: input.role, status: 'ACTIVE',
        displayName: input.displayName, invitedBy: input.invitedBy, joinedAt: sql`now()` })
      .onConflictDoUpdate({
        target: [tripMembers.tripId, tripMembers.userId],
        set: { role: input.role, status: 'ACTIVE', displayName: input.displayName, joinedAt: sql`now()`, updatedAt: sql`now()` }
      });
  }

  async setStatus(tripId: string, userId: string, status: MemberStatus): Promise<void> {
    await this.db.update(tripMembers).set({ status, updatedAt: sql`now()` })
      .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId)));
  }
}
