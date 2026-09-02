// /api/v1 계약 테스트 — Supabase 없이 가짜 Gateway로 라우트 경계를 그대로 통과시킨다.
// 검증 대상은 "iOS가 이 응답만 보고 오늘 무엇을 할지 알 수 있는가"와 "두 기기가 부딪혀도 조용히 덮어쓰지 않는가"다.
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  BookingListResponse, DeviceRegistration, ImportCommitResponse, ImportPreviewResponse,
  ActivityListResponse, CandidateBoardResponse, CommentListResponse,
  MemoryCreateResponse, MemoryListResponse, MutationResponse, PreferenceResponse, TodayResponse,
  TravelStateResponse, TripListResponse
} from '../domain/contract';
import type { ActivityRow, CandidateRow, CommentRow, PrefRow } from '../domain/candidatesView';
import type { MemoryRow } from '../domain/intakeView';
import type { PriceObservation } from '../domain/bookingsView';
import type { Gateway, TripRow } from './handlers';
import { createHandlers, resolveClock } from './handlers';
import type { TripDoc } from '../domain/todayView';
import collabModule from '@legacy/collab.js';

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

/** 가짜 후보 한 줄 — RPC가 주는 모양 그대로에 소속 여행만 더한다 */
interface FakeCandidate extends CandidateRow { trip_id: string }
interface FakeComment extends CommentRow { trip_id: string; candidate_id: string }

interface Store {
  rows: Map<string, TripRow>; dismissed: Map<string, string[]>; feedback: string[];
  observations: PriceObservation[]; sentKeys: string[]; devices: DeviceRegistration[]; memories: MemoryRow[];
  candidates: FakeCandidate[]; comments: FakeComment[]; prefs: Map<string, PrefRow[]>; activity: ActivityRow[];
  seq: number;
}
function makeStore(): Store {
  const rows = new Map<string, TripRow>();
  rows.set('trip-1', { client_id: 'trip-1', data: tripDoc(), revision: 3, updated_at: '2026-08-31T00:00:00Z', deleted_at: null });
  return {
    rows, dismissed: new Map(), feedback: [], observations: [], sentKeys: [], devices: [], memories: [],
    candidates: [], comments: [], prefs: new Map(), activity: [], seq: 0
  };
}

/** DB의 42501을 그대로 흉내낸다 — 핸들러가 이걸 403으로 옮기는지 보려면 모양이 같아야 한다 */
function forbidden(hint: string): never {
  throw Object.assign(new Error('permission denied'), { code: '42501', hint });
}
function gatewayOf(store: Store): Gateway {
  return {
    async listTrips() { return [...store.rows.values()]; },
    async getTrip(id) { return store.rows.get(id) ?? null; },
    async saveTrip(id, data, expected) {
      const row = store.rows.get(id);
      if (!row) return { applied: false, conflict: true, revision: 0, data: null };
      // 진짜 게이트웨이는 sync_trip의 42501을 forbidden으로 옮긴다 — 보기 권한 행이면 같은 답을 낸다
      if (row.role === 'VIEWER') return { applied: false, conflict: false, forbidden: true, revision: row.revision, data: null };
      if (row.revision !== expected) return { applied: false, conflict: true, revision: row.revision, data: row.data };
      const revision = row.revision + 1;
      store.rows.set(id, { ...row, data, revision, updated_at: new Date().toISOString() });
      return { applied: true, conflict: false, revision, data };
    },
    async listDismissed(id, day) { return store.dismissed.get(`${id}|${day}`) ?? []; },

    // 함께하기 — 권한 판정은 진짜 DB에서 RPC가 한다. 여기서도 같은 규칙을 흉내내야 핸들러 테스트가 의미가 있다.
    async listCandidates(tripId) { return store.candidates.filter((c) => c.trip_id === tripId); },
    async addCandidate(tripId, input) {
      const role = store.rows.get(tripId)?.role ?? null;
      if (role != null && role !== 'OWNER' && role !== 'EDITOR') forbidden('후보 추가는 편집 권한이 필요하다');
      const id = String(++store.seq);
      store.candidates.unshift({
        trip_id: tripId, id, title: input.title, place_id: input.placeId, lat: input.lat, lng: input.lng,
        addr: input.addr, note: input.note, url: input.url, status: 'PROPOSED', scheduled_ref: null,
        proposed_by_label: '나', mine: true, my_reaction: 'MUST',
        must_count: 1, ok_count: 0, pass_count: 0,
        reactions: [{ name: '나', reaction: 'MUST', me: true }], comment_count: 0,
        created_at: `2026-09-02T00:00:${String(store.seq).padStart(2, '0')}Z`
      });
      return id;
    },
    async reactCandidate(candidateId, reaction) {
      const cand = store.candidates.find((c) => String(c.id) === candidateId);
      if (!cand) forbidden('없는 후보');
      // 반응은 활성 멤버 전원 — 보기 권한도 의견은 낸다(§12)
      const list = (cand.reactions ?? []).filter((r) => !r.me);
      if (reaction) list.push({ name: '나', reaction, me: true });
      cand.reactions = list;
      cand.my_reaction = reaction;
      cand.must_count = list.filter((r) => r.reaction === 'MUST').length;
      cand.ok_count = list.filter((r) => r.reaction === 'OK').length;
      cand.pass_count = list.filter((r) => r.reaction === 'PASS').length;
    },
    async manageCandidate(candidateId, action, value) {
      const cand = store.candidates.find((c) => String(c.id) === candidateId);
      if (!cand) forbidden('없는 후보');
      const role = store.rows.get(cand.trip_id)?.role ?? null;
      const canEdit = role == null || role === 'OWNER' || role === 'EDITOR';
      if (action === 'REMOVE') {
        // 빼는 기준은 역할이 아니라 '누가 냈는가'
        if (!cand.mine && role !== 'OWNER' && role != null) forbidden('내가 낸 후보만 뺄 수 있다');
        store.candidates = store.candidates.filter((c) => c !== cand);
        return;
      }
      if (!canEdit) forbidden('상태 변경은 편집 권한이 필요하다');
      if (action === 'SCHEDULE') { cand.status = 'SCHEDULED'; cand.scheduled_ref = value; return; }
      if (action === 'UNSCHEDULE') { cand.status = 'PROPOSED'; cand.scheduled_ref = null; return; }
      if (action === 'REJECT') { cand.status = 'REJECTED'; cand.scheduled_ref = null; return; }
      if (action === 'REOPEN') { cand.status = 'PROPOSED'; cand.scheduled_ref = null; return; }
      forbidden('모르는 동작');
    },
    async listComments(candidateId) { return store.comments.filter((c) => c.candidate_id === candidateId); },
    async addComment(candidateId, body) {
      const cand = store.candidates.find((c) => String(c.id) === candidateId);
      if (!cand) forbidden('없는 후보');
      const id = String(++store.seq);
      store.comments.push({
        trip_id: cand.trip_id, candidate_id: candidateId, id, body,
        author_label: '나', mine: true, created_at: `2026-09-02T01:00:${String(store.seq).padStart(2, '0')}Z`
      });
      cand.comment_count = (cand.comment_count ?? 0) + 1;
      return id;
    },
    async deleteComment(commentId) {
      const cm = store.comments.find((c) => String(c.id) === commentId);
      if (!cm) forbidden('없는 코멘트');
      const role = store.rows.get(cm.trip_id)?.role ?? null;
      if (!cm.mine && role !== 'OWNER' && role != null) forbidden('쓴 사람이나 주최자만 지운다');
      store.comments = store.comments.filter((c) => c !== cm);
      const cand = store.candidates.find((c) => String(c.id) === cm.candidate_id);
      if (cand) cand.comment_count = Math.max(0, (cand.comment_count ?? 1) - 1);
    },
    async listPreferences(tripId) { return store.prefs.get(tripId) ?? []; },
    async savePreference(tripId, prefs) {
      // 진짜 서버는 tc_norm_prefs로 아는 값만 남긴다. 여기서는 클라이언트와 같은 화이트리스트를 쓴다.
      const normalized = collabModule.normPrefs(prefs);
      const rows = (store.prefs.get(tripId) ?? []).filter((r) => !r.mine);
      rows.unshift({ label: '나', mine: true, prefs: normalized });
      store.prefs.set(tripId, rows);
      return normalized;
    },
    async listActivity(_tripId, limit) { return store.activity.slice(0, limit); },
    async listPriceObservations() { return store.observations; },
    async listSentNotificationKeys() { return store.sentKeys; },
    async recordNotifications(_tripId, _day, items) {
      items.forEach((n) => { if (!store.sentKeys.includes(n.dedupeKey)) store.sentKeys.push(n.dedupeKey); });
    },
    async saveDevice(registration) {
      store.devices = store.devices.filter((d) => d.deviceId !== registration.deviceId).concat(registration);
    },
    async removeDevice(deviceId) { store.devices = store.devices.filter((d) => d.deviceId !== deviceId); },
    async listMemories(_tripId, dayIndex) {
      return dayIndex == null ? store.memories : store.memories.filter((m) => m.day_index === dayIndex);
    },
    async saveMemory(_tripId, row) {
      const existing = row.client_key ? store.memories.find((m) => m.client_key === row.client_key) : undefined;
      if (existing) return { row: existing, created: false };
      const saved: MemoryRow = { id: `mem${store.memories.length + 1}`, ...row };
      store.memories.push(saved);
      return { row: saved, created: true };
    },
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

describe('함께하기 — 역할과 권한(§76: 판단은 서버가 한다)', () => {
  it('여행 목록·Today의 TripSummary에 내 역할과 인원이 실린다 (없으면 혼자 쓰는 여행: OWNER·1)', async () => {
    store.rows.set('shared', { client_id: 'shared', data: { ...tripDoc(), id: 'shared', name: '공유' }, revision: 1, updated_at: '2026-08-31T00:00:00Z', deleted_at: null, role: 'EDITOR', member_count: 3 });
    const body = (await (await api.trips(new Request('http://localhost/api/v1/trips', auth()))).json()) as TripListResponse;
    const mine = body.trips.find((t) => t.id === 'trip-1')!;
    const shared = body.trips.find((t) => t.id === 'shared')!;
    expect([mine.role, mine.memberCount]).toEqual(['OWNER', 1]);
    expect([shared.role, shared.memberCount]).toEqual(['EDITOR', 3]);
    const today = (await (await api.today(new Request('http://localhost/api/v1/trips/shared/today', auth()), 'shared')).json()) as TodayResponse;
    expect([today.trip.role, today.trip.memberCount]).toEqual(['EDITOR', 3]);
  });

  it('보기 권한(VIEWER)의 쓰기는 403 FORBIDDEN이고 문서는 그대로다 — 서버에 헛된 저장 요청을 보내지 않는다', async () => {
    const row = store.rows.get('trip-1')!;
    store.rows.set('trip-1', { ...row, role: 'VIEWER', member_count: 2 });
    const res = await api.activityAction(
      new Request('http://localhost/api/v1/trips/trip-1/activities/d0s0/complete', auth({ method: 'POST', body: JSON.stringify({ expectedRevision: 3 }) })),
      'trip-1', 'd0s0', 'complete');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'FORBIDDEN' });
    expect(store.rows.get('trip-1')!.revision).toBe(3);
    expect(store.rows.get('trip-1')!.data.days![0].spots![0].status).toBeUndefined();
    // 읽기는 된다 — 보기 권한도 Today를 본다
    const today = await api.today(new Request('http://localhost/api/v1/trips/trip-1/today', auth()), 'trip-1');
    expect(today.status).toBe(200);
  });

  it('역할 정보 없이도 게이트웨이가 forbidden을 돌려주면 403이다 (RLS가 마지막 경계)', async () => {
    const row = store.rows.get('trip-1')!;
    // 역할은 모르지만(구버전 목록) sync_trip이 42501 → 게이트웨이 forbidden
    const gw = gatewayOf(store);
    const forbiddenGw: Gateway = { ...gw, async saveTrip(id, data, expected) { return { applied: false, conflict: false, forbidden: true, revision: expected, data: null }; } };
    const local = createHandlers({ gatewayFor: () => forbiddenGw, now: () => NOW });
    const res = await local.activityAction(
      new Request('http://localhost/api/v1/trips/trip-1/activities/d0s0/complete', auth({ method: 'POST', body: JSON.stringify({ expectedRevision: row.revision }) })),
      'trip-1', 'd0s0', 'complete');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'FORBIDDEN' });
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

describe('POST /import/preview — 공유된 것을 훑기만 한다(§76.2)', () => {
  const preview = (body: unknown) =>
    api.importPreview(new Request('http://localhost/api/v1/import/preview', auth({ method: 'POST', body: JSON.stringify(body) })));

  const HOTEL = {
    url: 'https://www.booking.com/hotel/es/cap-rocat.html',
    title: 'Cap Rocat | Booking.com',
    text: '예약 번호: ABC12345\n체크인 2026-09-02\n체크아웃 2026-09-04\n총액 EUR 1,420'
  };

  it('예약 후보와 소속 여행 후보를 함께 주고, 아무것도 저장하지 않는다', async () => {
    const res = await preview(HOTEL);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ImportPreviewResponse;
    expect(body.kind).toBe('BOOKING');
    expect(body.candidate?.title).toBe('Cap Rocat');
    expect(body.candidate?.confirmationNumber).toBe('ABC12345');
    expect(body.candidate?.disposition).toBe('AUTO');
    expect(body.tripMatches[0]?.tripId).toBe('trip-1');
    expect(body.tripMatches[0]?.reasons.length).toBeGreaterThan(0);
    expect(body.idempotencyKey).toBeTruthy();
    // 저장 흔적 없음
    expect(store.rows.get('trip-1')!.revision).toBe(3);
    expect(store.rows.get('trip-1')!.data.bookings ?? []).toHaveLength(0);
  });

  it('모든 공유를 예약으로 가정하지 않는다', async () => {
    const place = (await (await preview({ url: 'https://maps.apple.com/?ll=39.57,2.65&q=Sa+Calobra' })).json()) as ImportPreviewResponse;
    expect(place.kind).toBe('PLACE');
    expect(place.candidate).toBeNull();

    const note = (await (await preview({ text: '여기 저녁에 다시 오자' })).json()) as ImportPreviewResponse;
    expect(note.kind).toBe('NOTE');
    expect(note.candidate).toBeNull();
    expect(note.rawText).toBe('여기 저녁에 다시 오자');   // 못 읽어도 버리지 않는다(§50)
  });

  it('같은 공유는 같은 키를 낸다 — 두 번 처리되지 않게', async () => {
    const a = (await (await preview(HOTEL)).json()) as ImportPreviewResponse;
    const b = (await (await preview({ ...HOTEL, receivedAt: '2026-09-01T10:00:00Z' })).json()) as ImportPreviewResponse;
    expect(b.idempotencyKey).toBe(a.idempotencyKey);
  });

  it('빈 요청은 400', async () => {
    expect((await preview({})).status).toBe(400);
  });
});

describe('POST /import/commit — 확인한 것만 저장하고, 다음 행동으로 잇는다(§42)', () => {
  const commit = (body: unknown) =>
    api.importCommit(new Request('http://localhost/api/v1/trips/trip-1/import/commit',
      auth({ method: 'POST', body: JSON.stringify(body) })), 'trip-1');

  const candidateFor = async () => {
    const res = await api.importPreview(new Request('http://localhost/api/v1/import/preview', auth({
      method: 'POST',
      body: JSON.stringify({
        url: 'https://www.booking.com/hotel/es/cap-rocat.html',
        title: 'Cap Rocat | Booking.com',
        text: '예약 번호: ABC12345\n체크인 2026-09-02\n체크아웃 2026-09-04\n총액 EUR 1,420'
      })
    })));
    return ((await res.json()) as ImportPreviewResponse).candidate!;
  };

  it('예약을 여행에 붙이고 최신 상태를 함께 돌려준다', async () => {
    const candidate = await candidateFor();
    const res = await commit({ candidate, expectedRevision: 3 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ImportCommitResponse;
    expect(body.revision).toBe(4);
    const bookings = store.rows.get('trip-1')!.data.bookings as { id: string; title: string; confirmation?: string }[];
    expect(bookings).toHaveLength(1);
    expect(bookings[0].title).toBe('Cap Rocat');
    expect(bookings[0].confirmation).toBe('ABC12345');
    expect(body.replan).toBeTruthy();   // 저장으로 끝나지 않는다
    expect(body.today.trip.revision).toBe(4);
  });

  it('여러 번 들여와도 id가 겹치지 않는다', async () => {
    const candidate = await candidateFor();
    await commit({ candidate });
    await commit({ candidate });
    const bookings = store.rows.get('trip-1')!.data.bookings as { id: string }[];
    expect(new Set(bookings.map((b) => b.id)).size).toBe(bookings.length);
  });

  it('다른 기기가 먼저 바꿨으면 409', async () => {
    const candidate = await candidateFor();
    const res = await commit({ candidate, expectedRevision: 1 });
    expect(res.status).toBe(409);
    expect(store.rows.get('trip-1')!.data.bookings ?? []).toHaveLength(0);
  });

  it('후보가 없으면 400', async () => {
    expect((await commit({})).status).toBe(400);
  });
});

describe('여행 기록 — 어디였는지 다시 묻지 않는다(§27)', () => {
  const create = (body: unknown) =>
    api.createMemory(new Request('http://localhost/api/v1/trips/trip-1/memories?now=19:30',
      auth({ method: 'POST', body: JSON.stringify(body) })), 'trip-1');

  it('시각으로 일정을 자동 연결하고 왜 그렇게 붙였는지 말한다', async () => {
    const res = await create({ type: 'PHOTO', assetRefs: ['ph1', 'ph2'] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MemoryCreateResponse;
    expect(body.event.type).toBe('PHOTO');
    expect(body.event.assetRefs).toEqual(['ph1', 'ph2']);
    expect(body.association.activityId).toBe('d0s1');   // 19:30 = 저녁 예약 진행 중
    expect(body.association.reason.length).toBeGreaterThan(0);
    expect(body.alreadyExists).toBe(false);
  });

  it('클라이언트가 보낸 activityId를 그대로 믿지 않는다', async () => {
    const body = (await (await create({ type: 'NOTE', caption: '메모', activityId: 'd9s9' })).json()) as MemoryCreateResponse;
    expect(body.event.activityId).not.toBe('d9s9');
  });

  it('오프라인에서 만든 기록이 온라인 복귀 후 두 번 올라가지 않는다(§57)', async () => {
    const first = (await (await create({ type: 'NOTE', caption: '메모', clientKey: 'local-1' })).json()) as MemoryCreateResponse;
    const again = (await (await create({ type: 'NOTE', caption: '메모', clientKey: 'local-1' })).json()) as MemoryCreateResponse;
    expect(again.alreadyExists).toBe(true);
    expect(again.event.id).toBe(first.event.id);
    expect(store.memories).toHaveLength(1);
  });

  it('알 수 없는 종류는 400', async () => {
    expect((await create({ type: 'VIDEO' })).status).toBe(400);
  });

  it('기록을 일정과 나란히 놓아 돌려준다', async () => {
    await create({ type: 'PHOTO', assetRefs: ['a'] });
    await create({ type: 'NOTE', caption: '좋았다' });
    const res = await api.memories(new Request('http://localhost/api/v1/trips/trip-1/memories', auth()), 'trip-1');
    const body = (await res.json()) as MemoryListResponse;
    expect(body.events).toHaveLength(2);
    expect(body.timeline.length).toBeGreaterThan(0);
    expect(body.timeline[0].photos + body.timeline[0].notes).toBeGreaterThan(0);
  });

  it('사진 원본을 서버에 담지 않는다 — 식별자만 남는다(§76.6)', async () => {
    const body = (await (await create({ type: 'PHOTO', assetRefs: ['local-identifier-1'] })).json()) as MemoryCreateResponse;
    const text = JSON.stringify(body);
    expect(text).toContain('local-identifier-1');
    expect(text).not.toContain('base64');
    expect(text).not.toContain('data:image');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 함께하기 — 후보 보드 · 반응 · 코멘트 · 취향 · 활동
//
// iOS는 이 응답만 보고 그린다. 그래서 여기서 확인하는 것은 두 가지다:
//   "묶음·문장·선택지가 이미 다 만들어져 오는가"와 "화면에 점수가 새어 나가지 않는가".

const board = (res: Response) => res.json() as Promise<CandidateBoardResponse>;
const boardUrl = 'http://localhost/api/v1/trips/trip-1/candidates';

/** 다른 사람들의 반응을 심는다 — 진짜 RPC가 주는 모양(reactions 배열 + 카운트)을 그대로 맞춘다 */
function seedReactions(store: Store, candidateId: string, others: Array<{ name: string; reaction: 'MUST' | 'OK' | 'PASS' }>) {
  const cand = store.candidates.find((c) => String(c.id) === candidateId)!;
  const list = (cand.reactions ?? []).concat(others.map((o) => ({ name: o.name, reaction: o.reaction, me: false })));
  cand.reactions = list;
  cand.must_count = list.filter((r) => r.reaction === 'MUST').length;
  cand.ok_count = list.filter((r) => r.reaction === 'OK').length;
  cand.pass_count = list.filter((r) => r.reaction === 'PASS').length;
}

async function addCandidate(api: ReturnType<typeof createHandlers>, title: string, location?: { lat: number; lng: number }) {
  return board(await api.addCandidate(
    new Request(boardUrl, auth({ method: 'POST', body: JSON.stringify({ title, ...(location ? { location } : {}) }) })), 'trip-1'));
}

describe('함께하기 — 후보 보드', () => {
  it('후보를 담으면 묶음과 배지 문장까지 만들어져 온다 — iOS가 다시 계산할 것이 없다', async () => {
    const body = await addCandidate(api, '프라도 미술관');
    const all = body.groups.flatMap((g) => g.candidates);
    expect(all).toHaveLength(1);
    const cand = all[0];
    expect(cand.title).toBe('프라도 미술관');
    expect(cand.proposedBy).toBe('내가 추가');
    expect(cand.myReaction).toBe('MUST');          // 제안자에게는 MUST가 자동으로 붙는다
    expect(cand.verdict.text).not.toBe('');
    expect(cand.reactionSummary).toContain('1');
    expect(body.canPropose).toBe(true);
  });

  it('묶음은 결정하지 못한 것이 맨 위다 — 순위가 아니라 어디에 한마디가 필요한지다', async () => {
    await addCandidate(api, '갈린 곳');
    seedReactions(store, '1', [{ name: '지민', reaction: 'PASS' }]);
    await addCandidate(api, '다들 좋은 곳');
    seedReactions(store, '2', [{ name: '지민', reaction: 'MUST' }]);
    const body = await board(await api.candidates(new Request(boardUrl, auth()), 'trip-1'));
    expect(body.groups.map((g) => g.key)).toEqual(['NEEDS_OPINION', 'LOVED']);
    expect(body.groups[0].title).toBe('의견이 필요해요');
  });

  it('갈린 후보에는 세 선택지가 붙고 자동으로 빠지지 않는다 (§23·§24)', async () => {
    await addCandidate(api, '투우 박물관');
    seedReactions(store, '1', [{ name: '지민', reaction: 'PASS' }, { name: '현우', reaction: 'OK' }]);
    const body = await board(await api.candidates(new Request(boardUrl, auth()), 'trip-1'));
    const cand = body.groups.flatMap((g) => g.candidates)[0];
    expect(cand.status).toBe('PROPOSED');                       // 갈렸다고 빼지 않는다
    expect(cand.conflict).not.toBeNull();
    expect(cand.conflict!.must).toEqual(['나']);
    expect(cand.conflict!.pass).toEqual(['지민']);
    expect(cand.conflict!.options.map((o) => o.key)).toEqual(['TOGETHER', 'SPLIT', 'SKIP']);
    // 분리는 아직 안내만이라 누를 동작이 없다
    expect(cand.conflict!.options.map((o) => o.action)).toEqual(['SCHEDULE', null, 'REJECT']);
  });

  it('화면에 나가는 문장에 합의 점수가 없다 (§21·§22 — 점수는 내부값이다)', async () => {
    await addCandidate(api, '레티로 공원');
    seedReactions(store, '1', [{ name: '지민', reaction: 'MUST' }, { name: '현우', reaction: 'OK' }]);
    const body = await board(await api.candidates(new Request(boardUrl, auth()), 'trip-1'));
    const cand = body.groups.flatMap((g) => g.candidates)[0];
    expect(cand.verdict.text).not.toMatch(/\d/);
    expect(JSON.stringify(cand.verdict)).not.toContain('score');
    expect(JSON.stringify(body)).not.toContain('"score"');
  });

  it('빼기(REJECT)는 지우지 않는다 — 이번엔 뺐어요로 내려가고 되돌리면 후보로 돌아온다', async () => {
    await addCandidate(api, '쇼핑몰');
    const manage = (action: string) => api.manageCandidate(
      new Request(`${boardUrl}/1/manage`, auth({ method: 'POST', body: JSON.stringify({ action }) })), 'trip-1', '1');

    const rejected = await board(await manage('REJECT'));
    const rejectedGroup = rejected.groups.find((g) => g.key === 'REJECTED')!;
    expect(rejectedGroup.title).toBe('이번엔 뺐어요');
    expect(rejectedGroup.candidates[0].status).toBe('REJECTED');
    expect(rejectedGroup.candidates[0].reactionSummary).not.toBe('');   // 의견은 그대로 남는다

    const reopened = await board(await manage('REOPEN'));
    expect(reopened.groups.some((g) => g.key === 'REJECTED')).toBe(false);
    expect(reopened.groups.flatMap((g) => g.candidates)[0].status).toBe('PROPOSED');
  });

  it('모르는 동작은 400이다 — RPC까지 가지 않는다', async () => {
    await addCandidate(api, '아무 곳');
    const res = await api.manageCandidate(
      new Request(`${boardUrl}/1/manage`, auth({ method: 'POST', body: JSON.stringify({ action: 'DROP' }) })), 'trip-1', '1');
    expect(res.status).toBe(400);
    expect(store.candidates).toHaveLength(1);
  });

  it('이름 없는 후보는 400이다', async () => {
    const res = await api.addCandidate(new Request(boardUrl, auth({ method: 'POST', body: JSON.stringify({ title: '   ' }) })), 'trip-1');
    expect(res.status).toBe(400);
    expect(store.candidates).toHaveLength(0);
  });
});

describe('함께하기 — 보기 권한은 의견만 낸다 (§12)', () => {
  beforeEach(() => {
    const row = store.rows.get('trip-1')!;
    store.rows.set('trip-1', { ...row, role: 'VIEWER', member_count: 3 });
    store.candidates.push({
      trip_id: 'trip-1', id: '9', title: '지민이 담은 곳', place_id: null, lat: null, lng: null,
      addr: null, note: null, url: null, status: 'PROPOSED', scheduled_ref: null,
      proposed_by_label: '지민', mine: false, my_reaction: null,
      must_count: 1, ok_count: 0, pass_count: 0,
      reactions: [{ name: '지민', reaction: 'MUST', me: false }], comment_count: 0,
      created_at: '2026-09-01T00:00:00Z'
    });
  });

  it('후보 추가는 403이고 보드는 그대로다', async () => {
    const res = await api.addCandidate(new Request(boardUrl, auth({ method: 'POST', body: JSON.stringify({ title: '몰래' }) })), 'trip-1');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'FORBIDDEN' });
    expect(store.candidates).toHaveLength(1);
  });

  it('반응은 된다 — 의견을 내는 것은 여행에 내용을 만드는 것이 아니다', async () => {
    const body = await board(await api.reactCandidate(
      new Request(`${boardUrl}/9/react`, auth({ method: 'POST', body: JSON.stringify({ reaction: 'OK' }) })), 'trip-1', '9'));
    expect(body.canReact).toBe(true);
    expect(body.canPropose).toBe(false);
    expect(body.groups.flatMap((g) => g.candidates)[0].myReaction).toBe('OK');
  });

  it('같은 반응을 두 번 눌러도 결과가 같고, 비우면 거둔다', async () => {
    const react = (reaction: string | null) => api.reactCandidate(
      new Request(`${boardUrl}/9/react`, auth({ method: 'POST', body: JSON.stringify({ reaction }) })), 'trip-1', '9');
    await react('OK');
    const twice = await board(await react('OK'));
    expect(twice.groups.flatMap((g) => g.candidates)[0].myReaction).toBe('OK');
    const cleared = await board(await react(null));
    expect(cleared.groups.flatMap((g) => g.candidates)[0].myReaction).toBeNull();
  });

  it('알 수 없는 반응은 400이다', async () => {
    const res = await api.reactCandidate(
      new Request(`${boardUrl}/9/react`, auth({ method: 'POST', body: JSON.stringify({ reaction: 'LOVE' }) })), 'trip-1', '9');
    expect(res.status).toBe(400);
  });

  it('남이 낸 후보는 뺄 수 없다 — 기준은 역할이 아니라 누가 냈는가다', async () => {
    const body = await board(await api.candidates(new Request(boardUrl, auth()), 'trip-1'));
    expect(body.groups.flatMap((g) => g.candidates)[0].canRemove).toBe(false);
    const res = await api.manageCandidate(
      new Request(`${boardUrl}/9/manage`, auth({ method: 'POST', body: JSON.stringify({ action: 'REMOVE' }) })), 'trip-1', '9');
    expect(res.status).toBe(403);
    expect(store.candidates).toHaveLength(1);
  });

  it('일정에 넣는 것도 403이다 — 상태 변경은 편집 권한 이상', async () => {
    const res = await api.manageCandidate(
      new Request(`${boardUrl}/9/manage`, auth({ method: 'POST', body: JSON.stringify({ action: 'SCHEDULE', value: '2' }) })), 'trip-1', '9');
    expect(res.status).toBe(403);
  });
});

describe('함께하기 — 코멘트', () => {
  beforeEach(async () => { await addCandidate(api, '타파스 골목'); });

  it('남기면 목록과 후보의 코멘트 수가 함께 는다', async () => {
    const res = await api.addComment(
      new Request(`${boardUrl}/1/comments`, auth({ method: 'POST', body: JSON.stringify({ body: '여기 저녁이 좋대요' }) })), 'trip-1', '1');
    const body = (await res.json()) as CommentListResponse;
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0].body).toBe('여기 저녁이 좋대요');
    expect(body.comments[0].canDelete).toBe(true);
    const boardBody = await board(await api.candidates(new Request(boardUrl, auth()), 'trip-1'));
    expect(boardBody.groups.flatMap((g) => g.candidates)[0].commentCount).toBe(1);
  });

  it('빈 한마디는 400이다', async () => {
    const res = await api.addComment(
      new Request(`${boardUrl}/1/comments`, auth({ method: 'POST', body: JSON.stringify({ body: '  ' }) })), 'trip-1', '1');
    expect(res.status).toBe(400);
    expect(store.comments).toHaveLength(0);
  });

  it('지우면 목록에서 빠진다', async () => {
    await api.addComment(new Request(`${boardUrl}/1/comments`, auth({ method: 'POST', body: JSON.stringify({ body: '한마디' }) })), 'trip-1', '1');
    const id = String(store.comments[0].id);
    const body = (await (await api.deleteComment(
      new Request(`${boardUrl}/1/comments/${id}`, auth({ method: 'DELETE' })), 'trip-1', '1', id)).json()) as CommentListResponse;
    expect(body.comments).toHaveLength(0);
  });
});

describe('함께하기 — 여행 취향', () => {
  const prefUrl = 'http://localhost/api/v1/trips/trip-1/preferences';
  const save = (prefs: unknown) => api.savePreferences(new Request(prefUrl, auth({ method: 'PUT', body: JSON.stringify({ prefs }) })), 'trip-1');

  it('서버가 아는 값만 남는다 — 모르는 키와 빈 배열은 떨어진다', async () => {
    const body = (await (await save({ pace: 'RELAXED', walking: 'LOW', dislikes: [], secret: 'x', note: '  천천히  ' })).json()) as PreferenceResponse;
    expect(body.mine.pace).toBe('RELAXED');
    expect(body.mine.walking).toBe('LOW');
    expect(body.mine.dislikes).toEqual([]);
    expect(body.mine.note).toBe('천천히');
    expect(JSON.stringify(body.mine)).not.toContain('secret');
  });

  it('그룹 정리는 가장 약한 사람 기준으로 걷기를 말하고, 결정하지 않는다 (§19·§62)', async () => {
    store.prefs.set('trip-1', [
      { label: '나', mine: true, prefs: { pace: 'RELAXED', walking: 'NORMAL' } },
      { label: '지민', mine: false, prefs: { walking: 'LOW', night: false } }
    ]);
    const body = (await (await api.preferences(new Request(prefUrl, auth()), 'trip-1')).json()) as PreferenceResponse;
    expect(body.groupContext.some((t) => t.includes('많이 걷기 싫어요') && t.includes('지민'))).toBe(true);
    expect(body.groupContext.some((t) => t.includes('늦은 밤은 싫어요'))).toBe(true);
    expect(body.members.find((m) => m.mine)!.name).toBe('나');
    expect(body.groupContext.join(' ')).not.toContain('빼');   // 자동으로 빼자고 하지 않는다
  });

  it('아무도 안 남겼으면 그렇게 말한다', async () => {
    const body = (await (await api.preferences(new Request(prefUrl, auth()), 'trip-1')).json()) as PreferenceResponse;
    expect(body.groupContext[0]).toContain('아직 아무도');
    expect(body.mine.interests).toEqual([]);
  });
});

describe('함께하기 — 활동 기록', () => {
  it('문장과 상대시각까지 만들어 오고, 못 만드는 종류는 아예 빠진다 (§37·§39)', async () => {
    store.activity = [
      { id: 3, kind: 'CANDIDATE_PROPOSED', mine: false, actor_label: '지민', subject: { title: '프라도' }, created_at: '2026-09-01T03:59:00Z' },
      { id: 2, kind: 'MEMBER_JOINED', mine: false, actor_label: '현우', member_label: '현우', subject: {}, created_at: '2026-09-01T03:00:00Z' },
      { id: 1, kind: 'WHO_KNOWS', mine: false, actor_label: '지민', subject: {}, created_at: '2026-09-01T02:00:00Z' }
    ];
    const body = (await (await api.activity(new Request('http://localhost/api/v1/trips/trip-1/activity', auth()), 'trip-1')).json()) as ActivityListResponse;
    expect(body.entries.map((e) => e.id)).toEqual(['3', '2']);
    expect(body.entries[0].text).toContain('지민');
    expect(body.entries[0].relative).toBe('1분 전');
  });
});
