// 자체 Auth 세션 → RequestContext. PR2의 TokenVerifier 인터페이스를 그대로 구현하므로
// 라우트·허브는 어느 Auth로 들어왔는지 모른다(§16) — 그게 Auth를 교체 가능한 Infrastructure로 만드는 지점이다.
import type { AuthIdentityRepository } from '../repositories/types';
import type { BetterAuthInstance } from './betterAuth';
import { resolveDomainUser } from './identity';
import type { RequestContext, TokenVerifier } from './types';

export function createBetterAuthVerifier(
  auth: BetterAuthInstance,
  identities: AuthIdentityRepository
): TokenVerifier {
  return {
    async verify(token: string): Promise<RequestContext | null> {
      if (!token) return null;
      let session: Awaited<ReturnType<typeof auth.api.getSession>>;
      try {
        // bearer 플러그인이 Authorization 헤더의 세션 토큰을 받아 준다(iOS와 같은 경로, §70)
        session = await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) });
      } catch {
        return null;   // 만료·위조·형식 오류 — 이유를 구분하지 않는다(401 하나)
      }
      if (!session?.user?.id) return null;

      // 도메인 사용자로 잇는다. 이메일 미확인이면 null — 인증 실패로 다룬다(계정 탈취 방지, identity.ts)
      const userId = await resolveDomainUser(identities, {
        id: session.user.id, email: session.user.email, emailVerified: !!session.user.emailVerified
      });
      if (!userId) return null;

      const expiresAt = session.session?.expiresAt ? Math.floor(new Date(session.session.expiresAt).getTime() / 1000) : undefined;
      return {
        userId,
        legacySupabaseUserId: null,
        email: session.user.email ?? null,
        sessionId: session.session?.id ?? null,
        ...(expiresAt ? { expiresAt } : {}),
        tokenSource: 'tripcanvas'
      };
    }
  };
}
