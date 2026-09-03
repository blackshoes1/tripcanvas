// Phase A 안전장치 — 로컬 JWT 검증이 실패하면(예: 프로젝트가 아직 HS256인데 secret이 없다) 예전처럼 Supabase에 물어본다.
// 그래야 전환 첫날 전 사용자가 401을 받는 사고가 없다. 로컬이 성공하면 원격을 부르지 않는다.
import { describe, expect, it, vi } from 'vitest';

import type { RequestContext, TokenVerifier } from './types';
import { withRemoteFallback } from './withRemoteFallback';

const ctx = (userId: string): RequestContext => ({ userId, legacySupabaseUserId: userId, email: null, sessionId: null, tokenSource: 'supabase' });

describe('withRemoteFallback', () => {
  it('로컬이 성공하면 원격은 부르지 않는다', async () => {
    let remoteCalls = 0;
    const v = withRemoteFallback({ async verify() { return ctx('local'); } }, async () => { remoteCalls++; return ctx('remote'); });
    expect((await v.verify('t'))?.userId).toBe('local');
    expect(remoteCalls).toBe(0);
  });

  it('로컬이 실패하면 원격으로 사용자를 확인하고 한 번만 경고한다', async () => {
    const warnings: string[] = [];
    const local: TokenVerifier = { async verify() { return null; } };
    const v = withRemoteFallback(local, async (token) => (token === 'good.jwt.shaped' ? ctx('remote') : null), (m) => warnings.push(m));
    expect((await v.verify('good.jwt.shaped'))?.userId).toBe('remote');
    expect(await v.verify('bad.jwt.shaped')).toBeNull();
    expect((await v.verify('good.jwt.shaped'))?.userId).toBe('remote');
    expect(warnings).toHaveLength(1);
  });

  it('원격이 던져도 401로 끝난다 — 예외가 밖으로 새지 않는다', async () => {
    const v = withRemoteFallback({ async verify() { return null; } }, async () => { throw new Error('network'); });
    expect(await v.verify('t.o.k')).toBeNull();
  });
});

describe('JWT 모양이 아닌 토큰', () => {
  it('원격에 묻지 않는다 — 자체 Auth 세션 토큰마다 Supabase로 왕복하면 안 된다', async () => {
    let remoteCalls = 0;
    const v = withRemoteFallback({ async verify() { return null; } }, async () => { remoteCalls++; return null; }, vi.fn());
    expect(await v.verify('opaque-session-token')).toBeNull();
    expect(await v.verify('two.parts')).toBeNull();
    expect(remoteCalls).toBe(0);
    expect(await v.verify('header.payload.signature')).toBeNull();
    expect(remoteCalls).toBe(1);
  });
});
