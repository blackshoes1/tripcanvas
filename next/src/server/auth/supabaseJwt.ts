// Supabase access token 검증(Phase A, §15). Supabase에 물어보지 않고 서명을 직접 확인한다.
//   비대칭 키(ES256/RS256): ${SUPABASE_URL}/auth/v1/.well-known/jwks.json (jose가 캐시한다)
//   HS256: 프로젝트 JWT secret이 설정돼 있을 때만 — 없으면 그 토큰은 거절
// issuer는 ${SUPABASE_URL}/auth/v1, audience는 'authenticated'여야 한다 — 다른 프로젝트의 토큰이 통하지 않게.
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTVerifyGetKey } from 'jose';

import type { RequestContext, TokenVerifier } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SupabaseVerifierOptions {
  supabaseUrl: string;
  jwtSecret: string | null;
  /** 테스트·오프라인용 키 공급자. 없으면 원격 JWKS */
  jwks?: JWTVerifyGetKey;
}

export function createSupabaseVerifier(opts: SupabaseVerifierOptions): TokenVerifier {
  const issuer = `${opts.supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
  const jwks = opts.jwks ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const secret = opts.jwtSecret ? new TextEncoder().encode(opts.jwtSecret) : null;

  return {
    async verify(token: string): Promise<RequestContext | null> {
      if (!token) return null;
      try {
        const header = decodeProtectedHeader(token);
        const isHmac = typeof header.alg === 'string' && header.alg.startsWith('HS');
        if (isHmac && !secret) return null;
        const { payload } = isHmac
          ? await jwtVerify(token, secret!, { issuer, audience: 'authenticated' })
          : await jwtVerify(token, jwks, { issuer, audience: 'authenticated' });
        const sub = typeof payload.sub === 'string' ? payload.sub : '';
        if (!UUID.test(sub)) return null;
        return {
          userId: sub,
          legacySupabaseUserId: sub,
          email: typeof payload.email === 'string' && payload.email ? payload.email : null,
          sessionId: typeof payload.session_id === 'string' && payload.session_id ? payload.session_id : null,
          tokenSource: 'supabase'
        };
      } catch {
        return null;   // 만료·서명 불일치·형식 오류 — 이유는 구분하지 않는다(401 하나)
      }
    }
  };
}
