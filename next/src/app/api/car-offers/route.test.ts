// Route Handler 동등성 — 레거시 test/api-car-offers.test.js 핵심 케이스를 fetch 경계로 재검증
import { beforeEach, describe, expect, it } from 'vitest';

import legacy from '@legacy/api/car-offers.js';
import { toRouteHandler } from '@/lib/legacy/nodeHandler';

const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const BODY = {
  pickup: 'PMI', pickupCode: 'PMI', 'return': 'BCN', returnCode: 'BCN',
  pickupAt: `${day(30)}T10:00`, returnAt: `${day(34)}T10:00`, driverAge: 35, currency: 'EUR'
};

const post = (route: (r: Request) => Promise<Response>, body: unknown = BODY) =>
  route(new Request('http://localhost/api/car-offers', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `t-${Math.random()}` },
    body: JSON.stringify(body)
  }));
const health = (route: (r: Request) => Promise<Response>) =>
  route(new Request('http://localhost/api/car-offers?health'));

beforeEach(() => legacy._private.buckets.clear());

describe('car-offers Route Handler (레거시 핸들러 어댑터)', () => {
  it('Provider 없음 — health 상태 어휘(P0-2) + 검색 503 AUTH_REQUIRED (가짜 가격 금지)', async () => {
    const none = toRouteHandler(legacy.createHandler({ env: {} }));
    expect((await (await health(none)).json()).providers[0]).toMatchObject({ status: 'UNCONFIGURED', credentials: 'MISSING' });
    const res = await post(none);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'AUTH_REQUIRED' });

    // 키만 있고 adapter 미구현 → CREDENTIAL_READY (CONNECTED 금지), 키 값 미노출
    const keyed = toRouteHandler(legacy.createHandler({ env: { CAR_DISCOVERY_API_KEY: 'tp_secret_value' } }));
    const h = (await (await health(keyed)).json()).providers[0];
    expect(h.status).toBe('CREDENTIAL_READY');
    expect(JSON.stringify(h)).not.toContain('tp_secret_value');
  });

  it('failover — 한 Provider 실패가 전체를 막지 않고, 정규화·정렬 유지', async () => {
    const failing = { id: 'a', status: () => 'CONNECTED', search: async () => { throw Object.assign(new Error('x'), { code: 'NETWORK_ERROR' }); } };
    const working = { id: 'b', status: () => 'CONNECTED', search: async () => ({ offers: [
      { sellerName: 'Sixt', totalPrice: 258, deepLink: 'http://insecure.example.com/x' },
      { sellerName: 'Europcar', totalPrice: 247 }
    ] }) };
    const route = toRouteHandler(legacy.createHandler({ env: {}, adapters: [failing, working] }));
    const res = await post(route);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.offers.map((o: { seller: string }) => o.seller)).toEqual(['Europcar', 'Sixt']);   // 총액 오름차순
    expect(json.offers[1].link).toBeUndefined();   // http 딥링크 위생 유지
  });

  it('요청 검증 매핑 보존 — 당일 대여는 시각 순서만 본다', async () => {
    const route = toRouteHandler(legacy.createHandler({
      env: {}, adapters: [{ id: 'b', status: () => 'CONNECTED', search: async () => ({ offers: [{ sellerName: 'Sixt', totalPrice: 258 }] }) }]
    }));
    const sameDayOk = await post(route, { ...BODY, pickupAt: `${day(30)}T09:00`, returnAt: `${day(30)}T19:00` });
    expect(sameDayOk.status).toBe(200);
    const reversed = await post(route, { ...BODY, returnAt: BODY.pickupAt });
    expect(reversed.status).toBe(400);
    expect(await reversed.json()).toMatchObject({ error: 'INVALID_DATE_ORDER' });
  });
});
