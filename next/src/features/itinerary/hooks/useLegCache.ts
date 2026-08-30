'use client';
// 구간 캐시 구독 훅 — 읽기 전용 (경로 조회는 Phase 5까지 레거시 담당)
import { useSyncExternalStore } from 'react';

import type { LegCache } from '@/features/itinerary/domain/types';
import { getLegCacheServerSnapshot, getLegCacheSnapshot, subscribeLegCache } from '../services/legCacheStore';

export function useLegCache(): LegCache {
  return useSyncExternalStore(subscribeLegCache, getLegCacheSnapshot, getLegCacheServerSnapshot);
}
