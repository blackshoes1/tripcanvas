// 검색 라우팅 — 레거시 routedSearch + doSearch의 단기 캐시를 그대로 재현한다 (동작 변경 금지 — §28).
// · 국내 앵커(또는 한글 질의)면 카카오 우선, 결과가 없으면 구글로 폴백. 해외는 구글만
// · '무결과'와 '실패'를 끝까지 구분한다 — 실패는 코드로 남겨 사용자에게 다른 안내를 준다
// · 같은 질의 2분 캐시. 단 결과가 있을 때만 캐시한다(실패·무결과는 즉시 재시도 가능해야 하므로)
// Provider 주입 factory — 테스트는 SDK 없이 가짜 provider로 라우팅·폴백·캐시만 검증한다.
import legacyLib from '@legacy/lib.js';

import type { SearchOutcome } from './types';

export interface LatLng { lat: number; lng: number }

export type SearchProvider = (q: string, near: LatLng | null, limit: number) => Promise<SearchOutcome>;

export interface RoutedSearchDeps {
  kakao: SearchProvider;
  google: SearchProvider;
  nowMs?: () => number;
}

export interface SearchOptions {
  /** 주변 우선 검색 앵커. 국내/해외 판단에도 쓰인다 */
  near?: LatLng | null;
  /** 캐시 키에 들어가는 도시 문자열 — 같은 질의라도 도시가 다르면 다른 검색이다 */
  cityKey?: string;
  limit?: number;
}

/** 레거시 SEARCH_TTL과 동일 (2분) */
export const SEARCH_TTL_MS = 120_000;

export function cacheKeyOf(q: string, cityKey?: string): string {
  return `${q.trim().toLowerCase()}|${(cityKey ?? '').trim().toLowerCase()}`;
}

export function createRoutedSearch(deps: RoutedSearchDeps) {
  const nowMs = deps.nowMs ?? (() => Date.now());
  const cache = new Map<string, { outcome: SearchOutcome; at: number }>();

  async function search(q: string, opts: SearchOptions = {}): Promise<SearchOutcome> {
    const query = q.trim();
    if (!query) return { results: [], error: null };

    const key = cacheKeyOf(query, opts.cityKey);
    const hit = cache.get(key);
    if (hit && nowMs() - hit.at < SEARCH_TTL_MS) return hit.outcome;

    const near = opts.near ?? null;
    const limit = opts.limit ?? 5;
    let firstError: SearchOutcome['error'] = null;

    if (legacyLib.isKoreanSearch(query, near)) {
      const k = await deps.kakao(query, near, limit);
      if (k.results.length) return remember(key, k);
      firstError = k.error;   // 카카오가 실패했어도 구글로 한 번 더 — 실패 사유는 들고 간다
    }

    const g = await deps.google(query, near, limit);
    if (g.results.length) return remember(key, g);
    // 둘 다 빈손: 구글 실패가 있으면 그걸, 없으면 카카오 실패를, 둘 다 없으면 진짜 무결과
    return { results: [], error: g.error ?? firstError ?? null };
  }

  function remember(key: string, outcome: SearchOutcome): SearchOutcome {
    cache.set(key, { outcome, at: nowMs() });
    return outcome;
  }

  return { search };
}
