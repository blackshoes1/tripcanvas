'use client';
// 클라우드 동기화 배선 — 로그인·병합·업로드·충돌을 한 훅으로 묶는다.
// 판정은 domain, 네트워크는 services/cloudSync, 여기는 React와 잇는 일만 한다 (§27).
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { pullPriceSnapshots } from '@/features/pricing/services/priceCloud';
import { getPriceStoreSnapshot, replacePriceStore } from '@/features/pricing/services/localPriceStore';
import { newTrip, newTripId } from '@/features/trip/domain/tripEditor';
import { getTripStoreSnapshot } from '@/features/trip/services/localTripStore';
import type { Trip } from '@/features/trip/domain/types';
import { todayISO } from '@/lib/date/today';
import { resolveConflict, type Conflict } from '../domain/conflictResolve';
import { isSettled, staleTrips, syncLabel } from '../domain/syncDecisions';
import {
  cancelSyncRetries, cloudDelete, retryPendingSync, syncOnLogin, syncStaleTrips,
  syncTripCloud, type SyncHooks
} from '../services/cloudSync';
import {
  getSyncMeta, persistSyncMeta, refreshSyncMetaFromStorage, statusOf, subscribeSyncMeta
} from '../services/syncMetaStore';
import { useCloudAuth, type CloudUser } from './useCloudAuth';
import { cloudApi, cloudSessionVersion } from '../services/tripCanvasClient';

/** 편집이 멈춘 뒤 이만큼 기다렸다 올린다 (레거시 cloudSyncActive와 같은 800ms) */
const UPLOAD_DEBOUNCE = 800;

export function useCloudSync(
  trips: Trip[],
  activeTripId: string | null,
  replaceTrips: (trips: Trip[], activeId?: string) => boolean,
  onNotice: (msg: string) => void
) {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [access, setAccess] = useState<{ userId: string; roles: Record<string, string> } | null>(null);

  // 콜백은 최신 값을 봐야 하지만 참조는 안정적이어야 한다(엔진에 넘겨 두므로)
  const tripsRef = useRef(trips);
  const noticeRef = useRef(onNotice);
  const replaceRef = useRef(replaceTrips);
  useEffect(() => {
    tripsRef.current = trips;
    noticeRef.current = onNotice;
    replaceRef.current = replaceTrips;
  });

  // 엔진에 넘겨 두는 콜백 묶음 — 참조가 안정적이어야 이펙트가 매 렌더 다시 돌지 않는다.
  // 내부에서 ref를 읽는 것은 호출 시점이라 렌더 중 접근이 아니다.
  const hooks = useMemo<SyncHooks>(() => ({
    onConflict: c => setConflicts(prev => [...prev, c]),
    onNotice: msg => noticeRef.current(msg),
    applyTrips: next => replaceRef.current(next),
    getTrips: () => getTripStoreSnapshot()?.trips ?? []
  }), []);

  const onAccountSwitch = useCallback((_user: CloudUser) => {
    cancelSyncRetries();
    setConflicts([]);
    const version = cloudSessionVersion();
    void (async () => {
      await syncOnLogin(hooks);
      if (version !== cloudSessionVersion()) return;
      // 서버 cron·다른 기기가 남긴 가격 관측을 합친다 (실패해도 동기화는 유효)
      try {
        const merged = await pullPriceSnapshots(hooks.getTrips(), getPriceStoreSnapshot());
        if (merged && version === cloudSessionVersion()) replacePriceStore(merged);
      } catch (e) {
        console.warn('price.cloud-pull 실패:', e instanceof Error ? e.message : e);
      }
    })();
  }, [hooks]);

  const auth = useCloudAuth(onAccountSwitch);
  useEffect(() => () => cancelSyncRetries(), []);
  const retry = useCallback(() => retryPendingSync(hooks), [hooks]);

  // 다른 탭이 바꾼 메타를 받아들인다 (안 하면 이 탭이 옛 revision으로 올려 헛충돌을 만든다)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'tripcanvas_sync_v2' || e.key === null) refreshSyncMetaFromStorage();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // 편집이 멎으면 밀린 여행을 전부 올린다 (활성 여행만 올리면 전환 시 편집이 유실된다)
  useEffect(() => {
    if (!auth.user) return;
    const pending = staleTrips(trips, getSyncMeta());
    if (!pending.length) return;
    const id = window.setTimeout(() => { void syncStaleTrips(hooks.getTrips(), hooks); }, UPLOAD_DEBOUNCE);
    return () => window.clearTimeout(id);
  }, [trips, auth.user, hooks]);

  // 온라인으로 돌아오면 밀린 삭제를 밀어내고 밀린 업로드를 마저 올린다
  useEffect(() => {
    if (!auth.user) return;
    const onOnline = () => { void retry(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [auth.user, retry]);

  /** 여행 삭제를 클라우드에도 반영한다 — 안 하면 다음 로그인 병합이 그 여행을 되살린다 */
  const deleteFromCloud = useCallback((id: string, deleted: Trip | null) => {
    cloudDelete(id, deleted, hooks);
  }, [hooks]);

  /** 충돌 하나를 해소한다 */
  const resolve = useCallback((choice: 'cloud' | 'device' | 'both') => {
    const c = conflicts[0];
    if (!c) return;
    const res = resolveConflict(
      tripsRef.current, c,
      choice === 'both' ? { choice, copyId: newTripId() } : { choice },
      () => newTrip('새 여행', todayISO(), newTripId())
    );
    if (res.error) { noticeRef.current(res.error); return; }

    if (res.trips !== tripsRef.current && !replaceRef.current(res.trips, res.activeId ?? undefined)) {
      noticeRef.current('저장에 실패했어요 — 저장 공간을 확인해주세요');
      return;
    }
    if (Object.keys(res.metaPatch).length) {
      Object.assign(getSyncMeta(), res.metaPatch);
      persistSyncMeta();
    }
    setConflicts(prev => prev.slice(1));
    for (const u of res.uploads) void syncTripCloud(u.trip, hooks, { force: u.force });
  }, [conflicts, hooks]);

  // 활성 여행의 동기화 상태를 **값으로** 구독한다. 메타는 제자리에서 고쳐지므로 객체 참조로는
  // 변화를 알 수 없지만, 상태는 문자열이라 스냅샷으로 그대로 쓸 수 있다.
  const activeStatus = useSyncExternalStore(
    subscribeSyncMeta,
    useCallback(() => (activeTripId ? statusOf(activeTripId) : undefined), [activeTripId]),
    () => undefined
  );
  const pendingCount = useSyncExternalStore(
    subscribeSyncMeta,
    () => Object.values(getSyncMeta()).filter(e => !isSettled(e)).length,
    () => 0
  );
  const statusLabel = syncLabel(activeStatus, !!auth.user)
    + (auth.user && pendingCount ? ` · 클라우드 반영 대기 ${pendingCount}개` : '');
  const canRetry = useSyncExternalStore(
    subscribeSyncMeta,
    () => Object.values(getSyncMeta()).some(e => e.status === 'error' || e.status === 'delete-error'),
    () => false
  );
  const remote = activeTripId ? !!getSyncMeta()[activeTripId]?.revision : false;
  useEffect(() => {
    const user = auth.user;
    if (!user) return;
    let alive = true;
    const refresh = async () => {
      const { data, error } = await cloudApi.me();
      if (alive) setAccess({ userId: user.id, roles: !error && data ? Object.fromEntries(data.trips.map(t => [t.id, t.role])) : {} });
    };
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { alive = false; window.removeEventListener('focus', refresh); };
  }, [auth.user, activeTripId, remote]);
  const role = auth.user && remote
    ? (access?.userId === auth.user.id ? access.roles[activeTripId!] : null)
    : 'OWNER';

  return {
    user: auth.user,
    available: auth.available,
    signIn: auth.signIn,
    signOut: auth.signOut,
    canEdit: role === 'OWNER' || role === 'EDITOR',
    canDelete: role === 'OWNER',
    statusLabel,
    retry: auth.user && canRetry ? retry : undefined,
    conflict: conflicts[0] ?? null,
    remainingConflicts: Math.max(0, conflicts.length - 1),
    resolve,
    deleteFromCloud
  };
}
