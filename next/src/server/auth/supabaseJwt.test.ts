// Phase A(§14·§15) — 새 backend는 Supabase가 발급한 access token을 **직접** 검증한다(Supabase에 물어보지 않는다).
// 새 프로젝트의 비대칭 키(ES256)는 JWKS로, 구형 HS256은 프로젝트 JWT secret이 있을 때만.
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { ApiError } from '../api/errors';
import { authenticate } from './authenticate';
import { createSupabaseVerifier } from './supabaseJwt';

const SUPABASE_URL = 'https://proj.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const SUB = '11111111-2222-4333-8444-555555555555';
const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';

let es256: Awaited<ReturnType<typeof generateKeyPair>>;
let other: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  es256 = await generateKeyPair('ES256');
  other = await generateKeyPair('ES256');
  const jwk = await exportJWK(es256.publicKey);
  jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: 'k1', alg: 'ES256', use: 'sig' }] });
});

function claims(overrides: Record<string, unknown> = {}) {
  return { sub: SUB, email: 'a@example.com', session_id: 'sess-1', role: 'authenticated', ...overrides };
}
async function signEs(payload: Record<string, unknown>, opts: { iss?: string; aud?: string; exp?: string; key?: CryptoKey } = {}) {
  return new SignJWT(payload).setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setIssuer(opts.iss ?? ISSUER).setAudience(opts.aud ?? 'authenticated').setIssuedAt().setExpirationTime(opts.exp ?? '1h')
    .sign(opts.key ?? es256.privateKey);
}
async function signHs(payload: Record<string, unknown>, secret = SECRET) {
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER).setAudience('authenticated').setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

describe('createSupabaseVerifier', () => {
  it('JWKS(ES256)로 서명된 토큰 → RequestContext. 도메인은 JWT payload를 모른다(§16)', async () => {
    const verifier = createSupabaseVerifier({ supabaseUrl: SUPABASE_URL, jwtSecret: null, jwks });
    const ctx = await verifier.verify(await signEs(claims()));
    expect(ctx).toEqual({ userId: SUB, legacySupabaseUserId: SUB, email: 'a@example.com', sessionId: 'sess-1', tokenSource: 'supabase' });
  });

  it('HS256은 secret이 설정돼 있을 때만 받는다', async () => {
    const withSecret = createSupabaseVerifier({ supabaseUrl: SUPABASE_URL, jwtSecret: SECRET, jwks });
    expect((await withSecret.verify(await signHs(claims())))?.userId).toBe(SUB);
    const noSecret = createSupabaseVerifier({ supabaseUrl: SUPABASE_URL, jwtSecret: null, jwks });
    expect(await noSecret.verify(await signHs(claims()))).toBeNull();
    expect(await withSecret.verify(await signHs(claims(), 'wrong-secret-wrong-secret-wrong-secret-x'))).toBeNull();
  });

  it('issuer·audience가 다르면 거절한다 — 다른 Supabase 프로젝트의 토큰이 통하지 않게', async () => {
    const verifier = createSupabaseVerifier({ supabaseUrl: SUPABASE_URL, jwtSecret: null, jwks });
    expect(await verifier.verify(await signEs(claims(), { iss: 'https://evil.supabase.co/auth/v1' }))).toBeNull();
    expect(await verifier.verify(await signEs(claims(), { aud: 'anon' }))).toBeNull();
  });

  it('만료 · 다른 키의 서명 · sub 없음 · 형식 아님은 전부 null', async () => {
    const verifier = createSupabaseVerifier({ supabaseUrl: SUPABASE_URL, jwtSecret: null, jwks });
    expect(await verifier.verify(await signEs(claims(), { exp: '-1s' }))).toBeNull();
    expect(await verifier.verify(await signEs(claims(), { key: other.privateKey }))).toBeNull();
    expect(await verifier.verify(await signEs(claims({ sub: undefined })))).toBeNull();
    expect(await verifier.verify(await signEs(claims({ sub: 'not-a-uuid' })))).toBeNull();
    expect(await verifier.verify('garbage.token.value')).toBeNull();
    expect(await verifier.verify('')).toBeNull();
  });

  it('email·session_id가 없어도 사용자는 식별된다', async () => {
    const verifier = createSupabaseVerifier({ supabaseUrl: SUPABASE_URL, jwtSecret: null, jwks });
    const ctx = await verifier.verify(await signEs({ sub: SUB }));
    expect(ctx).toMatchObject({ userId: SUB, email: null, sessionId: null });
  });
});

describe('authenticate(request)', () => {
  it('Authorization: Bearer 가 없거나 검증에 실패하면 UNAUTHORIZED ApiError', async () => {
    const verifier = createSupabaseVerifier({ supabaseUrl: SUPABASE_URL, jwtSecret: null, jwks });
    await expect(authenticate(new Request('http://x/api/v1/trips'), verifier)).rejects.toMatchObject({ code: 'UNAUTHORIZED' } satisfies Partial<ApiError>);
    await expect(authenticate(new Request('http://x/api/v1/trips', { headers: { authorization: 'Bearer nope' } }), verifier))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(authenticate(new Request('http://x/api/v1/trips', { headers: { authorization: 'Basic abc' } }), verifier))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('유효한 토큰이면 RequestContext를 준다 (대소문자 무관한 Bearer)', async () => {
    const verifier = createSupabaseVerifier({ supabaseUrl: SUPABASE_URL, jwtSecret: null, jwks });
    const token = await signEs(claims());
    const ctx = await authenticate(new Request('http://x/api/v1/trips', { headers: { authorization: `bearer ${token}` } }), verifier);
    expect(ctx.userId).toBe(SUB);
  });
});
