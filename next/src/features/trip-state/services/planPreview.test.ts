import lib from '@legacy/lib.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanPreviewResponse } from '../domain/contract';
import type { TripDoc } from '../domain/todayView';
import type { Gateway, LegSupport, TripRow } from './handlers';
import { createHandlers } from './handlers';

const URL = 'https://example.org/api/v1/trips/trip-1/plan-preview';
const NOW = new Date('2026-09-16T00:00:00Z');
function document() {
  return { id: 'trip-1', name: '합성 여행', start: '2026-09-16', custom: { keep: true },
    days: [{ title: '첫날', startAt: '09:00', mode: 'car', spots: [
      { name: '첫 장소', stayMin: 30, hours: [{ d: 1, o: 540, c: 1020 }], provider: 'kakao', providerId: '1234' },
      { name: '예약 명소', bookAt: '10:00', stayMin: 30, bookingId: 'booking1',
        admission: { source: 'USER', requirement: 'REQUIRED', personalStatus: 'BOOKED' } }
    ] }] };
}

let row: TripRow;
let getTrip: ReturnType<typeof vi.fn>;
let saveTrip: ReturnType<typeof vi.fn>;
let gateway: Gateway;
beforeEach(() => {
  row = { client_id: 'trip-1', data: document(), revision: 7, role: 'OWNER', member_count: 2,
    updated_at: '2026-09-15T00:00:00Z', deleted_at: null };
  getTrip = vi.fn(async (id: string) => id === 'trip-1' ? row : null);
  saveTrip = vi.fn(async () => { throw new Error('미리보기는 저장하면 안 됩니다'); });
  gateway = { getTrip, saveTrip } as unknown as Gateway;
});

function handler(legs?: LegSupport) {
  return createHandlers({ gatewayFor: token => token === 'valid' ? gateway : null, now: () => NOW, legs });
}
function request(body: unknown = { document: document(), dayIndex: 0, revision: 7 }) {
  return new Request(URL, { method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
    body: JSON.stringify(body) });
}
const preview = (body?: unknown) => handler().planPreview(request(body), 'trip-1');

describe('일정 변경 미리보기', () => {
  it('같은 공통 엔진으로 전후 도착·예약 시각을 계산하며 서버 원문과 초안은 보존한다', async () => {
    const original = structuredClone(row);
    const draft = document();
    draft.days[0].spots[0].stayMin = 120;
    const inputSnapshot = structuredClone(draft);
    const res = await preview({ document: draft, dayIndex: 0, revision: 7 });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json() as PlanPreviewResponse;
    expect(body.before.day.spots[1]).toMatchObject({ etaMinutes: 570, bookedAtMinutes: 600, bookingLateMinutes: null, conflict: false, waitMinutes: 30 });
    expect(body.after.day.spots[1]).toMatchObject({ etaMinutes: 660, bookedAtMinutes: 600, bookingLateMinutes: 60, conflict: false, waitMinutes: 0 });
    expect(body.before.trip.revision).toBe(7);
    expect(body.after.trip.revision).toBe(7);
    expect(row).toEqual(original);
    expect(draft).toEqual(inputSnapshot);
    expect(saveTrip).not.toHaveBeenCalled();
  });

  it('체류 미정과 명시적 0분은 구분하고 둘 다 0분으로 계산한다', async () => {
    const draft: TripDoc = document();
    draft.days![0].spots = [{ name: '미정' }, { name: '잠깐 방문', stayMin: 0 }, { name: '정한 체류', stayMin: 20 }];
    const body = await (await preview({ document: draft, dayIndex: 0, revision: 7 })).json() as PlanPreviewResponse;
    expect(body.after.day.spots.map(s => s.stayMinutes)).toEqual([null, 0, 20]);
    expect(body.after.day.spots.map(s => s.etaMinutes)).toEqual([540, 540, 540]);
    expect(body.after.day.totals.endMinutes).toBe(560);
  });

  it('문서 안의 여행 id·역할로 권한이나 응답 여행을 바꾸지 않는다', async () => {
    const draft = { ...document(), id: 'someone-else', role: 'OWNER' };
    const body = await (await preview({ document: draft, dayIndex: 0, revision: 7 })).json() as PlanPreviewResponse;
    expect(body.after.trip.id).toBe('trip-1');
    expect(getTrip).toHaveBeenCalledExactlyOnceWith('trip-1');
    row.role = 'VIEWER';
    expect((await preview({ document: draft, dayIndex: 0, revision: 7 })).status).toBe(403);
  });

  it.each(['OWNER', 'EDITOR', null])('%s 역할은 미리보기를 볼 수 있다', async role => {
    row.role = role;
    expect((await preview()).status).toBe(200);
  });

  it('인증·여행 접근·삭제·보기 권한을 초안 처리 전에 검사한다', async () => {
    const api = handler();
    expect((await api.planPreview(new Request(URL, { method: 'POST', body: '{}' }), 'trip-1')).status).toBe(401);
    expect((await api.planPreview(new Request(URL, { method: 'POST', headers: { authorization: 'Bearer wrong' }, body: '{}' }), 'trip-1')).status).toBe(401);
    expect((await api.planPreview(request(), 'private')).status).toBe(404);
    row.deleted_at = '2026-09-16T00:00:00Z';
    expect((await preview()).status).toBe(404);
    row.deleted_at = null;
    row.role = 'VIEWER';
    expect((await preview()).status).toBe(403);
    expect(saveTrip).not.toHaveBeenCalled();
  });

  it('revision이 달라지면 현재 버전과 409를 돌려주고 재계산하지 않는다', async () => {
    const res = await preview({ document: document(), dayIndex: 0, revision: 6 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'REVISION_CONFLICT', revision: 7 });
    expect(saveTrip).not.toHaveBeenCalled();
  });

  it.each([
    { revision: '7' }, { revision: 7.5 }, { revision: -1 }, { revision: Number.MAX_SAFE_INTEGER + 1 },
    { revision: null }, { dayIndex: '0' }, { dayIndex: -1 }, { dayIndex: 0.5 }, { dayIndex: null },
    { document: null }, { document: { days: [{ spots: [{ name: '잘못된 좌표', lat: 99, lng: 0 }] }] } },
    { document: { days: [{ spots: [{ admission: { source: 'GOOGLE', requirement: 'REQUIRED' } }] }] } }
  ])('유효하지 않은 입력은 400: %j', async change => {
    const res = await preview({ document: document(), dayIndex: 0, revision: 7, ...change });
    expect(res.status).toBe(400);
    expect(saveTrip).not.toHaveBeenCalled();
  });

  it('양쪽에 존재하는 선택일만 비교한다', async () => {
    expect((await preview({ document: document(), dayIndex: 1, revision: 7 })).status).toBe(404);
    row.data.days!.push({ spots: [] });
    const res = await preview({ document: document(), dayIndex: 1, revision: 7 });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'DAY_NOT_FOUND' });
  });

  it('잘못된 JSON과 배열 요청은 거절한다', async () => {
    for (const body of ['{', '[]', 'null']) {
      const res = await handler().planPreview(new Request(URL, { method: 'POST', headers: { authorization: 'Bearer valid' }, body }), 'trip-1');
      expect(res.status).toBe(400);
    }
  });

  it('Content-Length가 없거나 거짓이어도 본문 바이트 제한을 지킨다', async () => {
    const text = JSON.stringify({ document: document(), dayIndex: 0, revision: 7, extra: '한'.repeat(lib.TC_LIMITS.jsonBytes / 2) });
    for (const headers of [{}, { 'content-length': '1' }] as Record<string, string>[]) {
      const res = await handler().planPreview(new Request(URL, { method: 'POST',
        headers: { authorization: 'Bearer valid', ...headers }, body: text }), 'trip-1');
      expect(res.status).toBe(400);
    }
    expect(saveTrip).not.toHaveBeenCalled();
  });

  it('기존 캐시만 사용하고 초안 순서의 미조회 구간은 추정으로 밝힌다', async () => {
    const a = { name: 'A', lat: 37.5, lng: 127, stayMin: 0 };
    const b = { name: 'B', lat: 37.51, lng: 127.01, stayMin: 0 };
    row.data.days![0].spots = [a, b];
    const draft = { ...document(), days: [{ spots: [b, a], startAt: '09:00' }] };
    const read = vi.fn(async () => ({ cache: { [lib.legKey(a, b, 'car')]: { sec: 1200, m: 9000, path: 'path' } }, pending: 4 }));
    const legs: LegSupport = { read, readTrip: vi.fn(), fillLater: vi.fn(), fillTripLater: vi.fn() };
    const res = await handler(legs).planPreview(request({ document: draft, dayIndex: 0, revision: 7 }), 'trip-1');
    const body = await res.json() as PlanPreviewResponse;
    expect(body.before.day.spots[1].incomingLeg).toMatchObject({ source: 'ROUTED', minutes: 20, path: 'path' });
    expect(body.after.day.spots[1].incomingLeg).toMatchObject({ source: 'STRAIGHT_LINE_ESTIMATE', path: null });
    expect(body.after.travelTimeSource).toBe('STRAIGHT_LINE_ESTIMATE');
    expect([body.before.legsPending, body.after.legsPending]).toEqual([0, 0]);
    expect(read.mock.calls).toHaveLength(2);
    expect(vi.mocked(legs.read).mock.calls.every(call => call[1] === 0 && call[2] === 0)).toBe(true);
    expect(legs.readTrip).not.toHaveBeenCalled();
    expect(legs.fillLater).not.toHaveBeenCalled();
    expect(legs.fillTripLater).not.toHaveBeenCalled();
    expect(saveTrip).not.toHaveBeenCalled();
  });

  it('캐시가 실패해도 추정으로 응답하고 채우기·저장을 시도하지 않는다', async () => {
    row.data.days![0].spots = [{ name: 'A', lat: 37.5, lng: 127 }, { name: 'B', lat: 37.51, lng: 127.01 }];
    const legs: LegSupport = { read: vi.fn(async () => { throw new Error('cache unavailable'); }),
      readTrip: vi.fn(), fillLater: vi.fn(), fillTripLater: vi.fn() };
    const res = await handler(legs).planPreview(request({ document: row.data, dayIndex: 0, revision: 7 }), 'trip-1');
    expect(res.status).toBe(200);
    const body = await res.json() as PlanPreviewResponse;
    expect(body.before.travelTimeSource).toBe('STRAIGHT_LINE_ESTIMATE');
    expect(body.after.travelTimeSource).toBe('STRAIGHT_LINE_ESTIMATE');
    expect(legs.fillLater).not.toHaveBeenCalled();
    expect(saveTrip).not.toHaveBeenCalled();
  });
});
