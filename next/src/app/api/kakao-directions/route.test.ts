// Route Handler 동등성 — 레거시 kakao-directions 핸들러의 핵심 계약을 fetch 경계로 재검증
import legacy from '@legacy/api/kakao-directions.js';
import { beforeEach, describe, expect, it } from 'vitest';

import { toRouteHandler } from '@/lib/legacy/nodeHandler';

const BODY = { origin: { lat: 33.5104, lng: 126.4914 }, destination: { lat: 33.4587, lng: 126.9425 } };
const post = (route: (r: Request) => Promise<Response>, body: unknown = BODY, method = 'POST') =>
  route(new Request('http://localhost/api/kakao-directions', {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `t-${Math.random()}` },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {})
  }));

beforeEach(() => legacy._private.buckets.clear());

describe('kakao-directions Route Handler (레거시 핸들러 어댑터)', () => {
  it('키 없으면 503 — 가짜 경로 금지, 잘못된 좌표는 400', async () => {
    const route = toRouteHandler(legacy.createHandler({ env: {} }));
    const noKey = await post(route);
    expect(noKey.status).toBe(503);
    expect(await noKey.json()).toMatchObject({ error: 'service_unavailable' });

    const bad = await post(route, { origin: { lat: 999, lng: 0 }, destination: BODY.destination });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'invalid_coordinates' });
  });

  it('업스트림 응답 위생(safeRoute) — 필요한 필드만, 좌표는 유한수만 통과', async () => {
    const upstream = {
      routes: [{
        result_code: 0,
        summary: { duration: 3600, distance: 40000, fare: { taxi: 45000, extra: 'strip-me' } },
        sections: [{ roads: [{ vertexes: [126.49, 33.51, NaN, 126.94, 33.45], name: 'strip-me' }] }],
        secret: 'strip-me'
      }]
    };
    const route = toRouteHandler(legacy.createHandler({
      env: { KAKAO_REST_API_KEY: 'k' },
      fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify(upstream) })
    }));
    const res = await post(route);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.route.summary).toEqual({ duration: 3600, distance: 40000, fare: { taxi: 45000 } });
    expect(json.route.sections[0].roads[0].vertexes).toEqual([126.49, 33.51, 126.94, 33.45]);   // NaN 제거
    expect(JSON.stringify(json)).not.toContain('strip-me');
  });

  it('경로 실패 코드는 422+code로 전달(라우팅의 인근 도로 스냅 재시도 근거), POST 외는 405', async () => {
    const route = toRouteHandler(legacy.createHandler({
      env: { KAKAO_REST_API_KEY: 'k' },
      fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify({ routes: [{ result_code: 102, summary: null }] }) })
    }));
    const res = await post(route);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'route_unavailable', code: 102 });

    const get = await post(route, undefined, 'GET');
    expect(get.status).toBe(405);
  });
});

// NAS에서는 Funnel(tailscaled)이 본 주소를 X-Forwarded-For에 싣는다. 그 앞에 클라이언트가 써 넣은 값이나
// `x-vercel-forwarded-for`(Vercel 밖에서는 아무나 보낼 수 있다)로는 새 버킷을 만들 수 없어야 한다.
describe('kakao-directions rate limit 키 (Vercel 밖)', () => {
  const from = (headers: Record<string, string>) => toRouteHandler(legacy.createHandler({ env: {} }))(
    new Request('http://localhost/api/kakao-directions', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(BODY)
    }));

  it('x-vercel-forwarded-for를 바꿔도 같은 사람이다', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      statuses.push((await from({ 'x-forwarded-for': '203.0.113.9', 'x-vercel-forwarded-for': `v-${Math.random()}` })).status);
    }
    expect(statuses.slice(0, 30)).not.toContain(429);
    expect(statuses[30]).toBe(429);
  });

  it('X-Forwarded-For 앞쪽에 써 넣은 값은 키가 되지 않는다 — 마지막(앞단 프록시가 붙인) 주소만', async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await from({ 'x-forwarded-for': `f-${Math.random()}, 203.0.113.10` })).status;
    expect(last).toBe(429);
  });

  // 위 둘은 '한 버킷에 쌓인다'만 본다 — 어댑터가 주소를 잃어 모두가 'ip:unknown' 하나가 돼도 통과한다.
  // 그러면 한 사람이 31번 보내는 것으로 모든 사용자의 국내 경로 조회가 429다.
  it('앞단 프록시가 붙인 주소가 다르면 다른 사람이다 — 한 사람이 다 써도 다른 사람은 막히지 않는다', async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await from({ 'x-forwarded-for': 'x, 203.0.113.10' })).status;
    expect(last).toBe(429);
    expect((await from({ 'x-forwarded-for': 'y, 203.0.113.11' })).status).not.toBe(429);
  });
});
