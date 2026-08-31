// Travel State — 여행 중 iOS가 쓰는 단 하나의 조회(§57).
//
// Today 응답 위에 "지금 상태를 한 마디로(Trip Pulse)", "언제 나서면 되는지(출발 계획)",
// "무엇을 알릴 만한지(알림 계획)", "잠금화면·위젯이 그릴 압축 상태"를 얹는다.
// 여러 endpoint를 연달아 부르지 않게 하려는 것이 목적이다 — 여행 중에는 왕복 횟수가 배터리다.
//
// 판단은 전부 adaptive.js에 있다. 여기서는 인자를 모아 넘기고 결과를 계약 모양으로 눕힌다.
import adapt from '@legacy/adaptive.js';
import lib from '@legacy/lib.js';

import type {
  DeparturePlan, GeoPoint, NotificationPlanItem, TravelStateResponse, TripPulse,
  LiveActivityState, WidgetActivity, WidgetSnapshot
} from './contract';
import { CONTRACT_SCHEMA_VERSION } from './contract';
import type { TodayInput } from './todayView';
import { computeToday, estimateLegMinutes } from './todayView';

export interface TravelStateInput extends TodayInput {
  /** 기기가 알려준 현재 위치 — 저장하지 않고 이번 계산에만 쓴다(§55). */
  currentLocation?: GeoPoint | null;
  locationUpdatedAt?: string | null;
  /** Travel Mode가 켜져 있는가. 꺼져 있으면 먼저 말 걸지 않는다. */
  travelMode?: boolean;
  /** "오늘은 쉬기"를 고른 뒤의 침묵 구간(그 날 자정부터 분). */
  suppressUntilMinutes?: number | null;
  /** 이미 보낸 알림 키 — 같은 상황을 다시 알리지 않기 위해. */
  sentNotificationKeys?: string[];
}

function isoAt(dayISO: string, minutes: number, timeZone: string): string | null {
  if (!dayISO || !timeZone) return null;
  return lib.zonedMinutesToISOString(dayISO, Math.round(minutes), timeZone);
}

export function buildTravelState(input: TravelStateInput): TravelStateResponse {
  // 위치가 있으면 그 위치에서부터 계산한다. 없으면 서버가 아는 마지막 앵커를 쓴다.
  const computed = computeToday({
    ...input,
    currentLocation: input.currentLocation ?? undefined
  } as TodayInput);
  const today = computed.response;
  const state = computed.state;
  const day = today.day;
  const timeZone = day.timeZone;

  const next = state.nextItem;
  const travelMinutes = next
    ? Math.round(estimateLegMinutes(state.currentLocation, next.location, day.mode))
    : 0;
  const rawDeparture = next ? adapt.departurePlan(state, next, travelMinutes) : null;

  const departure: DeparturePlan | null = rawDeparture
    ? {
      activityId: next!.id,
      leaveMinutes: Math.round(rawDeparture.leaveMin),
      leaveAtISO: isoAt(day.date, rawDeparture.leaveMin, timeZone),
      slackMinutes: Math.round(rawDeparture.slackMin),
      bufferMinutes: Math.round(rawDeparture.bufferMin),
      travelMinutes: Math.round(rawDeparture.travelMin),
      targetMinutes: Math.round(rawDeparture.targetMin),
      lateByMinutes: Math.round(rawDeparture.lateByMin),
      level: rawDeparture.level,
      stage: rawDeparture.stage,
      text: rawDeparture.text
    }
    : null;

  const rawPulse = adapt.tripPulse(state, computed.replan, rawDeparture);
  const pulse: TripPulse = { code: rawPulse.code as TripPulse['code'], text: rawPulse.text, detail: rawPulse.detail };

  const stateVersion = adapt.stateVersion(state, { stage: rawDeparture?.stage ?? '', pulse: rawPulse.code });
  const expiresMinutes = adapt.suggestionExpiryMin(state);

  const rawPlan = adapt.notificationPlan(state, {
    departure: rawDeparture,
    pulse: rawPulse,
    replan: computed.replan,
    suggestions: today.suggestions,
    suppressUntilMin: input.suppressUntilMinutes ?? undefined,
    travelMode: !!input.travelMode
  });
  const pending = adapt.pendingNotifications(rawPlan, input.sentNotificationKeys ?? []);
  const notifications: NotificationPlanItem[] = pending.map((n) => ({
    kind: n.kind as NotificationPlanItem['kind'],
    origin: n.origin,
    dedupeKey: n.dedupeKey,
    title: n.title,
    body: n.body,
    deepLink: n.deepLink,
    targetId: n.targetId,
    priority: n.priority,
    expiresAtISO: n.expiresAtMin == null ? null : isoAt(day.date, n.expiresAtMin, timeZone)
  }));

  // 잠금화면·Dynamic Island가 쓸 압축 상태. 여행 전체 일정표를 넣지 않는다(§75.5).
  // 예약번호·항공편 같은 민감한 값도 넣지 않는다(§54).
  const fixed = state.fixedCommitments.find((f) => f.startMin >= state.nowMin) ?? null;
  const liveActivity: LiveActivityState = {
    tripName: today.trip.name,
    dayLabel: `Day ${day.index + 1}`,
    status: today.nextAction?.status ?? (state.items.length ? 'UPCOMING' : 'NO_PLAN'),
    nextTitle: next ? next.name : '오늘 남은 일정 없음',
    nextStartISO: next ? isoAt(day.date, next.depart, timeZone) : null,
    travelMinutes: next ? travelMinutes : null,
    departureText: departure?.text ?? null,
    fixedTitle: fixed?.title ?? null,
    fixedStartISO: fixed ? isoAt(day.date, fixed.startMin, timeZone) : null,
    pulseText: pulse.text,
    stateVersion
  };

  const toWidgetActivity = (id: string): WidgetActivity | null => {
    const activity = today.activities.find((a) => a.id === id);
    if (!activity) return null;
    return {
      id: activity.id,
      title: activity.name,
      startMinutes: activity.startMinutes,
      startISO: isoAt(day.date, activity.startMinutes, timeZone),
      type: activity.type,
      isFixed: activity.flexibility === 'FIXED'
    };
  };
  const widget: WidgetSnapshot = {
    tripId: today.trip.id,
    tripName: today.trip.name,
    dayLabel: `Day ${day.index + 1}`,
    dayTitle: day.title,
    pulseText: pulse.text,
    nextActivity: next ? toWidgetActivity(next.id) : null,
    nextTravelMinutes: next ? travelMinutes : null,
    // 위젯은 훑어보는 화면이다 — 세 줄이면 충분하다.
    upcoming: today.remainingActivities.slice(0, 3)
      .map((a) => toWidgetActivity(a.id))
      .filter((a): a is WidgetActivity => !!a),
    updatedAtISO: today.generatedAt,
    stateVersion
  };

  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    stateVersion,
    today,
    pulse,
    departure,
    notifications,
    liveActivity,
    widget,
    suggestionsExpireAtISO: isoAt(day.date, expiresMinutes, timeZone),
    suggestionsExpireMinutes: expiresMinutes,
    locationUsed: state.currentLocation,
    locationUpdatedAt: input.locationUpdatedAt ?? null,
    travelMode: !!input.travelMode
  };
}
