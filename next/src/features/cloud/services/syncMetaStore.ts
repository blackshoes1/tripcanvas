'use client';
// 동기화 메타 (tripcanvas_sync_v2) — 레거시와 같은 키·같은 모양. 판정은 sync.js(TC_SYNC)가 한다.
//
// ⚠️ 이 값은 탭마다의 메모리 사본이다. 갱신하지 않으면 이 탭이 옛 revision으로 업로드해
// 헛충돌을 만든다(레거시가 같은 이유로 refreshSyncMetaFromStorage를 둔다).
// 단, **업로드가 떠 있는 동안에는 통째로 갈아끼우지 않는다** — 응답을 기다리는 entry 참조가 끊긴다.
import legacySync from '@legacy/sync.js';

const META_KEY = 'tripcanvas_sync_v2';
/** v1 호환: id 배열을 v2 meta로 한 번 흡수한다 (레거시와 동일) */
const V1_KEY = 'tripcanvas_synced';

export type SyncStatus =
  | 'new' | 'clean' | 'dirty' | 'syncing' | 'conflict' | 'error'
  | 'delete-pending' | 'delete-error' | 'tombstoned' | 'legacy';

export interface SyncEntry {
  revision: number | null;
  status: SyncStatus;
  /** 삭제 작업 식별자 — 늦게 온 응답이 새 삭제를 덮지 않게 */
  op: string;
  /** 마지막으로 올린 내용의 지문 */
  hash: string;
}

export type SyncMeta = Record<string, SyncEntry>;

const listeners = new Set<() => void>();
let meta: SyncMeta | null = null;
/** 바뀔 때마다 오르는 번호 — 메타는 제자리에서 고쳐지므로 참조로는 변화를 알 수 없다.
 *  구독자가 이 값을 스냅샷으로 삼아 다시 그린다(useSyncExternalStore 계약). */
let version = 0;
/** 진행 중인 업로드 수 — 이 사이엔 저장소에서 통째로 다시 읽지 않는다 */
let inFlight = 0;
let staleRefresh = false;

function v1Ids(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(V1_KEY) ?? 'null') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function readFromStorage(): SyncMeta {
  return legacySync.loadMeta(window.localStorage.getItem(META_KEY), v1Ids()) as SyncMeta;
}

/** 지금 이 탭이 보는 메타 (없으면 저장소에서 읽어 만든다) */
export function getSyncMeta(): SyncMeta {
  if (typeof window === 'undefined') return {};
  if (!meta) meta = readFromStorage();
  return meta;
}

/** 그 여행의 항목 — 없으면 만들어 넣는다 (레거시 syncEntry와 동일) */
export function syncEntry(id: string): SyncEntry {
  const m = getSyncMeta();
  return m[id] ?? (m[id] = { revision: null, status: 'new', op: '', hash: '' });
}

export function persistSyncMeta(): void {
  if (typeof window === 'undefined' || !meta) return;
  try { window.localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* 쿼터 — 다음 저장에서 다시 */ }
  version++;
  listeners.forEach(l => l());
}

/** 병합 결과처럼 메타를 통째로 갈아끼울 때 */
export function replaceSyncMeta(next: SyncMeta): void {
  meta = next;
  persistSyncMeta();
}

/**
 * 다른 탭이 바꾼 메타를 받아들인다. 업로드가 떠 있으면 미뤘다가 끝난 뒤에 한다 —
 * 지금 갈아끼우면 응답을 기다리는 entry 객체가 저장소의 새 객체와 달라져 결과가 유실된다.
 */
export function refreshSyncMetaFromStorage(): void {
  if (typeof window === 'undefined') return;
  if (inFlight) { staleRefresh = true; return; }
  staleRefresh = false;
  meta = readFromStorage();
  version++;
  listeners.forEach(l => l());
}

/** 지금 메타의 버전 (useSyncExternalStore 스냅샷) */
export function getSyncMetaVersion(): number {
  return version;
}

export function getSyncMetaServerVersion(): number {
  return 0;
}

/** 그 여행의 상태만 (라벨 계산용 — 항목 객체는 제자리에서 바뀌므로 값만 꺼낸다) */
export function statusOf(id: string): SyncStatus | undefined {
  if (typeof window === 'undefined') return undefined;
  return getSyncMeta()[id]?.status;
}

/** 업로드 하나를 시작/끝낸다 — 끝날 때 미뤄둔 갱신을 처리한다 */
export function beginInFlight(): void { inFlight++; }
export function endInFlight(): void {
  inFlight = Math.max(0, inFlight - 1);
  if (!inFlight && staleRefresh) refreshSyncMetaFromStorage();
}

export function subscribeSyncMeta(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** 테스트·초기화용 — 메모리 사본을 버린다 */
export function _resetSyncMeta(): void {
  meta = null;
  inFlight = 0;
  staleRefresh = false;
  version++;
}
