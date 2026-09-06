import { describe, expect, it } from 'vitest';

import { createServerRouter, makeServerFetch } from './serverRouting';

// 여기서 지키는 것: **키가 없으면 아무 일도 일어나지 않고**, 국내 구간은 Vercel과 **같은 프록시 코드**를 지난다.

const SEOUL = { lat: 37.5665, lng: 126.978 };
const BUSAN = { lat: 35.1796, lng: 129.0756 };
const TOKYO = { lat: 35.6812, lng: 139.7671 };
const OSAKA = { lat: 34.7025, lng: 135.4959 };

const KEYS = { googleRoutesKey: 'g-key', kakaoRestKey: 'k-key' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const KAKAO_OK = {
  routes: [{
    result_code: 0,
    summary: { duration: 1200, distance: 8400, fare: { taxi: 9800 } },
    sections: [{ roads: [{ vertexes: [126.978, 37.5665, 126.99, 37.57] }] }]
  }]
};

describe('createServerRouter', () => {
  it('키가 하나도 없으면 null — 라우팅은 꺼져 있고 직선 추정 그대로다', () => {
    expect(createServerRouter({ googleRoutesKey: '', kakaoRestKey: '' }, fetch)).toBeNull();
  });

  it('키가 있는 provider의 구간만 묻는다', () => {
    const onlyKakao = createServerRouter({ googleRoutesKey: '', kakaoRestKey: 'k' }, fetch)!;
    expect(onlyKakao.canRoute(SEOUL, BUSAN)).toBe(true);
    expect(onlyKakao.canRoute(TOKYO, OSAKA)).toBe(false);

    const onlyGoogle = createServerRouter({ googleRoutesKey: 'g', kakaoRestKey: '' }, fetch)!;
    expect(onlyGoogle.canRoute(SEOUL, BUSAN)).toBe(false);
    expect(onlyGoogle.canRoute(TOKYO, OSAKA)).toBe(true);
  });

  it('국내 자차는 카카오 업스트림에 서버 키로 붙고, 결과는 웹과 같은 모양이다', async () => {
    const calls: string[] = [];
    const router = createServerRouter(KEYS, (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(url));
      expect((init?.headers as Record<string, string>).Authorization).toBe('KakaoAK k-key');
      return jsonResponse(KAKAO_OK);
    }) as typeof fetch)!;

    const outcome = await router.fetchLeg(SEOUL, BUSAN, 'car');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.route.sec).toBe(1200);
    expect(outcome.route.m).toBe(8400);
    expect(outcome.route.taxi).toBe(9800);
    expect(outcome.route.path).toBeTruthy();
    expect(calls[0]).toMatch(/^https:\/\/apis-navi\.kakaomobility\.com\/v1\/directions\?/);
    // 좌표는 lng,lat 순서다 — 뒤집히면 엉뚱한 나라의 경로가 온다
    expect(calls[0]).toContain(encodeURIComponent('126.978,37.5665'));
  });

  it('해외는 Google Routes에 서버 키로 붙는다', async () => {
    let apiKey = '';
    const router = createServerRouter(KEYS, (async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toContain('routes.googleapis.com');
      apiKey = (init?.headers as Record<string, string>)['X-Goog-Api-Key'];
      return jsonResponse({ routes: [{ duration: '600s', distanceMeters: 5000, polyline: { encodedPolyline: 'abc' } }] });
    }) as typeof fetch)!;

    const outcome = await router.fetchLeg(TOKYO, OSAKA, 'car');
    expect(apiKey).toBe('g-key');
    expect(outcome).toEqual({ ok: true, route: { sec: 600, m: 5000, path: 'abc', taxi: undefined, snapped: undefined } });
  });

  it('비행기·기차는 네트워크 없이 추정이다 — 캐시에 넣을 것이 아니라 채우기가 아예 부르지 않는다', async () => {
    let called = 0;
    const router = createServerRouter(KEYS, (async () => { called += 1; return jsonResponse({}); }) as typeof fetch)!;
    const outcome = await router.fetchLeg(SEOUL, TOKYO, 'flight');
    expect(outcome.ok).toBe(true);
    expect(called).toBe(0);
  });

  it('업스트림이 5xx면 잠깐인 실패다 — 캐시에 굳히지 않는다', async () => {
    const router = createServerRouter(KEYS, (async () => jsonResponse({ error: 'boom' }, 500)) as typeof fetch)!;
    expect(await router.fetchLeg(TOKYO, OSAKA, 'car')).toEqual({ ok: false, transient: true });
  });

  it('경로가 없다고 답하면 잠깐이 아니다 — 그 구간은 실패로 남아 한동안 다시 묻지 않는다', async () => {
    const router = createServerRouter(KEYS, (async () => jsonResponse({ routes: [] })) as typeof fetch)!;
    expect(await router.fetchLeg(TOKYO, OSAKA, 'car')).toEqual({ ok: false, transient: false });
  });

  it('네트워크가 던져도 예외를 밖으로 내보내지 않는다', async () => {
    const router = createServerRouter(KEYS, (async () => { throw new Error('offline'); }) as typeof fetch)!;
    expect(await router.fetchLeg(TOKYO, OSAKA, 'car')).toEqual({ ok: false, transient: true });
  });
});

describe('makeServerFetch', () => {
  it('/api/kakao-directions만 가로채고 나머지는 그대로 나간다', async () => {
    const seen: string[] = [];
    const f = makeServerFetch(KEYS, (async (url: RequestInfo | URL) => {
      seen.push(String(url));
      return jsonResponse(KAKAO_OK);
    }) as typeof fetch);

    const proxied = await f('/api/kakao-directions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: SEOUL, destination: BUSAN })
    });
    expect(proxied.status).toBe(200);
    expect(seen[0]).toContain('apis-navi.kakaomobility.com');

    await f('https://example.test/other');
    expect(seen[1]).toBe('https://example.test/other');
  });

  it('카카오 키가 없으면 프록시가 503으로 막는다 — 업스트림에 키 없이 나가지 않는다', async () => {
    let called = 0;
    const f = makeServerFetch({ googleRoutesKey: 'g', kakaoRestKey: '' },
      (async () => { called += 1; return jsonResponse({}); }) as typeof fetch);
    const response = await f('/api/kakao-directions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: SEOUL, destination: BUSAN })
    });
    expect(response.status).toBe(503);
    expect(called).toBe(0);
  });
});
