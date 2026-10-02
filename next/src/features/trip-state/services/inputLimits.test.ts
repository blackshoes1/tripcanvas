// /api/v1 입력 상한 — 본문 크기와 필드 길이(2026-10-02).
// 지키는 것: 너무 큰 본문은 **읽기를 멈추고** 거절한다 · 식별자는 자르지 않고 거절한다 · 정상 앱이 보내는 값은 그대로 지나간다.
import { beforeEach, describe, expect, it } from 'vitest';

import type { DeviceRegistration } from '../domain/contract';
import type { PriceObservation } from '../domain/bookingsView';
import type { MemoryRow } from '../domain/intakeView';
import type { TripDoc } from '../domain/todayView';
import { REQUEST_BODY_MAX_BYTES } from '@/server/api/jsonBody';
import type { Gateway, TripRow } from './handlers';
import { createHandlers } from './handlers';
import { ASSET_REF_MAX, MEMORY_CLIENT_KEY_MAX } from './routes/intake';
import { APP_VERSION_MAX, DEVICE_ID_MAX, PUSH_TOKEN_MAX } from './routes/devices';
import { OFFER_MAX_CHARS } from './routes/prices';

const TOKEN = 'test-token';
const NOW = new Date('2026-09-01T04:00:00Z');
const UUID = '6F9619FF-8B86-D011-B42D-00C04FC964FF';
const APNS = 'a'.repeat(64);

function tripDoc(): TripDoc {
  return {
    id: 'trip-1', name: '마드리드', start: '2026-09-01', timeZone: 'Asia/Seoul',
    days: [{ title: '도착', mode: 'car', startAt: '09:00', spots: [
      { name: '숙소', city: '마드리드', stay: true, stayMin: 0, lat: 40.40, lng: -3.7 },
      { name: '미술관', city: '마드리드', stayMin: 90, lat: 40.41, lng: -3.7 }
    ] }]
  };
}

let row: TripRow;
let devices: DeviceRegistration[];
let memories: MemoryRow[];
let observations: Array<Omit<PriceObservation, 'observed_at'>>;
let saves: number;
let api: ReturnType<typeof createHandlers>;

beforeEach(() => {
  row = { client_id: 'trip-1', data: tripDoc(), revision: 3, updated_at: '2026-08-31T00:00:00Z', deleted_at: null };
  devices = []; memories = []; observations = []; saves = 0;
  const gateway = {
    async listTrips() { return [row]; },
    async getTrip(id: string) { return id === row.client_id ? row : null; },
    async saveTrip(_id: string, data: TripDoc, expected: number) {
      saves += 1;
      if (expected !== row.revision) return { applied: false, conflict: true, revision: row.revision, data: null };
      row = { ...row, data, revision: row.revision + 1 };
      return { applied: true, conflict: false, revision: row.revision, data };
    },
    async listDismissed() { return []; },
    async listAccepted() { return []; },
    async recordFeedback() {},
    async listPriceObservations() { return []; },
    async savePriceObservation(_t: string, obs: Omit<PriceObservation, 'observed_at'>) { observations.push(obs); },
    async listSentNotificationKeys() { return []; },
    async recordNotifications() {},
    async saveDevice(registration: DeviceRegistration) { devices.push(registration); },
    async removeDevice(deviceId: string) { devices = devices.filter((d) => d.deviceId !== deviceId); },
    async listMemories() { return memories; },
    async saveMemory(_tripId: string, memory: Omit<MemoryRow, 'id'>) {
      const saved: MemoryRow = { id: `mem${memories.length + 1}`, ...memory };
      memories.push(saved);
      return { row: saved, created: true };
    }
  } satisfies Gateway;
  api = createHandlers({ gatewayFor: (token) => (token === TOKEN ? gateway : null), now: () => NOW });
});

const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost/api/v1${path}`, {
    method: 'POST', body,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers }
  });
/** 상한을 1바이트 넘는 JSON — 필드는 정상이고 덧붙인 칸만 크다 */
const oversized = (fields: Record<string, unknown>) => {
  const head = JSON.stringify({ ...fields, pad: '' });
  return head.replace('"pad":""', `"pad":"${'x'.repeat(REQUEST_BODY_MAX_BYTES - head.length + 1)}"`);
};

describe('본문 크기 상한', () => {
  it('너무 큰 본문은 400 BAD_REQUEST와 이유 — 기기 등록은 일어나지 않는다', async () => {
    const res = await api.registerDevice(post('/devices', oversized({ deviceId: UUID, pushToken: APNS })));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; message: string };
    expect(body.error).toBe('BAD_REQUEST');
    expect(body.message).toContain('너무 커요');
    expect(devices).toEqual([]);
  });

  it('길이를 밝힌 큰 본문은 읽기 전에 거절한다', async () => {
    const request = post('/devices', JSON.stringify({ deviceId: UUID, pushToken: APNS }), { 'content-length': String(REQUEST_BODY_MAX_BYTES + 1) });
    expect((await api.registerDevice(request)).status).toBe(400);
    expect(request.bodyUsed).toBe(false);
  });

  it('⚠️ 너무 큰 본문을 빈 본문으로 넘기지 않는다 — revision 확인 없이 완료 처리가 저장되면 안 된다', async () => {
    const res = await api.activityAction(post('/trips/trip-1/activities/d0s1/complete', oversized({ expectedRevision: 1 })), 'trip-1', 'd0s1', 'complete');
    expect(res.status).toBe(400);
    expect(saves).toBe(0);
    expect(row.revision).toBe(3);
  });

  it('기록·가격·제안·들여오기도 같은 상한을 지난다', async () => {
    expect((await api.createMemory(post('/trips/trip-1/memories', oversized({ type: 'NOTE' })), 'trip-1')).status).toBe(400);
    expect((await api.createPrice(post('/trips/trip-1/prices', oversized({ bookingId: 'b1', price: 1 })), 'trip-1')).status).toBe(400);
    expect((await api.suggestionAction(post('/trips/trip-1/suggestions/skip', oversized({ suggestionId: 's1' })), 'trip-1', 'skip')).status).toBe(400);
    expect((await api.importPreview(post('/import/preview', oversized({ text: '예약' })))).status).toBe(400);
    expect((await api.importCommit(post('/trips/trip-1/import/commit', oversized({ candidate: {} })), 'trip-1')).status).toBe(400);
    expect(memories).toEqual([]);
    expect(observations).toEqual([]);
    expect(saves).toBe(0);
  });

  it('JSON이 아닌 본문은 예전처럼 빈 본문 — 필드가 없으니 400', async () => {
    expect((await api.registerDevice(post('/devices', 'null'))).status).toBe(400);
    expect((await api.registerDevice(post('/devices', '{깨짐'))).status).toBe(400);
  });
});

describe('기기 등록 — 식별자는 자르지 않고 거절한다', () => {
  it('앱이 보내는 값(UUID · APNs 16진 64자 · 버전)은 그대로 등록된다', async () => {
    const res = await api.registerDevice(post('/devices', JSON.stringify({ deviceId: UUID, pushToken: APNS, platform: 'ios', appVersion: '1.4.2' })));
    expect(res.status).toBe(200);
    expect(devices).toMatchObject([{ deviceId: UUID, pushToken: APNS, appVersion: '1.4.2' }]);
  });

  it('너무 긴 기기 id·푸시 토큰은 400 — 등록하지 않는다', async () => {
    const longId = await api.registerDevice(post('/devices', JSON.stringify({ deviceId: 'd'.repeat(DEVICE_ID_MAX + 1), pushToken: APNS })));
    expect(longId.status).toBe(400);
    const longToken = await api.registerDevice(post('/devices', JSON.stringify({ deviceId: UUID, pushToken: 't'.repeat(PUSH_TOKEN_MAX + 1) })));
    expect(longToken.status).toBe(400);
    expect(devices).toEqual([]);
    // 경계값은 지나간다
    expect((await api.registerDevice(post('/devices', JSON.stringify({ deviceId: 'd'.repeat(DEVICE_ID_MAX), pushToken: 't'.repeat(PUSH_TOKEN_MAX) })))).status).toBe(200);
  });

  it('앱 버전은 기록용이라 잘라서 남긴다', async () => {
    await api.registerDevice(post('/devices', JSON.stringify({ deviceId: UUID, pushToken: APNS, appVersion: 'v'.repeat(500) })));
    expect(devices[0].appVersion).toBe('v'.repeat(APP_VERSION_MAX));
  });

  it('해제도 같은 기기 id 상한', async () => {
    const del = (id: string) => api.unregisterDevice(new Request(`http://localhost/api/v1/devices?deviceId=${id}`, {
      method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}` }
    }));
    expect((await del('d'.repeat(DEVICE_ID_MAX + 1))).status).toBe(400);
    expect((await del(UUID)).status).toBe(200);
  });
});

describe('기록 — 사진 참조와 재시도 키', () => {
  const create = (body: Record<string, unknown>) => api.createMemory(post('/trips/trip-1/memories?now=10:00', JSON.stringify(body)), 'trip-1');

  it('앱이 보내는 PhotosPicker 식별자와 UUID 키는 그대로 남는다', async () => {
    const ref = `${UUID}/L0/001`;
    const res = await create({ type: 'PHOTO', assetRefs: [ref], clientKey: UUID });
    expect(res.status).toBe(200);
    expect(memories[0]).toMatchObject({ asset_refs: [ref], client_key: UUID });
  });

  it('식별자라기엔 너무 긴 사진 참조는 걸러 낸다 — 문자열이 아닌 원소처럼', async () => {
    await create({ type: 'PHOTO', assetRefs: ['ok-1', 'r'.repeat(ASSET_REF_MAX + 1), 42, 'r'.repeat(ASSET_REF_MAX)] });
    expect(memories[0].asset_refs).toEqual(['ok-1', 'r'.repeat(ASSET_REF_MAX)]);
  });

  it('너무 긴 재시도 키는 400 — 잘라 쓰면 다른 기록과 겹친다', async () => {
    expect((await create({ type: 'NOTE', clientKey: 'k'.repeat(MEMORY_CLIENT_KEY_MAX + 1) })).status).toBe(400);
    expect(memories).toEqual([]);
  });
});

describe('가격 관측 — 오퍼 원소', () => {
  it('웹이 싣는 모양의 오퍼는 그대로, 원본 응답 덩어리·객체가 아닌 것은 걸러 낸다', async () => {
    const webOffer = {
      seller: 'Booking.com', roomName: '디럭스 더블', price: 182000, total: 364000, cur: 'KRW', refundable: true, breakfast: false,
      link: `https://www.booking.com/hotel/es/madrid.html?aid=1&${'q=1&'.repeat(150)}`, verified: true, verifiedBy: 'metasearch', quality: 'EXACT'
    };
    expect(JSON.stringify(webOffer).length).toBeLessThan(OFFER_MAX_CHARS);
    const raw = { seller: '원본', blob: 'x'.repeat(OFFER_MAX_CHARS) };
    const res = await api.createPrice(post('/trips/trip-1/prices', JSON.stringify({
      bookingId: 'b1', price: 182000, offers: [webOffer, raw, 'text', [1, 2], webOffer]
    })), 'trip-1');
    expect(res.status).toBe(201);
    expect(observations[0].offers).toEqual([webOffer, webOffer]);
  });
});
