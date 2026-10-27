// better-auth 표의 제약 — PGlite(진짜 PostgreSQL) 위에서 같은 마이그레이션(0020·0021)으로 돌린다.
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createBetterAuth } from '../../auth/betterAuth';
import { authAccount, authRateLimit, authUser } from './schema';
import { createTestDatabase, type TestDatabase } from './testDb';

let db: TestDatabase;

beforeEach(async () => { db = await createTestDatabase(); });
afterEach(async () => { await db.close(); });

describe('auth_account.issuer (0020)', () => {
  // 이미지를 1.7.2로 롤백하면 계정을 (issuer, accountId)로 찾는다 — 1.7.14가 만든 계정이 비어 있으면 보이지 않는다.
  it('비어 들어오면 better-auth 1.7.2가 쓰던 값으로 채운다 · 적어 온 값은 그대로', async () => {
    await db.db.insert(authUser).values({ id: 'u1', name: '여행자', email: 'traveler@example.com' });
    await db.db.insert(authAccount).values([
      { id: 'a1', accountId: 'u1', providerId: 'credential', userId: 'u1' },
      { id: 'a2', accountId: 'google-sub', providerId: 'google', userId: 'u1' },
      { id: 'a3', accountId: 'apple-sub', providerId: 'apple', userId: 'u1' },
      { id: 'a4', accountId: 'kakao-id', providerId: 'kakao', userId: 'u1' },
      { id: 'a5', issuer: 'https://accounts.google.com', accountId: 'google-2', providerId: 'google', userId: 'u1' }
    ]);
    const rows = await db.db.select({ id: authAccount.id, issuer: authAccount.issuer }).from(authAccount).orderBy(authAccount.id);
    expect(rows).toEqual([
      { id: 'a1', issuer: 'local:credential' },
      { id: 'a2', issuer: 'https://accounts.google.com' },
      { id: 'a3', issuer: 'https://appleid.apple.com' },
      { id: 'a4', issuer: 'local:oauth:kakao' },
      { id: 'a5', issuer: 'https://accounts.google.com' }
    ]);
  });

  it('지금 라이브러리로 가입해도 채워진다', async () => {
    const auth = createBetterAuth({ db: db.db, secret: 'test-secret-at-least-32-characters-long!!',
      baseURL: 'https://api.test', webBaseURL: 'https://web.test',
      mail: { async sendVerificationEmail() {}, async sendPasswordReset() {} } });
    const response = await auth.handler(new Request('https://api.test/api/auth/sign-up/email', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://api.test' },
      body: JSON.stringify({ email: 'new@example.com', password: 'correct horse battery', name: '새 여행자' })
    }));
    expect(response.status).toBe(200);
    const [user] = await db.db.select().from(authUser).where(eq(authUser.email, 'new@example.com'));
    const [account] = await db.db.select().from(authAccount).where(eq(authAccount.userId, user.id));
    expect(account.providerId).toBe('credential');
    expect(account.issuer).toBe('local:credential');
  });
});

describe('auth_rate_limit.key (0021)', () => {
  // 하나뿐이어야 동시에 들어온 첫 요청들이 줄을 따로 만들어 제한을 N배로 늘리지 못한다.
  it('같은 key의 둘째 줄은 들어가지 않는다', async () => {
    await db.db.insert(authRateLimit).values({ id: 'r1', key: '203.0.113.7|/sign-in/email', count: 1, lastRequest: 1 });
    await expect(db.db.insert(authRateLimit).values({ id: 'r2', key: '203.0.113.7|/sign-in/email', count: 1, lastRequest: 2 }))
      .rejects.toThrow();
    expect(await db.db.select().from(authRateLimit)).toHaveLength(1);
  });
});
