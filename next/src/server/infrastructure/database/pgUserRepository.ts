import { eq, sql } from 'drizzle-orm';

import type { UserRecord, UserRepository } from '../../repositories/types';
import type { Db } from './db';
import { users } from './schema';

function toRecord(row: typeof users.$inferSelect): UserRecord {
  return { id: row.id, email: row.email, legacySupabaseUserId: row.legacySupabaseUserId };
}

export class PgUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async ensure(user: { id: string; email: string | null }): Promise<UserRecord> {
    const [row] = await this.db.insert(users)
      .values({ id: user.id, email: user.email, legacySupabaseUserId: user.id, lastSeenAt: sql`now()` })
      .onConflictDoUpdate({ target: users.id, set: { lastSeenAt: sql`now()`, email: sql`coalesce(excluded.email, ${users.email})` } })
      .returning();
    return toRecord(row);
  }

  async findById(id: string): Promise<UserRecord | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? toRecord(row) : null;
  }
}
