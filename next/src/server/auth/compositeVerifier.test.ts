// 전환기의 토큰 검증(§14) — Supabase 토큰과 새 Auth 세션이 **한동안 같이** 살아 있어야 한다.
// 기존 앱(웹·iOS)이 아직 Supabase 토큰을 보내는 동안 새 Auth로 가입한 사람도 들어올 수 있어야 하기 때문이다.
import { describe, expect, it, vi } from 'vitest';

import { composeVerifiers } from './compositeVerifier';
import type { RequestContext, TokenVerifier } from './types';

const ctx = (userId: string): RequestContext => ({ userId, legacySupabaseUserId: null, email: null, sessionId: null, tokenSource: 'supabase' });
const yes = (userId: string, calls: string[], name: string): TokenVerifier => ({
  async verify(token) { calls.push(`${name}:${token}`); return token === name ? ctx(userId) : null; }
});

describe('composeVerifiers', () => {
  it('앞에서 맞으면 뒤는 부르지 않는다', async () => {
    const calls: string[] = [];
    const v = composeVerifiers(yes('u-1', calls, 'first'), yes('u-2', calls, 'second'));
    expect((await v.verify('first'))?.userId).toBe('u-1');
    expect(calls).toEqual(['first:first']);
  });

  it('앞에서 안 맞으면 뒤가 본다', async () => {
    const calls: string[] = [];
    const v = composeVerifiers(yes('u-1', calls, 'first'), yes('u-2', calls, 'second'));
    expect((await v.verify('second'))?.userId).toBe('u-2');
    expect(calls).toEqual(['first:second', 'second:second']);
  });

  it('아무도 못 알아보면 null', async () => {
    const v = composeVerifiers(yes('u-1', [], 'first'), yes('u-2', [], 'second'));
    expect(await v.verify('nope')).toBeNull();
  });

  it('하나가 터져도 다음이 본다 — 새 Auth의 DB 장애가 기존 로그인을 막지 않는다', async () => {
    const log = vi.fn();
    const broken: TokenVerifier = { async verify() { throw new Error('db down'); } };
    const v = composeVerifiers(broken, yes('u-2', [], 'second'), { log });
    expect((await v.verify('second'))?.userId).toBe('u-2');
    expect(log).toHaveBeenCalled();
  });

  it('전부 터지면 null이고 예외가 밖으로 새지 않는다', async () => {
    const broken: TokenVerifier = { async verify() { throw new Error('down'); } };
    const v = composeVerifiers(broken, broken, { log: vi.fn() });
    expect(await v.verify('x')).toBeNull();
  });
});
