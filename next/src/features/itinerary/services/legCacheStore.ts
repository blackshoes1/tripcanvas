// 구간 캐시 접근 (읽기 전용) — 레거시 routing이 채우는 localStorage(tripcanvas_legs_v4)를 읽는다.
// Next 일정 뷰는 경로를 새로 조회하지 않는다(라우팅 이관은 Phase 5) — 캐시가 없으면
// 도메인이 속도 기반 직선 추정으로 폴백해 레거시와 같은 결과를 보인다.
// useSyncExternalStore 계약: 스냅샷은 raw 문자열 기준으로 캐시해 참조 안정성을 보장한다.
import type { LegCache } from '@/features/itinerary/domain/types';

const LS_KEY = 'tripcanvas_legs_v4';
const EMPTY: LegCache = Object.freeze({});

let cacheRaw: string | null | undefined;
let cacheVal: LegCache = EMPTY;
const listeners = new Set<() => void>();
let storageAttached = false;

export function getLegCacheSnapshot(): LegCache {
  if (typeof window === 'undefined') return EMPTY;
  const raw = window.localStorage.getItem(LS_KEY);
  if (cacheRaw === undefined || raw !== cacheRaw) {
    cacheRaw = raw;
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      cacheVal = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as LegCache) : EMPTY;
    } catch {
      cacheVal = EMPTY;   // 손상 캐시 — 추정 폴백으로 동작(빈 캐시와 동일)
    }
  }
  return cacheVal;
}

export function getLegCacheServerSnapshot(): LegCache {
  return EMPTY;   // SSR에는 저장소가 없다
}

export function subscribeLegCache(cb: () => void): () => void {
  listeners.add(cb);
  if (!storageAttached && typeof window !== 'undefined') {
    storageAttached = true;
    window.addEventListener('storage', e => {
      if (e.key === LS_KEY || e.key === null) {
        cacheRaw = undefined;
        listeners.forEach(l => l());
      }
    });
  }
  return () => { listeners.delete(cb); };
}
