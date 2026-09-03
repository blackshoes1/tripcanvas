// Phase A 안전장치 — 로컬 JWT 검증이 실패하면(예: 프로젝트가 아직 HS256인데 secret이 없다) 예전처럼 Supabase에 물어본다.
// 그래야 전환 첫날 전 사용자가 401을 받는 사고가 없다. 로컬이 성공하면 원격을 부르지 않는다.
import { describe, expect, it } from 'vitest';

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
    const v = withRemoteFallback(local, async (token) => (token === 'good' ? ctx('remote') : null), (m) => warnings.push(m));
    expect((await v.verify('good'))?.userId).toBe('remote');
    expect(await v.verify('bad')).toBeNull();
    expect((await v.verify('good'))?.userId).toBe('remote');
    expect(warnings).toHaveLength(1);
  });

  it('원격이 던져도 401로 끝난다 — 예외가 밖으로 새지 않는다', async () => {
    const v = withRemoteFallback({ async verify() { return null; } }, async () => { throw new Error('network'); });
    expect(await v.verify('t')).toBeNull();
  });
});
