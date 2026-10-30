import lib from '@legacy/lib.js';
import type { LegCache } from '@/features/itinerary/domain/types';
import { computeToday, type TripDoc } from './todayView';

/** 구독 한 곳의 최신 구역 관측. observedAtISO는 GPS 측정 시각이 아닌 관측 수신 시각이다. */
export interface ArrivalEvidence {
  target: { dayIndex: number; activityId: string; revision: number };
  arrived: boolean;
  observedAtISO: string;
}

/** 일정 수정·자정·완료·예정 종료 뒤에는 옛 구역 관측을 재사용하지 않는다. */
export function resolveArrivedActivityId(input: {
  trip: TripDoc; revision: number; todayISO: string; nowMinutes: number;
  arrival: ArrivalEvidence | null | undefined; legCache?: LegCache;
}): string | null {
  const evidence = input.arrival;
  if (!evidence?.arrived || evidence.target.revision !== input.revision) return null;
  const { dayIndex, activityId } = evidence.target;
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || !input.trip.days?.[dayIndex]
    || !/^d\d+s\d+$/.test(activityId)) return null;
  const zone = lib.effectiveTimeZone(input.trip, dayIndex).timeZone || 'UTC';
  const observed = lib.zonedClock(Date.parse(evidence.observedAtISO), zone);
  if (!observed || observed.todayISO !== input.todayISO || observed.nowMin > input.nowMinutes + 1) return null;
  const { state } = computeToday({
    tripId: input.trip.id ?? '', trip: input.trip, revision: input.revision, updatedAt: '',
    todayISO: input.todayISO, nowMinutes: input.nowMinutes, dayIndex,
    arrivedActivityId: activityId, legCache: input.legCache
  });
  return state.live && state.arrivedActivityId === activityId ? activityId : null;
}
