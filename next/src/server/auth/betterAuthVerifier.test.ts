// 자체 Auth 전 과정을 진짜로 돌린다(PGlite + better-auth): 가입 → 인증 메일 → 확인 → 로그인 → bearer 세션 → 도메인 사용자.
// §17이 요구하는 흐름이 실제로 서는지, 그리고 §19의 이관(기존 Supabase 사용자가 제 여행을 그대로 갖는지)을 확인한다.
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../infrastructure/database/testDb';
import { PgAuthIdentityRepository } from '../infrastructure/database/pgAuthIdentityRepository';
import { PgTripRepository } from '../infrastructure/database/pgTripRepository';
import { PgUserRepository } from '../infrastructure/database/pgUserRepository';
import type { MailService } from '../infrastructure/mail/types';
import { createBetterAuth, type BetterAuthInstance } from './betterAuth';
import { createBetterAuthVerifier } from './betterAuthVerifier';

const LEGACY = '00000000-0000-0000-0000-00000000000a';
const BASE = 'https://api.test';

let db: TestDatabase;
let auth: BetterAuthInstance;
let mails: { kind: string; to: string; url: string }[];
let verifier: ReturnType<typeof createBetterAuthVerifier>;

const mail: MailService = {
  async sendVerificationEmail(to, url) { mails.push({ kind: 'VERIFY', to, url }); },
  async sendPasswordReset(to, url) { mails.push({ kind: 'RESET', to, url }); }
};

beforeEach(async () => {
  db = await createTestDatabase();
  mails = [];
  auth = createBetterAuth({ db: db.db, mail, secret: 'test-secret-at-least-32-characters-long!!', baseURL: BASE });
  verifier = createBetterAuthVerifier(auth, new PgAuthIdentityRepository(db.db));
});

async function signUp(email: string, password = 'correct-horse-battery'): Promise<void> {
  await auth.api.signUpEmail({ body: { name: '테스터', email, password } });
}
/** 메일로 온 확인 링크를 그대로 연다 */
async function openVerificationLink(): Promise<void> {
  const link = mails.find((m) => m.kind === 'VERIFY');
  expect(link, '인증 메일이 발송되지 않았다').toBeDefined();
  const res = await auth.handler(new Request(link!.url, { method: 'GET', redirect: 'manual' }));
  expect(res.status).toBeLessThan(400);
}
/** 로그인해서 bearer로 쓸 세션 토큰을 얻는다 */
async function signIn(email: string, password = 'correct-horse-battery'): Promise<string> {
  const res = await auth.handler(new Request(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password })
  }));
  expect(res.status, await res.clone().text()).toBe(200);
  const token = res.headers.get('set-auth-token');
  expect(token, 'bearer 플러그인이 세션 토큰을 주지 않았다').toBeTruthy();
  return token!;
}

describe('가입과 이메일 확인 (§17·§20)', () => {
  it('가입하면 확인 메일이 나가고, 확인 전에는 로그인할 수 없다', async () => {
    await signUp('new@example.com');
    expect(mails.map((m) => [m.kind, m.to])).toEqual([['VERIFY', 'new@example.com']]);
    expect(mails[0].url).toContain('/api/auth/verify-email');

    const res = await auth.handler(new Request(`${BASE}/api/auth/sign-in/email`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com', password: 'correct-horse-battery' })
    }));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('확인한 뒤 로그인하면 세션 토큰이 나오고, 그 토큰이 도메인 사용자로 이어진다', async () => {
    await signUp('new@example.com');
    await openVerificationLink();
    const token = await signIn('new@example.com');

    const ctx = await verifier.verify(token);
    expect(ctx).toMatchObject({ email: 'new@example.com', tokenSource: 'tripcanvas', legacySupabaseUserId: null });
    expect(ctx!.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ctx!.expiresAt! * 1000).toBeGreaterThan(Date.now());
  });

  it('틀린 비밀번호는 통과하지 못한다', async () => {
    await signUp('new@example.com');
    await openVerificationLink();
    const res = await auth.handler(new Request(`${BASE}/api/auth/sign-in/email`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com', password: 'wrong-password-entirely' })
    }));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('기존 Supabase 사용자의 이관 (§19)', () => {
  it('같은 이메일로 가입해 확인하면 예전 여행이 그대로 있다 — users.id가 유지된다', async () => {
    await new PgUserRepository(db.db).ensure({ id: LEGACY, email: 'old@example.com' });
    const trips = new PgTripRepository(db.db);
    await trips.create({ ownerId: LEGACY, clientId: 'trip1', data: { name: '스페인' } });

    await signUp('old@example.com');
    await openVerificationLink();
    const ctx = await verifier.verify(await signIn('old@example.com'));

    expect(ctx!.userId).toBe(LEGACY);
    expect((await trips.listVisible(ctx!.userId)).map((v) => v.record.clientId)).toEqual(['trip1']);
  });

  it('비밀번호 재설정 메일도 어댑터로 나간다 — 비밀번호를 옮기지 않고 여기로 넘어온다', async () => {
    await new PgUserRepository(db.db).ensure({ id: LEGACY, email: 'old@example.com' });
    await signUp('old@example.com');
    mails.length = 0;
    const res = await auth.handler(new Request(`${BASE}/api/auth/request-password-reset`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'old@example.com', redirectTo: `${BASE}/reset` })
    }));
    expect(res.status).toBe(200);
    expect(mails.map((m) => m.kind)).toEqual(['RESET']);
  });
});

describe('세션 검증', () => {
  it('모르는 토큰·빈 토큰은 null', async () => {
    expect(await verifier.verify('')).toBeNull();
    expect(await verifier.verify('not-a-session-token')).toBeNull();
  });

  it('로그아웃한 세션은 더는 통하지 않는다', async () => {
    await signUp('new@example.com');
    await openVerificationLink();
    const token = await signIn('new@example.com');
    expect(await verifier.verify(token)).not.toBeNull();

    const res = await auth.handler(new Request(`${BASE}/api/auth/sign-out`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` }
    }));
    expect(res.status).toBe(200);
    expect(await verifier.verify(token)).toBeNull();
  });
});
