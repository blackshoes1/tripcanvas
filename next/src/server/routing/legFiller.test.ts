import legacyLib from '@legacy/lib.js';
import { describe, expect, it } from 'vitest';

import type { Trip } from '@/features/trip/domain/types';

import type { LegCacheRepository, LegCacheRow } from '../repositories/types';
import { createLegFiller, FAIL_RETRY_MS, isStale, legRequestsFor, MAX_PER_FILL, REFRESH_MS, toLegCache } from './legFiller';
import type { LegOutcome, ServerRouter } from './serverRouting';

const { legKey, normalizeTrip } = legacyLib as unknown as {
  legKey: (a: unknown, b: unknown, mode?: string) => string;
  normalizeTrip: (t: unknown) => Trip;
};

// 여기서 지키는 것: **채우기가 요청을 죽이지 않는다**. 그리고 무엇을 묻고 무엇을 안 묻는지가 규칙대로다.

function memoryRepo(seed: LegCacheRow[] = []) {
  const rows = new Map(seed.map((r) => [r.key, r]));
  const puts: Array<Omit<LegCacheRow, 'fetchedAt'>> = [];
  const repo: LegCacheRepository = {
    async getMany(keys) { return keys.map((k) => rows.get(k)).filter((r): r is LegCacheRow => !!r); },
    async put(row) { puts.push(row); rows.set(row.key, { ...row, fetchedAt: new Date() }); }
  };
  return { repo, puts, rows };
}

function router(fetchLeg: ServerRouter['fetchLeg'], canRoute = () => true): ServerRouter {
  return { fetchLeg, canRoute, providerFor: () => 'kakao' };
}

const ok = (sec: number): LegOutcome => ({ ok: true, route: { sec, m: sec * 10, path: 'p', taxi: 0, snapped: 0 } });

const seoul = { lat: 37.5665, lng: 126.978 };
const jeju = { lat: 33.4996, lng: 126.5312 };
const jejuAirport = { lat: 33.5104, lng: 126.4914 };

const TRIP: Trip = normalizeTrip({
  id: 't1', name: '제주', start: '2026-10-01',
  days: [
    { mode: 'car', spots: [
      { name: '제주공항', ...jejuAirport },
      { name: '숙소', lat: 33.4890, lng: 126.4983, stay: true, nights: 2 },
      { name: '이름만', name2: null }
    ] },
    { mode: 'car', spots: [{ name: '성산일출봉', ...jeju }] },
    { mode: 'car', spots: [{ name: '돌아가는 날', ...jejuAirport }] }
  ]
});

describe('legRequestsFor', () => {
  it('이월 앵커 → 장소 → 숙소 복귀 순서로, 좌표 없는 장소는 건너뛴다', () => {
    const stay = { lat: 33.4890, lng: 126.4983 };
    const day2 = legRequestsFor(TRIP, 1);
    // 전날 숙소(연박)에서 출발해 성산일출봉으로, 그리고 그 숙소로 돌아온다
    expect(day2.length).toBe(2);
    expect(day2[0].mode).toBe('car');
    expect(day2[0].key).toBe(legKey(stay, jeju, 'car'));
    expect(day2[1].key).toBe(legKey(jeju, stay, 'car'));
  });

  it('마지막 날은 숙소 복귀 구간을 묻지 않는다 — 떠나는 날이라 복귀가 없다', () => {
    const last = legRequestsFor(TRIP, 2);
    expect(last.length).toBe(1);   // 앵커(숙소) → 공항, 그것뿐
    expect(last[0].key).toBe(legKey({ lat: 33.4890, lng: 126.4983 }, jejuAirport, 'car'));
  });

  it('없는 날은 빈 배열 — 없는 것을 지어내지 않는다', () => {
    expect(legRequestsFor(TRIP, 9)).toEqual([]);
  });

  it('비행기·기차는 묻지 않는다 — routing.js가 네트워크 없이 추정한다', () => {
    const flying: Trip = normalizeTrip({
      id: 't2', name: '도쿄', start: '2026-10-01',
      days: [{ mode: 'flight', spots: [{ name: '김포', ...seoul }, { name: '하네다', lat: 35.5494, lng: 139.7798 }] }]
    });
    expect(legRequestsFor(flying, 0)).toEqual([]);
  });

  it('같은 구간이 두 번 나와도 한 번만 묻는다', () => {
    const backAndForth: Trip = normalizeTrip({
      id: 't3', name: '왕복', start: '2026-10-01',
      days: [{ mode: 'car', spots: [{ name: 'A', ...seoul }, { name: 'B', ...jeju }, { name: 'A2', ...seoul }, { name: 'B2', ...jeju }] }]
    });
    const keys = legRequestsFor(backAndForth, 0).map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('isStale', () => {
  const row = (fail: boolean, ageMs: number): LegCacheRow => ({
    key: 'k', sec: 100, m: 1000, path: null, taxi: null, snapped: false, fail,
    fetchedAt: new Date(1_000_000_000_000 - ageMs), provider: 'kakao'
  });
  const now = 1_000_000_000_000;

  it('없으면 물어야 한다', () => expect(isStale(undefined, now)).toBe(true));
  it('실패는 한 시간이 지나야 다시 묻는다', () => {
    expect(isStale(row(true, FAIL_RETRY_MS - 1), now)).toBe(false);
    expect(isStale(row(true, FAIL_RETRY_MS), now)).toBe(true);
  });
  it('성공은 30일을 쓴다 — 도로는 그렇게 자주 바뀌지 않는다', () => {
    expect(isStale(row(false, REFRESH_MS - 1), now)).toBe(false);
    expect(isStale(row(false, REFRESH_MS), now)).toBe(true);
  });
});

describe('toLegCache', () => {
  it('웹 캐시와 같은 모양이다 — 실패는 fail로 남아 화면이 ⚠️를 그린다', () => {
    const cache = toLegCache([
      { key: 'a', sec: 600, m: 5000, path: 'xyz', taxi: 9000, snapped: true, fail: false, provider: 'kakao', fetchedAt: new Date() },
      { key: 'b', sec: null, m: null, path: null, taxi: null, snapped: false, fail: true, provider: 'google', fetchedAt: new Date() }
    ]);
    expect(cache.a).toEqual({ sec: 600, m: 5000, path: 'xyz', taxi: 9000, snapped: true });
    expect(cache.b).toEqual({ fail: true });
  });
});

describe('createLegFiller', () => {
  const reqs = [
    { key: 'k1', a: seoul, b: jeju, mode: 'car' },
    { key: 'k2', a: jeju, b: seoul, mode: 'car' }
  ];

  it('라우터가 없으면(키 없음) 아무것도 묻지 않는다', async () => {
    const { repo, puts } = memoryRepo();
    const filler = createLegFiller({ repo, router: null });
    expect(await filler.fill(reqs)).toBe(0);
    expect(puts).toEqual([]);
  });

  it('미스만 조회해 넣는다 — 이미 있는 것은 다시 묻지 않는다', async () => {
    const { repo, puts } = memoryRepo([
      { key: 'k1', sec: 300, m: 2000, path: null, taxi: null, snapped: false, fail: false, provider: 'kakao', fetchedAt: new Date() }
    ]);
    const asked: string[] = [];
    const filler = createLegFiller({
      repo,
      router: router(async (a, b, mode) => { asked.push(mode); return ok(900); })
    });
    expect(await filler.fill(reqs)).toBe(1);
    expect(asked.length).toBe(1);
    expect(puts).toEqual([{ key: 'k2', sec: 900, m: 9000, path: 'p', taxi: 0, snapped: false, fail: false, provider: 'kakao' }]);
  });

  it('못 찾은 구간은 실패로 남긴다 — 매번 다시 묻지 않게', async () => {
    const { repo, puts } = memoryRepo();
    const filler = createLegFiller({ repo, router: router(async () => ({ ok: false, transient: false })) });
    expect(await filler.fill([reqs[0]])).toBe(0);
    expect(puts[0]).toMatchObject({ key: 'k1', fail: true, sec: null, path: null });
  });

  it('잠깐인 실패(429·5xx)는 캐시에 굳히지 않는다 — 혼잡이 한 시간짜리 직선이 되면 안 된다', async () => {
    const { repo, puts } = memoryRepo();
    const logs: string[] = [];
    const filler = createLegFiller({
      repo, log: (m) => logs.push(m),
      router: router(async () => ({ ok: false, transient: true }))
    });
    expect(await filler.fill([reqs[0]])).toBe(0);
    expect(puts).toEqual([]);
    expect(logs[0]).toContain('보류');
  });

  it('한 구간이 던져도 나머지를 계속 채운다', async () => {
    const { repo, puts } = memoryRepo();
    const logs: string[] = [];
    const filler = createLegFiller({
      repo, log: (m) => logs.push(m),
      router: router(async (_a, _b, _mode) => { throw new Error('boom'); })
    });
    const failing = router(async (a) => (a === seoul ? Promise.reject(new Error('boom')) : ok(120)));
    const filler2 = createLegFiller({ repo, log: (m) => logs.push(m), router: failing });
    await expect(filler.fill([reqs[0]])).resolves.toBe(0);
    expect(await filler2.fill(reqs)).toBe(1);
    expect(puts.map((p) => p.key)).toEqual(['k2']);
    expect(logs.some((l) => l.includes('오류'))).toBe(true);
  });

  it('키가 없는 provider의 구간은 아예 묻지 않는다', async () => {
    const { repo } = memoryRepo();
    let asked = 0;
    const filler = createLegFiller({
      repo,
      router: router(async () => { asked += 1; return ok(60); }, () => false)
    });
    expect(await filler.fill(reqs)).toBe(0);
    expect(asked).toBe(0);
  });

  it('한 번에 도는 구간 수에 상한이 있다 — 나머지는 다음 요청이 채운다', async () => {
    const { repo } = memoryRepo();
    const many = Array.from({ length: MAX_PER_FILL + 5 }, (_, i) => ({ key: `k${i}`, a: seoul, b: jeju, mode: 'car' }));
    let asked = 0;
    const filler = createLegFiller({ repo, router: router(async () => { asked += 1; return ok(60); }) });
    expect(await filler.fill(many)).toBe(MAX_PER_FILL);
    expect(asked).toBe(MAX_PER_FILL);
  });

  it('같은 구간을 동시에 두 번 묻지 않는다', async () => {
    const { repo } = memoryRepo();
    let asked = 0;
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const filler = createLegFiller({
      repo,
      router: router(async () => { asked += 1; await gate; return ok(60); })
    });
    const first = filler.fill([reqs[0]]);
    await Promise.resolve();
    expect(await filler.pending([reqs[0]])).toEqual([]);   // 진행 중이라 다시 뽑히지 않는다
    release!();
    await first;
    expect(asked).toBe(1);
  });
});
