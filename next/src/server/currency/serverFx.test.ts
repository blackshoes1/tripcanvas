import { describe, expect, it } from 'vitest';

import { FX_FALLBACK } from '@/features/currency/domain/fx';
import type { FxRateRepository, FxRateRow } from '@/server/repositories/types';
import { createServerFx, FX_RETRY_MS, fxDayOf } from './serverFx';

/** open.er-api.com 모양의 응답 — USD 기준 */
const apiBody = (krw: number) => ({ result: 'success', rates: { KRW: krw, EUR: 0.9, JPY: 150, CNY: 7 } });

class MemoryRepo implements FxRateRepository {
  rows: FxRateRow[] = [];
  reads = 0;
  writes = 0;
  failing = false;
  async latest(): Promise<FxRateRow | null> {
    this.reads += 1;
    if (this.failing) throw new Error('db down');
    return [...this.rows].sort((a, b) => (a.day < b.day ? 1 : -1))[0] ?? null;
  }
  async put(row: Omit<FxRateRow, 'fetchedAt'>): Promise<void> {
    this.writes += 1;
    if (this.failing) throw new Error('db down');
    this.rows = this.rows.filter((r) => r.day !== row.day).concat({ ...row, fetchedAt: new Date() });
  }
}

function fakeFetch(plan: () => Response | Error) {
  let calls = 0;
  const impl = (async () => {
    calls += 1;
    const r = plan();
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { impl, calls: () => calls };
}

const okJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('서버 환율 — 하루 한 번', () => {
  it('처음에는 받고, 같은 날의 다음 요청은 상류를 두드리지 않는다', async () => {
    const clock = { t: Date.UTC(2026, 8, 18, 3, 0, 0) };
    const f = fakeFetch(() => okJson(apiBody(1400)));
    const repo = new MemoryRepo();
    const fx = createServerFx({ repo, fetchImpl: f.impl, now: () => new Date(clock.t) });
    const first = await fx.read();
    expect(first.source).toBe('API');
    expect(first.asOf).toBe('2026-09-18');
    expect(first.rates.USD).toBe(1400);
    expect(first.rates.JPY).toBeCloseTo(1400 / 150, 6);
    expect(repo.writes).toBe(1);
    await fx.read(); await fx.read();
    expect(f.calls()).toBe(1);
    clock.t += 5 * 60 * 60 * 1000;                 // 같은 날 오후
    await fx.read();
    expect(f.calls()).toBe(1);
  });

  it('날이 바뀌면 다시 받는다 — UTC 날짜 기준(웹과 같다)', async () => {
    const clock = { t: Date.UTC(2026, 8, 18, 23, 30, 0) };
    let krw = 1400;
    const f = fakeFetch(() => okJson(apiBody(krw)));
    const fx = createServerFx({ repo: new MemoryRepo(), fetchImpl: f.impl, now: () => new Date(clock.t) });
    expect((await fx.read()).asOf).toBe('2026-09-18');
    clock.t += 60 * 60 * 1000; krw = 1410;         // 자정을 넘겼다
    const next = await fx.read();
    expect(next.asOf).toBe('2026-09-19');
    expect(next.rates.USD).toBe(1410);
    expect(f.calls()).toBe(2);
  });

  it('DB에 오늘치가 있으면(다른 프로세스가 받았다) 상류를 두드리지 않는다', async () => {
    const now = new Date(Date.UTC(2026, 8, 18, 9));
    const repo = new MemoryRepo();
    await repo.put({ day: fxDayOf(now), rates: { KRW: 1, USD: 1395, EUR: 1550, JPY: 9.3, CNY: 199 } });
    const f = fakeFetch(() => okJson(apiBody(1400)));
    const fx = createServerFx({ repo, fetchImpl: f.impl, now: () => now });
    const snap = await fx.read();
    expect(f.calls()).toBe(0);
    expect(snap).toEqual({ rates: { KRW: 1, USD: 1395, EUR: 1550, JPY: 9.3, CNY: 199 }, source: 'API', asOf: '2026-09-18' });
  });

  it('오늘 못 받으면 저장된 최근 날의 실제 시세를 그 날짜와 함께 준다 — 근사값보다 낫다', async () => {
    const now = new Date(Date.UTC(2026, 8, 18, 9));
    const repo = new MemoryRepo();
    await repo.put({ day: '2026-09-15', rates: { KRW: 1, USD: 1390, EUR: 1540, JPY: 9.2, CNY: 198 } });
    const f = fakeFetch(() => new Error('ECONNREFUSED'));
    const fx = createServerFx({ repo, fetchImpl: f.impl, now: () => now });
    const snap = await fx.read();
    expect(snap.source).toBe('API');
    expect(snap.asOf).toBe('2026-09-15');
    expect(snap.rates.USD).toBe(1390);
  });

  it('받은 적이 없고 못 받으면 근사값이고, 응답이 그렇게 말한다', async () => {
    const f = fakeFetch(() => new Response('nope', { status: 503 }));
    const fx = createServerFx({ repo: new MemoryRepo(), fetchImpl: f.impl, now: () => new Date(Date.UTC(2026, 8, 18)) });
    const snap = await fx.read();
    expect(snap).toEqual({ rates: { ...FX_FALLBACK }, source: 'FALLBACK', asOf: null });
  });

  it('실패한 뒤에는 잠시 두드리지 않다가, 재시도 간격이 지나면 다시 받는다', async () => {
    const clock = { t: Date.UTC(2026, 8, 18, 1) };
    let down = true;
    const f = fakeFetch(() => (down ? new Error('timeout') : okJson(apiBody(1400))));
    const fx = createServerFx({ repo: new MemoryRepo(), fetchImpl: f.impl, now: () => new Date(clock.t) });
    expect((await fx.read()).source).toBe('FALLBACK');
    await fx.read(); await fx.read();
    expect(f.calls()).toBe(1);                      // 요청마다 죽은 곳을 두드리지 않는다
    down = false;
    clock.t += FX_RETRY_MS + 1000;
    const snap = await fx.read();
    expect(snap.source).toBe('API');
    expect(f.calls()).toBe(2);
  });

  it('같은 순간에 들어온 요청들은 상류를 한 번만 두드린다', async () => {
    const f = fakeFetch(() => okJson(apiBody(1400)));
    const fx = createServerFx({ repo: new MemoryRepo(), fetchImpl: f.impl, now: () => new Date(Date.UTC(2026, 8, 18)) });
    const results = await Promise.all([fx.read(), fx.read(), fx.read()]);
    expect(f.calls()).toBe(1);
    expect(results.every((r) => r.source === 'API')).toBe(true);
  });

  it('반쪽 응답(통화가 빠짐)은 통째로 버린다 — 틀린 금액을 자신 있게 보여 주지 않는다', async () => {
    const f = fakeFetch(() => okJson({ result: 'success', rates: { KRW: 1400, EUR: 0.9 } }));
    const fx = createServerFx({ fetchImpl: f.impl, now: () => new Date(Date.UTC(2026, 8, 18)) });
    expect((await fx.read()).source).toBe('FALLBACK');
  });

  it('DB가 없어도(레거시 배포) 메모리로 하루 한 번 받는다', async () => {
    const f = fakeFetch(() => okJson(apiBody(1400)));
    const fx = createServerFx({ fetchImpl: f.impl, now: () => new Date(Date.UTC(2026, 8, 18)) });
    expect((await fx.read()).source).toBe('API');
    await fx.read();
    expect(f.calls()).toBe(1);
  });

  it('DB가 죽어도 환율은 나온다 — 저장 실패는 로그로만 남긴다', async () => {
    const repo = new MemoryRepo(); repo.failing = true;
    const logs: string[] = [];
    const f = fakeFetch(() => okJson(apiBody(1400)));
    const fx = createServerFx({ repo, fetchImpl: f.impl, now: () => new Date(Date.UTC(2026, 8, 18)), log: (m) => logs.push(m) });
    const snap = await fx.read();
    expect(snap.source).toBe('API');
    expect(logs.some((m) => m.includes('store'))).toBe(true);
  });
});
