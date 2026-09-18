// 서버 환율 저장소 — PostgreSQL. 하루에 한 행이고, 가장 최근 날을 읽는다.
import { desc } from 'drizzle-orm';

import type { FxRateRepository, FxRateRow } from '../../repositories/types';
import type { Db } from './db';
import { fxRates } from './schema';

export class PgFxRateRepository implements FxRateRepository {
  constructor(private readonly db: Db) {}

  async latest(): Promise<FxRateRow | null> {
    const [row] = await this.db.select().from(fxRates).orderBy(desc(fxRates.day)).limit(1);
    return row ? { day: row.day, rates: row.rates, fetchedAt: row.fetchedAt } : null;
  }

  async put(row: Omit<FxRateRow, 'fetchedAt'>): Promise<void> {
    const values = { day: row.day, rates: row.rates, fetchedAt: new Date() };
    await this.db.insert(fxRates).values(values)
      .onConflictDoUpdate({ target: fxRates.day, set: values });
  }
}
