// 운영 DB 연결(node-postgres). 프로세스당 Pool 하나. DATABASE_URL이 없으면 null — 호출측은 레거시 경로로 간다.
// 마이그레이션 적용은 `npm run db:migrate`(drizzle-kit migrate, 같은 migrations 폴더) — 컨테이너 시작 전에 돈다(§62).
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { getEnv } from '../../config/env';
import type { Db } from './db';
import * as schema from './schema';

let pool: Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;

export function getDb(): Db | null {
  const url = getEnv().databaseUrl;
  if (!url) return null;
  if (!db) {
    pool = new Pool({ connectionString: url, max: 5 });
    db = drizzle(pool, { schema });
  }
  return db;
}

export async function checkDatabase(): Promise<void> {
  const d = getDb();
  if (!d) throw new Error('DATABASE_URL 없음');
  await d.execute(sql`select 1`);
}

export async function closeDatabase(): Promise<void> {
  await pool?.end();
  pool = null;
  db = null;
}
