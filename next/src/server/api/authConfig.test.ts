import { describe, expect, it } from 'vitest';

import { resolveAuthProvider } from './authConfig';

describe('resolveAuthProvider', () => {
  it('자체 Auth가 조립되지 않았으면 SUPABASE — 오늘의 동작이 기본값이다', () => {
    expect(resolveAuthProvider(false)).toEqual({ provider: 'SUPABASE', passwordResetRequiredForLegacyUsers: false });
  });

  it('자체 Auth가 켜졌으면 TRIPCANVAS이고, 예전 계정은 비밀번호를 새로 정해야 한다(§19)', () => {
    expect(resolveAuthProvider(true)).toEqual({ provider: 'TRIPCANVAS', passwordResetRequiredForLegacyUsers: true });
  });

  // 토큰 없이 답하는 엔드포인트라, 무엇이 실리는지를 여기서 고정한다 —
  // 필드를 늘리려면 반드시 이 테스트를 지나야 한다(비밀이 딸려 나가지 않게).
  it('싣는 것은 이 둘뿐이다', () => {
    for (const enabled of [true, false]) {
      expect(Object.keys(resolveAuthProvider(enabled)).sort())
        .toEqual(['passwordResetRequiredForLegacyUsers', 'provider']);
    }
  });
});
