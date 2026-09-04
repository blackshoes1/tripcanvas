// 국내 장소 검색(카카오 로컬) — **서버에서만** 부른다.
//
// 왜 서버인가: 카카오 로컬은 SDK가 아니라 REST API고 REST 키를 쓴다. 그 키는 번들 ID·도메인으로
// 제한할 수 없어서 앱에 넣으면 추출한 사람이 그대로 쓴다(카카오내비 프록시를 서버에 둔 것과 같은 이유).
//
// 결과 모양은 웹의 `kakaoSearch`(app.js)와 같다 — 도시·카테고리 판정을 `lib.js`가 하는 덕에
// 웹에서 담은 장소와 앱에서 담은 장소가 같은 값을 갖는다.
import lib from '@legacy/lib.js';

const ENDPOINT = 'https://dapi.kakao.com/v2/local/search/keyword.json';
/** 앵커 근처를 먼저 본다. 웹과 같은 반경 */
const NEAR_RADIUS_M = 20_000;
const MAX_RESULTS = 15;
const TIMEOUT_MS = 8000;

export type PlacePoint = { lat: number; lng: number };

/** 검색 결과 한 건. 앱은 이것으로 곧장 장소(spot)를 만든다 */
export type PlaceResult = {
  name: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  /** 장소 카테고리(`SPOT_CATS`의 id). 모르면 null — 추론하지 않는다 */
  category: string | null;
};

export function clampLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(MAX_RESULTS, Math.max(1, Math.round(parsed)));
}

/**
 * 좌표로 쓸 수 있는 값만 좌표로 인정한다.
 * ⚠️ `Number('')`·`Number(null)`은 0이다 — 그대로 두면 **빈 좌표가 (0,0) 실좌표로 둔갑해**
 * 동선·ETA를 오염시킨다(`lib.js`의 normalizeSpot이 같은 이유로 같은 규칙을 쓴다).
 */
export function readPoint(lat: unknown, lng: unknown): PlacePoint | null {
  const num = (value: unknown): number => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '') return Number(value);
    return Number.NaN;
  };
  const y = num(lat);
  const x = num(lng);
  if (!Number.isFinite(y) || !Number.isFinite(x)) return null;
  if (y < -90 || y > 90 || x < -180 || x > 180) return null;
  return { lat: y, lng: x };
}

export function kakaoParams(query: string, near: PlacePoint | null, limit: number): URLSearchParams {
  const params = new URLSearchParams({ query, size: String(limit) });
  if (near) {
    params.set('y', String(near.lat));
    params.set('x', String(near.lng));
    params.set('radius', String(NEAR_RADIUS_M));
  }
  return params;
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
 * 앵커 근처를 먼저 찾고, 없으면 전국에서 다시 찾는다(웹과 같은 순서).
 * 무결과와 오류를 구분한다 — 오류를 빈 목록으로 뭉개면 "그런 장소가 없다"고 거짓말하게 된다.
 */
export async function searchKakaoPlaces(
  query: string,
  near: PlacePoint | null,
  limit: number,
  deps: KakaoSearchDeps
): Promise<PlaceResult[]> {
  const run = async (withNear: PlacePoint | null): Promise<PlaceResult[]> => {
    const doFetch = deps.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await doFetch(`${ENDPOINT}?${kakaoParams(query, withNear, limit).toString()}`, {
        headers: { Authorization: `KakaoAK ${deps.apiKey}` },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`kakao_local_${response.status}`);
      const body = (await response.json()) as { documents?: unknown };
      return normalizeKakao(body?.documents);
    } finally {
      clearTimeout(timer);
    }
  };

  if (near) {
    const nearby = await run(near);
    if (nearby.length) return nearby;
  }
  return run(null);
}
