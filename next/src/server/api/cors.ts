// CORS(§72). 정적 웹(tripcanvas-ai.vercel.app)과 API(tripcanvas-api.vercel.app)는 **다른 출처**다 —
// 웹이 Supabase 대신 이 API를 부르려면 브라우저가 교차 출처 요청을 허용해야 한다.
//
// `*`를 production 기본값으로 쓰지 않는다: 허용 목록(TRUSTED_ORIGINS)에 있는 출처만 그대로 되돌려 준다.
// 목록이 비어 있으면 아무 출처도 열지 않는다 — 설정을 잊었을 때 조용히 전부 열리는 편보다 막히는 편이 낫다.
//
// /api/v1은 쿠키를 쓰지 않고 Authorization 헤더만 본다. 그래서 Allow-Credentials를 켜지 않는다
// (켜면 브라우저가 자격증명을 실어 보낼 수 있게 되고, 그만큼 실수의 여지가 는다).

const ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const ALLOW_HEADERS = 'Authorization, Content-Type';
/** 사전 요청 결과를 브라우저가 캐시하는 시간(초) */
const MAX_AGE = 600;

export function corsHeadersFor(origin: string | null, allowed: string[]): Record<string, string> {
  if (!origin) return {};
  // Vary는 허용 여부와 무관하게 붙인다 — 캐시가 한 출처의 응답을 다른 출처에 주지 않게
  const headers: Record<string, string> = { vary: 'Origin' };
  if (allowed.includes(origin)) headers['access-control-allow-origin'] = origin;
  return headers;
}

export function preflightResponse(origin: string | null, allowed: string[]): Response {
  const headers = new Headers(corsHeadersFor(origin, allowed));
  if (headers.has('access-control-allow-origin')) {
    headers.set('access-control-allow-methods', ALLOW_METHODS);
    headers.set('access-control-allow-headers', ALLOW_HEADERS);
    headers.set('access-control-max-age', String(MAX_AGE));
  }
  return new Response(null, { status: 204, headers });
}

/** 환경변수에서 허용 출처 목록. proxy는 무거운 모듈을 끌어오지 않으므로 여기서 직접 읽는다 */
export function readAllowedOrigins(env: Record<string, string | undefined>): string[] {
  return (env.TRUSTED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
}
