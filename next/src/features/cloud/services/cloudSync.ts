'use client';
// 클라우드 동기화 엔진 — 레거시 syncTripCloud/performCloudDelete/syncOnLogin과 같은 규칙.
// 병합 판정은 sync.js(TC_SYNC), 그 위의 결정은 domain/syncDecisions, 여기는 네트워크와 배선만.
//
// 낙관적 동시성(CAS): 서버는 우리가 읽은 revision과 현재 revision이 다르면 conflict를 준다.
// 실패해도 로컬 편집은 절대 버리지 않는다.
import legacyCollab from '@legacy/collab.js';
import legacyLib from '@legacy/lib.js';
import legacySync from '@legacy/sync.js';

import type { Trip } from '@/features/trip/domain/types';
import { canUpload, mergeInput, pendingDeletes, SAMPLE_TRIP_ID, uploadable } from '../domain/syncDecisions';
import { snapshotTrip } from './tripSnapshots';
import { cloudApi, cloudSessionVersion, hasCloudSession } from './tripCanvasClient';
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

export interface SyncHooks {
  onConflict: (c: SyncConflict) => void;
  onNotice: (msg: string, kind?: 'ok' | 'warn' | 'error') => void;
  /** 병합 결과를 저장소에 반영 — 실패하면 false */
  applyTrips: (trips: Trip[]) => boolean;
  /** 비동기 응답 이후에는 호출 때의 배열 대신 현재 저장소를 읽는다. */
  getTrips: () => Trip[];
}

const uploads = new Set<string>();
const deletes = new Set<string>();
const retries = new Map<string, { attempts: number; timer?: ReturnType<typeof setTimeout> }>();
const RETRY_DELAYS = [15_000, 30_000, 60_000];
const currentSession = (version: number) => hasCloudSession() && cloudSessionVersion() === version;

function clearRetry(key: string): void {
  clearTimeout(retries.get(key)?.timer);
  retries.delete(key);
}

/** 계정 전환·화면 종료와 명시적 재시도는 이전 재시도 예약을 취소한다. */
export function cancelSyncRetries(): void {
  for (const key of retries.keys()) clearRetry(key);
}

function scheduleRetry(id: string, version: number, error: unknown, hooks: SyncHooks): void {
  const status = Number((error as { status?: number } | null)?.status) || 0;
  if (status && status !== 429 && status < 500) return;
  const key = `${version}:${id}`;
  const retry = retries.get(key) ?? { attempts: 0 };
  if (retry.timer || retry.attempts >= RETRY_DELAYS.length) return;
  retry.timer = setTimeout(() => {
    retry.timer = undefined;
    if (!currentSession(version)) { clearRetry(key); return; }
    const entry = getSyncMeta()[id];
    if (entry?.status === 'delete-error' || entry?.status === 'delete-pending') {
      void performCloudDelete(id, entry.op, null, hooks);
    } else if (entry?.status === 'error') {
      const trip = hooks.getTrips().find(t => t.id === id);
      if (trip) void syncTripCloud(trip, hooks);
    }
  }, RETRY_DELAYS[retry.attempts++]);
  retries.set(key, retry);
}

export async function retryPendingSync(hooks: SyncHooks): Promise<void> {
  cancelSyncRetries();
  const version = cloudSessionVersion();
  await reconcileUndoDeletes(hooks.getTrips(), hooks);
  if (!currentSession(version)) return;
  await flushPendingSync(hooks);
  if (currentSession(version)) await syncStaleTrips(hooks.getTrips(), hooks);
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
  if (!hasCloudSession() || !trip) return;
  const entry = syncEntry(trip.id);
  const force = !!opts.force;
  // 아직 클라우드에 없는 샘플 여행은 올리지 않는다 (계정마다 데모가 하나씩 생긴다)
  if (!uploadable(trip, entry)) return;
  if (!canUpload(entry, force)) return;

  const version = cloudSessionVersion(), key = `${version}:${trip.id}`;
  if (uploads.has(key)) return;
  const sent: Trip = JSON.parse(JSON.stringify(trip));
  const sentHash = hashTrip(sent);
  const current = () => currentSession(version) && getSyncMeta()[trip.id] === entry;
  let uploaded = false;
  uploads.add(key);

  entry.status = 'syncing';
  persistSyncMeta();
  beginInFlight();
  try {
    const row = await cloudApi.sync.save(trip.id, sent, entry.revision, force);
    if (!current()) {
      const pending = getSyncMeta()[trip.id];
      if (currentSession(version) && pending && ['delete-pending', 'delete-error'].includes(pending.status)
          && pending.revision === entry.revision && row && !row.conflict) {
        pending.revision = Number(row.revision) || 1;
        persistSyncMeta();
      }
      return;
    }
    if (!row) throw new Error('empty sync response');
    if (row.conflict) {
      clearRetry(key);
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
    const latest = hooks.getTrips().find(t => t.id === trip.id);
    entry.status = latest && hashTrip(latest) !== sentHash ? 'dirty' : 'clean';
    entry.op = '';
    entry.hash = sentHash;
    uploaded = true;
    clearRetry(key);
    persistSyncMeta();
    // 올라간 시점이 되돌릴 수 있는 지점이다 (여행별 10분에 한 번, 실패해도 업로드는 유효)
    void snapshotTrip(sent);
  } catch (e) {
    if (!current()) return;
    if (legacyCollab.isForbiddenError(e)) {
      clearRetry(key);
      // 보기 권한·내보내진 멤버 — 재시도 루프에 넣지 않는다. 로컬 편집은 그대로 남는다
      entry.status = 'forbidden';
      persistSyncMeta();
      hooks.onNotice(legacyCollab.forbiddenText(e, null), 'error');
      return;
    }
    entry.status = 'error';
    persistSyncMeta();
    console.warn('cloud.sync 실패:', e instanceof Error ? e.message : e);
    hooks.onNotice('클라우드 저장 실패 — 편집은 보존됐어요. 다시 저장을 눌러 재시도할 수 있어요', 'error');
    scheduleRetry(trip.id, version, e, hooks);
  } finally {
    uploads.delete(key);
    endInFlight();
    const pending = getSyncMeta()[trip.id];
    if (currentSession(version) && pending && ['delete-pending', 'delete-error'].includes(pending.status)) {
      await performCloudDelete(trip.id, pending.op, null, hooks);
    } else if (uploaded && current()) {
      const latest = hooks.getTrips().find(t => t.id === trip.id);
      if (latest && hashTrip(latest) !== entry.hash) await syncTripCloud(latest, hooks);
    }
  }
}

/** 밀린 여행을 전부 올린다 (활성 여행만 올리면 전환 시 편집이 유실된다) */
export async function syncStaleTrips(trips: Trip[], hooks: SyncHooks): Promise<void> {
  if (!hasCloudSession()) return;
  const version = cloudSessionVersion();
  const meta = getSyncMeta();
  for (const t of trips) {
    if (!currentSession(version)) return;
    const latest = hooks.getTrips().find(item => item.id === t.id);
    if (!latest) continue;
    const entry = meta[t.id];
    if (!entry || entry.hash !== hashTrip(latest)) await syncTripCloud(latest, hooks);
  }
}

/** 삭제를 먼저 로컬에 표시하고(오프라인이어도) 가능하면 클라우드에 반영한다 */
export function cloudDelete(clientId: string, deleted: Trip | null, hooks: SyncHooks): void {
  const op = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  beginDelete(getSyncMeta(), clientId, op);
  persistSyncMeta();
  if (hasCloudSession()) void performCloudDelete(clientId, op, deleted, hooks);
}

export async function performCloudDelete(
  clientId: string, op: string, deleted: Trip | null, hooks: SyncHooks
): Promise<void> {
  if (!hasCloudSession()) return;
  const version = cloudSessionVersion(), key = `${version}:${clientId}`;
  if (deletes.has(key) || uploads.has(key)) return;
  deletes.add(key);
  const entry = syncEntry(clientId);
  beginInFlight();
  try {
    const row = await cloudApi.sync.tombstone(clientId, entry.revision);
    if (!currentSession(version)) return;
    if (row?.conflict) {
      clearRetry(key);
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
    clearRetry(key);
    persistSyncMeta();
    // 그 사이 새 삭제가 시작됐으면(op 불일치) 이 응답은 낡았다 — 재업로드로 정리한다
    if (result.resync) {
      const restored = hooks.getTrips().find(t => t.id === clientId);
      if (restored) await syncTripCloud(restored, hooks);
    }
  } catch (e) {
    if (!currentSession(version) || getSyncMeta()[clientId] !== entry) return;
    if (legacyCollab.isForbiddenError(e)) {
      clearRetry(key);
      entry.status = 'forbidden';
      persistSyncMeta();
      hooks.onNotice(legacyCollab.forbiddenText(e, null), 'error');
      return;
    }
    entry.status = 'delete-error';
    entry.op = op;
    persistSyncMeta();
    console.warn('cloud.delete 실패:', e instanceof Error ? e.message : e);
    hooks.onNotice('삭제 동기화 실패 — 다시 저장을 눌러 재시도할 수 있어요', 'error');
    scheduleRetry(clientId, version, e, hooks);
  } finally {
    deletes.delete(key);
    endInFlight();
  }
}

/** 밀린 삭제를 밀어낸다 (온라인 복귀·로그인 직후) */
export async function flushPendingSync(hooks: SyncHooks): Promise<void> {
  if (!hasCloudSession()) return;
  const version = cloudSessionVersion();
  for (const { id, op } of pendingDeletes(getSyncMeta())) {
    if (!currentSession(version)) return;
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
  if (hasCloudSession()) for (const t of revived) await syncTripCloud(t, hooks);
}

/**
 * 로그인 직후 병합. 서버 revision과 로컬이 읽은 revision을 비교해 **안전한 변경만** 자동 적용하고,
 * 나머지는 conflict로 남겨 사용자가 고르게 한다. 유입 데이터는 전부 검증을 통과해야 한다.
 */
export async function syncOnLogin(hooks: SyncHooks): Promise<void> {
  if (!hasCloudSession()) return;
  const version = cloudSessionVersion();
  try {
    const { data: rows, error } = await cloudApi.sync.list();
    if (!currentSession(version)) return;
    if (error) throw error;

    const merged = mergeForLogin(mergeInput(hooks.getTrips(), rows ?? []), rows ?? [], getSyncMeta());

    // 클라우드에서 온 여행도 정규화·검증을 통과해야 한다 (§유입 데이터)
    const checked = merged.trips.map(t => validateTripPayload(t));
    if (checked.some(r => !r.ok)) throw new Error('invalid cloud payload');
    const trips = checked.map(r => (r as { ok: true; value: Trip }).value);

    if (!hooks.applyTrips(trips)) {
      hooks.onNotice('클라우드 데이터를 저장하지 못했어요 — 저장 공간을 확인해주세요', 'error');
      return;
    }
    for (const trip of trips) {
      const entry = merged.meta[trip.id];
      if (entry?.status === 'clean') entry.hash = hashTrip(trip);
    }
    replaceSyncMeta(merged.meta as SyncMeta);
    for (const c of merged.conflicts) hooks.onConflict(c as SyncConflict);
    for (const a of merged.actions) {
      if (!currentSession(version)) return;
      if ((a.trip as { id?: string }).id === SAMPLE_TRIP_ID) continue;   // 샘플은 병합 뒤에도 올리지 않는다
      const latest = hooks.getTrips().find(t => t.id === a.trip.id);
      if (latest) await syncTripCloud(latest, hooks, { force: a.force });
    }
    if (!currentSession(version)) return;
    await flushPendingSync(hooks);

    hooks.onNotice(
      merged.conflicts.length
        ? `동기화 충돌 ${merged.conflicts.length}건 — 버전을 골라주세요`
        : `클라우드 동기화 완료 · 여행 ${trips.length}개`,
      merged.conflicts.length ? 'warn' : 'ok'
    );
  } catch (e) {
    if (!currentSession(version)) return;
    console.warn('cloud.login-sync 실패:', e instanceof Error ? e.message : e);
    hooks.onNotice('클라우드 동기화 실패 — 로컬로 계속 사용합니다', 'error');
  }
}
