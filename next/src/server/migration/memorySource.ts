// R0용 원본 — 합성 데이터. 테스트가 운영에서 올 법한 모양을 그대로 적어 넣는다.
import type { MigratedTable, MigrationSource, SourceRow } from './types';

export class MemorySource implements MigrationSource {
  constructor(readonly tables: Partial<Record<MigratedTable, SourceRow[] | null>>) {}

  async rows(table: MigratedTable): Promise<SourceRow[] | null> {
    const value = this.tables[table];
    return value === undefined ? [] : value;
  }
}
