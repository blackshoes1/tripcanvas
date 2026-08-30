// Route Handler 동등성 — cron 인증·skip·starvation 방지 정렬을 fetch 경계로 재검증
import { describe, expect, it } from 'vitest';

import legacy from '@legacy/api/track-hotel-prices.js';
import { toRouteHandler } from '@/lib/legacy/nodeHandler';

const get = (route: (r: Request) => Promise<Response>, auth?: string) =>
  route(new Request('http://localhost/api/track-hotel-prices', {
    headers: auth ? { authorization: auth } : {}
  }));

describe('track-hotel-prices Route Handler (레거시 핸들러 어댑터)', () => {
  it('env 미설정이면 조용히 skip — 크론을 깨지 않는다', async () => {
    const route = toRouteHandler(legacy.createHandler({ env: {} }));
    const res = await get(route);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skipped: true, reason: 'not_configured' });
  });

  it('CRON_SECRET 인증 없이는 실행 금지 (비용 소진 방지)', async () => {
    const route = toRouteHandler(legacy.createHandler({
      env: { CRON_SECRET: 's', SUPABASE_SERVICE_ROLE_KEY: 'x', HOTEL_METASEARCH_API_KEY: 'y' }
    }));
    expect((await get(route)).status).toBe(401);
    expect((await get(route, 'Bearer wrong')).status).toBe(401);
  });

  it('실행 파이프라인 — DB 조회·starvation 방지 정렬·snapshot 기록이 어댑터를 통과한다', async () => {
    const future = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    const inserted: unknown[] = [];
    const fetchImpl = async (url: string, init?: { method?: string; body?: string }) => {
      const u = String(url);
      if (u.includes('/rest/v1/trips')) return { ok: true, json: async () => [{
        user_id: 'u1', client_id: 't1',
        data: { days: [], bookings: [
          { id: 'h1', type: 'hotel', title: 'Cap Rocat', price: 100, track: true, start: future(30), end: future(32) }
        ] }
      }] };
      if (u.includes('hotel_price_snapshots') && init?.method === 'POST') { inserted.push(JSON.parse(init.body!)); return { ok: true, json: async () => [] }; }
      if (u.includes('hotel_price_snapshots')) return { ok: true, json: async () => [] };
      // serpapi — 특정 호텔 직접 상세 응답 케이스
      return { ok: true, text: async () => JSON.stringify({
        name: 'Cap Rocat', property_token: 'tok',
        prices: [{ source: 'Expedia', rate_per_night: { extracted_lowest: 40 }, total_rate: { extracted_lowest: 80 } }]
      }) };
    };
    const route = toRouteHandler(legacy.createHandler({
      env: { CRON_SECRET: 's', SUPABASE_SERVICE_ROLE_KEY: 'k', HOTEL_METASEARCH_API_KEY: 'm', SUPABASE_URL: 'https://db.example.com' },
      fetchImpl: fetchImpl as never
    }));
    const res = await get(route, 'Bearer s');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.checked).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ booking_id: 'h1', currency: 'KRW' });
  });

  it('GET 외 메서드는 405', async () => {
    const route = toRouteHandler(legacy.createHandler({ env: {} }));
    const res = await route(new Request('http://localhost/api/track-hotel-prices', { method: 'POST' }));
    expect(res.status).toBe(405);
  });
});
