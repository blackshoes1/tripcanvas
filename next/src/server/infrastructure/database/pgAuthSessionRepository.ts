// 자체 Auth 세션 조회. better-auth가 소유한 테이블을 **읽기만** 한다 — 쓰기는 라이브러리의 몫이다(§18).
import { eq } from 'drizzle-orm';

import type { AuthSessionRepository, AuthSessionView } from '../../repositories/types';
import type { Db } from './db';
import { authSession, authUser } from './schema';

export class PgAuthSessionRepository implements AuthSessionRepository {
  constructor(private readonly db: Db) {}

  async findByToken(token: string): Promise<AuthSessionView | null> {
    const [row] = await this.db
      .select({
        sessionId: authSession.id,
        authUserId: authSession.userId,
        expiresAt: authSession.expiresAt,
        email: authUser.email,
        emailVerified: authUser.emailVerified
      })
      .from(authSession)
      .innerJoin(authUser, eq(authUser.id, authSession.userId))
      .where(eq(authSession.token, token))
      .limit(1);
    if (!row) return null;
    return {
      sessionId: row.sessionId,
      authUserId: row.authUserId,
      email: row.email ?? null,
      emailVerified: !!row.emailVerified,
      expiresAt: row.expiresAt instanceof Date ? row.expiresAt : new Date(String(row.expiresAt))
    };
  }
}
