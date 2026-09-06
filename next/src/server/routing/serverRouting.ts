// 서버 라우터 — 웹의 `routing.js`를 **그대로** 쓴다(복제하지 않는다, §엔진은 하나다).
//
// `createRoutingClient`는 fetch와 순수 함수를 주입받는 모듈이라 서버에서도 그대로 돈다.
// 다른 것은 둘뿐이다:
//   · 해외: Google Routes에 **서버 전용 키**로 붙는다(웹 키는 리퍼러 제한, iOS 키는 번들 제한이라 못 쓴다)
//   · 국내: routing.js가 `/api/kakao-directions`(Vercel 프록시)를 부르는데 서버에는 그 주소가 없다.
//     그래서 fetch가 그 경로를 가로채 **같은 프록시 코드**(`api/kakao-directions.js`)를 안에서 돌린다 —
//     좌표 검증·업스트림 호출·`safeRoute`가 Vercel과 한 글자도 다르지 않다.
//
// 키가 하나도 없으면 null이다 — 라우팅은 꺼져 있고 하루치는 지금처럼 직선 추정이다.
import kakaoDirections from '@legacy/api/kakao-directions.js';
import legacyLib from '@legacy/lib.js';
import routing from '@legacy/routing.js';

import { toRouteHandler } from '@/lib/legacy/nodeHandler';

const { encodePolyline, haversine, inKorea, ringPts } = legacyLib;

export interface ServerRoutingKeys {
  googleRoutesKey: string;
  kakaoRestKey: string;
}

export type LatLng = { lat: number; lng: number };
export type LegRoute = { sec: number; m: number; path: string | null; taxi?: number; snapped?: number };

/**
 * 조회 결과. **못 찾음(`ok:false`)에도 두 종류가 있다**:
 * `transient`는 지금 우리 쪽 사정(프록시 rate limit·키 없음·업스트림 5xx)이라 **캐시에 남기지 않는다** —
 * 남기면 잠깐의 혼잡이 한 시간짜리 "직선이에요"로 굳는다.
 */
export type LegOutcome = { ok: true; route: LegRoute } | { ok: false; transient: boolean };

export interface ServerRouter {
  fetchLeg(a: LatLng, b: LatLng, mode: string): Promise<LegOutcome>;
  /** 이 구간을 어느 provider가 맡는가 — 캐시 행에 남겨 나중에 원인을 되짚을 수 있게 */
  providerFor(a: LatLng, b: LatLng): 'google' | 'kakao';
  /** 그 provider의 키가 있는가. 없으면 그 구간은 아예 묻지 않는다 */
  canRoute(a: LatLng, b: LatLng): boolean;
}

/** 지금 실패가 '잠깐'인가 — 프록시 429/503, 업스트림 5xx·타임아웃. 키가 틀린 403은 아니다(계속 물으면 안 된다) */
function transientStatus(status: number): boolean {
  return status === 429 || status === 503 || status === 504 || status >= 500;
}

/**
 * `/api/kakao-directions`로 가는 요청은 프록시 코드로 안에서 처리하고, 나머지는 진짜 fetch로.
 * @param onStatus 내부·외부 응답 상태를 알린다(잠깐인 실패를 가려내려고)
 */
export function makeServerFetch(
  keys: ServerRoutingKeys, fetchImpl: typeof fetch, onStatus?: (status: number) => void
): typeof fetch {
  const kakao = toRouteHandler(kakaoDirections.createHandler({
    fetchImpl: fetchImpl as unknown as (url: string, init?: unknown) => Promise<unknown>,
    env: { KAKAO_REST_API_KEY: keys.kakaoRestKey }
  }));
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === '/api/kakao-directions' || url.endsWith('/api/kakao-directions')) {
      // 프록시는 Origin 헤더가 없으면 같은 출처로 본다 — 밖에서 온 요청이 아니라 우리가 안에서 부르는 것이다.
      // ⚠️ 분당 30번 제한은 그대로 걸린다(클라이언트 IP는 'unknown' 하나). 넘으면 429가 오고,
      //    그건 `transient`라 캐시에 남지 않고 다음 요청에서 다시 묻는다.
      const response = await kakao(new Request('http://internal/api/kakao-directions', init));
      onStatus?.(response.status);
      return response;
    }
    const response = await fetchImpl(input, init);
    onStatus?.(response.status);
    return response;
  }) as typeof fetch;
}

export function createServerRouter(keys: ServerRoutingKeys, fetchImpl: typeof fetch = fetch): ServerRouter | null {
  const hasGoogle = !!keys.googleRoutesKey;
  const hasKakao = !!keys.kakaoRestKey;
  if (!hasGoogle && !hasKakao) return null;

  const providerFor: ServerRouter['providerFor'] = (a, b) => (inKorea(a) && inKorea(b) ? 'kakao' : 'google');

  return {
    providerFor,
    canRoute: (a, b) => (providerFor(a, b) === 'kakao' ? hasKakao : hasGoogle),
    async fetchLeg(a, b, mode) {
      // 클라이언트를 구간마다 새로 만든다 — 상태(잠깐인 실패 표시)가 동시 호출끼리 섞이지 않게.
      // 닫힘 몇 개뿐이라 비용은 없다.
      let transient = false;
      const client = routing.createRoutingClient({
        fetchImpl: makeServerFetch(keys, fetchImpl, (status) => { if (transientStatus(status)) transient = true; }),
        googleKey: keys.googleRoutesKey,
        encodePolyline, ringPts, haversine, inKorea
      });
      try {
        const r = await client.fetchLeg(a, b, mode, null);
        if (!r || !(r.sec > 0)) return { ok: false, transient };
        return { ok: true, route: { sec: r.sec, m: r.m, path: r.path ?? null, taxi: r.taxi, snapped: r.snapped } };
      } catch {
        return { ok: false, transient: true };   // 네트워크 예외는 잠깐인 것으로 본다
      }
    }
  };
}
