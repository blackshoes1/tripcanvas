// 테스트용 DB — PGlite(PostgreSQL을 WASM으로, 메모리 안). 운영과 같은 마이그레이션 SQL을 적용하므로
// 스키마·제약·트랜잭션이 진짜 PostgreSQL 그대로 검증된다. 로컬에 PostgreSQL이 없어도 된다.
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import type { Db } from './db';
import { MIGRATIONS_FOLDER } from './migrationsPath';
import * as schema from './schema';

export interface TestDatabase {
  db: Db;
  close(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, close: () => client.close() };
}
