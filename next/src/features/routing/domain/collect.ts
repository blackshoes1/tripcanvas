// 조회할 구간 수집 — 레거시 renderSidebar가 requestLeg로 요구하던 구간 집합을 순수하게 재현한다:
// 이월 앵커·분리와 합류·숙소 복귀를 포함한 공통 journey. 대중교통은 구간별 '계획 출발시각'을
// 시각별 키(base@tz@when)로 요청한다 (미래가 아니면 base 키) — app.js legRequestKey/planDepartISO 동일.
// 타임라인은 현재 캐시 기준이라 캐시가 채워지면 출발시각이 바뀔 수 있다 — 재수집으로 수렴하고
// 무한 재조회는 fetcher의 그룹 댐핑(≤6)이 막는다 (레거시 transitQuerySeen 동일).
import legacyLib from '@legacy/lib.js';

import {
  dayJourneyOf, isoDateOf, legModeOf
} from '@/features/itinerary/domain/dayView';
import type { LegCache } from '@/features/itinerary/domain/types';
import type { Spot, TransportMode, Trip } from '@/features/trip/domain/types';

const { legKey, returnModeOf, zonedMinutesToISOString } = legacyLib;

export interface LegRequest {
  /** 캐시 키 — transit+미래 출발시각이면 base@tz@when */
  key: string;
  base: string;
  a: { lat: number; lng: number };
  b: { lat: number; lng: number };
  mode: TransportMode;
  when: string | null;
  timeZone: string;
}

/** 계획 출발시각 → 미래(now+60s 이후)일 때만 ISO — app.js planDepartISO 동일 */
function planDepartISO(isoDate: string, minutes: number, timeZone: string, nowMs: number): string | null {
  const iso = zonedMinutesToISOString(isoDate, minutes, timeZone || '');
  return iso && new Date(iso).getTime() > nowMs + 60000 ? iso : null;
}

function requestKey(base: string, mode: TransportMode, when: string | null, timeZone: string): string {
  return mode === 'transit' && when ? `${base}@${timeZone || 'UTC'}@${when}` : base;
}

export function collectLegRequests(trip: Trip, legCache: LegCache, nowMs: number): LegRequest[] {
  const out = new Map<string, LegRequest>();
  const add = (
    a: Spot & { lat: number; lng: number }, b: Spot & { lat: number; lng: number },
    mode: TransportMode, when: string | null, timeZone: string
  ) => {
    const A = { lat: a.lat, lng: a.lng }, B = { lat: b.lat, lng: b.lng };
    const base = legKey(A, B, mode);
    const key = requestKey(base, mode, when, timeZone);
    if (!out.has(key)) out.set(key, { key, base, a: A, b: B, mode, when: mode === 'transit' ? when : null, timeZone });
  };

  trip.days.forEach((day, di) => {
    const iso = isoDateOf(trip, di);
    const timeZone = day.timeZone || trip.timeZone || '';
    for (const leg of dayJourneyOf(trip, legCache, di).legs) {
      const mode = leg.returning ? returnModeOf(day) as TransportMode : legModeOf(day, leg.to);
      const when = mode === 'transit' && iso ? planDepartISO(iso, leg.depart, timeZone, nowMs) : null;
      add(leg.from, leg.to, mode, when, timeZone);
    }
  });

  return [...out.values()];
}
