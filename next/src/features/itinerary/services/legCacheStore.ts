// 구간 캐시 접근 — 레거시와 같은 localStorage(tripcanvas_legs_v4)를 읽고 쓴다 (Phase 6a부터 쓰기).
// 캐시가 없는 구간은 도메인이 속도 기반 직선 추정으로 폴백하고, legFetcher가 채우면
// 알림(notify)으로 화면이 자동 갱신된다 — 레거시의 디바운스 재렌더에 해당.
// useSyncExternalStore 계약: 스냅샷은 raw 문자열 기준으로 캐시해 참조 안정성을 보장한다.
import type { CachedLeg, LegCache } from '@/features/itinerary/domain/types';

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

/** 조회 결과 병합 저장 — 쿼터 초과 등 실패는 무시(레거시 saveLegCache와 동일), 저장 여부와 무관하게 알림 */
export function writeLegEntries(entries: Record<string, CachedLeg>): void {
  if (typeof window === 'undefined') return;
  const merged = { ...getLegCacheSnapshot(), ...entries };
  try { window.localStorage.setItem(LS_KEY, JSON.stringify(merged)); } catch { /* 쿼터 초과 — 표시는 추정 유지 */ }
  cacheRaw = undefined;
  cacheVal = merged;      // 저장 실패 시에도 이번 세션 화면에는 반영
  cacheRaw = window.localStorage.getItem(LS_KEY);
  listeners.forEach(l => l());
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
