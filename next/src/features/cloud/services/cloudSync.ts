'use client';
// 클라우드 동기화 엔진 — 레거시 syncTripCloud/performCloudDelete/syncOnLogin과 같은 규칙.
// 병합 판정은 sync.js(TC_SYNC), 그 위의 결정은 domain/syncDecisions, 여기는 네트워크와 배선만.
//
// 낙관적 동시성(CAS): 서버는 우리가 읽은 revision과 현재 revision이 다르면 conflict를 준다.
// 실패해도 로컬 편집은 절대 버리지 않는다.
import legacyLib from '@legacy/lib.js';
import legacySync from '@legacy/sync.js';

import type { Trip } from '@/features/trip/domain/types';
import { canUpload, pendingDeletes } from '../domain/syncDecisions';
import { supabase } from './supabaseClient';
import {
  beginInFlight, endInFlight, getSyncMeta, persistSyncMeta, replaceSyncMeta,
  syncEntry, type SyncMeta
} from './syncMetaStore';

const { hashTrip, mergeForLogin, beginDelete, finishDelete, undoDelete } = legacySync;
const { validateTripPayload } = legacyLib;

export interface SyncConflict {
  kind: 'remote-missing' | 'remote-deleted' | 'changed-both';
  local: Trip | null;
  remote: Trip | null;
  revision: number | null;
  deleted_at: string | null;
}

interface RpcRow {
  applied: boolean;
  conflict: boolean;
  revision: number | string;
  data: unknown;
  deleted_at: string | null;
}

/** RPC는 table을 돌려주므로 첫 행만 쓴다 (레거시 rpcRow와 동일) */
async function rpcRow(name: string, args: Record<string, unknown>): Promise<RpcRow | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as RpcRow | null;
}

export interface SyncHooks {
  onConflict: (c: SyncConflict) => void;
  onNotice: (msg: string, kind?: 'ok' | 'warn' | 'error') => void;
  /** 병합 결과를 저장소에 반영 — 실패하면 false */
  applyTrips: (trips: Trip[]) => boolean;
}

/**
 * 여행 하나를 올린다.
 *
 * ⚠️ 충돌이 나면 entry.revision(로컬이 파생된 base)을 **그대로 둔다**. 서버 revision을
 * stamp하면 미해결 충돌이 다음 병합에서 '안전한 업로드'로 둔갑해 원격본을 조용히 날린다.
 */
export async function syncTripCloud(
  trip: Trip, hooks: SyncHooks, opts: { force?: boolean } = {}
): Promise<void> {
  const sb = supabase();
  if (!sb || !trip) return;
  const entry = syncEntry(trip.id);
  const force = !!opts.force;
  if (!canUpload(entry, force)) return;

  entry.status = 'syncing';
  persistSyncMeta();
  beginInFlight();
  try {
    const row = await rpcRow('sync_trip', {
      p_client_id: trip.id, p_data: trip, p_expected_revision: entry.revision, p_force: force
    });
    if (!row) throw new Error('empty sync response');
    if (row.conflict) {
      entry.status = 'conflict';
      persistSyncMeta();
      hooks.onConflict({
        kind: row.deleted_at ? 'remote-deleted' : 'changed-both',
        local: trip, remote: (row.data as Trip) ?? null,
        revision: Number(row.revision) || entry.revision, deleted_at: row.deleted_at
      });
      return;
    }
    entry.revision = Number(row.revision) || 1;
    entry.status = 'clean';
    entry.op = '';
    entry.hash = hashTrip(trip);
    persistSyncMeta();
  } catch (e) {
    entry.status = 'error';
    persistSyncMeta();
    console.warn('cloud.sync 실패:', e instanceof Error ? e.message : e);
    hooks.onNotice('클라우드 저장 실패 — 로컬 편집은 보존됐어요', 'error');
  } finally {
    endInFlight();
  }
}

/** 밀린 여행을 전부 올린다 (활성 여행만 올리면 전환 시 편집이 유실된다) */
export async function syncStaleTrips(trips: Trip[], hooks: SyncHooks): Promise<void> {
  const sb = supabase();
  if (!sb) return;
  const meta = getSyncMeta();
  for (const t of trips) {
    const entry = meta[t.id];
    if (!entry || entry.hash !== hashTrip(t)) await syncTripCloud(t, hooks);
  }
}

/** 삭제를 먼저 로컬에 표시하고(오프라인이어도) 가능하면 클라우드에 반영한다 */
export function cloudDelete(clientId: string, deleted: Trip | null, hooks: SyncHooks): void {
  const op = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  beginDelete(getSyncMeta(), clientId, op);
  persistSyncMeta();
  if (supabase()) void performCloudDelete(clientId, op, deleted, hooks);
}

export async function performCloudDelete(
  clientId: string, op: string, deleted: Trip | null, hooks: SyncHooks
): Promise<void> {
  const entry = syncEntry(clientId);
  beginInFlight();
  try {
    const row = await rpcRow('tombstone_trip', {
      p_client_id: clientId, p_expected_revision: entry.revision, p_force: false
    });
    if (row?.conflict) {
      entry.status = 'conflict';          // base revision 유지 — 위와 같은 이유
      persistSyncMeta();
      hooks.onConflict({
        kind: row.deleted_at ? 'remote-deleted' : 'changed-both',
        local: deleted, remote: (row.data as Trip) ?? null,
        revision: Number(row.revision) || entry.revision, deleted_at: row.deleted_at
      });
      return;
    }
    const result = finishDelete(getSyncMeta(), clientId, op, Number(row?.revision) || entry.revision || 1);
    persistSyncMeta();
    // 그 사이 새 삭제가 시작됐으면(op 불일치) 이 응답은 낡았다 — 재업로드로 정리한다
    if (result.resync) hooks.onNotice('삭제 동기화가 엇갈려 다시 맞췄어요', 'warn');
  } catch (e) {
    entry.status = 'delete-error';
    entry.op = op;
    persistSyncMeta();
    console.warn('cloud.delete 실패:', e instanceof Error ? e.message : e);
    hooks.onNotice('삭제 동기화 실패 — 온라인이 되면 다시 시도합니다', 'error');
  } finally {
    endInFlight();
  }
}

/** 밀린 삭제를 밀어낸다 (온라인 복귀·로그인 직후) */
export async function flushPendingSync(hooks: SyncHooks): Promise<void> {
  if (!supabase()) return;
  for (const { id, op } of pendingDeletes(getSyncMeta())) {
    await performCloudDelete(id, op, null, hooks);
  }
}

/** 되살아난 여행은 삭제 표시를 걷고 반드시 재업로드한다 */
export async function reconcileUndoDeletes(trips: Trip[], hooks: SyncHooks): Promise<void> {
  const meta = getSyncMeta();
  const revived: Trip[] = [];
  for (const t of trips) {
    const s = meta[t.id]?.status;
    if (s === 'delete-pending' || s === 'delete-error' || s === 'tombstoned') {
      undoDelete(meta, t.id);
      revived.push(t);
    }
  }
  if (!revived.length) return;
  persistSyncMeta();
  if (supabase()) for (const t of revived) await syncTripCloud(t, hooks);
}

/**
 * 로그인 직후 병합. 서버 revision과 로컬이 읽은 revision을 비교해 **안전한 변경만** 자동 적용하고,
 * 나머지는 conflict로 남겨 사용자가 고르게 한다. 유입 데이터는 전부 검증을 통과해야 한다.
 */
export async function syncOnLogin(localTrips: Trip[], hooks: SyncHooks): Promise<void> {
  const sb = supabase();
  if (!sb) return;
  try {
    const { data: rows, error } = await sb
      .from('trips')
      .select('client_id,data,revision,deleted_at,updated_at');
    if (error) throw error;

    const merged = mergeForLogin(localTrips, rows ?? [], getSyncMeta());
    replaceSyncMeta(merged.meta as SyncMeta);

    // 클라우드에서 온 여행도 정규화·검증을 통과해야 한다 (§유입 데이터)
    const checked = merged.trips.map(t => validateTripPayload(t));
    if (checked.some(r => !r.ok)) throw new Error('invalid cloud payload');
    const trips = checked.map(r => (r as { ok: true; value: Trip }).value);

    if (trips.length && !hooks.applyTrips(trips)) {
      hooks.onNotice('클라우드 데이터를 저장하지 못했어요 — 저장 공간을 확인해주세요', 'error');
      return;
    }
    for (const c of merged.conflicts) hooks.onConflict(c as SyncConflict);
    for (const a of merged.actions) await syncTripCloud(a.trip as unknown as Trip, hooks, { force: a.force });
    await flushPendingSync(hooks);

    hooks.onNotice(
      merged.conflicts.length
        ? `동기화 충돌 ${merged.conflicts.length}건 — 버전을 골라주세요`
        : `클라우드 동기화 완료 · 여행 ${trips.length}개`,
      merged.conflicts.length ? 'warn' : 'ok'
    );
  } catch (e) {
    console.warn('cloud.login-sync 실패:', e instanceof Error ? e.message : e);
    hooks.onNotice('클라우드 동기화 실패 — 로컬로 계속 사용합니다', 'error');
  }
}
