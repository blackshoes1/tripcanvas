// Phase A 안전장치 — 로컬 JWT 검증이 실패하면 예전 방식(Supabase에 getUser)으로 한 번 더 확인한다.
// 프로젝트가 아직 HS256으로 서명하는데 SUPABASE_JWT_SECRET이 없으면 로컬은 전부 실패한다 — 그날 전 사용자가 401을 받으면 안 된다.
// 폴백이 실제로 쓰이면 한 번 경고를 남긴다: 그게 보이면 secret을 넣거나 프로젝트를 비대칭 키로 옮긴다.
import type { RequestContext, TokenVerifier } from './types';

export function withRemoteFallback(
  local: TokenVerifier,
  remote: (token: string) => Promise<RequestContext | null>,
  warn: (message: string) => void = (m) => console.warn(`[tripcanvas-api] ${m}`)
): TokenVerifier {
  let warned = false;
  return {
    async verify(token: string): Promise<RequestContext | null> {
      const ctx = await local.verify(token);
      if (ctx) return ctx;
      try {
        const remoteCtx = await remote(token);
        if (remoteCtx && !warned) {
          warned = true;
          warn('Supabase 토큰의 로컬 검증이 실패해 원격(getUser)으로 확인했다 — HS256 프로젝트면 SUPABASE_JWT_SECRET을 설정할 것');
        }
        return remoteCtx;
      } catch {
        return null;
      }
    }
  };
}
