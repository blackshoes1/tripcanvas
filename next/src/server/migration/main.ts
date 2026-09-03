// 이관 실행 진입점(R1·전환 당일). 절차는 docs/backup-restore.md.
//
//   LEGACY_DATABASE_URL  운영 덤프를 복원한 **사본**. 운영 DB를 직접 가리키지 않는다
//   DATABASE_URL         새 PostgreSQL(대상)
//
//   npm run tools:build && npm run migrate:import -- --reset
//
// 기본은 **검사만**(dry-run)이다: 무엇이 옮겨질지 세어 보고만 하고 쓰지 않는다. 실제로 쓰려면 --apply를 준다.
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../infrastructure/database/schema';
import { importAll } from './importer';
import { createPgSource, pgSourceClient } from './pgSource';
import { MIGRATION_ORDER } from './types';
import { verifyMigration } from './verify';

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const reset = args.has('--reset');
  const legacyUrl = process.env.LEGACY_DATABASE_URL ?? '';
  const targetUrl = process.env.DATABASE_URL ?? '';

  if (!legacyUrl || !targetUrl) {
    console.error('[migration] LEGACY_DATABASE_URL(복원한 사본)과 DATABASE_URL(대상)이 필요하다');
    process.exitCode = 1;
    return;
  }
  if (legacyUrl === targetUrl) {
    console.error('[migration] 원본과 대상이 같다 — 사본을 가리키고 있는지 확인할 것');
    process.exitCode = 1;
    return;
  }

  const legacy = await pgSourceClient(legacyUrl);
  const pool = new Pool({ connectionString: targetUrl, max: 4 });
  const db = drizzle(pool, { schema });
  const source = createPgSource(legacy, { usersTable: process.env.LEGACY_USERS_TABLE || undefined });

  try {
    if (!apply) {
      console.log('[migration] 검사만 한다(dry-run). 실제로 옮기려면 --apply\n');
      for (const table of MIGRATION_ORDER) {
        const rows = await source.rows(table);
        console.log(`  ${table.padEnd(24)} ${rows === null ? '원본에 없음' : `${rows.length}행`}`);
      }
      return;
    }

    console.log(`[migration] 이관 시작${reset ? ' (대상을 비우고)' : ''}`);
    const started = Date.now();
    const report = await importAll(db, source, { reset });
    for (const t of report.tables) {
      const dropped = t.droppedColumns.length ? `  버린 컬럼: ${t.droppedColumns.join(', ')}` : '';
      console.log(`  ${t.table.padEnd(24)} ${t.sourceRows === null ? '원본에 없음' : `${t.sourceRows}행 → ${t.inserted}건 삽입`}${dropped}`);
    }
    console.log(`  시퀀스 재설정: ${report.sequencesReset.length}개`);
    console.log(`  걸린 시간: ${Math.round((Date.now() - started) / 1000)}초\n`);

    const verification = await verifyMigration(db, source);
    console.log(verification.text());
    if (!verification.ok) {
      console.error('\n[migration] 검증 실패 — 전환하지 않는다');
      process.exitCode = 1;
    }
  } finally {
    await legacy.end();
    await pool.end();
  }
}

void main();
