import { afterEach, expect, it, vi } from 'vitest';
import api from '@legacy/api.js';
import type { Trip } from '@/features/trip/domain/types';
import { listSnapshots, loadSnapshot } from './tripSnapshots';
import { pullPriceSnapshots } from '@/features/pricing/services/priceCloud';

vi.mock('./tripCanvasClient', async () => ({ cloudApi: (await import('@legacy/api.js')).default, hasCloudSession: () => true }));
afterEach(() => vi.unstubAllGlobals());

it('loads a snapshot inside its trip and normalizes the document without losing unknown fields', async () => {
  api.configure({ baseUrl: 'http://api.test', getToken: async () => 'token' });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    expect(url).toBe('http://api.test/api/v1/trips/trip1/snapshots/12');
    return Response.json({ snapshot: { data: { id: 'trip1', name: '버전', days: [{ spots: [] }], future: { keep: true } } } });
  }));
  expect(await loadSnapshot('trip1', 12)).toMatchObject({ ok: true, trip: { future: { keep: true } } });
});

it('snapshot transport failure is not an empty history', async () => {
  api.configure({ baseUrl: 'http://api.test', getToken: async () => 'token' });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'NOT_FOUND' }, { status: 404 })));
  await expect(listSnapshots('trip1')).rejects.toThrow('버전 이력을 불러오지 못했어요');
});

it('price history uses trip-scoped API authorization and keeps matching booking observations', async () => {
  api.configure({ baseUrl: 'http://api.test', getToken: async () => 'token' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe('http://api.test/api/v1/trips/trip1/prices');
    expect(init.headers).toMatchObject({ authorization: 'Bearer token' });
    return Response.json({ observations: [
      { booking_id: 'hotel1', price: 90000, currency: 'KRW', seller: 'test', quality: 'SIMILAR', verified: false, offers: [], observed_at: new Date().toISOString() },
      { booking_id: 'other', price: 1, observed_at: new Date().toISOString() }
    ] });
  }));
  const trips = [{ id: 'trip1', bookings: [{ id: 'hotel1', type: 'hotel' }] }] as Trip[];
  const merged = await pullPriceSnapshots(trips, {});
  expect(merged?.hotel1.obs[0]).toMatchObject({ price: 90000, cur: 'KRW' });
  expect(merged?.other).toBeUndefined();
});
