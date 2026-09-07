// 여행 전체 동선을 계약 모양으로.
//
// ⚠️ 구간을 여기서 다시 걸어 내지 않는다 — `dayLegs`가 단일 출처다. 일자 화면(`dayPlanView`)과
// 같은 걸음을 써야 "일자 지도에는 도로인데 전체 지도에서는 직선"이 생기지 않는다.
import legacyLib from '@legacy/lib.js';

import { dayLegs, hasCoord, isoDateOf } from '@/features/itinerary/domain/dayView';
import type { LegCache } from '@/features/itinerary/domain/types';
import type { Trip } from '@/features/trip/domain/types';

import { CONTRACT_SCHEMA_VERSION } from './contract';
import type { TripRouteDay, TripRouteLeg, TripRoutesResponse, TripSummary } from './contract';
import type { TripDoc } from './todayView';

const { legKey } = legacyLib;

export interface TripRoutesInput {
  trip: TripDoc;
  summary: TripSummary;
  generatedAt: string;
  legCache?: LegCache;
  /** 아직 조회되지 않은 구간 수. 모르면 0 */
  legsPending?: number;
}

export function buildTripRoutes(input: TripRoutesInput): TripRoutesResponse {
  const trip = input.trip as unknown as Trip;
  const cache = input.legCache ?? {};
  const days: TripRouteDay[] = [];
  let routed = 0;
  let total = 0;

  (trip.days ?? []).forEach((day, index) => {
    const legs: TripRouteLeg[] = dayLegs(trip, index).map((leg) => {
      const entry = cache[legKey(leg.from, leg.to, leg.mode)];
      const isRouted = !!(entry && entry.sec);
      total += 1;
      if (isRouted) routed += 1;
      return {
        from: { lat: leg.from.lat, lng: leg.from.lng },
        to: { lat: leg.to.lat, lng: leg.to.lng },
        mode: leg.mode,
        path: isRouted ? entry.path ?? null : null,
        source: isRouted ? 'ROUTED' : 'STRAIGHT_LINE_ESTIMATE'
      };
    });

    days.push({
      index,
      date: isoDateOf(trip, index),
      title: String(day.title ?? ''),
      // 좌표 없는 장소는 지도에 못 올린다 — 그 사실은 일자 화면이 이미 말한다
      spots: (day.spots ?? []).filter(hasCoord).map((s) => ({
        name: String(s.name ?? ''),
        location: { lat: s.lat, lng: s.lng }
      })),
      legs
    });
  });

  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    // 하나라도 추정이면 추정이다 — 절반만 도로인 여행을 "실제 경로"라 하지 않는다
    travelTimeSource: total > 0 && routed === total ? 'ROUTED' : 'STRAIGHT_LINE_ESTIMATE',
    legsPending: Math.max(0, Math.round(input.legsPending ?? 0)),
    trip: input.summary,
    days
  };
}
