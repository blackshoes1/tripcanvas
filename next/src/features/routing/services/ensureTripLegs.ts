'use client';
// 실제 의존성 배선 — routing.js(단일 소스) 클라이언트 + legFetcher + legCacheStore.
// 화면(일정/지도)이 트립·캐시가 바뀔 때마다 부르면, 빠진 구간만 백그라운드로 채워진다.
import legacyLib from '@legacy/lib.js';
import legacyRouting from '@legacy/routing.js';

import type { CachedLeg } from '@/features/itinerary/domain/types';
import { getLegCacheSnapshot, writeLegEntries } from '@/features/itinerary/services/legCacheStore';
import { GMAPS_KEY } from '@/features/map/config';
import { collectLegRequests } from '@/features/routing/domain/collect';
import { createLegFetcher } from '@/features/routing/services/legFetcher';
import type { Trip } from '@/features/trip/domain/types';

const { encodePolyline, haversine, inKorea, ringPts } = legacyLib;

let fetcher: ReturnType<typeof createLegFetcher> | null = null;

function getFetcher() {
  if (!fetcher) {
    const client = legacyRouting.createRoutingClient({
      fetchImpl: (url, init) => fetch(url, init),
      googleKey: GMAPS_KEY,
      encodePolyline, ringPts, haversine, inKorea
    });
    fetcher = createLegFetcher({
      fetchLeg: (a, b, mode, when) => client.fetchLeg(a, b, mode, when) as Promise<CachedLeg | null>,
      readCache: getLegCacheSnapshot,
      writeEntries: writeLegEntries
    });
  }
  return fetcher;
}

/** 트립에 표시되는 모든 구간 중 미조회분을 큐에 넣는다 — 결과는 legCache 알림으로 반영 */
export function ensureTripLegs(trip: Trip): void {
  if (typeof window === 'undefined') return;
  getFetcher().ensure(collectLegRequests(trip, getLegCacheSnapshot(), Date.now()));
}
