// 경로 조회를 일으킨 사람이 구간 캐시까지 실려 가는가 — 하루 예산은 사람마다 센다(2026-10-02).
// 응답은 여전히 경로 조회를 기다리지 않는다: 하루치·전체는 상한까지만 읽고, 나머지는 응답 뒤에 채운다.
import { describe, expect, it } from 'vitest';

import type { TripDoc } from '../domain/todayView';
import type { Gateway, LegSupport, TripRow } from './handlers';
import { createHandlers } from './handlers';

const TOKEN = 'tok';
const USER = '00000000-0000-0000-0000-0000000000a1';

function setup() {
  const data: TripDoc = {
    id: 'trip-1', name: '마드리드', start: '2026-09-01', timeZone: 'Europe/Madrid',
    days: [{ title: '도착', mode: 'car', spots: [
      { name: '숙소', stay: true, lat: 40.40, lng: -3.7 }, { name: '미술관', lat: 40.41, lng: -3.7 }
    ] }]
  };
  const row: TripRow = { client_id: 'trip-1', data, revision: 1, updated_at: '2026-08-31T00:00:00Z', deleted_at: null };
  const seen: string[] = [];
  const legs: LegSupport = {
    async read(_t, _d, _w, userId) { seen.push(`read:${userId}`); return { cache: {}, pending: 0 }; },
    async readTrip(_t, _w, userId) { seen.push(`readTrip:${userId}`); return { cache: {}, pending: 0 }; },
    fillLater(_t, _d, userId) { seen.push(`fillLater:${userId}`); },
    fillTripLater(_t, userId) { seen.push(`fillTripLater:${userId}`); }
  };
  const gateway = {
    userId: USER,
    async listTrips() { return [row]; },
    async getTrip() { return row; },
    async saveTrip() { return { applied: false, conflict: true, revision: 1, data: null }; },
    async listDismissed() { return []; },
    async recordFeedback() {},
    async listPriceObservations() { return []; },
    async savePriceObservation() {},
    async listSentNotificationKeys() { return []; },
    async recordNotifications() {},
    async saveDevice() {},
    async removeDevice() {},
    async listMemories() { return []; },
    async saveMemory() { throw new Error('unused'); }
  } satisfies Gateway;
  const api = createHandlers({ gatewayFor: (t) => (t === TOKEN ? gateway : null), legs, now: () => new Date('2026-09-01T10:00:00Z') });
  const get = (path: string) => new Request(`http://localhost/api/v1/trips/trip-1${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  return { api, get, seen };
}

describe('경로 조회 — 누가 일으켰는가', () => {
  it('하루치·지금·전체 동선·비용 모두 요청한 사람으로 읽고 채운다', async () => {
    const { api, get, seen } = setup();
    expect((await api.dayPlan(get('/days/0'), 'trip-1', 0)).status).toBe(200);
    expect((await api.today(get('/today'), 'trip-1')).status).toBe(200);
    expect((await api.tripRoutes(get('/routes'), 'trip-1')).status).toBe(200);
    expect((await api.tripCosts(get('/costs'), 'trip-1')).status).toBe(200);
    expect(seen.length).toBeGreaterThanOrEqual(8);
    expect(seen.every((s) => s.endsWith(`:${USER}`))).toBe(true);
    expect(seen).toEqual(expect.arrayContaining([`read:${USER}`, `fillLater:${USER}`, `readTrip:${USER}`, `fillTripLater:${USER}`]));
  });
});
