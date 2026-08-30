'use client';
// 초안 장소 지오코딩 — 레거시 geocodeSpot과 같은 규칙:
// 후보 질의를 "이름 도시" → "이름" → 단순화한 이름 순으로 시도하고,
// **도시 앵커에서 150km 밖 결과는 버린다** (같은 이름의 엉뚱한 도시 장소가 잡히는 걸 막는다).
import legacyLib from '@legacy/lib.js';

import { cityAnchorOf, searchPlaces } from '@/features/search/services/placeSearch';
import type { Spot } from '@/features/trip/domain/types';

const { haversine, simplifyName } = legacyLib;

/** 도시 앵커에서 이만큼 떨어진 결과는 다른 곳으로 본다 */
export const CITY_RADIUS_KM = 150;

export async function geocodeSpot(s: Spot): Promise<{ lat: number; lng: number } | null> {
  const anchor = await cityAnchorOf(s.city ?? '');
  const cands = [`${s.name} ${s.city ?? ''}`.trim(), s.name];
  const simp = simplifyName(s.name);
  if (simp && simp !== s.name) cands.push(simp);

  const seen = new Set<string>();
  for (const q of cands) {
    const qq = q.trim();
    if (!qq || seen.has(qq)) continue;
    seen.add(qq);
    // cityKey를 넘겨야 같은 이름이라도 도시가 다르면 다른 검색으로 캐시된다
    const hit = (await searchPlaces(qq, { near: anchor, cityKey: s.city, limit: 1 })).results[0];
    if (hit && (!anchor || haversine(anchor, hit) <= CITY_RADIUS_KM)) return { lat: hit.lat, lng: hit.lng };
  }
  return null;
}

/**
 * 좌표 없는 장소들을 차례로 찾아 **제자리에 채운다**.
 * 못 찾은 장소는 버리지 않는다 — 카드에 '위치 미지정'으로 남겨 손으로 지정할 수 있게.
 */
export async function fillCoords(
  spots: Spot[], onProgress?: (done: number, total: number, name: string) => void
): Promise<void> {
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    onProgress?.(i + 1, spots.length, s.name);
    const g = await geocodeSpot(s);
    if (g) { s.lat = g.lat; s.lng = g.lng; }
  }
}
