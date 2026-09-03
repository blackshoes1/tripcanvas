// 요청 컨텍스트(§16) — 인증 결과의 플랫폼 중립적 모양. 도메인 코드는 JWT payload를 모른다.
export interface RequestContext {
  /** 자체 users.id. Phase A에서는 Supabase user id와 같다 */
  userId: string;
  legacySupabaseUserId: string | null;
  email: string | null;
  sessionId: string | null;
  /** 토큰 만료(epoch 초). 실시간 접속이 토큰보다 오래 살지 않게 쓴다 — 없으면 만료로 끊지 않는다 */
  expiresAt?: number;
  tokenSource: 'supabase';
}

/** 토큰 → 컨텍스트. Phase 8의 새 Auth는 다른 구현을 꽂는다 — 호출측은 이 인터페이스만 본다 */
export interface TokenVerifier {
  verify(token: string): Promise<RequestContext | null>;
}
