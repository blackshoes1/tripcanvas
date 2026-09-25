// 지도 장면 빌더 — 레거시 render()의 지도 부분(app.js)을 순수 함수로 재현한다. 재작성 금지 원칙:
// 규칙(엔진 선택·색·실경로 우선·점선·칩·프레이밍)을 그대로 옮기고, 순수 계산은 lib.js 단일 소스를 쓴다.
// 읽기 뷰 — 경로를 새로 조회하지 않으므로 미캐시 구간은 레거시의 '조회 중' 상태와 동일하게 선을 긋지 않는다.
import legacyLib from '@legacy/lib.js';

import { MODE_ICON, dayJourneyOf, fmtDur, hasCoord, legModeOf } from '@/features/itinerary/domain/dayView';
import type { LegCache } from '@/features/itinerary/domain/types';
import type { Spot, TransportMode, Trip } from '@/features/trip/domain/types';
import type { FitTarget, MapEngine, MapScene, SceneChip, SceneGhost, SceneLine, ScenePin } from './types';

const { decodePolyline, inKorea, legKey, returnModeOf, spotCatOf } = legacyLib;

// ── 색상 (app.js와 동일 값·규칙 — Phase 6에서 단일 소스로 합칠 표시 글루) ──
export const PALETTE =
  ['#e63946', '#1e88e5', '#2ecc71', '#9b59b6', '#ec4899', '#14b8a6', '#8d6e63', '#ff7f50', '#a3e635', '#f6b93b'];

export function dayColor(di: number): string {
  return PALETTE[di % PALETTE.length];
}

/** 도시 → 색. 등장 순서대로 팔레트를 배정한다 (레거시 cityColors) */
export function cityColors(trip: Trip): Record<string, string> {
  const m: Record<string, string> = {};
  let i = 0;
  trip.days.forEach(d => d.spots.forEach(s => {
    if (!(s.city in m)) { m[s.city] = PALETTE[i % PALETTE.length]; i++; }
  }));
  return m;
}

/** 색상 기준 — trip.colorBy 'city'일 때만 도시별, 기본 일자별 (경로 색 가독성) */
function colorByMode(trip: Trip): 'city' | 'day' {
  return trip.colorBy === 'city' ? 'city' : 'day';
}
export function spotColor(trip: Trip, s: Spot, di: number, cityMap: Record<string, string>): string {
  return colorByMode(trip) === 'day' ? dayColor(di) : (cityMap[s.city] ?? '#888');
}

// ── 엔진 선택 ──
/**
 * 지금 보는 범위(일자 필터 중이면 그 일자, 아니면 전체)의 좌표 스팟이 '전부' 국내일 때만 카카오.
 * 해외 스팟이 하나라도 보이면 카카오는 그 지역을 못 그리므로 구글. (레거시 desiredEngine 동일)
 * @param activeDay 1-based 일자 필터, 0=전체
 */
export function desiredEngineOf(trip: Trip, activeDay: number): MapEngine {
  const days = activeDay ? [trip.days[activeDay - 1]] : trip.days;
  let kr = 0, n = 0;
  days.forEach(d => d?.spots.forEach(s => {
    if (hasCoord(s)) { n++; if (inKorea(s)) kr++; }
  }));
  return n > 0 && kr === n ? 'kakao' : 'google';
}

// ── 장면 빌드 ──
export function buildMapScene(trip: Trip, legCache: LegCache, activeDay: number): MapScene {
  const colors = cityColors(trip);
  const pins: ScenePin[] = [];
  const lines: SceneLine[] = [];
  const ghosts: SceneGhost[] = [];
  const chips: SceneChip[] = [];

  trip.days.forEach((day, di) => {
    if (activeDay && di + 1 !== activeDay) return;
    day.spots.forEach((s, si) => {
      if (!hasCoord(s)) return;                 // 좌표 미지정 장소는 핀 생략 (카드엔 남음)
      const cat = spotCatOf(s);
      pins.push({
        lat: s.lat, lng: s.lng, di, si, label: si + 1,
        color: spotColor(trip, s, di, colors), opt: !!s.opt, catIcon: cat?.icon ?? null,
        title: cat ? `${cat.icon} ${cat.name} · ${s.name}` : s.name
      });
    });

    // 조회·타임라인과 같은 경로 집합: 분리된 가지끼리는 연결하지 않는다.
    const locSpots = day.spots.filter(hasCoord);
    const lc = dayColor(di), lop = activeDay ? 0.9 : 0.7;
    for (const leg of dayJourneyOf(trip, legCache, di).legs) {
      const A = leg.from, B = leg.to;
      const returning = !!leg.returning;
      const carried = !returning && !day.spots.includes(A);
      if (carried && activeDay) continue; // 일자 간 점선은 전체 보기에서만
      if (returning && !locSpots.includes(B) && !ghosts.some(g => g.lat === B.lat && g.lng === B.lng && g.color === lc))
        ghosts.push({ lat: B.lat, lng: B.lng, color: lc, title: B.name });
      const lm = returning ? returnModeOf(day) as TransportMode : legModeOf(day, B);
      const cch = legCache[legKey(A, B, lm)];
      if (!cch) continue;
      const path = cch.sec && cch.path ? decodePolyline(cch.path) : null;
      lines.push({
        pts: path ?? [{ lat: A.lat, lng: A.lng }, { lat: B.lat, lng: B.lng }],
        color: lc, opacity: returning ? lop * 0.85 : carried ? 0.8 : lop,
        dashed: returning || carried
      });
      if (activeDay && !returning && cch.sec) {
        const mid = path ? path[Math.floor(path.length / 2)]
          : { lat: (A.lat + B.lat) / 2, lng: (A.lng + B.lng) / 2 };
        const dist = cch.m ?? 0;
        chips.push({
          ...mid,
          text: lm === 'car' && dist < 2000
            ? `🚶${Math.max(1, Math.round(dist / 75))}분`
            : `${MODE_ICON[lm]}${fmtDur(cch.sec)}`
        });
      }
    }
  });

  return { engine: desiredEngineOf(trip, activeDay), pins, lines, ghosts, chips };
}

// ── 카메라 프레이밍 (레거시 fitCurrentView/fitAll/fitEntry 동일 수치) ──
function dayPts(trip: Trip, di: number): [number, number][] {
  return (trip.days[di]?.spots ?? []).filter(hasCoord).map(s => [s.lat, s.lng]);
}

/** 현재 보는 범위 — 일자 필터 중이면 그 일자(pad 64·maxZoom 15), 아니면 전체(pad 60) */
export function fitTargetOf(trip: Trip, activeDay: number): FitTarget | null {
  if (activeDay) {
    const pts = dayPts(trip, activeDay - 1);
    if (pts.length) return { pts, pad: 64, maxZoom: 15 };
  }
  const all: [number, number][] = [];
  trip.days.forEach((_, di) => all.push(...dayPts(trip, di)));
  return all.length ? { pts: all, pad: 60 } : null;
}

/** 여행 진입 시 포커스 — 위치 있는 첫 일자 지역 (없으면 전체) */
export function entryFitOf(trip: Trip): FitTarget | null {
  const di = trip.days.findIndex(d => d.spots.some(s => hasCoord(s)));
  if (di >= 0) return { pts: dayPts(trip, di), pad: 64, maxZoom: 15 };
  return fitTargetOf(trip, 0);
}
