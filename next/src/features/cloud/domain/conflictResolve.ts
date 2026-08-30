// 동기화 충돌 해소 — 순수(§9). 레거시 replaceWithRemote/syncUseDevice/syncKeepCopy와 같은 결과.
//
// 세 갈래 모두 **로컬을 조용히 버리지 않는다**: 클라우드를 택해도 그 선택은 사용자가 한 것이고,
// '둘 다 보관'은 로컬을 복사본으로 남긴다.
import legacyLib from '@legacy/lib.js';
import legacySync from '@legacy/sync.js';

import type { Trip } from '@/features/trip/domain/types';
import type { SyncEntry } from '../services/syncMetaStore';

const { validateTripPayload } = legacyLib;
const { hashTrip } = legacySync;

export interface Conflict {
  kind: 'remote-missing' | 'remote-deleted' | 'changed-both';
  local: Trip | null;
  remote: Trip | null;
  revision: number | null;
  deleted_at: string | null;
}

export type Resolution =
  /** 클라우드 버전을 쓴다 (원격이 삭제였으면 로컬에서도 지운다) */
  | { choice: 'cloud' }
  /** 이 기기 버전을 쓴다 — force 업로드로 원격을 덮는다 */
  | { choice: 'device' }
  /** 둘 다 — 클라우드를 받고 로컬은 복사본으로 남긴다 */
  | { choice: 'both'; copyId: string };

export interface ResolveResult {
  trips: Trip[];
  /** 이 여행의 메타를 이렇게 바꾼다 (없으면 그대로) */
  metaPatch: Record<string, SyncEntry>;
  /** 해소 후 올려야 할 여행 (force 여부 포함) */
  uploads: { trip: Trip; force: boolean }[];
  /** 활성 여행을 이걸로 옮긴다 */
  activeId: string | null;
  error?: string;
}

/** 클라우드 데이터를 로컬 목록에 반영한다 — 검증을 통과하지 못하면 아무것도 바꾸지 않는다 */
function takeRemote(trips: Trip[], c: Conflict): { trips: Trip[]; remote: Trip | null } | { error: string } {
  let remote: Trip | null = null;
  if (c.remote) {
    const r = validateTripPayload(c.remote) as { ok: true; value: Trip } | { ok: false; error: string };
    if (!r.ok) return { error: '클라우드 데이터가 손상되어 적용하지 않았습니다' };
    remote = r.value;
  }
  const id = c.local?.id ?? remote?.id ?? '';
  const next = trips.filter(t => t.id !== id);
  // 원격이 tombstone이면 받아올 내용이 없다 → 로컬에서도 빠진다
  if (remote && !c.deleted_at) next.push(remote);
  return { trips: next, remote };
}

/**
 * 충돌 하나를 해소한다.
 * @param newTrip 목록이 비어버릴 때 넣을 새 여행 (마지막 여행이 사라지는 상태를 만들지 않는다)
 */
export function resolveConflict(
  trips: Trip[], c: Conflict, res: Resolution, newTrip: () => Trip
): ResolveResult {
  const base: ResolveResult = { trips, metaPatch: {}, uploads: [], activeId: null };

  if (res.choice === 'device') {
    // 로컬을 그대로 두고 force로 원격을 덮는다. 메타는 업로드 결과가 정한다.
    if (!c.local) return { ...base, error: '이 기기에 남은 버전이 없습니다' };
    return { ...base, uploads: [{ trip: c.local, force: true }] };
  }

  const taken = takeRemote(trips, c);
  if ('error' in taken) return { ...base, error: taken.error };
  let next = taken.trips;
  const uploads: ResolveResult['uploads'] = [];
  let activeId: string | null = null;

  if (res.choice === 'both' && c.local) {
    const copy: Trip = JSON.parse(JSON.stringify(c.local));
    copy.id = res.copyId;
    copy.name = `${c.local.name || '여행'} (충돌 복사본)`;
    next = [...next, copy];
    uploads.push({ trip: copy, force: false });
    activeId = copy.id;
  }

  // 마지막 여행이 사라지면 빈 저장소가 된다 — 복구 경로가 없어지므로 새 여행을 채운다
  if (!next.length) {
    const fresh = newTrip();
    next = [fresh];
    activeId = activeId ?? fresh.id;
  }

  const metaPatch: Record<string, SyncEntry> = {};
  const id = c.local?.id ?? c.remote?.id;
  if (id) {
    metaPatch[id] = {
      revision: c.revision,
      status: c.deleted_at ? 'tombstoned' : 'clean',
      op: '',
      hash: taken.remote ? hashTrip(taken.remote) : ''
    };
  }
  return { trips: next, metaPatch, uploads, activeId };
}
