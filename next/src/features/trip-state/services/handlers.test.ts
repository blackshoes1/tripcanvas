// /api/v1 계약 테스트 — Supabase 없이 가짜 Gateway로 라우트 경계를 그대로 통과시킨다.
// 검증 대상은 "iOS가 이 응답만 보고 오늘 무엇을 할지 알 수 있는가"와 "두 기기가 부딪혀도 조용히 덮어쓰지 않는가"다.
import { beforeEach, describe, expect, it } from 'vitest';

import type { BookingListResponse, DeviceRegistration, MutationResponse, TodayResponse, TravelStateResponse, TripListResponse } from '../domain/contract';
import type { PriceObservation } from '../domain/bookingsView';
import type { Gateway, TripRow } from './handlers';
import { createHandlers, resolveClock } from './handlers';
import type { TripDoc } from '../domain/todayView';

const TOKEN = 'test-token';
const NOW = new Date('2026-09-01T04:00:00Z');   // Asia/Seoul 13:00
const auth = (init: RequestInit = {}) => ({
  ...init,
  headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(init.headers ?? {}) }
});
const P = (lat: number) => ({ lat, lng: -3.7 });

function tripDoc(): TripDoc {
  return {
    id: 'trip-1', name: '마드리드', start: '2026-09-01', timeZone: 'Asia/Seoul',
    days: [
      {
        title: '도착', mode: 'car', startAt: '09:00', spots: [
          { name: '숙소', city: '마드리드', stay: true, stayMin: 0, ...P(40.40) },
          { name: '저녁 예약', city: '마드리드', bookAt: '19:00', stayMin: 90, ...P(40.41) }
        ]
      },
      {
        title: '시내', mode: 'car', spots: [
          { name: '공원', city: '마드리드', stayMin: 90, ...P(40.405) },
          { name: '미술관', city: '마드리드', stayMin: 120, ...P(40.407) }
        ]
      }
    ]
  };
}

interface Store {
  rows: Map<string, TripRow>; dismissed: Map<string, string[]>; feedback: string[];
  observations: PriceObservation[]; sentKeys: string[]; devices: DeviceRegistration[];
}
function makeStore(): Store {
  const rows = new Map<string, TripRow>();
  rows.set('trip-1', { client_id: 'trip-1', data: tripDoc(), revision: 3, updated_at: '2026-08-31T00:00:00Z', deleted_at: null });
  return { rows, dismissed: new Map(), feedback: [], observations: [], sentKeys: [], devices: [] };
}
function gatewayOf(store: Store): Gateway {
  return {
    async listTrips() { return [...store.rows.values()]; },
    async getTrip(id) { return store.rows.get(id) ?? null; },
    async saveTrip(id, data, expected) {
      const row = store.rows.get(id);
      if (!row) return { applied: false, conflict: true, revision: 0, data: null };
      if (row.revision !== expected) return { applied: false, conflict: true, revision: row.revision, data: row.data };
      const revision = row.revision + 1;
      store.rows.set(id, { ...row, data, revision, updated_at: new Date().toISOString() });
      return { applied: true, conflict: false, revision, data };
    },
    async listDismissed(id, day) { return store.dismissed.get(`${id}|${day}`) ?? []; },
    async listPriceObservations() { return store.observations; },
    async listSentNotificationKeys() { return store.sentKeys; },
    async recordNotifications(_tripId, _day, items) {
      items.forEach((n) => { if (!store.sentKeys.includes(n.dedupeKey)) store.sentKeys.push(n.dedupeKey); });
    },
    async saveDevice(registration) {
      store.devices = store.devices.filter((d) => d.deviceId !== registration.deviceId).concat(registration);
    },
    async removeDevice(deviceId) { store.devices = store.devices.filter((d) => d.deviceId !== deviceId); },
    async recordFeedback(id, day, key, action) {
      store.feedback.push(`${action}:${key}`);
      if (action !== 'SKIPPED') return;
      const k = `${id}|${day}`;
      const list = store.dismissed.get(k) ?? [];
      if (!list.includes(key)) store.dismissed.set(k, [...list, key]);
    }
  };
}

let store: Store;
let api: ReturnType<typeof createHandlers>;
beforeEach(() => {
  store = makeStore();
  api = createHandlers({ gatewayFor: (token) => (token === TOKEN ? gatewayOf(store) : null), now: () => NOW });
});

const todayUrl = (q = '') => `http://localhost/api/v1/trips/trip-1/today${q}`;
const getToday = async (q = ''): Promise<TodayResponse> => {
  const res = await api.today(new Request(todayUrl(q), auth()), 'trip-1');
  expect(res.status).toBe(200);
  return res.json() as Promise<TodayResponse>;
};

describe('인증', () => {
  it('토큰이 없거나 틀리면 401 — 그 외 정보를 흘리지 않는다', async () => {
    const bare = await api.today(new Request(todayUrl()), 'trip-1');
    expect(bare.status).toBe(401);
    expect(await bare.json()).toMatchObject({ error: 'UNAUTHORIZED' });
    const wrong = await api.today(new Request(todayUrl(), { headers: { authorization: 'Bearer nope' } }), 'trip-1');
    expect(wrong.status).toBe(401);
  });
});

describe('GET /trips', () => {
  it('웹에서 만든 여행이 목록에 보이고, 오늘이 며칠째인지까지 알려준다', async () => {
    const res = await api.trips(new Request('http://localhost/api/v1/trips', auth()));
    const body = (await res.json()) as TripListResponse;
    expect(body.trips).toHaveLength(1);
    expect(body.trips[0]).toMatchObject({ id: 'trip-1', name: '마드리드', dayCount: 2, revision: 3, todayIndex: 0 });
    expect(body.trips[0].cities).toContain('마드리드');
  });

  it('삭제된(tombstone) 여행은 목록에서 빠진다', async () => {
    store.rows.set('trip-1', { ...store.rows.get('trip-1')!, deleted_at: '2026-08-30T00:00:00Z' });
    const body = (await (await api.trips(new Request('http://localhost/api/v1/trips', auth()))).json()) as TripListResponse;
    expect(body.trips).toHaveLength(0);
  });
});

describe('GET /today — iOS가 이 응답 하나로 오늘을 안다', () => {
  it('현재 상태·다음 행동·제안·남은 일정·재구성을 한 번에 준다', async () => {
    const body = await getToday();
    expect(body.schemaVersion).toBe(1);
    expect(body.travelTimeSource).toBe('STRAIGHT_LINE_ESTIMATE');   // 서버엔 구간 캐시가 없다 — 추정임을 밝힌다
    expect(body.trip.id).toBe('trip-1');
    expect(body.day.index).toBe(0);
    expect(body.currentState.live).toBe(true);
    expect(body.currentState.nowMinutes).toBe(13 * 60);
    expect(body.nextAction?.title).toBe('저녁 예약');
    expect(body.nextAction?.departure?.text).toMatch(/출발/);
    expect(body.fixedCommitments.map((f) => f.title)).toContain('저녁 예약');
    expect(body.activities.map((a) => a.id)).toEqual(['d0s0', 'd0s1']);
    expect(body.activityState.status).toBe(body.nextAction?.status);
    expect(body.replan.needed).toBe(false);
  });

  it('제안에는 반드시 이유가 붙는다 — "AI가 추천했습니다"로 끝내지 않는다', async () => {
    const body = await getToday();
    expect(body.suggestions.length).toBeGreaterThan(0);
    body.suggestions.forEach((s) => {
      expect(s.reasons.length).toBeGreaterThan(0);
      expect(s.id).toBeTruthy();
    });
    expect(body.suggestions.some((s) => s.action.kind === 'MOVE_TO_TODAY')).toBe(true);
  });

  it('예약 시각을 지나 있으면 지연이 아니라 "그 일정을 하는 중"이다', async () => {
    const dining = await getToday('?now=19:30');
    expect(dining.currentState.nowMinutes).toBe(19 * 60 + 30);
    expect(dining.nextAction?.status).toBe('IN_PROGRESS');
  });

  it('출발 시각을 이미 넘겼으면 지연으로 알린다', async () => {
    const row = store.rows.get('trip-1')!;
    const far = JSON.parse(JSON.stringify(row.data)) as TripDoc;
    far.days![0].spots![1] = { name: '저녁 예약', city: '마드리드', bookAt: '19:00', stayMin: 90, lat: 40.9, lng: -3.7 };
    store.rows.set('trip-1', { ...row, data: far });
    const late = await getToday('?now=18:30');
    expect(late.nextAction?.departure?.level).toBe('LATE');
    expect(late.nextAction?.status).toBe('DELAYED');
  });

  it('완료를 누르지 않은 과거 일정 때문에 멀쩡한 오후가 지연으로 보이지 않는다', async () => {
    const body = await getToday();   // 13:00 — 09:00 숙소를 아무도 완료 처리하지 않았다
    expect(body.nextAction?.title).toBe('저녁 예약');
    expect(body.nextAction?.status).toBe('UPCOMING');
  });

  it('여행 기간 밖의 날을 보면 live가 아니고 계획 기준으로 답한다', async () => {
    const planning = await getToday('?day=1&date=2026-12-25');
    expect(planning.currentState.live).toBe(false);
    expect(planning.day.index).toBe(1);
    expect(planning.trip.todayIndex).toBe(-1);
  });

  it('없는 여행은 404', async () => {
    const res = await api.today(new Request('http://localhost/api/v1/trips/nope/today', auth()), 'nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'TRIP_NOT_FOUND' });
  });
});

describe('Activity 완료 / 건너뛰기', () => {
  const complete = (id: string, body: unknown = {}) =>
    api.activityAction(new Request(`http://localhost/api/v1/trips/trip-1/activities/${id}/complete`,
      auth({ method: 'POST', body: JSON.stringify(body) })), 'trip-1', id, 'complete');

  it('완료하면 저장되고, 바뀐 Today가 같은 응답에 담겨 온다', async () => {
    const res = await complete('d0s0', { expectedRevision: 3 });
    const body = (await res.json()) as MutationResponse;
    expect(res.status).toBe(200);
    expect(body.applied).toBe(true);
    expect(body.revision).toBe(4);
    expect(body.today.currentState.completedActivityIds).toContain('d0s0');
    expect(store.rows.get('trip-1')!.data.days![0].spots![0].status).toBe('COMPLETED');
  });

  it('두 번 눌러도 같은 결과다 (중복 제출이 오류가 되지 않는다)', async () => {
    await complete('d0s0', { expectedRevision: 3 });
    const again = (await (await complete('d0s0')).json()) as MutationResponse;
    expect(again.applied).toBe(false);
    expect(again.alreadyApplied).toBe(true);
    expect(again.revision).toBe(4);
  });

  it('다른 기기가 먼저 바꿨으면 409로 알린다 — 조용히 덮어쓰지 않는다', async () => {
    const res = await complete('d0s1', { expectedRevision: 1 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'REVISION_CONFLICT', revision: 3 });
    expect(store.rows.get('trip-1')!.revision).toBe(3);
  });

  it('그 사이 순서가 바뀌었으면 엉뚱한 장소를 완료 처리하지 않는다', async () => {
    const res = await complete('d0s0', { expectedName: '다른 장소' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'SUGGESTION_STALE' });
  });

  it('없는 일정은 404, 알 수 없는 동작은 400', async () => {
    expect((await complete('d9s9')).status).toBe(404);
    const bad = await api.activityAction(
      new Request('http://localhost/api/v1/trips/trip-1/activities/d0s0/burn', auth({ method: 'POST', body: '{}' })),
      'trip-1', 'd0s0', 'burn');
    expect(bad.status).toBe(400);
  });

  it('건너뛴 일정은 남은 일정에서 빠진다', async () => {
    const res = await api.activityAction(
      new Request('http://localhost/api/v1/trips/trip-1/activities/d0s0/skip', auth({ method: 'POST', body: '{}' })),
      'trip-1', 'd0s0', 'skip');
    const body = (await res.json()) as MutationResponse;
    expect(body.today.currentState.skippedActivityIds).toContain('d0s0');
    expect(body.today.remainingActivities.map((a) => a.id)).not.toContain('d0s0');
  });
});

describe('Suggestion 수락 / 건너뛰기', () => {
  const act = (action: 'accept' | 'skip', body: unknown) =>
    api.suggestionAction(new Request(`http://localhost/api/v1/trips/trip-1/suggestions/${action}`,
      auth({ method: 'POST', body: JSON.stringify(body) })), 'trip-1', action);

  it('수락하면 그 장소가 오늘로 옮겨오고 고정 예약은 순서를 지킨다', async () => {
    const today = await getToday();
    const move = today.suggestions.find((s) => s.action.kind === 'MOVE_TO_TODAY')!;
    expect(move.acceptable).toBe(true);
    const body = (await (await act('accept', { suggestionId: move.id, expectedRevision: 3 })).json()) as MutationResponse;
    expect(body.applied).toBe(true);
    const names = store.rows.get('trip-1')!.data.days![0].spots!.map((s) => s.name);
    expect(names[0]).toBe('숙소');
    expect(names[names.length - 1]).toBe('저녁 예약');
    expect(names).toContain(move.title);
    expect(store.rows.get('trip-1')!.data.days![1].spots!.map((s) => s.name)).not.toContain(move.title);
    expect(store.feedback).toContain(`ACCEPTED:${move.id}`);
  });

  it('건너뛴 제안은 같은 날 다시 올라오지 않는다 (기기가 바뀌어도)', async () => {
    const first = await getToday();
    const target = first.suggestions[0];
    const skipped = (await (await act('skip', { suggestionId: target.id })).json()) as MutationResponse;
    expect(skipped.applied).toBe(true);
    expect(skipped.today.suggestions.map((s) => s.id)).not.toContain(target.id);
    const again = await getToday();
    expect(again.suggestions.map((s) => s.id)).not.toContain(target.id);
    expect(store.rows.get('trip-1')!.revision).toBe(3);   // 거절은 여행 데이터를 건드리지 않는다
  });

  it('이미 건너뛴 제안을 또 건너뛰어도 오류가 아니다', async () => {
    const first = await getToday();
    const id = first.suggestions[0].id;
    await act('skip', { suggestionId: id });
    const res = await act('skip', { suggestionId: id });
    expect(res.status).toBe(200);
    expect(((await res.json()) as MutationResponse).alreadyApplied).toBe(true);
  });

  it('상황이 바뀌어 사라진 제안을 수락하면 409로 새로고침을 요청한다', async () => {
    const res = await act('accept', { suggestionId: 'trip-1|2026-09-01|NEXT_ACTIVITY|없는 제안' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'SUGGESTION_STALE' });
  });

  it('suggestionId가 없으면 400', async () => {
    expect((await act('accept', {})).status).toBe(400);
  });
});

describe('POST /replan-preview', () => {
  it('미리보기만 만들고 아무것도 저장하지 않는다', async () => {
    store.rows.set('trip-1', {
      ...store.rows.get('trip-1')!,
      data: {
        ...tripDoc(),
        days: [{
          title: '지연', mode: 'car', startAt: '09:00', spots: [
            { name: 'Museum', city: '마드리드', stayMin: 120, ...P(40.41) },
            { name: 'Cafe', city: '마드리드', opt: true, stayMin: 60, ...P(40.44) },
            { name: 'Park', city: '마드리드', must: true, stayMin: 90, ...P(40.47) },
            { name: 'Dinner', city: '마드리드', bookAt: '19:00', stayMin: 90, ...P(40.50) }
          ]
        }]
      }
    });
    const res = await api.replanPreview(
      new Request('http://localhost/api/v1/trips/trip-1/replan-preview?now=16:30', auth({ method: 'POST', body: '{}' })), 'trip-1');
    const body = (await res.json()) as { replan: TodayResponse['replan'] };
    expect(body.replan.needed).toBe(true);
    expect(body.replan.lateMinutes).toBeGreaterThan(0);
    expect(body.replan.dropNames).toContain('Cafe');          // (선택)부터 뺀다
    expect(body.replan.dropNames).not.toContain('Park');      // mustVisit 보호
    expect(body.replan.dropActivityIds).not.toContain('d0s3'); // 고정 예약 보호
    expect(body.replan.after).toContain('Dinner');
    expect(store.rows.get('trip-1')!.revision).toBe(3);       // 저장 없음
  });
});

describe('resolveClock', () => {
  it('여행지 시간대로 오늘·현재 분을 정하고, 질의가 있으면 그쪽이 이긴다', () => {
    const trip: TripDoc = { timeZone: 'Asia/Seoul', days: [{ spots: [] }] };
    const base = resolveClock(trip, 0, new URL('http://x/'), NOW);
    expect(base).toEqual({ todayISO: '2026-09-01', nowMinutes: 13 * 60 });
    const forced = resolveClock(trip, 0, new URL('http://x/?date=2026-09-03&now=07:05'), NOW);
    expect(forced).toEqual({ todayISO: '2026-09-03', nowMinutes: 7 * 60 + 5 });
  });

  it('시간대가 없으면 UTC로 떨어지고 깨지지 않는다', () => {
    const utc = resolveClock({ days: [{ spots: [] }] }, 0, new URL('http://x/'), NOW);
    expect(utc).toEqual({ todayISO: '2026-09-01', nowMinutes: 4 * 60 });
  });
});

describe('GET /bookings — 여행 당일에 필요한 것만 빠르게(§45)', () => {
  const list = () => api.bookings(new Request('http://localhost/api/v1/trips/trip-1/bookings', auth()), 'trip-1');
  const withBookings = (bookings: unknown[]) => {
    const row = store.rows.get('trip-1')!;
    store.rows.set('trip-1', { ...row, data: { ...row.data, bookings } });
  };

  it('예약이 없으면 빈 목록이다 (없는 예약을 지어내지 않는다)', async () => {
    const body = (await (await list()).json()) as BookingListResponse;
    expect(body.bookings).toEqual([]);
  });

  it('호텔·렌터카를 시작일 순으로 주고, 관측이 없으면 가격 상태는 null이다', async () => {
    withBookings([
      { id: 'car1', type: 'car', title: '렌터카', price: 300000, cur: 'KRW', start: '2026-09-03', carPickupTime: '10:00' },
      { id: 'htl1', type: 'hotel', title: '호텔', provider: 'Booking', price: 1420000, cur: 'KRW', start: '2026-09-01', end: '2026-09-04', refundable: true }
    ]);
    const body = (await (await list()).json()) as BookingListResponse;
    expect(body.bookings.map((b) => b.id)).toEqual(['htl1', 'car1']);
    expect(body.bookings[0]).toMatchObject({ type: 'hotel', title: '호텔', price: 1420000, refundable: true });
    expect(body.bookings[0].priceStatus).toBeNull();      // 첫 확인 전 — 가짜 상태를 만들지 않는다
    expect(body.bookings[0].confirmation).toBeNull();     // 웹에 입력 UI가 없다
  });

  it('관측이 있으면 웹과 같은 판정으로 절약 가능 여부를 알려준다', async () => {
    withBookings([{ id: 'htl1', type: 'hotel', title: '호텔', price: 1420000, cur: 'KRW', start: '2026-09-01', end: '2026-09-04', refundable: true, freeCancelUntil: '2026-09-10' }]);
    store.observations = [{
      booking_id: 'htl1', seller: 'Agoda', price: 1292000, currency: 'KRW', quality: 'EXACT', verified: true,
      offers: [{ seller: 'Agoda', price: 1292000, cur: 'KRW', quality: 'EXACT', verified: true, refundable: true }],
      observed_at: '2026-08-30T21:00:00Z'
    }];
    const body = (await (await list()).json()) as BookingListResponse;
    const status = body.bookings[0].priceStatus!;
    expect(status.state).toBe('SAVING_AVAILABLE');
    expect(status.savingAmount).toBe(128000);
    expect(status.seller).toBe('Agoda');
    expect(status.observedAt).toBe('2026-08-30T21:00:00Z');   // 언제 확인한 값인지 반드시 함께 온다
    expect(status.note).toMatch(/더 싼/);
  });

  it('추적을 꺼 둔 예약은 그렇다고 말한다', async () => {
    withBookings([{ id: 'htl1', type: 'hotel', title: '호텔', price: 100000, cur: 'KRW', track: false }]);
    const body = (await (await list()).json()) as BookingListResponse;
    expect(body.bookings[0].priceStatus?.state).toBe('UNTRACKED');
  });

  it('가격 조회가 실패해도 예약 목록 자체는 보인다', async () => {
    withBookings([{ id: 'htl1', type: 'hotel', title: '호텔', price: 100000, cur: 'KRW' }]);
    const broken = createHandlers({
      gatewayFor: () => ({ ...gatewayOf(store), listPriceObservations: async () => { throw new Error('down'); } }),
      now: () => NOW
    });
    const res = await broken.bookings(new Request('http://localhost/api/v1/trips/trip-1/bookings', auth()), 'trip-1');
    expect(res.status).toBe(200);
    expect(((await res.json()) as BookingListResponse).bookings).toHaveLength(1);
  });
});

describe('GET /travel-state — 여행 중 단 하나의 조회(§57)', () => {
  const call = (query = '') =>
    api.travelState(new Request(`http://localhost/api/v1/trips/trip-1/travel-state${query}`, auth()), 'trip-1');
  const state = async (query = ''): Promise<TravelStateResponse> => {
    const res = await call(query);
    expect(res.status).toBe(200);
    return res.json() as Promise<TravelStateResponse>;
  };

  it('Today·Pulse·출발 계획·잠금화면·위젯을 한 번에 준다', async () => {
    const body = await state();
    expect(body.today.trip.id).toBe('trip-1');
    expect(body.pulse.text.length).toBeGreaterThan(0);
    expect(body.pulse.code).toBeTruthy();
    expect(body.departure?.activityId).toBe('d0s1');
    expect(body.liveActivity.nextTitle).toBe('저녁 예약');
    expect(body.widget.upcoming.length).toBeGreaterThan(0);
    expect(body.stateVersion).toBe(body.liveActivity.stateVersion);
    expect(body.stateVersion).toBe(body.widget.stateVersion);
  });

  it('같은 상태면 stateVersion이 그대로다 — 분마다 잠금화면을 새로 그리지 않는다', async () => {
    const first = await state('?now=13:00');
    const later = await state('?now=13:07');
    expect(later.stateVersion).toBe(first.stateVersion);
  });

  it('일정 상태가 바뀌면 stateVersion도 바뀐다', async () => {
    const before = await state('?now=13:00');
    await api.activityAction(
      new Request('http://localhost/api/v1/trips/trip-1/activities/d0s0/complete', auth({ method: 'POST', body: '{}' })),
      'trip-1', 'd0s0', 'complete');
    const after = await state('?now=13:00');
    expect(after.stateVersion).not.toBe(before.stateVersion);
  });

  it('위치를 주면 그 위치에서 계산하고, 저장하지는 않는다', async () => {
    const nearHotel = await state('?now=13:00');   // 위치가 없으면 숙소(앵커) 기준
    const farAway = await state('?now=13:00&lat=40.59&lng=-3.70&locUpdatedAt=2026-09-01T04:00:00Z');
    expect(farAway.locationUsed).toEqual({ lat: 40.59, lng: -3.7 });
    expect(farAway.locationUpdatedAt).toBe('2026-09-01T04:00:00Z');
    // 멀리 있으면 이동시간이 늘고, 그만큼 더 일찍 나서라고 말한다
    expect(farAway.departure!.travelMinutes).toBeGreaterThan(nearHotel.departure!.travelMinutes);
    expect(farAway.departure!.leaveMinutes).toBeLessThan(nearHotel.departure!.leaveMinutes);
    // 저장 흔적이 없다 (여행 문서는 그대로)
    expect(store.rows.get('trip-1')!.revision).toBe(3);
  });

  it('출발할 때가 되면 알림 계획이 생기고, 그 전에는 조용하다', async () => {
    const calm = await state('?now=13:00');
    expect(calm.notifications.filter((n) => n.kind === 'departureReminder')).toHaveLength(0);

    const ready = await state('?now=18:58');
    const dep = ready.notifications.find((n) => n.kind === 'departureReminder' || n.kind === 'scheduleDelay');
    expect(dep).toBeTruthy();
    expect(dep!.deepLink).toContain('/today?focus=');
    expect(dep!.origin).toBe('DEVICE');
  });

  it('markSent=1이면 같은 알림이 다음 호출에서 빠진다', async () => {
    const first = await state('?now=18:58&markSent=1');
    expect(first.notifications.length).toBeGreaterThan(0);
    expect(store.sentKeys.length).toBeGreaterThan(0);
    const second = await state('?now=18:58');
    expect(second.notifications).toHaveLength(0);
  });

  it('Travel Mode를 켜야 빈 시간 제안 알림이 나온다', async () => {
    const off = await state('?now=13:00');
    expect(off.notifications.filter((n) => n.kind === 'emptySlotSuggestion')).toHaveLength(0);
    const on = await state('?now=13:00&travelMode=1');
    expect(on.notifications.filter((n) => n.kind === 'emptySlotSuggestion').length).toBeGreaterThan(0);
    const resting = await state('?now=13:00&travelMode=1&suppressUntil=18:00');
    expect(resting.notifications.filter((n) => n.kind === 'emptySlotSuggestion')).toHaveLength(0);
  });

  it('잠금화면 상태에 예약번호 같은 민감한 값을 담지 않는다', async () => {
    const body = await state();
    const serialized = JSON.stringify(body.liveActivity) + JSON.stringify(body.widget);
    expect(serialized).not.toContain('confirmation');
    expect(serialized).not.toContain('bookUrl');
    expect(body.widget.upcoming.length).toBeLessThanOrEqual(3);
  });

  it('제안 만료 시각을 함께 준다 — 낡은 추천을 그대로 쓰지 않기 위해', async () => {
    const body = await state('?now=13:00');
    expect(body.suggestionsExpireMinutes).toBeGreaterThan(13 * 60);
    expect(body.suggestionsExpireAtISO).toBeTruthy();
  });

  it('없는 여행은 404, 토큰 없으면 401', async () => {
    expect((await api.travelState(new Request('http://localhost/api/v1/trips/nope/travel-state', auth()), 'nope')).status).toBe(404);
    expect((await api.travelState(new Request('http://localhost/api/v1/trips/trip-1/travel-state'), 'trip-1')).status).toBe(401);
  });
});

describe('POST/DELETE /devices — push 토큰(§45)', () => {
  const register = (body: unknown) =>
    api.registerDevice(new Request('http://localhost/api/v1/devices', auth({ method: 'POST', body: JSON.stringify(body) })));

  it('기기를 등록하고 같은 기기는 한 행으로 유지한다', async () => {
    const res = await register({ deviceId: 'dev-1', pushToken: 'token-a', appVersion: '1.0' });
    expect(res.status).toBe(200);
    expect(store.devices).toHaveLength(1);
    await register({ deviceId: 'dev-1', pushToken: 'token-b' });
    expect(store.devices).toHaveLength(1);
    expect(store.devices[0].pushToken).toBe('token-b');
  });

  it('알 수 없는 설정 키는 통과시키지 않는다', async () => {
    await register({ deviceId: 'dev-1', pushToken: 't', preferences: { departure: false, hack: true, price: 'yes' } });
    expect(store.devices[0].preferences).toEqual({ departure: false });
  });

  it('deviceId나 토큰이 없으면 400', async () => {
    expect((await register({ pushToken: 't' })).status).toBe(400);
    expect((await register({ deviceId: 'd' })).status).toBe(400);
  });

  it('로그아웃 시 토큰을 지운다', async () => {
    await register({ deviceId: 'dev-1', pushToken: 't' });
    const res = await api.unregisterDevice(new Request('http://localhost/api/v1/devices?deviceId=dev-1', auth({ method: 'DELETE' })));
    expect(res.status).toBe(200);
    expect(store.devices).toHaveLength(0);
    expect((await api.unregisterDevice(new Request('http://localhost/api/v1/devices', auth({ method: 'DELETE' })))).status).toBe(400);
  });
});
