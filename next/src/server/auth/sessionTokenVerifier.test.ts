// 사이드카가 better-auth 없이 세션을 판정한다(PR11 후속). 이 파일의 값어치는 **파리티**에 있다:
// 진짜 better-auth로 만든 세션을 DB 검증기가 그대로 받아들이는지 본다.
// 라이브러리가 토큰 모양을 바꾸면 여기가 먼저 깨진다 — 배포된 사이드카가 조용히 전원을 막기 전에.
import { createHmac } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../infrastructure/database/testDb';
import { PgAuthIdentityRepository } from '../infrastructure/database/pgAuthIdentityRepository';
import { PgAuthSessionRepository } from '../infrastructure/database/pgAuthSessionRepository';
import type { MailService } from '../infrastructure/mail/types';
import { createBetterAuth, type BetterAuthInstance } from './betterAuth';
import { createBetterAuthVerifier } from './betterAuthVerifier';
import { createSessionTokenVerifier, splitSignedToken } from './sessionTokenVerifier';
import type { TokenVerifier } from './types';

const BASE = 'https://api.test';
const SECRET = 'test-secret-at-least-32-characters-long!!';

let db: TestDatabase;
let auth: BetterAuthInstance;
let mails: { kind: string; url: string }[];
/** 사이드카가 쓰는 검증기 — better-auth를 import하지 않는다 */
let sidecar: TokenVerifier;
/** API가 쓰는 검증기 — 비교 대상 */
let api: TokenVerifier;

const mail: MailService = {
  async sendVerificationEmail(_to, url) { mails.push({ kind: 'VERIFY', url }); },
  async sendPasswordReset(_to, url) { mails.push({ kind: 'RESET', url }); }
};

beforeEach(async () => {
  db = await createTestDatabase();
  mails = [];
  auth = createBetterAuth({ db: db.db, mail, secret: SECRET, baseURL: BASE, webBaseURL: 'https://web.test' });
  api = createBetterAuthVerifier(auth, new PgAuthIdentityRepository(db.db));
  sidecar = createSessionTokenVerifier({
    sessions: new PgAuthSessionRepository(db.db),
    identities: new PgAuthIdentityRepository(db.db),
    secret: SECRET
  });
});

/** 가입 → 메일 확인 → 로그인. 실제 better-auth가 발급한 bearer를 돌려준다 */
async function signedInToken(email = 'a@example.com', password = 'correct-horse-battery'): Promise<string> {
  await auth.api.signUpEmail({ body: { name: '테스터', email, password } });
  const link = mails.find((m) => m.kind === 'VERIFY');
  expect(link, '인증 메일이 나가지 않았다').toBeDefined();
  await auth.handler(new Request(link!.url, { method: 'GET', redirect: 'manual' }));

  const res = await auth.handler(new Request(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password })
  }));
  expect(res.status, await res.clone().text()).toBe(200);
  const token = res.headers.get('set-auth-token');
  expect(token, 'bearer 토큰을 받지 못했다').toBeTruthy();
  return token!;
}

describe('better-auth와의 파리티', () => {
  it('진짜 세션을 API 검증기와 **같은 사용자**로 판정한다', async () => {
    const token = await signedInToken();

    const fromApi = await api.verify(token);
    const fromSidecar = await sidecar.verify(token);

    expect(fromApi, 'API가 제 토큰을 못 알아봤다').not.toBeNull();
    expect(fromSidecar, '사이드카가 진짜 세션을 거절했다 — 실시간이 통째로 끊긴다').not.toBeNull();
    expect(fromSidecar!.userId).toBe(fromApi!.userId);
    expect(fromSidecar!.sessionId).toBe(fromApi!.sessionId);
    expect(fromSidecar!.tokenSource).toBe('tripcanvas');
  });

  it('bearer는 `<token>.<서명>`이고 DB에는 서명 없는 token만 있다', async () => {
    const bearer = await signedInToken();
    const parts = splitSignedToken(bearer);
    expect(parts).not.toBeNull();

    const { rows } = (await db.db.execute(sql`select token from auth_session`)) as { rows: { token: string }[] };
    expect(rows[0]?.token).toBe(parts!.token);
    expect(rows[0]?.token).not.toBe(bearer);   // 통째로 조회하면 아무도 못 들어온다
  });
});

describe('거절해야 하는 것', () => {
  it('서명이 틀리면 거절한다 — 사이드카가 API보다 무른 문이 되면 안 된다', async () => {
    const bearer = await signedInToken();
    const { token } = splitSignedToken(bearer)!;
    const forged = createHmac('sha256', 'wrong-secret-wrong-secret-wrong!!').update(token).digest('base64');

    expect(await sidecar.verify(`${token}.${forged}`)).toBeNull();
    expect(await sidecar.verify(`${token}.`)).toBeNull();
    expect(await sidecar.verify(token)).toBeNull();          // 서명 없음
  });

  it('AUTH_SECRET이 다르면 아무도 못 들어온다 — 두 프로세스가 같은 비밀을 써야 한다', async () => {
    const bearer = await signedInToken();
    const wrong = createSessionTokenVerifier({
      sessions: new PgAuthSessionRepository(db.db),
      identities: new PgAuthIdentityRepository(db.db),
      secret: 'another-secret-another-secret-32!!'
    });
    expect(await wrong.verify(bearer)).toBeNull();
  });

  it('서명은 맞지만 DB에 없는 토큰은 거절한다 (로그아웃된 세션)', async () => {
    const bearer = await signedInToken();
    await db.db.execute(sql`delete from auth_session`);
    expect(await sidecar.verify(bearer)).toBeNull();
  });

  it('만료된 세션은 거절한다', async () => {
    const bearer = await signedInToken();
    const expired = createSessionTokenVerifier({
      sessions: new PgAuthSessionRepository(db.db),
      identities: new PgAuthIdentityRepository(db.db),
      secret: SECRET,
      now: () => new Date(Date.now() + 400 * 24 * 3600 * 1000)
    });
    expect(await expired.verify(bearer)).toBeNull();
  });

  it('이메일이 확인되지 않은 계정의 세션은 거절한다 — API와 같은 규칙(계정 탈취 방지)', async () => {
    await auth.api.signUpEmail({ body: { name: '미확인', email: 'unverified@example.com', password: 'correct-horse-battery' } });
    // 확인 전에는 로그인이 열리지 않으므로 세션을 직접 만들어 규칙만 본다
    const token = 'raw-token-for-unverified-account';
    await db.db.execute(sql`
      insert into auth_session (id, token, user_id, expires_at, created_at, updated_at)
      select 's-unverified', ${token}, u.id, now() + interval '7 days', now(), now()
        from auth_user u where u.email = 'unverified@example.com'`);
    const signature = createHmac('sha256', SECRET).update(token).digest('base64');

    expect(await sidecar.verify(`${token}.${signature}`)).toBeNull();
  });

  it('빈 값과 비밀 없음은 조용히 거절한다', async () => {
    expect(await sidecar.verify('')).toBeNull();
    const noSecret = createSessionTokenVerifier({
      sessions: new PgAuthSessionRepository(db.db),
      identities: new PgAuthIdentityRepository(db.db),
      secret: ''
    });
    expect(await noSecret.verify(await signedInToken())).toBeNull();
  });
});
