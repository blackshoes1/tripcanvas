// 구간 채우기 — 하루의 구간 중 캐시에 없는 것을 조회해 넣는다.
//
// 못 채운 구간이 있으면 하루치를 주기 전에 **잠깐만**(상한) 기다리고, 남은 것은 배경에서 채운다.
// 측정(2026-09-07, NAS): 구글 6건 병렬 277ms · 1건 65ms(커넥션 재사용) · 카카오 1건 ~300ms.
//
// 지키는 것:
//   · 같은 구간을 동시에 두 번 묻지 않는다(진행 중 표시)
//   · 실패는 1시간, 성공은 30일 지나야 다시 묻는다 — 무한 재시도는 할당량을 먹는다
//   · 키가 없는 provider의 구간은 아예 묻지 않는다
import { dayLegs } from '@/features/itinerary/domain/dayView';
import type { LegCache } from '@/features/itinerary/domain/types';
import type { Trip } from '@/features/trip/domain/types';

import type { LegCacheRepository, LegCacheRow } from '../repositories/types';
import type { ServerRouter } from './serverRouting';

/** 조회하지 않는 수단 — routing.js가 네트워크 없이 직선으로 추정한다(시각표가 없다) */
const ESTIMATED_MODES = new Set(['flight', 'train']);

/** 한 번에 조회할 최대 구간 수 — 한 요청이 할당량과 시간을 통째로 쓰지 않게. 나머지는 다음 요청이 채운다 */
export const MAX_PER_FILL = 12;
/**
 * 동시에 물어보는 수. 측정(2026-09-07, NAS): 구글은 커넥션을 재사용해 1건 ~65ms,
 * **6건 병렬 277ms / 순차 371ms**. 더 늘려도 이득이 적고 업스트림에 부담만 준다.
 */
export const FILL_CONCURRENCY = 6;
export const FAIL_RETRY_MS = 60 * 60 * 1000;          // 1시간
export const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;   // 30일

type P = { lat: number; lng: number };
export interface LegRequest { key: string; a: P; b: P; mode: string }

/** 그 날 **조회할** 구간들 — 걸음은 `dayLegs`가 정하고 여기서는 거르기만 한다 */
export function legRequestsFor(trip: Trip, di: number): LegRequest[] {
  const out: LegRequest[] = [];
  // ⚠️ 걸음은 `dayLegs` 하나다 — 그리기(지도)와 조회가 갈리면 "이 구간만 직선"이 생긴다.
  for (const leg of dayLegs(trip, di)) {
    if (ESTIMATED_MODES.has(leg.mode)) continue;          // 비행기·기차는 네트워크 없이 추정한다
    if (out.some((r) => r.key === leg.key)) continue;     // 같은 구간을 두 번 묻지 않는다
    out.push({
      key: leg.key,
      a: { lat: +leg.from.lat, lng: +leg.from.lng },
      b: { lat: +leg.to.lat, lng: +leg.to.lng },
      mode: leg.mode
    });
  }
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
  async function pending(requests: LegRequest[], max?: number): Promise<LegRequest[]> {
    if (!deps.router) return [];
    const rows = await deps.repo.getMany(requests.map((r) => r.key));
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const t = now();
    return requests
      .filter((r) => !inFlight.has(r.key) && deps.router!.canRoute(r.a, r.b) && isStale(byKey.get(r.key), t))
      .slice(0, Math.max(1, max ?? MAX_PER_FILL));
  }

  /**
   * 미스를 조회해 넣는다. 예외는 삼키고 로그로 — 배경 작업이 요청을 죽이면 안 된다.
   *
   * `budgetMs`를 주면 **그만큼만 기다렸다 돌아온다.** 남은 조회는 배경에서 계속 돌아
   * 캐시에 들어가므로 버려지지 않는다 — 다음 요청이 그 결과를 본다.
   */
  async function fill(requests: LegRequest[], opts?: { budgetMs?: number; max?: number }): Promise<number> {
    const router = deps.router;
    if (!router) return 0;
    const queue = await pending(requests, opts?.max);
    if (!queue.length) return 0;

    let filled = 0;
    const worker = async () => {
      for (;;) {
        const r = queue.shift();
        if (!r) return;
        if (await one(r)) filled += 1;
      }
    };
    const work = Promise.all(
      Array.from({ length: Math.min(FILL_CONCURRENCY, queue.length) }, worker)
    ).catch((error) => { log(`구간 채우기 오류 — ${error instanceof Error ? error.message : String(error)}`); });

    if (opts?.budgetMs && opts.budgetMs > 0) {
      // ⚠️ 남은 것을 취소하지 않는다. 시간이 다 된 것은 '기다리기'지 '그만두기'가 아니다.
      await Promise.race([work, new Promise((resolve) => setTimeout(resolve, opts.budgetMs))]);
    } else {
      await work;
    }
    return filled;
  }

  /** 한 구간. 성공하면 true */
  async function one(r: LegRequest): Promise<boolean> {
    const router = deps.router;
    if (!router) return false;
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
        return true;
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
    return false;
  }

  return { fill, pending };
}

export type LegFiller = ReturnType<typeof createLegFiller>;
