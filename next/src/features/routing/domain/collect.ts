// 조회할 구간 수집 — 레거시 renderSidebar가 requestLeg로 요구하던 구간 집합을 순수하게 재현한다:
// (이월 앵커→첫 장소) + 일자 내 연속 쌍 + 숙소 복귀. 대중교통은 구간별 '계획 출발시각'을
// 시각별 키(base@tz@when)로 요청한다 (미래가 아니면 base 키) — app.js legRequestKey/planDepartISO 동일.
// 타임라인은 현재 캐시 기준이라 캐시가 채워지면 출발시각이 바뀔 수 있다 — 재수집으로 수렴하고
// 무한 재조회는 fetcher의 그룹 댐핑(≤6)이 막는다 (레거시 transitQuerySeen 동일).
import legacyLib from '@legacy/lib.js';

import {
  backLegOf, dayTimelineOf, hasCoord, isoDateOf, legModeOf
} from '@/features/itinerary/domain/dayView';
import type { LegCache } from '@/features/itinerary/domain/types';
import type { Spot, TransportMode, Trip } from '@/features/trip/domain/types';

const { dayReturnStay, dayStartAnchor, legKey, parseHM, zonedMinutesToISOString } = legacyLib;

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
    const tl = dayTimelineOf(trip, legCache, di);
    const anchor = dayStartAnchor(trip.days as unknown[], di) as Spot | null;

    // 구간별 출발 분 — app.js legDepartMinute: 첫 장소는 시작시각, 그 외엔 직전 장소 도착+대기+체류
    const departMin = (si: number): number => {
      if (si <= 0) return parseHM(day.startAt);
      const prev = day.spots[si - 1], state = tl[si - 1];
      return state.eta + (state.wait || 0) + (prev.stayMin != null ? +prev.stayMin : 60);
    };

    let prev = hasCoord(anchor) ? anchor : null;
    day.spots.forEach((s, si) => {
      if (!hasCoord(s)) return;
      if (prev) {
        const mode = legModeOf(day, s);
        const when = mode === 'transit' && iso ? planDepartISO(iso, departMin(si), timeZone, nowMs) : null;
        add(prev, s, mode, when, timeZone);
      }
      prev = s;
    });

    // 숙소 복귀 — 복귀를 뺀 그날 종료시각 기준 (레거시 backLegOf 동일; 순환 방지)
    const bl = backLegOf(day, dayReturnStay(trip.days as unknown[], di) as Spot | null);
    if (bl) {
      let when: string | null = null;
      if (bl.mode === 'transit' && iso && day.spots.length) {
        const last = day.spots.length - 1, s = day.spots[last];
        const base = s.bookAt ? Math.max(tl[last].eta, parseHM(s.bookAt)) : tl[last].eta;
        when = planDepartISO(iso, base + (s.stayMin != null ? +s.stayMin : 60), timeZone, nowMs);
      }
      add(bl.from, bl.to, bl.mode, when, timeZone);
    }
  });

  return [...out.values()];
}
