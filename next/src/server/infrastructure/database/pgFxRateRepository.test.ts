// 서버 환율 저장소 — PGlite(진짜 PostgreSQL) 위에서 같은 마이그레이션(0013)으로 돌린다.
import { count } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { PgFxRateRepository } from './pgFxRateRepository';
import { fxRates } from './schema';
import { createTestDatabase, type TestDatabase } from './testDb';

let db: TestDatabase;
let fx: PgFxRateRepository;

beforeEach(async () => {
  db = await createTestDatabase();
  fx = new PgFxRateRepository(db.db);
});

describe('fx_rates', () => {
  it('받은 적이 없으면 null — 없는 시세를 지어내지 않는다', async () => {
    expect(await fx.latest()).toBeNull();
  });

  it('가장 최근 날을 돌려준다 — 넣은 순서가 아니라 날짜 순', async () => {
    await fx.put({ day: '2026-09-18', rates: { KRW: 1, USD: 1400, EUR: 1550, JPY: 9.3, CNY: 199 } });
    await fx.put({ day: '2026-09-15', rates: { KRW: 1, USD: 1390, EUR: 1540, JPY: 9.2, CNY: 198 } });
    const latest = await fx.latest();
    expect(latest?.day).toBe('2026-09-18');
    expect(latest?.rates.USD).toBe(1400);
    expect(latest?.fetchedAt).toBeInstanceOf(Date);
  });

  it('같은 날을 다시 넣으면 덮어쓴다 — 하루에 한 행', async () => {
    await fx.put({ day: '2026-09-18', rates: { KRW: 1, USD: 1400, EUR: 1550, JPY: 9.3, CNY: 199 } });
    await fx.put({ day: '2026-09-18', rates: { KRW: 1, USD: 1402, EUR: 1551, JPY: 9.31, CNY: 199.5 } });
    const [{ n }] = await db.db.select({ n: count() }).from(fxRates);
    expect(n).toBe(1);
    expect((await fx.latest())?.rates.USD).toBe(1402);
  });
});
