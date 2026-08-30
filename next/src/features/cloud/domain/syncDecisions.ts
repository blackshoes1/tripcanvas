// 동기화 판정 — 순수(§9). 병합 자체는 레거시 sync.js(TC_SYNC)가 단일 소스로 담당하고,
// 여기에는 그 위에서 Next가 내리는 결정만 둔다. 두 앱이 같은 클라우드 행을 다루므로
// 판정이 갈라지면 한쪽이 다른 쪽 편집을 덮어쓴다.
import legacySync from '@legacy/sync.js';

import type { Trip } from '@/features/trip/domain/types';
import type { SyncEntry, SyncMeta, SyncStatus } from '../services/syncMetaStore';

const { hashTrip } = legacySync;

/** 로그인 병합을 돌려야 하는가 — **계정이 바뀐 순간에만**.
 *
 * ⚠️ 토큰 자동 갱신(TOKEN_REFRESHED)에도 병합을 돌리면, 오래 열어둔 탭이 몇 시간 뒤
 * 제 로컬본을 다시 올려 다른 기기의 최신 편집을 덮어쓴다(레거시가 겪은 실제 사고).
 */
export function shouldMergeOnAuth(prevUserId: string | null, nextUserId: string | null): boolean {
  return !!nextUserId && prevUserId !== nextUserId;
}

/**
 * 올려야 할 여행들 — 지문이 다르면 밀린 것이다.
 *
 * ⚠️ 활성 여행만 올리면 안 된다: 편집 직후 다른 여행으로 전환하면 디바운스가 취소돼
 * 그 편집이 영영 안 올라가고, 로컬만 앞선 채 revision은 그대로라 다음 병합이 그걸
 * '깨끗한 상태'로 착각한다(레거시 syncStaleTrips와 같은 이유).
 */
export function staleTrips(trips: Trip[], meta: SyncMeta): Trip[] {
  return trips.filter(t => {
    const entry = meta[t.id];
    return !entry || entry.hash !== hashTrip(t);
  });
}

/** 레거시가 첫 방문에 심어 주는 샘플 여행의 id (app.js seedSpain) */
export const SAMPLE_TRIP_ID = 'spain2026';

/**
 * 샘플 여행을 클라우드에 올려도 되는가.
 *
 * ⚠️ 샘플은 **모든 기기에 똑같이 심어지는 데모**다. 그대로 올리면 계정마다 만든 적 없는
 * 여행이 하나씩 생기고, 기기가 둘이면 서로 다른 편집본이 충돌로 뜬다. 레거시는 올리지 않는데
 * Next만 올리면 레거시 사용자 계정에도 샘플이 들어간다 — 병행 운영에서 갈라지면 안 되는 판정.
 * 이미 클라우드에 있는(revision이 붙은) 것만 계속 동기화한다.
 */
export function uploadable(trip: Trip, entry: SyncEntry | undefined): boolean {
  return trip.id !== SAMPLE_TRIP_ID || !!entry?.revision;
}

/**
 * 로그인 병합에 넣을 로컬 여행 목록. 클라우드에 행이 없는 샘플은 뺀다 —
 * 넣으면 병합이 '아직 안 올라간 로컬 여행'으로 보고 계정에 심는다.
 */
export function mergeInput(trips: Trip[], rows: { client_id?: string }[]): Trip[] {
  return trips.filter(
    t => t.id !== SAMPLE_TRIP_ID || (rows ?? []).some(r => r && r.client_id === t.id)
  );
}

/** 지금 올릴 수 있는 상태인가 — 미해결 충돌은 사용자가 고르기 전까지 건드리지 않는다 */
export function canUpload(entry: SyncEntry | undefined, force: boolean): boolean {
  if (force) return true;
  return entry?.status !== 'conflict';
}

/** 삭제 동기화가 밀려 있는 항목들 (온라인 복귀·로그인 직후 밀어낸다) */
export function pendingDeletes(meta: SyncMeta): { id: string; op: string }[] {
  return Object.entries(meta)
    .filter(([, e]) => e.status === 'delete-pending' || e.status === 'delete-error')
    .map(([id, e]) => ({ id, op: e.op }));
}

/**
 * 지운 줄 알았는데 되살아난 여행 — 삭제 표시가 남아 있는데 로컬에 그대로 있다.
 * (되돌리기로 부활했거나, 다른 탭이 되살렸다) 반드시 재업로드 대상이 된다.
 */
export function resurrectedIds(trips: Trip[], meta: SyncMeta): string[] {
  const dead: SyncStatus[] = ['delete-pending', 'delete-error', 'tombstoned'];
  return trips.filter(t => dead.includes(meta[t.id]?.status)).map(t => t.id);
}

/** 화면에 보여줄 한 줄 — 상태를 사람 말로 */
export function syncLabel(status: SyncStatus | undefined, signedIn: boolean): string {
  if (!signedIn) return '로그인하면 이 기기 밖에도 저장됩니다';
  switch (status) {
    case 'clean': return '☁️ 클라우드에 저장됨';
    case 'syncing': return '⏳ 올리는 중…';
    case 'conflict': return '⚠️ 다른 기기와 충돌 — 버전을 골라주세요';
    case 'error': return '⚠️ 저장 실패 — 로컬 편집은 보존됨';
    case 'delete-pending':
    case 'delete-error': return '🗑 삭제 동기화 대기';
    case 'tombstoned': return '🗑 클라우드에서 삭제됨';
    default: return '⏳ 아직 올라가지 않음';
  }
}

/** 여행 하나가 지금 클라우드 기준으로 안전한가 (충돌·오류가 없나) */
export function isSettled(entry: SyncEntry | undefined): boolean {
  return entry?.status === 'clean' || entry?.status === 'tombstoned';
}
