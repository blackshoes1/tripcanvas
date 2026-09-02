// /api/v1 핸들러 — 저장소 접근(Gateway)을 주입받아 테스트에서 Supabase 없이 그대로 돌릴 수 있다.
//
// 역할 분리(§8):
//   단순 조회(Trip·Day·Spot)  → 클라이언트가 Supabase SDK로 직접 봐도 된다
//   도메인 판단(Today·Suggestion·Replan) → 여기. 서버가 판단하고 클라이언트는 표현만 한다
//
// 쓰기는 전부 revision CAS(sync_trip)를 지난다. 같은 요청을 두 번 받아도 결과가 같고(alreadyApplied),
// 다른 기기가 먼저 바꿨으면 409로 최신 revision을 알려 준다 — 조용히 덮어쓰지 않는다.
import type {
  ApiError, ApiErrorCode, BookingCandidate, BookingListResponse, DeviceRegistration,
  ImportCommitResponse, ImportPreviewResponse, MemoryCreateResponse, MemoryEvent, MemoryListResponse,
  CandidateBoardResponse, MutationResponse, NotificationPlanItem, ReactionKind, TodayResponse,
  TravelStateResponse, TripListResponse
} from '../domain/contract';
import { CONTRACT_SCHEMA_VERSION } from '../domain/contract';
import type { PriceObservation } from '../domain/bookingsView';
import { buildBookings } from '../domain/bookingsView';
import { buildTravelState } from '../domain/travelState';
import type { MemoryRow, SharedInputPayload } from '../domain/intakeView';
import {
  associateCapture, buildImportPreview, buildMemoryTimeline, candidateToBookingDoc, toMemoryEvent
} from '../domain/intakeView';
import type { SettableStatus } from '../domain/mutations';
import { applyActivityStatus, applySuggestion } from '../domain/mutations';
import type { ActivityRow, CandidateRow, CommentRow, PrefRow, ProposalDay } from '../domain/candidatesView';
import { buildActivity, buildCandidateBoard, buildComments, buildPreferences } from '../domain/candidatesView';
import type { TodayInput, TripDoc } from '../domain/todayView';
import { computeToday, summarizeTrip } from '../domain/todayView';
import collab from '@legacy/collab.js';

export interface TripRow {
  client_id: string;
  data: TripDoc;
  revision: number;
  updated_at: string;
  deleted_at: string | null;
  /** 함께하기 — 호출자의 역할·활성 멤버 수 (my_trip_roles). 없으면 혼자 쓰는 여행 */
  role?: string | null;
  member_count?: number | null;
}

export interface Gateway {
  listTrips(): Promise<TripRow[]>;
  getTrip(tripId: string): Promise<TripRow | null>;
  /** sync_trip RPC (revision CAS). conflict면 applied=false + 현재 revision. forbidden이면 권한 없음(42501) — 재시도해도 같다 */
  saveTrip(tripId: string, data: TripDoc, expectedRevision: number): Promise<{ applied: boolean; conflict: boolean; revision: number; data: TripDoc | null; forbidden?: boolean }>;
  /** 그 여행·그 날 이미 거절한 제안 키 */
  listDismissed(tripId: string, dayISO: string): Promise<string[]>;
  recordFeedback(tripId: string, dayISO: string, key: string, action: string): Promise<void>;
  /** 가격 관측 (hotel_price_snapshots). 없으면 빈 배열 — 가짜 가격을 만들지 않는다 */
  listPriceObservations(tripId: string): Promise<PriceObservation[]>;
  /** 이미 보낸 알림 키 — 같은 상황을 두 번 알리지 않기 위해(§46) */
  listSentNotificationKeys(tripId: string, dayISO: string): Promise<string[]>;
  recordNotifications(tripId: string, dayISO: string, items: { kind: string; dedupeKey: string; stateVersion: string }[]): Promise<void>;
  saveDevice(registration: DeviceRegistration): Promise<void>;
  listMemories(tripId: string, dayIndex: number | null): Promise<MemoryRow[]>;
  /** clientKey가 이미 있으면 새로 만들지 않고 그것을 돌려준다(오프라인 재시도 대비) */
  saveMemory(tripId: string, row: Omit<MemoryRow, "id">): Promise<{ row: MemoryRow; created: boolean }>;
  removeDevice(deviceId: string): Promise<void>;

  // ── 함께하기. 전부 RPC(security definer)를 지난다 — 후보·반응·코멘트 테이블에는 쓰기 정책이 없다.
  //    권한 거절은 42501로 올라오고 핸들러가 403으로 옮긴다. 판정 자체는 DB가 한다.
  listCandidates(tripId: string): Promise<CandidateRow[]>;
  addCandidate(tripId: string, input: NewCandidate): Promise<string>;
  /** reaction이 null이면 반응을 거둔다. 같은 값을 두 번 보내도 결과가 같다 */
  reactCandidate(candidateId: string, reaction: ReactionKind | null): Promise<void>;
  manageCandidate(candidateId: string, action: string, value: string | null): Promise<void>;
  listComments(candidateId: string): Promise<CommentRow[]>;
  addComment(candidateId: string, body: string): Promise<string>;
  deleteComment(commentId: string): Promise<void>;
  listPreferences(tripId: string): Promise<PrefRow[]>;
  /** 서버가 정규화한 결과를 그대로 돌려준다 — 저장 뒤에는 서버가 이긴다 */
  savePreference(tripId: string, prefs: unknown): Promise<unknown>;
  listActivity(tripId: string, limit: number): Promise<ActivityRow[]>;
}

export interface NewCandidate {
  title: string;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  addr: string | null;
  note: string | null;
  url: string | null;
}

export interface HandlerDeps {
  /** 토큰으로 사용자 컨텍스트를 만든다. 인증 실패는 null */
  gatewayFor(token: string): Promise<Gateway | null> | Gateway | null;
  now?: () => Date;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const STATUS: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401, TRIP_NOT_FOUND: 404, ACTIVITY_NOT_FOUND: 404,
  SUGGESTION_STALE: 409, REVISION_CONFLICT: 409, BAD_REQUEST: 400, UPSTREAM_ERROR: 502, FORBIDDEN: 403
};
const MESSAGES: Record<ApiErrorCode, string> = {
  UNAUTHORIZED: '로그인이 필요합니다.',
  TRIP_NOT_FOUND: '그 여행을 찾을 수 없습니다.',
  ACTIVITY_NOT_FOUND: '그 일정을 찾을 수 없습니다 — 목록을 새로 불러와 주세요.',
  SUGGESTION_STALE: '상황이 바뀌어 그 제안은 더 이상 맞지 않습니다 — 새 제안을 확인해 주세요.',
  REVISION_CONFLICT: '다른 기기에서 먼저 바뀌었습니다 — 최신 일정을 불러온 뒤 다시 시도해 주세요.',
  BAD_REQUEST: '요청 형식이 올바르지 않습니다.',
  UPSTREAM_ERROR: '데이터를 가져오지 못했습니다.',
  FORBIDDEN: '이 여행을 바꿀 권한이 없습니다 — 주최자에게 편집 권한을 요청해 주세요.'
};

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
function fail(code: ApiErrorCode, extra?: Partial<ApiError>): Response {
  const body: ApiError = { error: code, message: extra?.message ?? MESSAGES[code], ...(extra?.revision != null ? { revision: extra.revision } : {}) };
  return ok(body, STATUS[code]);
}
/** Authorization: Bearer <supabase access token> */
export function bearerToken(request: Request): string | null {
  const raw = request.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

/** 여행지 현지 기준 날짜·분. 클라이언트가 명시하면 그 값이 이긴다(기기가 현지 시각을 안다). */
export function resolveClock(
  trip: TripDoc, dayIndexHint: number | null, url: URL, now: Date
): { todayISO: string; nowMinutes: number } {
  const qDate = url.searchParams.get('date');
  const qNow = url.searchParams.get('now');
  const zone = trip.days?.[dayIndexHint ?? 0]?.timeZone || trip.timeZone || '';
  let todayISO = '';
  let nowMinutes = 9 * 60;
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    const parts: Record<string, string> = {};
    fmt.formatToParts(now).forEach((p) => { if (p.type !== 'literal') parts[p.type] = p.value; });
    todayISO = `${parts.year}-${parts.month}-${parts.day}`;
    nowMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  } catch {
    todayISO = now.toISOString().slice(0, 10);
    nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  }
  if (qDate && /^\d{4}-\d{2}-\d{2}$/.test(qDate)) todayISO = qDate;
  if (qNow) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(qNow);
    if (m) nowMinutes = Math.min(1439, Math.max(0, Number(m[1]) * 60 + Number(m[2])));
  }
  return { todayISO, nowMinutes };
}

/** 위치는 쿼리로만 받는다. 저장하지 않고 이번 계산에만 쓴다(§55). */
export function readLocation(url: URL): { point: { lat: number; lng: number } | null; updatedAt: string | null } {
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  const valid = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    && url.searchParams.has('lat') && url.searchParams.has('lng');
  return {
    point: valid ? { lat, lng } : null,
    updatedAt: url.searchParams.get('locUpdatedAt')
  };
}

function readMinutes(raw: string | null): number | null {
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (m) return Math.min(1439, Math.max(0, Number(m[1]) * 60 + Number(m[2])));
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** 범주별 on/off만 통과시킨다 — 임의 키가 그대로 들어가지 않게. */
function sanitizePreferences(raw: unknown): Record<string, boolean> {
  const allowed = ['departure', 'booking', 'replan', 'price', 'suggestion'];
  const out: Record<string, boolean> = {};
  if (raw && typeof raw === 'object') {
    for (const key of allowed) {
      const value = (raw as Record<string, unknown>)[key];
      if (typeof value === 'boolean') out[key] = value;
    }
  }
  return out;
}

/** 예약 id는 uid() 형식(영숫자·-·_)이어야 normalizeBooking을 통과한다. 겹치지 않게 만든다. */
function makeBookingId(trip: TripDoc): string {
  const used = new Set(((trip.bookings ?? []) as { id?: unknown }[]).map((b) => String(b?.id ?? '')));
  for (let n = 1; n < 1000; n++) {
    const id = `imp${n}`;
    if (!used.has(id)) return id;
  }
  return `imp${Date.now().toString(36)}`;
}

function readPoint(raw: unknown): { lat: number; lng: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as { lat?: unknown; lng?: unknown };
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function readDayIndex(url: URL): number | undefined {
  const raw = url.searchParams.get('day');
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

export function createHandlers(deps: HandlerDeps) {
  const now = deps.now ?? (() => new Date());

  async function auth(request: Request): Promise<Gateway | Response> {
    const token = bearerToken(request);
    if (!token) return fail('UNAUTHORIZED');
    const gateway = await deps.gatewayFor(token);
    return gateway ?? fail('UNAUTHORIZED');
  }

  async function todayFor(gateway: Gateway, row: TripRow, url: URL, extra?: Partial<TodayInput>): Promise<TodayResponse> {
    const dayIndex = readDayIndex(url);
    const clock = resolveClock(row.data, dayIndex ?? null, url, now());
    const dismissed = await gateway.listDismissed(row.client_id, clock.todayISO).catch((): string[] => []);
    return computeToday({
      tripId: row.client_id, trip: row.data, revision: row.revision, updatedAt: row.updated_at,
      role: row.role, memberCount: row.member_count,
      todayISO: clock.todayISO, nowMinutes: clock.nowMinutes, dayIndex, dismissed,
      generatedAt: now().toISOString(), ...extra
    }).response;
  }

  /** GET /api/v1/trips — 여행 목록. 삭제(tombstone)된 여행은 빼고, 최근 수정 순. */
  async function trips(request: Request): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    let rows: TripRow[];
    try { rows = await gateway.listTrips(); } catch { return fail('UPSTREAM_ERROR'); }
    const stamp = now().toISOString().slice(0, 10);
    const body: TripListResponse = {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      trips: rows.filter((r) => !r.deleted_at).map((r) => summarizeTrip(r, stamp))
    };
    return ok(body);
  }

  /** GET /api/v1/trips/:tripId/today */
  async function today(request: Request, tripId: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    let row: TripRow | null;
    try { row = await gateway.getTrip(tripId); } catch { return fail('UPSTREAM_ERROR'); }
    if (!row || row.deleted_at) return fail('TRIP_NOT_FOUND');
    return ok(await todayFor(gateway, row, new URL(request.url)));
  }

  /** POST /api/v1/trips/:tripId/replan-preview — 미리보기만. 아무것도 저장하지 않는다. */
  async function replanPreview(request: Request, tripId: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    let row: TripRow | null;
    try { row = await gateway.getTrip(tripId); } catch { return fail('UPSTREAM_ERROR'); }
    if (!row || row.deleted_at) return fail('TRIP_NOT_FOUND');
    const response = await todayFor(gateway, row, new URL(request.url));
    return ok({ schemaVersion: CONTRACT_SCHEMA_VERSION, replan: response.replan, today: response });
  }

  async function readBody(request: Request): Promise<Record<string, unknown>> {
    try { return (await request.json()) as Record<string, unknown>; } catch { return {}; }
  }

  /** 저장 후 최신 Today를 함께 돌려준다 — 여행 중에는 왕복 횟수가 곧 체감 속도다. */
  async function persist(
    gateway: Gateway, row: TripRow, next: TripDoc, url: URL, applied: boolean, alreadyApplied: boolean
  ): Promise<Response> {
    if (!applied) {
      const body: MutationResponse = {
        schemaVersion: CONTRACT_SCHEMA_VERSION, applied: false, alreadyApplied,
        revision: row.revision, today: await todayFor(gateway, row, url)
      };
      return ok(body);
    }
    // 보기 권한은 서버(RLS)가 어차피 거절한다 — 헛된 RPC 없이 바로 알린다
    if (row.role != null && !collab.canEdit(row.role)) return fail('FORBIDDEN');
    let saved;
    try { saved = await gateway.saveTrip(row.client_id, next, row.revision); } catch { return fail('UPSTREAM_ERROR'); }
    if (saved.forbidden) return fail('FORBIDDEN');
    if (!saved.applied) return fail('REVISION_CONFLICT', { revision: saved.revision });
    const savedRow: TripRow = { ...row, data: saved.data ?? next, revision: saved.revision, updated_at: new Date().toISOString() };
    const body: MutationResponse = {
      schemaVersion: CONTRACT_SCHEMA_VERSION, applied: true, alreadyApplied: false,
      revision: saved.revision, today: await todayFor(gateway, savedRow, url)
    };
    return ok(body);
  }

  /** POST /api/v1/trips/:tripId/activities/:activityId/:action  (complete | skip | reset) */
  async function activityAction(request: Request, tripId: string, activityId: string, action: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const status: SettableStatus | null =
      action === 'complete' ? 'COMPLETED' : action === 'skip' ? 'SKIPPED' : action === 'reset' ? 'PLANNED' : null;
    if (!status) return fail('BAD_REQUEST');
    let row: TripRow | null;
    try { row = await gateway.getTrip(tripId); } catch { return fail('UPSTREAM_ERROR'); }
    if (!row || row.deleted_at) return fail('TRIP_NOT_FOUND');

    const body = await readBody(request);
    const expected = body.expectedRevision;
    if (typeof expected === 'number' && expected !== row.revision) return fail('REVISION_CONFLICT', { revision: row.revision });
    const expectedName = typeof body.expectedName === 'string' ? body.expectedName : undefined;

    const result = applyActivityStatus(row.data, activityId, status, expectedName);
    if (!result.ok) {
      return result.error === 'NAME_MISMATCH'
        ? fail('SUGGESTION_STALE', { message: '그 사이 일정 순서가 바뀌었습니다 — 새로 불러온 뒤 다시 시도해 주세요.', revision: row.revision })
        : fail('ACTIVITY_NOT_FOUND');
    }
    return persist(gateway, row, result.trip, new URL(request.url), result.applied, result.alreadyApplied);
  }

  /** POST /api/v1/trips/:tripId/suggestions/:action  (accept | skip), body: { suggestionId } */
  async function suggestionAction(request: Request, tripId: string, action: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    if (action !== 'accept' && action !== 'skip') return fail('BAD_REQUEST');
    let row: TripRow | null;
    try { row = await gateway.getTrip(tripId); } catch { return fail('UPSTREAM_ERROR'); }
    if (!row || row.deleted_at) return fail('TRIP_NOT_FOUND');

    const body = await readBody(request);
    const suggestionId = typeof body.suggestionId === 'string' ? body.suggestionId : '';
    if (!suggestionId) return fail('BAD_REQUEST');
    const expected = body.expectedRevision;
    if (typeof expected === 'number' && expected !== row.revision) return fail('REVISION_CONFLICT', { revision: row.revision });

    const url = new URL(request.url);
    const dayIndex = readDayIndex(url);
    const clock = resolveClock(row.data, dayIndex ?? null, url, now());
    const dismissed = await gateway.listDismissed(tripId, clock.todayISO).catch((): string[] => []);
    // 클라이언트가 보낸 id로 '서버가 방금 다시 계산한' 제안을 찾는다 — 인덱스를 그대로 믿지 않는다.
    const computed = computeToday({
      tripId, trip: row.data, revision: row.revision, updatedAt: row.updated_at,
      todayISO: clock.todayISO, nowMinutes: clock.nowMinutes, dayIndex, dismissed, generatedAt: now().toISOString()
    });
    const raw = computed.rawSuggestions.find((s) => s.id === suggestionId);
    // 이미 거절한 제안을 또 건너뛰는 것은 오류가 아니다(같은 결과) — 수락만 신선도를 요구한다.
    if (!raw && !(action === 'skip' && dismissed.includes(suggestionId))) return fail('SUGGESTION_STALE');

    await gateway.recordFeedback(tripId, clock.todayISO, suggestionId, action === 'accept' ? 'ACCEPTED' : 'SKIPPED').catch(() => undefined);
    if (action === 'skip') {
      const body2: MutationResponse = {
        schemaVersion: CONTRACT_SCHEMA_VERSION, applied: true, alreadyApplied: !raw, revision: row.revision,
        today: await todayFor(gateway, row, url)
      };
      return ok(body2);
    }
    const result = applySuggestion(
      row.data, computed.dayIndex,
      { id: raw!.id, type: raw!.type, title: raw!.title, action: raw!.action as { kind?: string; si?: number | null; fromDay?: number | null; drop?: string[] } },
      computed.windowAfterId
    );
    if (!result.ok) return fail('SUGGESTION_STALE');
    return persist(gateway, row, result.trip, url, result.applied, result.alreadyApplied);
  }

  /** GET /api/v1/trips/:tripId/bookings — 여행 당일에 필요한 것만: 시간·장소·상태·번호·링크 */
  async function bookings(request: Request, tripId: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    let row: TripRow | null;
    try { row = await gateway.getTrip(tripId); } catch { return fail('UPSTREAM_ERROR'); }
    if (!row || row.deleted_at) return fail('TRIP_NOT_FOUND');
    const url = new URL(request.url);
    const clock = resolveClock(row.data, readDayIndex(url) ?? null, url, now());
    // 가격 관측이 없어도 예약 목록 자체는 보여야 한다 — 가격은 없으면 없는 대로.
    const observations = await gateway.listPriceObservations(tripId).catch((): PriceObservation[] => []);
    const body: BookingListResponse = {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      bookings: buildBookings(row.data, observations, clock.todayISO)
    };
    return ok(body);
  }

  /**
   * GET /api/v1/trips/:tripId/travel-state
   * 여행 중 iOS가 쓰는 단 하나의 조회(§57). Today + Trip Pulse + 출발 계획 + 알림 계획 +
   * 잠금화면/위젯 압축 상태를 한 번에 준다 — 연속 호출은 그대로 배터리다.
   *
   * 위치(lat/lng)는 이번 계산에만 쓰고 저장하지 않는다(§55).
   * markSent=1이면 돌려준 알림을 '보낸 것'으로 기록해 다음 호출에서 빠진다.
   */
  async function travelState(request: Request, tripId: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    let row: TripRow | null;
    try { row = await gateway.getTrip(tripId); } catch { return fail('UPSTREAM_ERROR'); }
    if (!row || row.deleted_at) return fail('TRIP_NOT_FOUND');

    const url = new URL(request.url);
    const dayIndex = readDayIndex(url);
    const clock = resolveClock(row.data, dayIndex ?? null, url, now());
    const [dismissed, sentKeys] = await Promise.all([
      gateway.listDismissed(tripId, clock.todayISO).catch((): string[] => []),
      gateway.listSentNotificationKeys(tripId, clock.todayISO).catch((): string[] => [])
    ]);

    const location = readLocation(url);
    const response = buildTravelState({
      tripId, trip: row.data, revision: row.revision, updatedAt: row.updated_at,
      todayISO: clock.todayISO, nowMinutes: clock.nowMinutes, dayIndex, dismissed,
      generatedAt: now().toISOString(),
      currentLocation: location.point,
      locationUpdatedAt: location.updatedAt,
      travelMode: url.searchParams.get('travelMode') === '1',
      suppressUntilMinutes: readMinutes(url.searchParams.get('suppressUntil')),
      sentNotificationKeys: sentKeys
    });

    if (url.searchParams.get('markSent') === '1' && response.notifications.length) {
      await gateway.recordNotifications(tripId, clock.todayISO,
        response.notifications.map((n: NotificationPlanItem) => ({
          kind: n.kind, dedupeKey: n.dedupeKey, stateVersion: response.stateVersion
        }))).catch(() => undefined);
    }
    return ok(response satisfies TravelStateResponse);
  }

  /** POST /api/v1/devices — 기기 등록. 로그아웃·알림 끄기는 DELETE로(§45). */
  async function registerDevice(request: Request): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const body = await readBody(request);
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
    const pushToken = typeof body.pushToken === 'string' ? body.pushToken.trim() : '';
    if (!deviceId || !pushToken) return fail('BAD_REQUEST');
    const registration: DeviceRegistration = {
      deviceId,
      platform: body.platform === 'web' ? 'web' : 'ios',
      pushToken,
      enabled: body.enabled !== false,
      preferences: sanitizePreferences(body.preferences),
      appVersion: typeof body.appVersion === 'string' ? body.appVersion : null
    };
    try { await gateway.saveDevice(registration); } catch { return fail('UPSTREAM_ERROR'); }
    return ok({ schemaVersion: CONTRACT_SCHEMA_VERSION, registered: true, deviceId });
  }

  /** DELETE /api/v1/devices?deviceId=... — 로그아웃 시 토큰을 지운다. */
  async function unregisterDevice(request: Request): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const deviceId = new URL(request.url).searchParams.get('deviceId')?.trim() ?? '';
    if (!deviceId) return fail('BAD_REQUEST');
    try { await gateway.removeDevice(deviceId); } catch { return fail('UPSTREAM_ERROR'); }
    return ok({ schemaVersion: CONTRACT_SCHEMA_VERSION, registered: false, deviceId });
  }

  /**
   * POST /api/v1/import/preview — 공유된 것 하나를 훑는다. **아무것도 저장하지 않는다**(§76.2).
   * 무엇인지 · 어느 여행에 붙을지 · 이미 있는 것과 겹치는지까지 한 번에 돌려준다.
   */
  async function importPreview(request: Request): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const body = await readBody(request);
    const payload: SharedInputPayload = {
      url: typeof body.url === 'string' ? body.url : null,
      text: typeof body.text === 'string' ? body.text : null,
      title: typeof body.title === 'string' ? body.title : null,
      sourceType: typeof body.sourceType === 'string' ? body.sourceType : null,
      receivedAt: typeof body.receivedAt === 'string' ? body.receivedAt : null,
      locale: typeof body.locale === 'string' ? body.locale : null,
      currencyHint: typeof body.currencyHint === 'string' ? body.currencyHint : null
    };
    if (!payload.url && !payload.text && !payload.title) return fail('BAD_REQUEST');
    let rows: TripRow[];
    try { rows = await gateway.listTrips(); } catch { return fail('UPSTREAM_ERROR'); }
    const preview: ImportPreviewResponse = buildImportPreview(
      payload,
      rows.filter((r) => !r.deleted_at).map((r) => ({ client_id: r.client_id, data: r.data })),
      { year: now().getUTCFullYear() }
    );
    return ok(preview);
  }

  /**
   * POST /api/v1/trips/:tripId/import/commit — 사용자가 확인한 후보만 저장한다.
   * 저장으로 끝내지 않고 새 예약이 남은 일정과 부딪히는지까지 돌려준다(§42).
   */
  async function importCommit(request: Request, tripId: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const body = await readBody(request);
    const candidate = body.candidate as BookingCandidate | undefined;
    if (!candidate || typeof candidate !== 'object') return fail('BAD_REQUEST');
    let row: TripRow | null;
    try { row = await gateway.getTrip(tripId); } catch { return fail('UPSTREAM_ERROR'); }
    if (!row || row.deleted_at) return fail('TRIP_NOT_FOUND');
    const expected = body.expectedRevision;
    if (typeof expected === 'number' && expected !== row.revision) return fail('REVISION_CONFLICT', { revision: row.revision });

    const bookingId = makeBookingId(row.data);
    const next: TripDoc = JSON.parse(JSON.stringify(row.data));
    next.bookings = ((next.bookings ?? []) as unknown[]).concat([candidateToBookingDoc(candidate, bookingId)]);

    if (row.role != null && !collab.canEdit(row.role)) return fail('FORBIDDEN');
    let saved;
    try { saved = await gateway.saveTrip(tripId, next, row.revision); } catch { return fail('UPSTREAM_ERROR'); }
    if (saved.forbidden) return fail('FORBIDDEN');
    if (!saved.applied) return fail('REVISION_CONFLICT', { revision: saved.revision });

    const url = new URL(request.url);
    const savedRow: TripRow = { ...row, data: saved.data ?? next, revision: saved.revision, updated_at: new Date().toISOString() };
    const today = await todayFor(gateway, savedRow, url);
    const response: ImportCommitResponse = {
      schemaVersion: CONTRACT_SCHEMA_VERSION, bookingId, revision: saved.revision, replan: today.replan, today
    };
    return ok(response);
  }

  /** GET /api/v1/trips/:tripId/memories?day=N */
  async function memories(request: Request, tripId: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    let row: TripRow | null;
    try { row = await gateway.getTrip(tripId); } catch { return fail('UPSTREAM_ERROR'); }
    if (!row || row.deleted_at) return fail('TRIP_NOT_FOUND');
    const url = new URL(request.url);
    const dayIndex = readDayIndex(url) ?? null;
    let rows: MemoryRow[];
    try { rows = await gateway.listMemories(tripId, dayIndex); } catch { return fail('UPSTREAM_ERROR'); }
    const events: MemoryEvent[] = rows.map(toMemoryEvent);
    const today = await todayFor(gateway, row, url);
    const body: MemoryListResponse = {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      events,
      timeline: buildMemoryTimeline(events, today.activities.map((a) => ({ id: a.id, name: a.name, startMinutes: a.startMinutes })))
    };
    return ok(body);
  }

  /**
   * POST /api/v1/trips/:tripId/memories — 사진·메모를 남긴다.
   * 어느 일정인지는 **서버가 시각·위치로 짚어 준다** — 사용자가 다시 고르게 하지 않는다(§27).
   */
  async function createMemory(request: Request, tripId: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const body = await readBody(request);
    const type = String(body.type ?? '');
    if (['PHOTO', 'NOTE', 'VISIT', 'MOMENT'].indexOf(type) < 0) return fail('BAD_REQUEST');
    let row: TripRow | null;
    try { row = await gateway.getTrip(tripId); } catch { return fail('UPSTREAM_ERROR'); }
    if (!row || row.deleted_at) return fail('TRIP_NOT_FOUND');

    const url = new URL(request.url);
    const today = await todayFor(gateway, row, url);
    const clock = resolveClock(row.data, today.day.index, url, now());
    const atMinutes = typeof body.atMinutes === 'number' ? Math.round(body.atMinutes) : clock.nowMinutes;
    const location = readPoint(body.location);

    // 클라이언트가 activityId를 보내도 그대로 믿지 않는다 — 서버가 다시 짚고 이유를 남긴다.
    const association = associateCapture(
      { atMinutes, location },
      today.activities.map((a) => ({
        id: a.id, name: a.name, startMinutes: a.startMinutes, endMinutes: a.endMinutes, location: a.location
      })));

    const assetRefs = Array.isArray(body.assetRefs)
      ? (body.assetRefs as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 50)
      : [];
    let result;
    try {
      result = await gateway.saveMemory(tripId, {
        day_index: today.day.index,
        activity_id: association.activityId,
        type,
        caption: typeof body.caption === 'string' ? body.caption.slice(0, 2000) : null,
        asset_refs: assetRefs,
        lat: location?.lat ?? null,
        lng: location?.lng ?? null,
        at_minutes: atMinutes,
        captured_at: new Date().toISOString(),
        client_key: typeof body.clientKey === 'string' ? body.clientKey : null
      });
    } catch { return fail('UPSTREAM_ERROR'); }

    const response: MemoryCreateResponse = {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      event: toMemoryEvent(result.row),
      association,
      alreadyExists: !result.created
    };
    return ok(response);
  }

  // ── 함께하기 ────────────────────────────────────────────────────────────
  //
  // 권한의 경계는 DB다(RLS·RPC). 여기서 하는 일은 세 가지뿐이다:
  //   1) 여행이 보이는지 확인하고  2) RPC를 부르고  3) 42501을 403으로 옮긴다.
  // 판정을 여기서 흉내내면 DB와 답이 갈린다 — 미리 막는 것은 헛된 왕복을 아끼는 곳에서만 한다.

  /** RPC 오류를 사용자 말로. 권한 거절(42501)은 재시도해도 같으므로 403으로 분명히 알린다 */
  function rpcFail(e: unknown): Response {
    return collab.isForbiddenError(e) ? fail('FORBIDDEN') : fail('UPSTREAM_ERROR');
  }

  /** 보드 한 장 — 후보·취향을 함께 읽어 묶음·배지·제안까지 만들어 준다 */
  async function boardFor(gateway: Gateway, row: TripRow): Promise<CandidateBoardResponse> {
    const [rows, prefRows] = await Promise.all([
      gateway.listCandidates(row.client_id),
      gateway.listPreferences(row.client_id).catch((): PrefRow[] => [])   // 취향은 없어도 보드는 보인다
    ]);
    return buildCandidateBoard({
      tripId: row.client_id, rows, prefRows,
      days: ((row.data.days ?? []) as unknown as ProposalDay[]),
      role: row.role ?? null, memberCount: row.member_count ?? 1
    });
  }

  /** 여행을 집어 온다. 못 보면 404 — 남의 여행인지 없는 여행인지 구별해 주지 않는다 */
  async function tripOr404(gateway: Gateway, tripId: string): Promise<TripRow | Response> {
    let row: TripRow | null;
    try { row = await gateway.getTrip(tripId); } catch { return fail('UPSTREAM_ERROR'); }
    if (!row || row.deleted_at) return fail('TRIP_NOT_FOUND');
    return row;
  }

  /** GET /api/v1/trips/:tripId/candidates — 보드 전체(묶음·배지·충돌 선택지·그룹 제안·취향 요약) */
  async function candidates(request: Request, tripId: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const row = await tripOr404(gateway, tripId);
    if (row instanceof Response) return row;
    try { return ok(await boardFor(gateway, row)); } catch (e) { return rpcFail(e); }
  }

  /** POST /api/v1/trips/:tripId/candidates — 후보 추가(편집 권한). 바뀐 보드를 함께 돌려준다 */
  async function addCandidate(request: Request, tripId: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const row = await tripOr404(gateway, tripId);
    if (row instanceof Response) return row;
    const body = await readBody(request);
    const title = String(body.title ?? '').trim();
    if (!title) return fail('BAD_REQUEST', { message: '후보에는 이름이 있어야 합니다.' });
    const point = readPoint(body.location);
    try {
      await gateway.addCandidate(tripId, {
        title,
        placeId: typeof body.placeId === 'string' ? body.placeId : null,
        lat: point?.lat ?? null, lng: point?.lng ?? null,
        addr: typeof body.addr === 'string' ? body.addr : null,
        note: typeof body.note === 'string' ? body.note : null,
        url: typeof body.url === 'string' ? body.url : null
      });
      return ok(await boardFor(gateway, row));
    } catch (e) { return rpcFail(e); }
  }

  /** POST /api/v1/trips/:tripId/candidates/:candidateId/react — 활성 멤버 전원. reaction이 없으면 거둔다 */
  async function reactCandidate(request: Request, tripId: string, candidateId: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const row = await tripOr404(gateway, tripId);
    if (row instanceof Response) return row;
    const body = await readBody(request);
    const raw = body.reaction;
    const reaction = raw == null ? null : collab.normReaction(raw);
    if (raw != null && !reaction) return fail('BAD_REQUEST', { message: '알 수 없는 반응입니다.' });
    try {
      await gateway.reactCandidate(candidateId, reaction as ReactionKind | null);
      return ok(await boardFor(gateway, row));
    } catch (e) { return rpcFail(e); }
  }

  const CANDIDATE_ACTIONS = ['REMOVE', 'SCHEDULE', 'UNSCHEDULE', 'REJECT', 'REOPEN'];

  /** POST /api/v1/trips/:tripId/candidates/:candidateId/manage — 상태 변경. 어떤 역할이 되는지는 DB가 정한다 */
  async function manageCandidate(request: Request, tripId: string, candidateId: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const row = await tripOr404(gateway, tripId);
    if (row instanceof Response) return row;
    const body = await readBody(request);
    const action = String(body.action ?? '').toUpperCase();
    if (!CANDIDATE_ACTIONS.includes(action)) return fail('BAD_REQUEST', { message: '알 수 없는 동작입니다.' });
    const value = typeof body.value === 'string' ? body.value : null;
    try {
      await gateway.manageCandidate(candidateId, action, value);
      return ok(await boardFor(gateway, row));
    } catch (e) { return rpcFail(e); }
  }

  /** GET /api/v1/trips/:tripId/candidates/:candidateId/comments */
  async function comments(request: Request, tripId: string, candidateId: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const row = await tripOr404(gateway, tripId);
    if (row instanceof Response) return row;
    try {
      return ok(buildComments(candidateId, await gateway.listComments(candidateId), row.role ?? null));
    } catch (e) { return rpcFail(e); }
  }

  /** POST — 코멘트도 의견이라 보기 권한이 남길 수 있다(§14) */
  async function addComment(request: Request, tripId: string, candidateId: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const row = await tripOr404(gateway, tripId);
    if (row instanceof Response) return row;
    const body = await readBody(request);
    const text = String(body.body ?? '').trim();
    if (!text) return fail('BAD_REQUEST', { message: '한마디를 입력해 주세요.' });
    try {
      await gateway.addComment(candidateId, text);
      return ok(buildComments(candidateId, await gateway.listComments(candidateId), row.role ?? null));
    } catch (e) { return rpcFail(e); }
  }

  /** DELETE — 쓴 사람이나 주최자만. 판정은 DB가 한다 */
  async function deleteComment(request: Request, tripId: string, candidateId: string, commentId: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const row = await tripOr404(gateway, tripId);
    if (row instanceof Response) return row;
    try {
      await gateway.deleteComment(commentId);
      return ok(buildComments(candidateId, await gateway.listComments(candidateId), row.role ?? null));
    } catch (e) { return rpcFail(e); }
  }

  /** GET /api/v1/trips/:tripId/preferences — 내 취향 + 일행의 요약 + 그룹 정리 문장 */
  async function preferences(request: Request, tripId: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const row = await tripOr404(gateway, tripId);
    if (row instanceof Response) return row;
    try {
      return ok(buildPreferences(await gateway.listPreferences(tripId), row.member_count ?? 1));
    } catch (e) { return rpcFail(e); }
  }

  /** PUT — 본인 것만 바꾼다. 서버가 정규화해 돌려준 값이 이긴다(§16) */
  async function savePreferences(request: Request, tripId: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const row = await tripOr404(gateway, tripId);
    if (row instanceof Response) return row;
    const body = await readBody(request);
    try {
      await gateway.savePreference(tripId, body.prefs ?? body);
      return ok(buildPreferences(await gateway.listPreferences(tripId), row.member_count ?? 1));
    } catch (e) { return rpcFail(e); }
  }

  /** GET /api/v1/trips/:tripId/activity — 묶고 문장까지 만들어 준다(§38·§39) */
  async function activity(request: Request, tripId: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const row = await tripOr404(gateway, tripId);
    if (row instanceof Response) return row;
    const raw = Number(new URL(request.url).searchParams.get('limit'));
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(100, Math.floor(raw)) : 40;
    try {
      return ok(buildActivity(await gateway.listActivity(tripId, limit), now().getTime()));
    } catch (e) { return rpcFail(e); }
  }

  return {
    trips, today, bookings, travelState, replanPreview, activityAction, suggestionAction,
    registerDevice, unregisterDevice, importPreview, importCommit, memories, createMemory,
    candidates, addCandidate, reactCandidate, manageCandidate,
    comments, addComment, deleteComment, preferences, savePreferences, activity
  };
}
