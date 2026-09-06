// 구간 채우기 — 하루의 구간 중 캐시에 없는 것을 조회해 넣는다.
//
// ⚠️ **요청을 라우팅에 묶지 않는다.** 하루치 응답은 캐시에 있는 것만 쓰고 즉시 나간다; 미스는 응답을 보낸 뒤
// 여기서 채운다. Google Routes는 구간당 300ms쯤이라 10곳짜리 하루를 기다리면 화면이 멈춘다.
// 다음 요청부터 도로다.
//
// 지키는 것:
//   · 같은 구간을 동시에 두 번 묻지 않는다(진행 중 표시)
//   · 실패는 1시간, 성공은 30일 지나야 다시 묻는다 — 무한 재시도는 할당량을 먹는다
//   · 키가 없는 provider의 구간은 아예 묻지 않는다
import legacyLib from '@legacy/lib.js';

import { backLegOf, hasCoord, type LocatedSpot, legModeOf } from '@/features/itinerary/domain/dayView';
import type { LegCache } from '@/features/itinerary/domain/types';
import type { Day, Spot, Trip } from '@/features/trip/domain/types';

import type { LegCacheRepository, LegCacheRow } from '../repositories/types';
import type { ServerRouter } from './serverRouting';

const { dayReturnStay, dayStartAnchor, legKey } = legacyLib;

/** 조회하지 않는 수단 — routing.js가 네트워크 없이 직선으로 추정한다(시각표가 없다) */
const ESTIMATED_MODES = new Set(['flight', 'train']);

/** 한 번에 조회할 최대 구간 수 — 한 요청이 할당량과 시간을 통째로 쓰지 않게. 나머지는 다음 요청이 채운다 */
export const MAX_PER_FILL = 12;
export const FAIL_RETRY_MS = 60 * 60 * 1000;          // 1시간
export const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;   // 30일

type P = { lat: number; lng: number };
export interface LegRequest { key: string; a: P; b: P; mode: string }

/**
 * 그 날이 필요로 하는 구간들 — `dayView.ts`·`collect.ts`와 **같은 순서**로 만든다:
 * 이월 앵커 → 첫 장소, 연속 쌍(좌표 없는 장소는 건너뜀), 마지막 → 숙소 복귀.
 */
export function legRequestsFor(trip: Trip, di: number): LegRequest[] {
  const days = trip.days ?? [];
  const day: Day | undefined = days[di];
  if (!day) return [];
  const out: LegRequest[] = [];
  const push = (a: P, b: P, mode: string) => {
    if (ESTIMATED_MODES.has(mode)) return;
    const key = legKey(a, b, mode);
    if (!out.some((r) => r.key === key)) out.push({ key, a: { lat: +a.lat, lng: +a.lng }, b: { lat: +b.lat, lng: +b.lng }, mode });
  };

  const anchor = dayStartAnchor(days as unknown[], di) as Spot | null;
  let prev: LocatedSpot | null = hasCoord(anchor) ? anchor : null;
  for (const spot of day.spots ?? []) {
    if (!hasCoord(spot)) continue;
    if (prev) push(prev, spot, legModeOf(day, spot));
    prev = spot;
  }
  // 숙소 복귀는 합성 구간이다 — 화면·타임라인이 쓰는 것과 **같은 함수**로 만든다.
  const back = backLegOf(day, dayReturnStay(days as unknown[], di) as Spot | null);
  if (back) push(back.from, back.to, back.mode);
  return out;
}

/** 캐시 행 → 웹과 같은 `LegCache`. 실패 행은 `fail`로 남아 화면이 ⚠️를 그릴 수 있다 */
export function toLegCache(rows: LegCacheRow[]): LegCache {
  const out: Record<string, LegCache[string]> = {};
  for (const r of rows) {
    out[r.key] = r.fail
      ? { fail: true }
      : { sec: r.sec ?? undefined, m: r.m ?? undefined, path: r.path ?? undefined,
          taxi: r.taxi ?? undefined, snapped: r.snapped || undefined };
  }
  return out;
}

/** 다시 물어야 하는가 — 없거나, 실패 뒤 1시간이 지났거나, 성공 뒤 30일이 지났거나 */
export function isStale(row: LegCacheRow | undefined, now: number): boolean {
  if (!row) return true;
  const age = now - row.fetchedAt.getTime();
  return row.fail ? age >= FAIL_RETRY_MS : age >= REFRESH_MS;
}

export interface LegFillerDeps {
  repo: LegCacheRepository;
  router: ServerRouter | null;
  now?: () => number;
  log?: (message: string) => void;
}

export function createLegFiller(deps: LegFillerDeps) {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => {});
  /** 지금 조회 중인 키 — 같은 구간을 동시에 두 번 묻지 않는다 */
  const inFlight = new Set<string>();

  /** 채워야 할 구간만 골라낸다. 라우터가 없거나 그 provider 키가 없으면 비어 있다 */
  async function pending(requests: LegRequest[]): Promise<LegRequest[]> {
    if (!deps.router) return [];
    const rows = await deps.repo.getMany(requests.map((r) => r.key));
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const t = now();
    return requests
      .filter((r) => !inFlight.has(r.key) && deps.router!.canRoute(r.a, r.b) && isStale(byKey.get(r.key), t))
      .slice(0, MAX_PER_FILL);
  }

  /** 미스를 조회해 넣는다. 예외는 삼키고 로그로 — 배경 작업이 요청을 죽이면 안 된다 */
  async function fill(requests: LegRequest[]): Promise<number> {
    const router = deps.router;
    if (!router) return 0;
    let filled = 0;
    for (const r of await pending(requests)) {
      inFlight.add(r.key);
      try {
        const provider = router.providerFor(r.a, r.b);
        const outcome = await router.fetchLeg(r.a, r.b, r.mode);
        if (outcome.ok) {
          const { route } = outcome;
          await deps.repo.put({
            key: r.key, sec: Math.round(route.sec), m: Math.round(route.m), path: route.path,
            taxi: route.taxi ?? null, snapped: !!route.snapped, fail: false, provider
          });
          filled += 1;
        } else if (outcome.transient) {
          // 지금 우리 쪽 사정이다 — 남기지 않는다. 다음 요청에서 다시 묻는다.
          log(`구간 조회 보류 — ${provider} ${r.key}`);
        } else {
          await deps.repo.put({
            key: r.key, sec: null, m: null, path: null, taxi: null, snapped: false, fail: true, provider
          });
          log(`구간 조회 실패 — ${provider} ${r.key}`);
        }
      } catch (error) {
        log(`구간 채우기 오류 — ${r.key} · ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        inFlight.delete(r.key);
      }
    }
    return filled;
  }

  return { fill, pending };
}

export type LegFiller = ReturnType<typeof createLegFiller>;
