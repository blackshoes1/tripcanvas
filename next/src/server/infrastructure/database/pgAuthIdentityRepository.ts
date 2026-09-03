// 계정 연결 저장소. 규칙은 server/auth/identity.ts에 있고 여기는 읽고 쓰기만 한다.
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { AuthIdentityRepository } from '../../repositories/types';
import type { Db } from './db';
import { users } from './schema';

export class PgAuthIdentityRepository implements AuthIdentityRepository {
  constructor(private readonly db: Db) {}

  async findByAuthUserId(authUserId: string): Promise<string | null> {
    const [row] = await this.db.select({ id: users.id }).from(users).where(eq(users.authUserId, authUserId)).limit(1);
    return row?.id ?? null;
  }

  async findUnlinkedByEmail(email: string): Promise<string | null> {
    const [row] = await this.db.select({ id: users.id }).from(users)
      .where(and(sql`lower(btrim(${users.email})) = ${email}`, isNull(users.authUserId))).limit(1);
    return row?.id ?? null;
  }

  /** 그 사이 다른 계정이 먼저 이어졌으면 false — 조건부 update 하나로 경합을 막는다 */
  async link(userId: string, authUserId: string): Promise<boolean> {
    const rows = await this.db.update(users).set({ authUserId })
      .where(and(eq(users.id, userId), isNull(users.authUserId))).returning({ id: users.id });
    return rows.length > 0;
  }

  async createLinked(email: string, authUserId: string): Promise<string> {
    const [row] = await this.db.insert(users)
      .values({ id: sql`gen_random_uuid()`, email, authUserId, lastSeenAt: sql`now()` })
      .returning({ id: users.id });
    return row.id;
  }
}
