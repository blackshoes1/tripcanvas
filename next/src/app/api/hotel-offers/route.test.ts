// Route Handler 동등성 — 레거시 테스트(test/api-hotel-offers.test.js)의 핵심 케이스를
// fetch 스타일 경계를 통과시켜 재검증한다: 어댑터가 메서드·본문·헤더·상태코드를 보존하는가.
import { beforeEach, describe, expect, it } from 'vitest';

import legacy from '@legacy/api/hotel-offers.js';
import { toRouteHandler } from '@/lib/legacy/nodeHandler';

const BODY = {
  name: 'Cap Rocat', lat: 39.4699, lng: 2.7166,
  checkIn: '2027-10-30', checkOut: '2027-11-01', adults: 2, rooms: 1, currency: 'KRW'
};

const LIST = { properties: [
  { name: 'Cap Rocat', property_token: 'tok_cap', gps_coordinates: { latitude: 39.4699, longitude: 2.7166 } }
] };
const DETAIL = {
  name: 'Cap Rocat',
  prices: [
    { source: 'Booking.com', link: 'https://www.booking.com/y', free_cancellation: true,
      rate_per_night: { extracted_lowest: 620000 }, total_rate: { extracted_lowest: 1240000 } },
    { source: 'Agoda', link: 'http://insecure.example.com', rate_per_night: { extracted_lowest: 580000 }, total_rate: { extracted_lowest: 1160000 } }
  ]
};
const fetchOK = async (url: string) =>
  ({ ok: true, text: async () => JSON.stringify(String(url).includes('property_token') ? DETAIL : LIST) });

function routeFor(env: Record<string, string>) {
  return toRouteHandler(legacy.createHandler({ env, fetchImpl: fetchOK as never }));
}

const post = (route: (r: Request) => Promise<Response>, body: unknown, ip = `t-${Math.random()}`) =>
  route(new Request('http://localhost/api/hotel-offers', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body)
  }));

beforeEach(() => { legacy._private.buckets.clear(); legacy._private.resetProviderMemory(); });

describe('hotel-offers Route Handler (레거시 핸들러 어댑터)', () => {
  it('키 없음 → 503 AUTH_REQUIRED (가짜 가격 금지)', async () => {
    const res = await post(routeFor({}), BODY);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'AUTH_REQUIRED' });
  });

  it('성공 조회 — 오퍼 정규화 + basis(P0-1) + 키 미노출', async () => {
    const res = await post(routeFor({ HOTEL_METASEARCH_API_KEY: 'sekrit-key' }), { ...BODY, rooms: 2 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('OK');
    expect(json.property.token).toBe('tok_cap');
    expect(json.basis).toMatchObject({ rooms: 1, requestedRooms: 2 });
    const agoda = json.offers.find((o: { seller: string }) => o.seller === 'Agoda');
    expect(agoda.link).toBeUndefined();          // http 딥링크 위생 유지
    expect(JSON.stringify(json)).not.toContain('sekrit');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('검증 오류 매핑 보존 — 잘못된 날짜 400, 허용 외 메서드 405', async () => {
    const route = routeFor({ HOTEL_METASEARCH_API_KEY: 'k' });
    const bad = await post(route, { ...BODY, checkIn: '10/30' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'INVALID_DATES' });
    const put = await route(new Request('http://localhost/api/hotel-offers', { method: 'PUT' }));
    expect(put.status).toBe(405);
    expect(put.headers.get('allow')).toBe('GET, POST');
  });

  it('GET health — Provider 상태 어휘(P0-2) 그대로', async () => {
    const route = routeFor({ HOTEL_METASEARCH_API_KEY: 'k', EXPEDIA_API_KEY: 'e' });
    const res = await route(new Request('http://localhost/api/hotel-offers?health=1'));
    expect(res.status).toBe(200);
    const by = Object.fromEntries((await res.json()).providers.map((p: { id: string; status: string }) => [p.id, p.status]));
    expect(by['google-hotels (serpapi)']).toBe('CREDENTIAL_READY');
    expect(by['booking.com']).toBe('AUTH_REQUIRED');
  });

  it('rate limit — 분당 상한 초과 시 429 (IP는 x-forwarded-for)', async () => {
    const route = routeFor({ HOTEL_METASEARCH_API_KEY: 'k' });
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await post(route, BODY, 'same-ip')).status;
    expect(last).toBe(429);
  });

  it('같은 origin이 아니면 403 (프록시 남용 방지 유지)', async () => {
    const route = routeFor({ HOTEL_METASEARCH_API_KEY: 'k' });
    const res = await route(new Request('http://localhost/api/hotel-offers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example.com', host: 'localhost' },
      body: JSON.stringify(BODY)
    }));
    expect(res.status).toBe(403);
  });
});
