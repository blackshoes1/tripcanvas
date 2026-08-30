// 여행 저장소 접근 (§18 repository) — 레거시와 같은 localStorage(tripcanvas_v1)를 읽고 쓴다.
// 병행 운영의 핵심: 두 앱이 같은 데이터를 보되, 유입 검증(parseStorePayload)과
// 정규화(normalizeTrip)를 반드시 거쳐 서로의 데이터를 깨지 않는다.
// useSyncExternalStore 계약: 스냅샷은 캐시해 참조 안정성을 보장하고, 변경 시에만 무효화한다.
import legacyLib from '@legacy/lib.js';

import type { Trip } from '@/features/trip/domain/types';

const LS_KEY = 'tripcanvas_v1';

export interface TripStore {
  trips: Trip[];
  activeId: string;
}

// 스냅샷 캐시 — raw 문자열이 같으면 같은 객체를 돌려준다(참조 안정성). 같은 탭에서
// 저장소가 바뀌면(레거시 앱·편집기) raw가 달라져 자동으로 다시 파싱한다(신선도).
let cacheRaw: string | null | undefined;
let cacheVal: TripStore | null = null;
const listeners = new Set<() => void>();
let storageAttached = false;

export function getTripStoreSnapshot(): TripStore | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(LS_KEY);
  if (cacheRaw === undefined || raw !== cacheRaw) {
    cacheRaw = raw;
    const parsed = legacyLib.parseStorePayload(raw);
    cacheVal = parsed.ok ? (parsed.value as TripStore) : null;
  }
  return cacheVal;
}

export function getTripStoreServerSnapshot(): TripStore | null {
  return null;   // SSR에는 저장소가 없다 — 클라이언트 hydration 후 로드
}

function emit() {
  cacheRaw = undefined;
  listeners.forEach(l => l());
}

export function subscribeTripStore(cb: () => void): () => void {
  listeners.add(cb);
  if (!storageAttached && typeof window !== 'undefined') {
    storageAttached = true;
    window.addEventListener('storage', e => { if (e.key === LS_KEY || e.key === null) emit(); });
  }
  return () => { listeners.delete(cb); };
}

/** 저장소 전체를 되쓴다 — 여행 추가·전환·삭제처럼 목록 자체가 바뀔 때 */
function writeStore(next: TripStore): boolean {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(next));
    emit();
    return true;
  } catch {
    return false;   // 쿼터 초과 등 — 호출측이 실패를 알린다
  }
}

/**
 * 새 여행을 넣고 활성으로 — 정규화를 통과 못 하면 넣지 않는다.
 * 저장소가 아직 없으면(첫 방문·초기화 직후) 여기서 만든다 — 안 그러면 첫 여행을 영영 못 만든다.
 */
export function addTrip(trip: Trip): boolean {
  if (typeof window === 'undefined') return false;
  const normalized = legacyLib.normalizeTrip(trip) as Trip | null;
  if (!normalized) return false;
  const store = getTripStoreSnapshot() ?? { trips: [], activeId: '' };
  return writeStore({ trips: [...store.trips, normalized], activeId: normalized.id });
}

/** 활성 여행 전환 */
export function switchTrip(id: string): boolean {
  if (typeof window === 'undefined') return false;
  const store = getTripStoreSnapshot();
  if (!store || !store.trips.some(t => t.id === id)) return false;
  return writeStore({ ...store, activeId: id });
}

/**
 * 여행 삭제. 마지막 하나는 지우지 않는다 — 빈 저장소가 되면 레거시·Next 양쪽에서
 * '여행이 없어요' 상태로 떨어져 복구 경로가 사라진다.
 * 활성 여행을 지우면 남은 첫 여행으로 옮겨간다.
 */
export function removeTrip(id: string): boolean {
  if (typeof window === 'undefined') return false;
  const store = getTripStoreSnapshot();
  if (!store || store.trips.length <= 1) return false;
  const trips = store.trips.filter(t => t.id !== id);
  if (trips.length === store.trips.length) return false;
  return writeStore({ trips, activeId: store.activeId === id ? trips[0].id : store.activeId });
}

/** 한 여행만 정규화해 되쓴다 — 다른 여행·필드는 건드리지 않는다 */
export function saveTrip(updated: Trip): boolean {
  if (typeof window === 'undefined') return false;
  const store = getTripStoreSnapshot();
  if (!store) return false;
  const normalized = legacyLib.normalizeTrip(updated) as Trip | null;
  if (!normalized) return false;
  const i = store.trips.findIndex(t => t.id === normalized.id);
  if (i < 0) return false;
  return writeStore({ ...store, trips: store.trips.map((t, k) => (k === i ? normalized : t)) });
}
