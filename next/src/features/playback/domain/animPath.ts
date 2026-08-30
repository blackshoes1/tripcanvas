// 재생 경로 — app.js animPath()와 같은 점 목록을 만든다 (순수).
//
// 각 점에 구간 메타(from/to/mode/소요/일자/줌)를 실어 둔다. 재생 HUD가 '지금 어느 구간인지'를
// 알아야 하고, 카메라는 '도시 내인지 도시 간인지'에 따라 줌을 달리 잡아야 하기 때문.
import legacyLib from '@legacy/lib.js';

import { hasCoord, legModeOf, type LatLng, type LocatedSpot } from '@/features/itinerary/domain/dayView';
import type { LegCache } from '@/features/itinerary/domain/types';
import type { TransportMode, Trip } from '@/features/trip/domain/types';

const { decodePolyline, dayStartAnchor, haversine, legKey } = legacyLib;

/** 재생 중 도시 내(줌인)·도시 간(줌아웃) 레벨 */
export const PLAY_ZOOM_IN = 13;
export const PLAY_ZOOM_OUT = 9;

/**
 * 도시 간 이동 판정 — 이름만으론 오판한다(인근 산·명소가 지자체명이 다르다).
 * 이름이 다르면서 충분히 멀 때(15km↑)만 도시 간. 이름을 모르면 거리(25km)로.
 * → 인근 명소에서 줌아웃·정지가 남발되지 않게.
 */
export function isInterCity(a: { city?: string } & LatLng, b: { city?: string } & LatLng): boolean {
  const ca = (a.city ?? '').trim(), cb = (b.city ?? '').trim();
  const dist = haversine(a, b);
  return ca && cb ? (ca !== cb && dist > 15) : dist > 25;
}

export interface AnimPoint extends LatLng {
  mode: TransportMode;
  /** 이 점이 속한 구간의 줌 상한 */
  zoom: number;
  di: number;
  from: string;
  to: string;
  /** 실경로 소요(초). 캐시가 없으면 null — HUD가 '소요 미표시'로 다룬다 */
  sec: number | null;
}

/**
 * 재생할 점 목록. 일자 필터 중이면 그 일자만, 아니면 전체.
 * 각 일자의 시작점은 dayStartAnchor(정책 반영 — 'none'이면 이월 없음, 빈 날은 건너뜀).
 * 실경로가 캐시에 있으면 그 폴리라인을, 없으면 두 점을 잇는 직선을 쓴다.
 */
export function buildAnimPath(trip: Trip, legCache: LegCache, activeDay: number): AnimPoint[] {
  const flat: AnimPoint[] = [];
  const range = activeDay ? [activeDay - 1] : trip.days.map((_, i) => i);

  range.forEach(di => {
    const day = trip.days[di];
    if (!day) return;
    const loc = day.spots.filter(hasCoord);
    if (!loc.length) return;

    const pushSeg = (A: LocatedSpot, B: LocatedSpot) => {
      const mode = legModeOf(day, B);
      const c = legCache[legKey(A, B, mode)];
      const pts = c?.sec && c.path
        ? decodePolyline(c.path)
        : [{ lat: A.lat, lng: A.lng }, { lat: B.lat, lng: B.lng }];
      const zoom = isInterCity(A, B) ? PLAY_ZOOM_OUT : PLAY_ZOOM_IN;
      const from = A.name || '출발', to = B.name || '도착';
      const sec = c?.sec ?? null;
      pts.forEach(p => flat.push({ lat: +p.lat, lng: +p.lng, mode, zoom, di, from, to, sec }));
    };

    const anchor = dayStartAnchor(trip.days as unknown[], di) as LocatedSpot | null;
    if (hasCoord(anchor)) pushSeg(anchor, loc[0]);   // 이월 숙소/이전 위치 → 오늘 첫 장소
    for (let i = 1; i < loc.length; i++) pushSeg(loc[i - 1], loc[i]);
  });

  return flat;
}
