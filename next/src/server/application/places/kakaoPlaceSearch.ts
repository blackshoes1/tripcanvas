// 국내 장소 검색(카카오 로컬) — **서버에서만** 부른다.
//
// 왜 서버인가: 카카오 로컬은 SDK가 아니라 REST API고 REST 키를 쓴다. 그 키는 번들 ID·도메인으로
// 제한할 수 없어서 앱에 넣으면 추출한 사람이 그대로 쓴다(카카오내비 프록시를 서버에 둔 것과 같은 이유).
//
// 결과 모양은 웹의 `kakaoSearch`(app.js)와 같다 — 도시·카테고리 판정을 `lib.js`가 하는 덕에
// 웹에서 담은 장소와 앱에서 담은 장소가 같은 값을 갖는다.
import lib from '@legacy/lib.js';

const ENDPOINT = 'https://dapi.kakao.com/v2/local/search';
/** 앵커 근처를 먼저 본다. 웹과 같은 반경 */
const NEAR_RADIUS_M = 20_000;
const MAX_RESULTS = 15;
const TIMEOUT_MS = 8000;

export type PlacePoint = { lat: number; lng: number };
export type PlaceBounds = { south: number; west: number; north: number; east: number };
const CATEGORY_CODES = { food: 'FD6', cafe: 'CE7', attraction: 'AT4', stay: 'AD5' } as const;
export type PlaceSearchCategory = keyof typeof CATEGORY_CODES;
export type PlaceSearchFilters = { category?: PlaceSearchCategory; bounds?: PlaceBounds };

/** 검색 결과 한 건. 앱은 이것으로 곧장 장소(spot)를 만든다 */
export type PlaceResult = {
  provider: 'kakao';
  /** 제공처에서 확인한 원본 ID와 URL. 없으면 만들어 내지 않는다. */
  providerId: string | null;
  placeUrl: string | null;
  name: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  /** 장소 카테고리(`SPOT_CATS`의 id). 모르면 null — 추론하지 않는다 */
  category: string | null;
};

export function clampLimit(value: unknown): number {
  if (value == null) return 5;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(MAX_RESULTS, Math.max(1, Math.round(parsed)));
}

export function readSearchCategory(value: string): PlaceSearchCategory | null {
  return Object.hasOwn(CATEGORY_CODES, value) ? value as PlaceSearchCategory : null;
}

function readNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) {
    return Number(value);
  }
  return Number.NaN;
}

/**
 * 좌표로 쓸 수 있는 값만 좌표로 인정한다.
 * ⚠️ `Number('')`·`Number(null)`은 0이다 — 그대로 두면 **빈 좌표가 (0,0) 실좌표로 둔갑해**
 * 동선·ETA를 오염시킨다(`lib.js`의 normalizeSpot이 같은 이유로 같은 규칙을 쓴다).
 */
export function readPoint(lat: unknown, lng: unknown): PlacePoint | null {
  const y = readNumber(lat);
  const x = readNumber(lng);
  if (!Number.isFinite(y) || !Number.isFinite(x)) return null;
  if (y < -90 || y > 90 || x < -180 || x > 180) return null;
  return { lat: y, lng: x };
}

/** south,west,north,east. 국내 검색이므로 날짜변경선을 넘는 영역은 뒤집거나 나누지 않는다. */
export function readBounds(value: string): PlaceBounds | null {
  const parts = value.split(',');
  if (parts.length !== 4) return null;
  const southwest = readPoint(parts[0], parts[1]);
  const northeast = readPoint(parts[2], parts[3]);
  if (!southwest || !northeast || southwest.lat >= northeast.lat || southwest.lng >= northeast.lng) return null;
  return { south: southwest.lat, west: southwest.lng, north: northeast.lat, east: northeast.lng };
}

/** 앱의 화면 검색은 중심에서 모서리까지 20km로 제한한다. rect의 제공처 제한이라는 뜻은 아니다. */
export function boundsTooWide(bounds: PlaceBounds): boolean {
  const center = { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 };
  return [bounds.south, bounds.north].some(lat =>
    [bounds.west, bounds.east].some(lng => lib.haversine(center, { lat, lng }) * 1000 > NEAR_RADIUS_M)
  );
}

export function kakaoParams(
  query: string, near: PlacePoint | null, limit: number, filters: PlaceSearchFilters = {}
): URLSearchParams {
  const params = new URLSearchParams({ size: String(limit) });
  if (query) params.set('query', query);
  if (filters.category) params.set('category_group_code', CATEGORY_CODES[filters.category]);
  if (filters.bounds) {
    const { south, west, north, east } = filters.bounds;
    params.set('rect', `${west},${south},${east},${north}`);
  } else if (near) {
    params.set('y', String(near.lat));
    params.set('x', String(near.lng));
    params.set('radius', String(NEAR_RADIUS_M));
  }
  return params;
}

function kakaoPlaceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'place.map.kakao.com' ||
      url.username || url.password || url.port || !/^\/\d{1,20}\/?$/.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** 카카오 문서 → 장소. 좌표가 없는 항목은 버린다(담아도 동선에 못 쓴다) */
export function normalizeKakao(documents: unknown): PlaceResult[] {
  if (!Array.isArray(documents)) return [];
  const out: PlaceResult[] = [];
  for (const raw of documents) {
    const doc = (raw ?? {}) as Record<string, unknown>;
    const point = readPoint(doc.y, doc.x);
    const name = String(doc.place_name ?? '').trim();
    if (!point || !name) continue;
    const address = String(doc.road_address_name || doc.address_name || '').trim();
    out.push({
      provider: 'kakao',
      providerId: typeof doc.id === 'string' && /^\d{1,20}$/.test(doc.id) ? doc.id : null,
      placeUrl: kakaoPlaceUrl(doc.place_url),
      name,
      address,
      city: lib.cityFromKoreanAddr(String(doc.address_name || doc.road_address_name || '')),
      lat: point.lat,
      lng: point.lng,
      category: lib.catFromKakao(doc.category_group_code) ?? null
    });
  }
  return out;
}

export type KakaoSearchDeps = {
  fetchImpl?: typeof fetch;
  apiKey: string;
};

/**
 * 구형 검색은 앵커 근처를 먼저 찾고, 없으면 전국에서 다시 찾는다(웹과 같은 순서).
 * 화면 범위 검색은 rect를 벗어나지 않고, 검색어 없는 업종 탐색은 category API를 쓴다.
 * 무결과와 오류를 구분한다 — 오류를 빈 목록으로 뭉개면 "그런 장소가 없다"고 거짓말하게 된다.
 */
export async function searchKakaoPlaces(
  query: string,
  near: PlacePoint | null,
  limit: number,
  deps: KakaoSearchDeps,
  filters: PlaceSearchFilters = {}
): Promise<PlaceResult[]> {
  const run = async (withNear: PlacePoint | null): Promise<PlaceResult[]> => {
    const doFetch = deps.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const endpoint = query ? 'keyword' : 'category';
      const response = await doFetch(`${ENDPOINT}/${endpoint}.json?${kakaoParams(query, withNear, limit, filters).toString()}`, {
        headers: { Authorization: `KakaoAK ${deps.apiKey}` },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`kakao_local_${response.status}`);
      const body = (await response.json()) as { documents?: unknown };
      if (!Array.isArray(body?.documents)) throw new Error('kakao_local_invalid_response');
      // 제공처에 필터를 보내고, 돌아온 결과도 다시 확인해 지도 밖이나 다른 업종을 그리지 않는다.
      const categoryCode = filters.category && CATEGORY_CODES[filters.category];
      const documents = categoryCode
        ? body.documents.filter(doc => doc?.category_group_code === categoryCode)
        : body.documents;
      return normalizeKakao(documents).filter(place => {
        const bounds = filters.bounds;
        return !bounds || (place.lat >= bounds.south && place.lat <= bounds.north &&
          place.lng >= bounds.west && place.lng <= bounds.east);
      }).slice(0, limit);
    } finally {
      clearTimeout(timer);
    }
  };

  if (filters.bounds) return run(null);
  if (near) {
    const nearby = await run(near);
    if (nearby.length) return nearby;
  }
  return run(null);
}
