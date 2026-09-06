'use client';
// 지도 SDK 검색 어댑터 — app.js kakaoSearch/googlePlaces/cityAnchorOf와 같은 질의·같은 필드.
// 결과를 Spot 필드로 옮기는 정규화는 전부 lib.js 순수 함수(단일 소스)를 쓴다.
// 라우팅·폴백·캐시 판단은 domain/routeSearch가 하고, 여기는 SDK 호출과 모양 맞추기만 한다 (§27).
import legacyLib from '@legacy/lib.js';

import { loadGoogleMaps, loadKakaoMaps } from '@/features/map/services/sdkLoader';
import type { SpotCategory } from '@/features/trip/domain/types';
import { createRoutedSearch, type LatLng, type SearchProvider } from '../domain/routeSearch';
import type { PlaceResult, SearchOutcome } from '../domain/types';

const asCat = (v: string | null): SpotCategory | undefined => (v ?? undefined) as SpotCategory | undefined;

/** 카카오 키워드 검색. 앵커가 있으면 20km 반경 우선, 빈손이면 전국으로 한 번 더 (레거시와 동일) */
const kakaoProvider: SearchProvider = async (q, near, limit) => {
  if (!(await loadKakaoMaps())) return { results: [], error: 'network' };   // SDK 로드 실패(네트워크·도메인 제한)

  const size = Math.min(limit, 15);
  const run = (opts: { size: number; location?: kakao.maps.LatLng; radius?: number }): Promise<SearchOutcome> =>
    new Promise(res => {
      try {
        new kakao.maps.services.Places().keywordSearch(q, (data, status) => {
          const S = kakao.maps.services.Status;
          if (status === S.OK && data) {
            res({
              results: data.map(d => ({
                name: d.place_name,
                addr: d.road_address_name || d.address_name || '',
                city: legacyLib.cityFromKoreanAddr(d.address_name || d.road_address_name || ''),
                lat: +d.y, lng: +d.x,
                cat: asCat(legacyLib.catFromKakao(d.category_group_code)),
                kakaoId: d.id || undefined   // 고른 그 장소의 신원 — 지도 링크가 바로 길찾기가 된다
              })),
              error: null
            });
            return;
          }
          if (status === S.ZERO_RESULT) { res({ results: [], error: null }); return; }   // 진짜 결과 없음 — 오류 아님
          console.warn('kakao 검색 오류 status:', status);
          res({ results: [], error: 'error' });
        }, opts);
      } catch (e) {
        console.warn('kakao 검색 예외:', e);
        res({ results: [], error: 'error' });
      }
    });

  if (near) {
    const r = await run({ size, location: new kakao.maps.LatLng(near.lat, near.lng), radius: 20000 });
    if (r.results.length) return r;
  }
  return run({ size });
};

/** Google Places 텍스트 검색 (신 API). 해외 장소는 영문명 — 레거시와 같은 language:'en' */
const googleProvider: SearchProvider = async (q, near, limit) => {
  if (!(await loadGoogleMaps())) return { results: [], error: 'network' };
  try {
    const { Place } = await google.maps.importLibrary('places');
    const req: Record<string, unknown> = {
      textQuery: q,
      fields: ['id', 'displayName', 'formattedAddress', 'addressComponents', 'location',
        'regularOpeningHours', 'primaryType', 'types'],
      maxResultCount: limit,
      language: 'en'
    };
    if (near) req.locationBias = { center: near, radius: 30000 };
    const { places } = await Place.searchByText(req);
    return {
      results: (places ?? []).map((p): PlaceResult => ({
        name: legacyLib.placeName(p),
        addr: p.formattedAddress ?? '',
        city: legacyLib.cityFromGoogle(p.addressComponents),
        lat: p.location.lat(), lng: p.location.lng(),
        cat: asCat(legacyLib.catFromGoogle(p.types, p.primaryType)),
        hours: legacyLib.normHours(p.regularOpeningHours) ?? undefined,
        placeId: p.id || undefined   // 예약 가격 추적의 호텔 identity
      })),
      error: null
    };
  } catch (e) {
    const code = legacyLib.classifySearchErr(e);
    console.warn('Places 검색 오류[' + code + ']:', (e instanceof Error ? e.message : e));
    return { results: [], error: code };
  }
};

const routed = createRoutedSearch({ kakao: kakaoProvider, google: googleProvider });

/** 장소 검색 — 국내/해외 라우팅·폴백·2분 캐시를 거친 결과 */
export const searchPlaces = routed.search;

// 도시명 → 앵커 좌표 (Google Geocoder, 전 세계). 실패도 캐시한다 — 같은 오타를 매번 물어보지 않게.
const cityAnchors = new Map<string, LatLng | null>();

export async function cityAnchorOf(city: string): Promise<LatLng | null> {
  const key = city.trim();
  if (!key) return null;
  const hit = cityAnchors.get(key);
  if (hit !== undefined) return hit;
  if (!(await loadGoogleMaps())) return null;   // 로드 실패는 캐시하지 않는다 (다음에 될 수 있다)
  const anchor = await new Promise<LatLng | null>(res => {
    try {
      new google.maps.Geocoder().geocode({ address: key }, (r, st) => {
        res(st === 'OK' && r && r[0]
          ? { lat: r[0].geometry.location.lat(), lng: r[0].geometry.location.lng() }
          : null);
      });
    } catch { res(null); }
  });
  cityAnchors.set(key, anchor);
  return anchor;
}
