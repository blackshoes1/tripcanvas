// 레거시 Vercel 함수((req,res) Node 스타일)를 Next Route Handler(fetch 스타일)로 감싸는 어댑터.
// Phase 3 이관 전략: HTTP 관심사(요청 검증·rate limit·오류 매핑)까지 포함한 레거시 핸들러를
// 그대로 실행해 동작 동등성을 구조적으로 보장한다 — 재구현은 레거시 제거(Phase 6) 때 한다.
// hotel-offers → car-offers → cron이 모두 이 어댑터 하나를 재사용한다.

export interface LegacyRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  socket: { remoteAddress?: string };
}

export interface LegacyResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

export type LegacyNodeHandler = (req: LegacyRequest, res: LegacyResponse) => void | Promise<void>;

/** fetch Request → 레거시 req 형태 (경로+쿼리 유지, 본문은 문자열 — 레거시 parseBody가 처리) */
async function toLegacyRequest(request: Request): Promise<LegacyRequest> {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  return {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text(),
    socket: { remoteAddress: headers['x-forwarded-for']?.split(',')[0]?.trim() }
  };
}

/** 레거시 핸들러를 Route Handler로 변환 — res.end()가 호출되면 Response로 resolve */
export function toRouteHandler(handler: LegacyNodeHandler): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const legacyReq = await toLegacyRequest(request);
    return new Promise<Response>((resolve, reject) => {
      const headers = new Headers();
      const res: LegacyResponse = {
        statusCode: 200,
        setHeader(name, value) { headers.set(name, value); },
        end(body) { resolve(new Response(body ?? '', { status: this.statusCode, headers })); }
      };
      Promise.resolve(handler(legacyReq, res)).catch(reject);
    });
  };
}
