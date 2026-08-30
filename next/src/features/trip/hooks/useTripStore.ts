'use client';
// 여행 저장소 훅 — useSyncExternalStore로 외부 저장소(localStorage)를 구독 (§16: 상태 라이브러리 없음)
import { useCallback, useSyncExternalStore } from 'react';

import type { Trip } from '@/features/trip/domain/types';
import {
  getTripStoreServerSnapshot, getTripStoreSnapshot, saveTrip, subscribeTripStore
} from '../services/localTripStore';

export function useTripStore() {
  const store = useSyncExternalStore(subscribeTripStore, getTripStoreSnapshot, getTripStoreServerSnapshot);
  const activeTrip: Trip | null = store?.trips.find(t => t.id === store.activeId) ?? null;

  /** 활성 여행 갱신 — 정규화·저장. 저장 실패(쿼터 등) 시 false */
  const updateActiveTrip = useCallback((mutate: (trip: Trip) => Trip): boolean => {
    const current = getTripStoreSnapshot();
    const trip = current?.trips.find(t => t.id === current.activeId);
    if (!trip) return false;
    return saveTrip(mutate(trip));
  }, []);

  return { store, activeTrip, updateActiveTrip };
}
