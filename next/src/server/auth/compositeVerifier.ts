// 전환기의 토큰 검증(§14). Supabase 토큰과 새 Auth 세션이 한동안 같이 산다:
// 기존 앱은 아직 Supabase 토큰을 보내고, 새로 가입한 사람은 새 세션을 보낸다. 순서대로 물어보고 처음 알아본 쪽을 쓴다.
//
// 하나가 터져도 다음이 본다 — 새 Auth의 DB 장애가 기존 로그인을 통째로 막으면 안 된다.
import type { RequestContext, TokenVerifier } from './types';

export function composeVerifiers(
  ...args: [...TokenVerifier[], { log?: (message: string, error?: unknown) => void }] | TokenVerifier[]
): TokenVerifier {
  const last = args[args.length - 1];
  const hasOptions = last != null && typeof (last as TokenVerifier).verify !== 'function';
  const options = (hasOptions ? last : {}) as { log?: (message: string, error?: unknown) => void };
  const verifiers = (hasOptions ? args.slice(0, -1) : args) as TokenVerifier[];
  const log = options.log ?? ((m: string, e?: unknown) => console.warn(`[tripcanvas-api] ${m}`, e ?? ''));

  return {
    async verify(token: string): Promise<RequestContext | null> {
      for (const verifier of verifiers) {
        try {
          const ctx = await verifier.verify(token);
          if (ctx) return ctx;
        } catch (e) {
          log('토큰 검증기 하나가 실패했다 — 다음으로 넘어간다', e);
        }
      }
      return null;
    }
  };
}
