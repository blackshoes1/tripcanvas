// 지도 장면 빌더 — 레거시 render()의 지도 부분(app.js)을 순수 함수로 재현한다. 재작성 금지 원칙:
// 규칙(엔진 선택·색·실경로 우선·점선·칩·프레이밍)을 그대로 옮기고, 순수 계산은 lib.js 단일 소스를 쓴다.
// 읽기 뷰 — 경로를 새로 조회하지 않으므로 미캐시 구간은 레거시의 '조회 중' 상태와 동일하게 선을 긋지 않는다.
import legacyLib from '@legacy/lib.js';

import { MODE_ICON, backLegOf, fmtDur, hasCoord, legModeOf } from '@/features/itinerary/domain/dayView';
import type { LegCache } from '@/features/itinerary/domain/types';
import type { Spot, Trip } from '@/features/trip/domain/types';
import type { FitTarget, MapEngine, MapScene, SceneChip, SceneGhost, SceneLine, ScenePin } from './types';

const { dayReturnStay, dayStartAnchor, decodePolyline, inKorea, legKey, spotCatOf } = legacyLib;

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

    // 일자 내 동선 — 실경로 우선. 미캐시(조회 중)엔 그리지 않고, 실패 구간만 직선으로.
    // 경로선 색은 색 모드와 무관하게 항상 일자 색 (핀·카드만 도시별/일자별 따름).
    const locSpots = day.spots.filter(hasCoord);
    const lc = dayColor(di), lop = activeDay ? 0.9 : 0.7;
    for (let i = 1; i < locSpots.length; i++) {
      const A = locSpots[i - 1], B = locSpots[i], lm = legModeOf(day, B);
      const cch = legCache[legKey(A, B, lm)];
      if (!cch) continue;
      const path = cch.sec && cch.path ? decodePolyline(cch.path) : null;
      lines.push({
        pts: path ?? [{ lat: A.lat, lng: A.lng }, { lat: B.lat, lng: B.lng }],
        color: lc, opacity: lop, dashed: false
      });
      if (activeDay && cch.sec) {   // 일자 보기에선 경로 중간에 소요시간 칩
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

    // 숙소 복귀 — 자동 합성 구간이라 점선. 연박처럼 그날 목록에 없는 숙소면 옅은 🏠 표식.
    const bl = backLegOf(day, dayReturnStay(trip.days as unknown[], di) as Spot | null);
    if (bl) {
      const bch = legCache[legKey(bl.from, bl.to, bl.mode)];
      if (bch) {
        const bpath = bch.sec && bch.path ? decodePolyline(bch.path) : null;
        lines.push({
          pts: bpath ?? [{ lat: bl.from.lat, lng: bl.from.lng }, { lat: bl.to.lat, lng: bl.to.lng }],
          color: lc, opacity: lop * 0.85, dashed: true
        });
      }
      if (locSpots.indexOf(bl.to) < 0) ghosts.push({ lat: bl.to.lat, lng: bl.to.lng, color: lc, title: bl.to.name });
    }
  });

  // 일자 간 연결 (전체 보기) — 점선, 도착 일자 색. 이월 시작점은 dayStartAnchor(정책 반영).
  if (!activeDay) {
    trip.days.forEach((day, di) => {
      const loc = day.spots.filter(hasCoord);
      if (!loc.length) return;
      const from = dayStartAnchor(trip.days as unknown[], di) as Spot | null;
      if (!hasCoord(from)) return;
      const cch = legCache[legKey(from, loc[0], legModeOf(day, loc[0]))];
      if (!cch) return;
      const path = cch.sec && cch.path ? decodePolyline(cch.path) : null;
      lines.push({
        pts: path ?? [{ lat: from.lat, lng: from.lng }, { lat: loc[0].lat, lng: loc[0].lng }],
        color: dayColor(di), opacity: 0.8, dashed: true
      });
    });
  }

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
