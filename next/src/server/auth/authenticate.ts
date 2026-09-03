import { ApiError } from '../api/errors';
import type { RequestContext, TokenVerifier } from './types';

/** Authorization: Bearer <token> */
export function bearerToken(request: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec((request.headers.get('authorization') ?? '').trim());
  return m ? m[1].trim() : null;
}

/** 요청 → RequestContext. 실패는 UNAUTHORIZED 하나다 */
export async function authenticate(request: Request, verifier: TokenVerifier): Promise<RequestContext> {
  const token = bearerToken(request);
  const ctx = token ? await verifier.verify(token) : null;
  if (!ctx) throw new ApiError('UNAUTHORIZED');
  return ctx;
}
