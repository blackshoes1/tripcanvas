// Today 응답 구성 — 판단은 하지 않고, 저장소 루트 adaptive.js(웹이 쓰는 그 엔진)의 결과를 contract 모양으로 눕힌다.
// 여기에 새 규칙을 넣지 말 것: 넣는 순간 웹과 iOS의 답이 갈라진다. 규칙이 필요하면 adaptive.js에 넣는다.
//
// 서버는 클라이언트의 구간 캐시(tripcanvas_legs_v4)를 갖고 있지 않다. 그래서 이동시간은
// 웹과 같은 수단별 평균속도로 계산한 **직선거리 추정**이고, 응답에 travelTimeSource로 그 사실을 실어 보낸다.
// (웹은 캐시된 실제 경로가 있으면 그 값을 쓰므로 분 단위로 다를 수 있다 — 클라이언트가 '추정'이라고 표기한다.)
import adapt from '@legacy/adaptive.js';
import collab from '@legacy/collab.js';
import lib from '@legacy/lib.js';

import type {
  ActivitySummary, CommitmentType, DaySummary, EnergyLevel, Flexibility, GeoPoint,
  FixedCommitmentSummary, NextAction, PlanningMode, ReplanPreview, SuggestionActionKind,
  TodayResponse, TravelActivityState, TravelStatus, TripStateSummary, TripSuggestion, TripSummary
} from './contract';
import { CONTRACT_SCHEMA_VERSION } from './contract';

export interface SpotDoc {
  name?: string; city?: string; desc?: string; lat?: number | null; lng?: number | null;
  at?: string; bookAt?: string; stayMin?: number; stay?: boolean; nights?: number;
  opt?: boolean; must?: boolean; status?: string; legMode?: string;
  bookingId?: string; bookUrl?: string; placeId?: string; hours?: unknown; cost?: number; cur?: string;
}
export interface DayDoc {
  title?: string; mode?: string; startAt?: string; startPolicy?: string; timeZone?: string; spots?: SpotDoc[];
}
export interface TripDoc {
  id?: string; name?: string; start?: string; timeZone?: string; days?: DayDoc[]; bookings?: unknown[];
}

/** 웹(app.js MODE_SPEED)과 같은 값 — 두 쪽이 다른 속도를 쓰면 같은 일정이 다른 시각으로 보인다. */
export const MODE_SPEED: Record<string, number> = {
  car: 40, taxi: 40, transit: 25, train: 160, walk: 4.5, bike: 15, flight: 700
};

/** 예약 시각 앞의 '기다리는 중' 구간 — 이보다 이른 시각은 아직 도착으로 보지 않는다. */
const ARRIVAL_WAIT_MIN = 60;

function dayModeOf(day: DayDoc | undefined): string {
  const m = day?.mode;
  return m && MODE_SPEED[m] ? m : 'car';
}
/** 구간 수단 = 도착 장소의 legMode 우선, 없으면 일자 기본 (웹 legModeOf와 같은 규칙) */
function legModeOf(day: DayDoc | undefined, spot: unknown): string {
  const m = (spot as SpotDoc | null)?.legMode;
  return m && MODE_SPEED[m] ? m : dayModeOf(day);
}
function hasCoord(p: unknown): p is { lat: number; lng: number } {
  const s = p as { lat?: unknown; lng?: unknown } | null;
  return !!s && s.lat != null && s.lng != null && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng));
}
export function estimateLegMinutes(a: unknown, b: unknown, mode: string): number {
  if (!hasCoord(a) || !hasCoord(b)) return 0;
  const km = lib.haversine({ lat: Number(a.lat), lng: Number(a.lng) }, { lat: Number(b.lat), lng: Number(b.lng) });
  return (km / (MODE_SPEED[mode] || 40)) * 60;
}
function point(p: unknown): GeoPoint | null {
  return hasCoord(p) ? { lat: Number(p.lat), lng: Number(p.lng) } : null;
}
function isoDateOf(trip: TripDoc, dayIndex: number): string {
  if (!trip.start || !/^\d{4}-\d{2}-\d{2}$/.test(trip.start)) return '';
  const base = Date.parse(`${trip.start}T00:00:00Z`);
  if (!Number.isFinite(base)) return '';
  return new Date(base + dayIndex * 86400000).toISOString().slice(0, 10);
}

export interface TodayInput {
  /** trips.client_id */
  tripId: string;
  trip: TripDoc;
  revision: number;
  updatedAt: string;
  /** 함께하기 — 호출자의 역할·활성 멤버 수. 없으면 혼자 쓰는 여행(OWNER·1)으로 본다 */
  role?: string | null;
  memberCount?: number | null;
  /** 여행지 기준 오늘 (YYYY-MM-DD) */
  todayISO: string;
  /** 여행지 기준 현재 시각(자정부터 분) */
  nowMinutes: number;
  /** 보고 싶은 일자. 생략하면 오늘(기간 밖이면 첫날) */
  dayIndex?: number;
  energyLevel?: EnergyLevel;
  prefs?: Record<string, unknown>;
  /** 기기가 알려준 현재 위치. 저장하지 않고 이번 계산에만 쓴다 */
  currentLocation?: { lat: number; lng: number } | null;
  /** 그날 이미 거절한 제안 키 */
  dismissed?: string[];
  generatedAt?: string;
}

/** 지금 사용자가 놓인 상태 — 시각만으로 결정되는 규칙(§20 deterministic). */
export function travelStatusOf(
  state: ReturnType<typeof adapt.buildTripState>,
  next: ReturnType<typeof adapt.buildTripState>['nextItem'],
  departure: { level: 'EARLY' | 'NOW' | 'LATE'; leaveMin: number } | null
): TravelStatus {
  if (!state.items.length) return 'NO_PLAN';
  if (!next) return 'COMPLETED';
  if (next.status === 'IN_PROGRESS') return 'IN_PROGRESS';
  // ARRIVED(도착해서 예약 시각을 기다리는 중)는 위치 정보 없이는 확인할 수 없다. 도착 '예정' 시각만 보면
  // 오전에 계산된 eta 때문에 오후 내내 '식당에 도착함'이 된다. 그래서 두 가지 근거를 요구한다:
  //   (1) 직전 일정을 사용자가 완료 처리했다(계획대로 움직였다는 유일한 증거)
  //   (2) 예약 시각 직전 대기 구간에 들어와 있다
  // 실제 위치가 들어오면(§41 확장 지점) 이 추론을 사실로 대체한다.
  if (state.live && state.nowMin < next.depart) {
    const at = state.items.findIndex((it) => it.id === next.id);
    const prevDone = at <= 0 || state.items[at - 1].status === 'COMPLETED';
    const waitFrom = Math.max(next.eta, next.depart - ARRIVAL_WAIT_MIN);
    if (prevDone && state.nowMin >= waitFrom) return 'ARRIVED';
  }
  // '지연'은 다음 일정에 이미 늦은 상태다. 사용자가 완료를 안 누른 과거 항목을 지연으로 세면
  // 아무 문제 없는 오후에도 경고가 뜬다 — 고정 약속을 못 지키는 경우는 replan.needed가 따로 알린다.
  if (departure?.level === 'LATE') return 'DELAYED';
  if (departure?.level === 'NOW') return 'READY_TO_LEAVE';
  if (state.live && departure && state.nowMin > departure.leaveMin) return 'TRAVELING';
  return 'UPCOMING';
}

/** adaptive 제안의 action.kind → contract의 행동 종류 */
function actionKindOf(sug: { type: string; action: { kind?: string; fromDay?: number | null } }): SuggestionActionKind {
  const kind = sug.action?.kind ?? '';
  if (sug.type === 'REPLAN') return 'REPLAN';
  if (sug.type === 'PRICE_SAVING') return 'OPEN_BOOKING';
  if (kind === 'REST' || kind === 'RETURN_TO_HOTEL' || kind === 'EAT') return kind;
  if (sug.action?.fromDay != null) return 'MOVE_TO_TODAY';
  return kind === 'CHECK_IN' ? 'CHECK_IN' : 'VISIT_PLACE';
}

/** 응답과 함께 원본(엔진 결과)을 돌려준다 — 수락 처리는 클라이언트가 보낸 인덱스가 아니라 이 원본을 근거로 한다. */
export interface TodayComputation {
  response: TodayResponse;
  dayIndex: number;
  /** 엔진 원본 — Travel State 계층이 그대로 이어 쓴다(다시 계산하지 않기 위해) */
  state: ReturnType<typeof adapt.buildTripState>;
  replan: ReturnType<typeof adapt.generateReplan>;
  /** 그 시점의 첫 빈 시간 — 옮겨온 일정을 어디에 끼울지의 기준 */
  windowAfterId: string | null;
  rawSuggestions: { id: string; type: string; title: string; action: Record<string, unknown> }[];
}

export function buildToday(input: TodayInput): TodayResponse {
  return computeToday(input).response;
}

export function computeToday(input: TodayInput): TodayComputation {
  const trip = input.trip ?? {};
  const days = trip.days ?? [];
  const todayIndex = adapt.currentDayIndex(trip, input.todayISO);
  const requested = input.dayIndex;
  const dayIndex = requested != null && requested >= 0 && requested < days.length
    ? requested
    : (todayIndex >= 0 ? todayIndex : 0);
  const day: DayDoc = days[dayIndex] ?? { spots: [] };
  const spots = day.spots ?? [];
  const timeZone = day.timeZone || trip.timeZone || '';
  const dayISO = isoDateOf(trip, dayIndex);

  const anchor = lib.dayStartAnchor(days, dayIndex);
  const timeline = lib.computeTimeline(day, {
    legMin: (a, b) => estimateLegMinutes(a, b, legModeOf(day, b)),
    startAnchor: anchor
  });
  const legMin = (a: unknown, b: unknown) => estimateLegMinutes(a, b, dayModeOf(day));

  const state = adapt.buildTripState(trip, {
    dayIndex, todayISO: input.todayISO, nowMin: input.nowMinutes, timeline,
    startAnchor: anchor, legMin, energyLevel: input.energyLevel ?? 'NORMAL', prefs: input.prefs ?? {},
    currentLocation: input.currentLocation ?? undefined
  });
  const built = adapt.buildSuggestions(trip, state, { legMin, dismissed: input.dismissed ?? [] });

  const activities: ActivitySummary[] = state.items.map((it) => {
    const spot = (it.spot ?? {}) as SpotDoc;
    return {
      id: it.id,
      name: it.name,
      city: String(spot.city ?? ''),
      desc: String(spot.desc ?? ''),
      status: it.status,
      flexibility: it.flexibility as Flexibility,
      type: it.type as CommitmentType,
      etaMinutes: Math.round(it.eta),
      startMinutes: Math.round(it.depart),
      endMinutes: Math.round(it.end),
      stayMinutes: Math.round(it.stayMin),
      travelInMinutes: Math.round(it.travelIn),
      fixedAtMinutes: it.fixedAt == null ? null : Math.round(it.fixedAt),
      location: it.location,
      mustVisit: !!spot.must,
      optional: !!spot.opt,
      bookingId: spot.bookingId ?? null,
      bookUrl: spot.bookUrl ?? null,
      placeId: spot.placeId ?? null
    };
  });
  const byId = new Map(activities.map((a) => [a.id, a]));

  const next = state.nextItem;
  const travelMinutes = next
    ? Math.round(estimateLegMinutes(state.currentLocation, next.location, legModeOf(day, next.spot)))
    : null;
  const advice = next ? adapt.departureAdvice(state, next, travelMinutes ?? 0) : null;
  const status = travelStatusOf(state, next, advice);

  const nextAction: NextAction | null = next
    ? {
      activityId: next.id,
      title: next.name,
      status,
      travelMinutes,
      etaMinutes: Math.round(next.eta),
      startMinutes: Math.round(next.depart),
      stayMinutes: Math.round(next.stayMin),
      departure: advice
        ? { leaveMinutes: Math.round(advice.leaveMin), slackMinutes: Math.round(advice.slackMin), level: advice.level, text: advice.text }
        : null,
      location: next.location,
      type: next.type as CommitmentType,
      flexibility: next.flexibility as Flexibility,
      reasons: advice ? [advice.text] : []
    }
    : null;

  const suggestions: TripSuggestion[] = built.suggestions.map((s) => {
    const kind = actionKindOf(s);
    const si = s.action?.si;
    const inToday = si != null && s.action?.fromDay == null;
    return {
      id: s.id,
      type: (s.type === 'REPLAN' || s.type === 'PRICE_SAVING' || s.type === 'REST' ? s.type : 'NEXT_ACTIVITY'),
      title: s.title,
      description: s.description,
      reasons: s.reasons ?? [],
      impact: s.impact ?? {},
      action: {
        kind,
        activityId: inToday ? `d${dayIndex}s${si}` : null,
        fromDay: s.action?.fromDay ?? null,
        bookingId: s.action?.bookingId ?? null,
        dropActivityIds: s.action?.drop ?? [],
        startMinutes: s.action?.startMin ?? null
      },
      // 수락이 실제로 일정을 바꾸는 제안만 true. 식사(장소를 직접 골라야 함)·가격(자동 재예약 금지)은 false.
      acceptable: kind === 'MOVE_TO_TODAY' || kind === 'REPLAN' || kind === 'REST' || kind === 'RETURN_TO_HOTEL'
    };
  });

  const replanRaw = built.replan;
  const replan: ReplanPreview = {
    needed: replanRaw.needed,
    feasible: replanRaw.feasible,
    lateMinutes: Math.round(replanRaw.lateBy),
    before: replanRaw.before,
    after: replanRaw.after,
    dropActivityIds: replanRaw.drop,
    dropNames: replanRaw.dropNames,
    movesToNextDay: !!days[dayIndex + 1],
    impact: replanRaw.impact ?? {}
  };

  const tripSummary: TripSummary = {
    id: input.tripId,
    name: String(trip.name ?? '여행'),
    start: String(trip.start ?? ''),
    dayCount: days.length,
    revision: input.revision,
    updatedAt: input.updatedAt,
    timeZone: String(trip.timeZone ?? ''),
    cities: Array.from(new Set(days.flatMap((d) => (d.spots ?? []).map((s) => String(s.city ?? ''))).filter(Boolean))),
    todayIndex,
    daysUntilStart: adapt.daysUntilStart(trip, input.todayISO),
    role: collab.normRole(input.role) ?? 'OWNER',
    memberCount: Math.max(1, Math.round(Number(input.memberCount) || 1))
  };
  const daySummary: DaySummary = {
    index: dayIndex,
    date: dayISO,
    title: String(day.title ?? ''),
    mode: dayModeOf(day),
    startMinutes: lib.parseHM(day.startAt),
    spotCount: spots.length,
    timeZone
  };
  const currentState: TripStateSummary = {
    currentDay: dayIndex,
    todayIndex,
    dayCount: days.length,
    live: state.live,
    nowMinutes: Math.round(state.nowMin),
    dayStartMinutes: Math.round(state.dayStartMin),
    dayEndMinutes: Math.round(state.dayEndMin),
    availableMinutes: Math.round(state.availableMin),
    delayMinutes: Math.round(state.delayMin),
    travelMinutesToday: Math.round(state.travelMinToday),
    planningMode: state.planningMode as PlanningMode,
    energyLevel: state.energyLevel as EnergyLevel,
    completedActivityIds: state.completedItems,
    remainingActivityIds: state.remainingItems,
    skippedActivityIds: state.skippedItems,
    currentLocation: state.currentLocation
  };
  const fixedCommitments: FixedCommitmentSummary[] = state.fixedCommitments.map((f) => ({
    id: f.id, activityId: f.itemId, type: f.type as CommitmentType, title: f.title,
    startMinutes: Math.round(f.startMin), endMinutes: Math.round(f.endMin),
    location: f.location, flexibility: f.flexibility as Flexibility
  }));

  const startAtISO = next && dayISO && timeZone
    ? lib.zonedMinutesToISOString(dayISO, Math.round(next.depart), timeZone)
    : null;
  const activityState: TravelActivityState = {
    tripName: tripSummary.name,
    dayLabel: `Day ${dayIndex + 1}`,
    nextTitle: next ? next.name : '오늘 남은 일정 없음',
    startAtISO,
    travelMinutes,
    status
  };

  const response: TodayResponse = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    travelTimeSource: 'STRAIGHT_LINE_ESTIMATE',
    trip: tripSummary,
    day: daySummary,
    currentState,
    nextAction,
    suggestions,
    remainingActivities: state.remainingItems.map((id) => byId.get(id)).filter((a): a is ActivitySummary => !!a),
    activities,
    fixedCommitments,
    replan,
    activityState
  };
  return {
    response,
    dayIndex,
    state,
    replan: replanRaw,
    windowAfterId: built.window?.afterId ?? null,
    rawSuggestions: built.suggestions.map((s) => ({ id: s.id, type: s.type, title: s.title, action: s.action as unknown as Record<string, unknown> }))
  };
}

/** 여행 목록 요약 — 상세를 열지 않고도 '오늘 며칠째인지'까지 보인다. */
export function summarizeTrip(
  row: { client_id: string; data: TripDoc; revision: number; updated_at: string; role?: string | null; member_count?: number | null },
  todayISO: string
): TripSummary {
  const trip = row.data ?? {};
  const days = trip.days ?? [];
  return {
    id: row.client_id,
    name: String(trip.name ?? '여행'),
    start: String(trip.start ?? ''),
    dayCount: days.length,
    revision: Number(row.revision) || 1,
    updatedAt: row.updated_at,
    timeZone: String(trip.timeZone ?? ''),
    cities: Array.from(new Set(days.flatMap((d) => (d.spots ?? []).map((s) => String(s.city ?? ''))).filter(Boolean))),
    todayIndex: adapt.currentDayIndex(trip, todayISO),
    daysUntilStart: adapt.daysUntilStart(trip, todayISO),
    role: collab.normRole(row.role) ?? 'OWNER',
    memberCount: Math.max(1, Math.round(Number(row.member_count) || 1))
  };
}
