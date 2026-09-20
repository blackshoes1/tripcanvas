// 점검(읽기 전용) 모드 — 전환 직전의 write freeze(docs/production-cutover.md).
//
// 왜 필요한가: 마지막 덤프를 뜬 뒤 옛 DB에 한 건이라도 더 쓰이면 새 DB에는 없는 변경이 생긴다.
// 앱을 통째로 내리면 여행 중인 사용자가 아무것도 못 보므로, **읽기는 두고 쓰기만** 잠깐 막는다.
//
// 왜 503인가(그리고 404·200이 아닌가): 웹은 PUT이 404면 여행을 다시 만들고(api.js), 목록이 200에 비어 있으면
// "원격에 없음" 충돌 카드를 띄운다. 503은 두 클라이언트 모두 "잠시 후 다시"로 처리하고 편집을 기기에 남긴다.
import { corsHeadersFor } from './cors';
import { ApiError, JSON_HEADERS, type ErrorBody } from './errors';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const GUARDED_PREFIXES = ['/api/v1/', '/api/auth/'];

/** TC_READ_ONLY=1|true|on 이면 켜진다. 기본은 꺼짐 — 값이 없거나 이상하면 평소처럼 돈다 */
export function isReadOnly(env: Record<string, string | undefined>): boolean {
  const v = (env.TC_READ_ONLY ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

/** 이 요청이 점검 모드에서 막히는 쓰기인가 — 메서드와 경로만 본다 */
export function blocksWrite(method: string, pathname: string): boolean {
  if (READ_METHODS.has(method.toUpperCase())) return false;
  return GUARDED_PREFIXES.some((p) => pathname.startsWith(p));
}

/** 503 + 계약 그대로의 본문 + CORS. CORS 헤더가 없으면 브라우저는 이유 없는 네트워크 오류로 보여 준다 */
export function maintenanceResponse(origin: string | null, allowedOrigins: string[], retryAfterSeconds = 120): Response {
  const err = new ApiError('MAINTENANCE');
  const body: ErrorBody = { code: err.code, error: err.code, message: err.message };
  return new Response(JSON.stringify(body), {
    status: err.status,
    headers: { ...JSON_HEADERS, 'retry-after': String(retryAfterSeconds), ...corsHeadersFor(origin, allowedOrigins) }
  });
}
