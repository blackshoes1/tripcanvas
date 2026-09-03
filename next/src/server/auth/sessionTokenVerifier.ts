// 자체 Auth 세션을 **better-auth를 import하지 않고** 검증한다.
//
// 왜: 실시간 사이드카는 Next 번들 밖의 독립 프로세스이고 CommonJS로 컴파일된다(tsconfig.tools.json).
// better-auth는 ESM 전용이라 그대로는 들어오지 않는다. 사이드카가 알아야 하는 것은 하나뿐이다 —
// "이 토큰이 살아 있는 세션인가, 누구의 것인가". 그건 저장소 질문이지 Auth 라이브러리 질문이 아니다.
//
// bearer 토큰의 모양: `<token>.<signature>`
//   · signature = base64(HMAC-SHA256(AUTH_SECRET, token))
//   · DB(auth_session.token)에는 **서명 없는 token만** 들어 있다
//
// ⚠️ 이 모양은 better-auth가 정한 것이고 우리가 설계한 것이 아니다(§18 — 세션 토큰을 직접 만들지 않는다).
// 라이브러리가 바꾸면 여기가 조용히 전원을 막게 되므로, **진짜 better-auth로 세션을 만들어** 이 검증기가
// 그것을 받아들이는지 확인하는 테스트(sessionTokenVerifier.test.ts)가 이 가정을 붙들고 있다.
//
// 서명을 굳이 확인하는 이유: 확인하지 않아도 DB 조회만으로 인증 강도는 같지만(토큰 자체가 비밀이다),
// 그러면 사이드카가 API보다 **무른 문**이 된다. 같은 토큰을 두 곳이 다른 기준으로 받아들이면 안 된다.
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { AuthIdentityRepository, AuthSessionRepository } from '../repositories/types';
import { resolveDomainUser } from './identity';
import type { RequestContext, TokenVerifier } from './types';

export interface SessionTokenVerifierOptions {
  sessions: AuthSessionRepository;
  identities: AuthIdentityRepository;
  /** better-auth와 **같은** AUTH_SECRET. 다르면 모든 서명이 어긋난다 */
  secret: string;
  /** 테스트가 시간을 주입한다 */
  now?: () => Date;
}

/** `<token>.<signature>` — 마지막 점에서 가른다(토큰에는 점이 없지만 서명 base64에는 있을 수 있다) */
export function splitSignedToken(bearer: string): { token: string; signature: string } | null {
  const at = bearer.lastIndexOf('.');
  if (at <= 0 || at === bearer.length - 1) return null;
  return { token: bearer.slice(0, at), signature: bearer.slice(at + 1) };
}

/** 길이가 달라도 시간으로 새어 나가지 않게 — 비교 전에 길이를 먼저 본다 */
function signatureMatches(secret: string, token: string, signature: string): boolean {
  const expected = Buffer.from(createHmac('sha256', secret).update(token).digest('base64'), 'utf8');
  const got = Buffer.from(signature, 'utf8');
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function createSessionTokenVerifier(opts: SessionTokenVerifierOptions): TokenVerifier {
  const now = opts.now ?? (() => new Date());
  return {
    async verify(bearer: string): Promise<RequestContext | null> {
      if (!bearer || !opts.secret) return null;
      const parts = splitSignedToken(bearer);
      if (!parts || !signatureMatches(opts.secret, parts.token, parts.signature)) return null;

      const session = await opts.sessions.findByToken(parts.token);
      if (!session) return null;
      if (session.expiresAt.getTime() <= now().getTime()) return null;

      // 이메일 미확인이면 null — 인증 실패로 다룬다(계정 탈취 방지, identity.ts). API와 같은 규칙이다.
      const userId = await resolveDomainUser(opts.identities, {
        id: session.authUserId, email: session.email ?? '', emailVerified: session.emailVerified
      });
      if (!userId) return null;

      return {
        userId,
        legacySupabaseUserId: null,
        email: session.email ?? null,
        sessionId: session.sessionId,
        expiresAt: Math.floor(session.expiresAt.getTime() / 1000),
        tokenSource: 'tripcanvas'
      };
    }
  };
}
