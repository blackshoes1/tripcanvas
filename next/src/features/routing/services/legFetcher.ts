// 구간 조회 큐 — app.js requestLeg/pumpLegs의 게이팅·기록 의미론을 그대로 재현한다:
// · 캐시 히트는 재조회 없음. 단 '경로 없는 비추정 항목'(과거 레이스 오염)은 자가 치유 재조회
// · 실패는 세션 한정 기억(영구 캐시에 fail을 남기지 않는다 — 레거시도 실패는 저장하지 않음)
// · 대중교통 시각별 키는 (base@tz@날짜) 그룹당 6개까지 — ETA 재계산 진동이 무한 재조회가 되지 않게
// · 성공은 시각별 key와 base 키 양쪽에 기록 (지도·재생은 가장 최근 실제 경로 사용)
// 의존성 주입 factory — 테스트는 가짜 fetchLeg/스토어로 게이팅만 검증한다.
import type { CachedLeg, LegCache } from '@/features/itinerary/domain/types';
import type { LegRequest } from '@/features/routing/domain/collect';

export interface LegFetcherDeps {
  fetchLeg: (
    a: { lat: number; lng: number }, b: { lat: number; lng: number },
    mode: string, when?: string | null
  ) => Promise<CachedLeg | null>;
  readCache: () => LegCache;
  /** key(+base) 결과 병합 저장 + 구독자 알림 */
  writeEntries: (entries: Record<string, CachedLeg>) => void;
  nowMs?: () => number;
}

export function createLegFetcher(deps: LegFetcherDeps) {
  const { fetchLeg, readCache, writeEntries } = deps;
  const nowMs = deps.nowMs ?? (() => Date.now());
  const failMem = new Map<string, number>();
  const transitSeen = new Map<string, Set<string>>();
  const queued = new Set<string>();
  const queue: LegRequest[] = [];
  let busy = false;

  /** 조회가 필요한가 — app.js requestLeg의 게이팅 그대로 */
  function needsFetch(req: LegRequest): boolean {
    const c = readCache()[req.key];
    if (c && c.sec && !c.path && !c.est) { /* 자가 치유 — 재조회해 덮어쓴다 */ }
    else if (c) return false;                       // 성공(sec) 또는 과거 실패 기록 — 재조회 없음
    if (failMem.has(req.key)) return false;         // 이번 세션 실패 — 재조회 없음
    if (req.mode === 'transit' && req.when) {
      const group = `${req.base}@${req.timeZone || 'UTC'}@${req.when.slice(0, 10)}`;
      const seen = transitSeen.get(group) ?? new Set<string>();
      if (!seen.has(req.key) && seen.size >= 6) return false;
      seen.add(req.key);
      transitSeen.set(group, seen);
    }
    return true;
  }

  async function pump(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      while (queue.length) {
        const req = queue.shift()!;
        queued.delete(req.key);
        const existing = readCache()[req.key];
        if (existing && !(existing.sec && !existing.path && !existing.est)) continue;   // 그 사이 채워짐
        let r: CachedLeg | null = null;
        try { r = await fetchLeg(req.a, req.b, req.mode, req.when); } catch { r = null; }
        if (r) {
          if (req.mode === 'transit' && req.when) { r.when = req.when; r.timeZone = req.timeZone || ''; }
          writeEntries({ [req.key]: r, [req.base]: r });
        } else {
          failMem.set(req.key, nowMs());
        }
      }
    } finally {
      busy = false;
    }
  }

  /** 필요한 구간만 큐에 넣고 백그라운드 조회 시작 — 결과는 스토어 알림으로 화면에 반영된다 */
  function ensure(requests: LegRequest[]): void {
    let added = false;
    for (const req of requests) {
      if (queued.has(req.key) || !needsFetch(req)) continue;
      queued.add(req.key);
      queue.push(req);
      added = true;
    }
    if (added) void pump();
  }

  return { ensure, _private: { failMem, transitSeen, queue } };
}
