// 경로 조회 하루 예산 — 진짜 PostgreSQL(PGlite)에서 센다.
//
// ⚠️ PGlite는 트랜잭션을 하나씩 돌린다(`_runExclusiveTransaction`). 그래서 여기서는 **동시성**을 검증하지 못한다 —
// `reserve`의 행 잠금(`for update`)을 빼도 이 파일은 통과한다. 여기서 지키는 것은 몰려온 요청의 합이 상한을
// 넘지 않는다는 **순차 정확성**까지다. 실제 PostgreSQL 두 연결의 경합은 아직 테스트가 없다.
import { beforeEach, describe, expect, it } from 'vitest';

import { PgLegFillUsageRepository } from '../infrastructure/database/pgLegFillUsageRepository';
import { legFillUsage } from '../infrastructure/database/schema';
import { createTestDatabase, type TestDatabase } from '../infrastructure/database/testDb';
import type { LegFillUsageRepository } from '../repositories/types';
import { createLegBudget, DEFAULT_LEG_FILL_LIMITS, readLegFillLimits } from './legBudget';

let db: TestDatabase;
let repo: PgLegFillUsageRepository;
let clock: Date;

beforeEach(async () => {
  db = await createTestDatabase();
  repo = new PgLegFillUsageRepository(db.db);
  clock = new Date('2026-10-02T03:00:00Z');
});

const budgetOf = (perUserDaily: number, totalDaily: number, log?: (m: string) => void) =>
  createLegBudget({ repo, limits: { perUserDaily, totalDaily }, now: () => clock, log });

describe('하루 예산', () => {
  it('사람마다 상한까지만 내주고, 넘는 요청은 남은 만큼만', async () => {
    const budget = budgetOf(10, 100);
    expect(await budget.take('u1', 6)).toBe(6);
    expect(await budget.take('u1', 6)).toBe(4);
    expect(await budget.take('u1', 6)).toBe(0);
    expect(await budget.remaining('u1')).toBe(0);
    // 다른 사람은 자기 몫이 있다
    expect(await budget.take('u2', 6)).toBe(6);
    expect(await budget.remaining('u2')).toBe(4);
  });

  it('서버 전체 상한이 사람마다 상한보다 먼저 닿으면 그것이 이긴다 — 여러 계정으로 나눠도 천장은 하나다', async () => {
    const budget = budgetOf(10, 15);
    expect(await budget.take('u1', 10)).toBe(10);
    expect(await budget.take('u2', 10)).toBe(5);
    expect(await budget.take('u3', 10)).toBe(0);
    expect(await budget.remaining('u3')).toBe(0);
    expect(await budget.remaining(undefined)).toBe(0);
  });

  it('사람을 모르는 호출은 전체 예산만 쓴다', async () => {
    const budget = budgetOf(1, 5);
    expect(await budget.take(undefined, 3)).toBe(3);
    expect(await budget.remaining(undefined)).toBe(2);
    expect(await budget.remaining('u1')).toBe(1);
  });

  it('한꺼번에 몰려와도 내준 합이 상한을 넘지 않는다(순차 정확성 — PGlite는 트랜잭션을 직렬로 돈다)', async () => {
    const budget = budgetOf(1000, 50);
    const grants = await Promise.all(Array.from({ length: 12 }, (_, i) => budget.take(`u${i % 3}`, 7)));
    expect(grants.reduce((a, b) => a + b, 0)).toBe(50);
  });

  it('날짜(UTC)가 바뀌면 다시 센다 — 오래된 날의 행은 치운다', async () => {
    const budget = budgetOf(5, 100);
    expect(await budget.take('u1', 5)).toBe(5);
    expect(await budget.take('u1', 1)).toBe(0);
    clock = new Date('2026-10-03T00:00:01Z');
    expect(await budget.take('u1', 5)).toBe(5);
    clock = new Date('2026-10-20T00:00:00Z');
    await budget.take('u1', 1);
    const days = (await db.db.select({ day: legFillUsage.day }).from(legFillUsage)).map((r) => r.day);
    expect([...new Set(days)]).toEqual(['2026-10-20']);
  });

  it('저장소가 실패하면 0 — 셀 수 없을 때 유료 조회를 열어 두지 않는다', async () => {
    const broken: LegFillUsageRepository = {
      async used() { throw new Error('db down'); },
      async reserve() { throw new Error('db down'); }
    };
    const logs: string[] = [];
    const budget = createLegBudget({ repo: broken, limits: DEFAULT_LEG_FILL_LIMITS, log: (m) => logs.push(m) });
    expect(await budget.take('u1', 3)).toBe(0);
    expect(await budget.remaining('u1')).toBe(0);
    expect(logs).toHaveLength(1);
  });

  it('소진은 그날 한 번만 알린다 — 요청마다 같은 줄을 남기지 않는다. 사용자 id는 로그에 없다', async () => {
    const logs: string[] = [];
    const budget = budgetOf(1, 100, (m) => logs.push(m));
    await budget.take('00000000-0000-0000-0000-00000000000a', 3);
    await budget.take('00000000-0000-0000-0000-00000000000a', 3);
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toContain('00000000');
  });
});

describe('readLegFillLimits', () => {
  it('비었으면 기본값, 0은 유효하다(유료 조회만 멈추는 비상 스위치)', () => {
    expect(readLegFillLimits({})).toEqual(DEFAULT_LEG_FILL_LIMITS);
    expect(readLegFillLimits({ LEG_FILL_USER_DAILY: '300', LEG_FILL_TOTAL_DAILY: '0' })).toEqual({ perUserDaily: 300, totalDaily: 0 });
  });

  it('이상한 값은 기본값으로 — 그리고 알린다', () => {
    const warned: string[] = [];
    expect(readLegFillLimits({ LEG_FILL_USER_DAILY: '-1', LEG_FILL_TOTAL_DAILY: 'lots' }, (m) => warned.push(m))).toEqual(DEFAULT_LEG_FILL_LIMITS);
    expect(warned).toHaveLength(2);
  });
});
