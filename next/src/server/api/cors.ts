// CORS(§72). 정적 웹(tripcanvas-ai.vercel.app)과 API(tripcanvas-api.vercel.app)는 **다른 출처**다 —
// 웹이 Supabase 대신 이 API를 부르려면 브라우저가 교차 출처 요청을 허용해야 한다.
//
// `*`를 쓰지 않는다: 허용 목록에 있는 출처만 그대로 되돌려 준다.
//
// 이 앱의 웹 주소는 하나로 정해져 있으므로 **기본값으로 넣어 둔다** — 배포할 때 뭘 설정하지 않아도 그냥 동작해야 한다.
// 다른 주소를 쓰게 되면 TRUSTED_ORIGINS로 덮어쓴다(그때는 기본값을 쓰지 않는다).
// CORS는 '어느 웹사이트가 브라우저에서 이 API를 부를 수 있는가'만 정한다 — 데이터 접근은 여전히 토큰이 지킨다.
//
// /api/v1은 쿠키를 쓰지 않고 Authorization 헤더만 본다. 그래서 Allow-Credentials를 켜지 않는다
// (켜면 브라우저가 자격증명을 실어 보낼 수 있게 되고, 그만큼 실수의 여지가 는다).

const ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
/** 우리가 실제로 읽는 헤더. 브라우저가 더 보내겠다고 하면 아래 allowedRequestHeaders가 그것을 되돌려 준다 */
const ALLOW_HEADERS = 'Authorization, Content-Type';
/** 헤더 이름으로 성립하는 문자만(RFC 7230 token). 이상한 값을 그대로 되비추지 않는다 */
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
const MAX_REQUEST_HEADERS = 24;
/** 사전 요청 결과를 브라우저가 캐시하는 시간(초) */
const MAX_AGE = 600;

/** 이 앱이 실제로 쓰는 웹 주소. 설정이 없으면 이 목록을 쓴다 */
export const DEFAULT_ORIGINS = Object.freeze([
  'https://tripcanvas-ai.vercel.app',
  'http://localhost:8000'     // 로컬에서 열어 볼 때(README의 python3 -m http.server 8000)
]);

export function corsHeadersFor(origin: string | null, allowed: string[]): Record<string, string> {
  if (!origin) return {};
  // Vary는 허용 여부와 무관하게 붙인다 — 캐시가 한 출처의 응답을 다른 출처에 주지 않게
  const headers: Record<string, string> = { vary: 'Origin' };
  if (allowed.includes(origin)) headers['access-control-allow-origin'] = origin;
  return headers;
}

/**
 * 사전 요청이 "이 헤더들을 보내겠다"고 하면 **그대로 허용한다**.
 *
 * ⚠️ 고정 목록(Authorization·Content-Type)만 돌려주면, 브라우저가 스스로 얹는 헤더 하나에
 * 요청이 통째로 막힌다 — 개발자도구의 '캐시 사용 안 함'은 `cache-control`·`pragma`를 붙이고,
 * 그러면 사용자에게는 원인 없는 **CORS 오류**로만 보인다(2026-09-07).
 *
 * 여기서 허용을 넓혀도 서버가 더 하는 일은 없다 — 서버는 읽던 헤더만 읽고, 권한은 여전히 토큰이 지킨다.
 * 출처 허용 목록이 진짜 방어선이고 이건 브라우저에게 "그 헤더 보내도 된다"고 답하는 것뿐이다.
 * @param requested Access-Control-Request-Headers 값
 */
export function allowedRequestHeaders(requested: string | null): string {
  const names = (requested ?? '').split(',').map((h) => h.trim()).filter((h) => HEADER_NAME.test(h));
  return names.length ? names.slice(0, MAX_REQUEST_HEADERS).join(', ') : ALLOW_HEADERS;
}

/**
 * 사전 요청 하나에 필요한 정보. 브라우저가 무엇을 하겠다고 했는지 그대로 받는다.
 */
export interface PreflightRequest {
  /** Access-Control-Request-Headers */
  headers?: string | null;
  /**
   * Access-Control-Request-Private-Network — "이 요청의 목적지가 사설망 주소다"라는 브라우저의 신고.
   *
   * ⚠️ 우리 API 주소(`*.ts.net`)는 **보는 사람에 따라 사설 주소로 풀린다**: tailnet 안에서는
   * 100.x(RFC 6598)이고, 집 공유기가 MagicDNS를 쓰면 폰도 그렇게 받는다. 그러면 공개 출처인 웹이
   * 사설 주소를 부르는 모양이 되어 Chrome이 막는다 — 사용자에게는 원인 없는 **CORS 오류**로만 보인다.
   */
  privateNetwork?: boolean;
}

export function preflightResponse(origin: string | null, allowed: string[], request: PreflightRequest = {}): Response {
  const headers = new Headers(corsHeadersFor(origin, allowed));
  if (headers.has('access-control-allow-origin')) {
    headers.set('access-control-allow-methods', ALLOW_METHODS);
    headers.set('access-control-allow-headers', allowedRequestHeaders(request.headers ?? null));
    headers.set('access-control-max-age', String(MAX_AGE));
    // 허용 목록에 있는 출처일 때만 답한다 — 사설망 접근을 아무에게나 열지 않는다.
    if (request.privateNetwork) headers.set('access-control-allow-private-network', 'true');
  }
  return new Response(null, { status: 204, headers });
}

/**
 * 허용 출처 — 설정이 있으면 그것, 없으면 이 앱의 알려진 주소.
 * proxy는 무거운 모듈을 끌어오지 않으므로 여기서 직접 읽는다.
 */
export function readAllowedOrigins(env: Record<string, string | undefined>): string[] {
  const configured = (env.TRUSTED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  return configured.length ? configured : [...DEFAULT_ORIGINS];
}
