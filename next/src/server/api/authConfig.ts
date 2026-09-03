// 어느 Auth로 로그인할지는 **서버가 정한다**(PR11). 클라이언트가 고르면, 서버에 자체 Auth가
// 꺼져 있는데 웹만 그쪽으로 로그인하려다 아무 데도 못 들어가는 상태가 된다 — 실시간 제공자를
// /api/v1/me가 정하는 것과 같은 이유다.
//
// 로그인 **전에** 알아야 하므로 토큰 없이 답한다. 그래서 여기에는 아무 비밀도 싣지 않는다:
// 무엇으로 로그인하는지와, 예전 계정이 비밀번호를 새로 정해야 하는지뿐이다.

export type AuthProvider = 'SUPABASE' | 'TRIPCANVAS';

export interface AuthConfigView {
  provider: AuthProvider;
  /**
   * 자체 Auth로 넘어간 뒤 예전 사용자는 비밀번호를 새로 정해야 한다(§19 — 해시를 옮기지 않는다).
   * 화면이 "틀렸다" 대신 재설정 길을 안내할지 정하는 신호다.
   */
  passwordResetRequiredForLegacyUsers: boolean;
}

/**
 * 자체 Auth 인스턴스가 실제로 만들어졌을 때만 TRIPCANVAS다.
 * `AUTH_SECRET`·`DATABASE_URL`이 없으면 instance.ts가 null을 주므로 오늘의 동작(SUPABASE)이 그대로다.
 */
export function resolveAuthProvider(newAuthEnabled: boolean): AuthConfigView {
  return newAuthEnabled
    ? { provider: 'TRIPCANVAS', passwordResetRequiredForLegacyUsers: true }
    : { provider: 'SUPABASE', passwordResetRequiredForLegacyUsers: false };
}
