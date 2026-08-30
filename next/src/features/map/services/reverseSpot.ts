'use client';
// 좌표 → {이름, 도시} 역추적 — app.js reverseSpot과 같은 질의·같은 폴백 순서.
//
// ⚠️ 이건 **최후 수단**이다. 무엇을 눌렀는지 아는 경로(해외 POI의 placeId, 국내 POI 칩)가 있으면
// 그쪽을 쓴다. 좌표만으로 이름을 되짚는 건 추측이라 엉뚱한 상호가 들어갈 수 있다.
// 그래서 반경을 좁게(40m) 잡고, 그 안에 없으면 이름을 비워 둔다 — 빈 칸이 오답보다 낫다.
import legacyLib from '@legacy/lib.js';

import { KAKAO_NEARBY_CATS, NEAR_POI_RADIUS_M, nearestPlaceName, type NearbyCandidate } from '../domain/mapPick';
import { loadGoogleMaps, loadKakaoMaps } from './sdkLoader';

export interface ReverseResult {
  name: string | null;
  city: string | null;
}

const EMPTY: ReverseResult = { name: null, city: null };

/** 구글 Place에서 우리가 쓰는 필드만 */
const G_FIELDS = ['displayName', 'formattedAddress', 'addressComponents'];

/** 역추적에 필요한 필드만 — 검색 결과(PlaceLike)와 fetchFields가 채운 인스턴스 둘 다 만족한다 */
interface PlaceFields {
  displayName?: unknown;
  formattedAddress?: string;
  addressComponents?: unknown;
}

/** 카카오 행정구역 → 도시명 (레거시 reverseSpot 안의 규칙 그대로) */
function cityFromRegion(one: string, two: string): string {
  const metro = /(특별시|광역시|특별자치시|특별자치도)$/.test(one);
  return metro
    ? one.replace(/(특별시|광역시|특별자치시|특별자치도)$/, '')
    : (two.replace(/(시|군)$/, '') || one);
}

/** 국내: 가까운 실제 상호 하나 (카테고리별 최근접 후보를 모아 그중 최근접) */
async function kakaoNearbyName(lat: number, lng: number): Promise<string | null> {
  const S = window.kakao?.maps?.services;
  if (!S?.Places) return null;
  const ps = new S.Places();
  const loc = new kakao.maps.LatLng(lat, lng);
  const perCat = await Promise.all(KAKAO_NEARBY_CATS.map(code =>
    new Promise<NearbyCandidate | null>(res => {
      try {
        ps.categorySearch(code, (data, status) => {
          const top = status === S.Status.OK && data?.length ? data[0] : null;
          res(top?.place_name ? { name: top.place_name, distance: top.distance } : null);
        }, { location: loc, radius: NEAR_POI_RADIUS_M, sort: S.SortBy?.DISTANCE });
      } catch { res(null); }
    })
  ));
  return nearestPlaceName(perCat.filter((c): c is NearbyCandidate => !!c));
}

async function reverseKorea(lat: number, lng: number): Promise<ReverseResult> {
  if (!(await loadKakaoMaps())) return EMPTY;
  const S = window.kakao?.maps?.services;
  if (!S?.Geocoder) return EMPTY;

  const addr = await new Promise<{ building: string; city: string }>(res => {
    try {
      // 인자 순서가 (lng, lat)이다 — 뒤집으면 엉뚱한 곳의 주소가 나온다
      new S.Geocoder().coord2Address(lng, lat, (result, status) => {
        if (status !== S.Status.OK || !result?.length) { res({ building: '', city: '' }); return; }
        const r = result[0], a = r.address ?? {};
        res({
          building: r.road_address?.building_name ?? '',
          city: cityFromRegion(a.region_1depth_name ?? '', a.region_2depth_name ?? '')
        });
      });
    } catch { res({ building: '', city: '' }); }
  });

  // 건물명은 '그 건물'이지 '탭한 가게'가 아니다 → 가까운 실제 상호를 우선한다
  const poi = await kakaoNearbyName(lat, lng).catch(() => null);
  return { name: poi || addr.building || null, city: addr.city || null };
}

async function reverseOverseas(lat: number, lng: number, placeId?: string): Promise<ReverseResult> {
  if (!(await loadGoogleMaps())) return EMPTY;
  try {
    const lib = await google.maps.importLibrary('places');
    const Place = lib?.Place;
    if (!Place) return EMPTY;
    // fetchFields는 인스턴스 자신을 채우기도 해서 PlaceLike보다 느슨한 모양을 받는다
    const shape = (p: PlaceFields | null | undefined): ReverseResult =>
      p ? { name: legacyLib.placeName(p) || null, city: legacyLib.cityFromGoogle(p.addressComponents) || null } : EMPTY;

    // 탭한 POI를 특정하지 못한 경우(빈 자리). 넓은 반경의 '가장 유명한' 곳을 집어오면
    // 엉뚱한 가게가 들어간다 → 좁은 반경의 '가장 가까운' 곳만 본다.
    const nearby = async (): Promise<ReverseResult> => {
      const req: Record<string, unknown> = {
        fields: G_FIELDS,
        locationRestriction: { center: { lat, lng }, radius: NEAR_POI_RADIUS_M },
        maxResultCount: 1,
        language: 'en'
      };
      const rank = lib.SearchNearbyRankPreference?.DISTANCE;
      if (rank) req.rankPreference = rank;
      try {
        const { places } = await Place.searchNearby(req);
        return shape(places?.[0]);
      } catch { return EMPTY; }
    };

    if (placeId) {
      try {
        const place = new Place({ id: placeId, requestedLanguage: 'en' });
        const r = await place.fetchFields({ fields: G_FIELDS });
        return shape(r?.place ?? place);
      } catch { return nearby(); }
    }
    return nearby();
  } catch { return EMPTY; }
}

/**
 * 좌표(+선택적 placeId)로 장소 신원을 되짚는다. 실패해도 throw하지 않고 빈 결과를 준다 —
 * 이름을 못 찾는 건 정상적인 결과(빈 칸)이지 오류가 아니다.
 */
export function reverseSpot(lat: number, lng: number, placeId?: string): Promise<ReverseResult> {
  return legacyLib.inKorea({ lat, lng })
    ? reverseKorea(lat, lng).catch(() => EMPTY)
    : reverseOverseas(lat, lng, placeId).catch(() => EMPTY);
}
