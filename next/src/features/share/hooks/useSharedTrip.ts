'use client';
// 공유 링크로 열렸을 때 — 해시 규약을 이 훅이 전부 안다 (레거시 진입 IIFE와 같은 역할).
//   #v= 읽기전용 보기: 저장소를 건드리지 않는다. 보는 사람이 "내 여행으로 저장"을 눌러야 들어온다.
//   #t= 구버전 링크: 곧바로 내 여행으로 넣고 해시를 지운다(예전 공유 링크 호환 — 레거시와 동일).
//
// 상태는 두지 않는다. 해시는 외부 시스템이라 **렌더에서 파생**하고(services/shareUrl),
// 저장소에 넣는 일만 이펙트가 한다 — 넣고 해시를 지우면 스냅샷이 바뀌어 화면이 알아서 따라온다.
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import { newTripId } from '@/features/trip/domain/tripEditor';
import type { Trip } from '@/features/trip/domain/types';
import { addTrip } from '@/features/trip/services/localTripStore';
import { claimSharedTrip, decodeSharedTrip, readShareHash } from '../domain/shareLink';
import { decompressShare } from '../services/shareCodec';
import {
  clearShareHash, getShareUrlServerSnapshot, getShareUrlSnapshot, subscribeShareUrl
} from '../services/shareUrl';

export type SharedState =
  | { kind: 'none' }
  /** 읽기전용으로 보는 중 — 저장소에는 아직 없다 */
  | { kind: 'view'; trip: Trip }
  /** 구버전 링크 — 이펙트가 저장소에 넣는 동안 잠깐 */
  | { kind: 'importing'; trip: Trip }
  | { kind: 'claimed'; name: string }
  | { kind: 'error'; message: string };

export function useSharedTrip() {
  const url = useSyncExternalStore(subscribeShareUrl, getShareUrlSnapshot, getShareUrlServerSnapshot);

  const shared = useMemo<SharedState>(() => {
    const h = readShareHash(url.hash);
    if (h.kind === 'none') return url.outcome ?? { kind: 'none' };
    const r = decodeSharedTrip(h.encoded, decompressShare);
    if (!r.ok) return { kind: 'error', message: r.error };
    return h.kind === 'view' ? { kind: 'view', trip: r.trip } : { kind: 'importing', trip: r.trip };
  }, [url]);

  // 구버전 #t= 링크는 곧바로 내 여행이 된다 — 저장소에 넣는 것은 외부 시스템 갱신이고,
  // 해시를 지우면 스냅샷이 바뀌어 다음 렌더가 'claimed'로 넘어간다(setState 없음).
  useEffect(() => {
    if (shared.kind !== 'importing') return;
    const ok = addTrip(claimSharedTrip(shared.trip, newTripId()));
    clearShareHash(ok ? { kind: 'claimed', name: shared.trip.name } : null);
  }, [shared]);

  // 해석 못 한 링크는 해시를 걷어낸다 — 새로고침마다 같은 오류를 다시 보지 않게.
  // 이유는 결과(outcome)로 남겨 그대로 화면에 머문다 — 지우기만 하면 한 프레임 스치고 사라진다.
  useEffect(() => {
    if (shared.kind === 'error' && readShareHash(url.hash).kind !== 'none') {
      clearShareHash({ kind: 'error', message: shared.message });
    }
  }, [shared, url.hash]);

  /** 읽기전용으로 보던 여행을 내 저장소로 */
  const claim = useCallback((): boolean => {
    if (shared.kind !== 'view') return false;
    if (!addTrip(claimSharedTrip(shared.trip, newTripId()))) return false;
    clearShareHash({ kind: 'claimed', name: shared.trip.name });
    return true;
  }, [shared]);

  /** 읽기전용을 닫고 내 여행으로 돌아간다 (저장하지 않음) */
  const dismiss = useCallback(() => clearShareHash(), []);

  return { shared, claim, dismiss };
}
