// legFetcher — app.js requestLeg/pumpLegs 게이팅·기록 의미론을 고정한다.
import { describe, expect, it } from 'vitest';

import type { CachedLeg, LegCache } from '@/features/itinerary/domain/types';
import type { LegRequest } from '@/features/routing/domain/collect';
import { createLegFetcher } from './legFetcher';

const REQ = (key: string, extra: Partial<LegRequest> = {}): LegRequest => ({
  key, base: key.split('@')[0],
  a: { lat: 33.51, lng: 126.49 }, b: { lat: 33.46, lng: 126.94 },
  mode: 'car', when: null, timeZone: '', ...extra
});

function harness(initial: LegCache = {}, result: CachedLeg | null = { sec: 600, m: 8000, path: 'p' }) {
  let cache: Record<string, CachedLeg> = { ...initial };
  const calls: string[] = [];
  const fetcher = createLegFetcher({
    fetchLeg: async (_a, _b, mode, when) => { calls.push(`${mode}@${when ?? ''}`); return result ? { ...result } : null; },
    readCache: () => cache,
    writeEntries: e => { cache = { ...cache, ...e }; },
    nowMs: () => 1000
  });
  return { fetcher, calls, cache: () => cache };
}

const settle = () => new Promise(r => setTimeout(r, 0));

describe('legFetcher', () => {
  it('성공은 key와 base 양쪽에 기록, 이미 캐시된 구간은 조회하지 않는다', async () => {
    const h = harness();
    h.fetcher.ensure([REQ('K#car')]);
    await settle();
    expect(h.calls).toHaveLength(1);
    expect(h.cache()['K#car'].sec).toBe(600);

    h.fetcher.ensure([REQ('K#car')]);   // 캐시 히트 — 재조회 없음
    await settle();
    expect(h.calls).toHaveLength(1);
  });

  it('실패는 세션 한정 기억 — 영구 캐시에 fail을 남기지 않고, 재조회도 하지 않는다', async () => {
    const h = harness({}, null);
    h.fetcher.ensure([REQ('K#car')]);
    await settle();
    expect(h.calls).toHaveLength(1);
    expect(h.cache()['K#car']).toBeUndefined();   // 저장 안 함 (레거시 fail은 세션 메모리 성격)

    h.fetcher.ensure([REQ('K#car')]);
    await settle();
    expect(h.calls).toHaveLength(1);              // failMem 게이트
  });

  it('경로 없는 비추정 항목은 자가 치유 재조회, est 추정 항목은 재조회하지 않는다', async () => {
    const stale = harness({ 'K#car': { sec: 100, m: 100 } });        // path 없음 · est 아님 → 오염
    stale.fetcher.ensure([REQ('K#car')]);
    await settle();
    expect(stale.calls).toHaveLength(1);
    expect(stale.cache()['K#car'].path).toBe('p');                   // 덮어씀

    const est = harness({ 'K#flight': { sec: 100, m: 100, est: true } });
    est.fetcher.ensure([REQ('K#flight', { mode: 'flight' })]);
    await settle();
    expect(est.calls).toHaveLength(0);                               // 추정은 원래 경로가 없다
  });

  it('과거 실패 기록(fail 항목)이 캐시에 있으면 재조회하지 않는다', async () => {
    const h = harness({ 'K#car': { fail: 123 } });
    h.fetcher.ensure([REQ('K#car')]);
    await settle();
    expect(h.calls).toHaveLength(0);
  });

  it('대중교통 시각별 키는 그룹(base@tz@날짜)당 6개까지 — ETA 진동이 무한 재조회가 되지 않게', async () => {
    const h = harness();
    const reqs = Array.from({ length: 8 }, (_, i) =>
      REQ(`B#transit@Asia/Seoul@2100-01-01T0${i}:00:00Z`, {
        base: 'B#transit', mode: 'transit',
        when: `2100-01-01T0${i}:00:00Z`, timeZone: 'Asia/Seoul'
      }));
    h.fetcher.ensure(reqs);
    await settle();
    expect(h.calls).toHaveLength(6);
    // 대중교통 결과에는 출발시각 스탬프가 남는다 (레거시 pumpLegs 동일)
    expect(h.cache()['B#transit@Asia/Seoul@2100-01-01T00:00:00Z']).toMatchObject({ when: '2100-01-01T00:00:00Z' });
  });
});
