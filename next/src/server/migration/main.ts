// 이관 실행 진입점(R1·전환 당일). 절차는 docs/backup-restore.md.
//
//   LEGACY_DATABASE_URL  운영 덤프를 복원한 **사본**. 운영 DB를 직접 가리키지 않는다
//   DATABASE_URL         새 PostgreSQL(대상)
//
//   npm run tools:build
//   npm run migrate:import                      세어만 본다 (원본만 읽는다)
//   npm run migrate:import -- --trial --reset   전부 해 보고 **되돌린다** — 예행(R1·R2)
//   npm run migrate:import -- --apply --reset   실제로 옮긴다 (전환 당일)
//
// --trial과 --apply는 같은 경로를 지난다. 다른 것은 마지막에 커밋하느냐뿐이라,
// 예행이 통과했는데 당일에 처음 보는 오류가 나는 일이 없다.
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../infrastructure/database/schema';
import { importAll } from './importer';
import { createPgSource, pgSourceClient } from './pgSource';
import { MIGRATION_ORDER } from './types';
import { verifyMigration, type VerificationReport } from './verify';

/** 검증 실패를 트랜잭션 밖으로 알리는 신호 */
class VerificationFailed extends Error {}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const trial = args.has('--trial');
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
    if (!apply && !trial) {
      console.log('[migration] 세어만 본다. 예행은 --trial, 실제 이관은 --apply\n');
      for (const table of MIGRATION_ORDER) {
        const rows = await source.rows(table);
        console.log(`  ${table.padEnd(24)} ${rows === null ? '원본에 없음' : `${rows.length}행`}`);
      }
      return;
    }

    console.log(`[migration] ${trial ? '예행 — 끝나면 되돌린다' : '이관'} 시작${reset ? ' (대상을 비우고)' : ''}`);
    const started = Date.now();
    let verification: VerificationReport | undefined;
    // 검증을 **커밋 전에** 같은 트랜잭션에서 돌린다. 어긋나면 던져서 통째로 되돌린다 —
    // "통과하지 못하면 전환하지 않는다"를 사람이 리포트를 읽고 지키는 대신 도구가 지킨다(§79).
    const report = await importAll(db, source, {
      reset, trial,
      inTransaction: async (tx) => {
        verification = await verifyMigration(tx, source);
        if (!verification.ok) throw new VerificationFailed();
      }
    });
    for (const t of report.tables) {
      const dropped = t.droppedColumns.length ? `  버린 컬럼: ${t.droppedColumns.join(', ')}` : '';
      console.log(`  ${t.table.padEnd(24)} ${t.sourceRows === null ? '원본에 없음' : `${t.sourceRows}행 → ${t.inserted}건 삽입`}${dropped}`);
    }
    console.log(`  시퀀스 재설정: ${report.sequencesReset.length}개`);
    console.log(`  걸린 시간: ${Math.round((Date.now() - started) / 1000)}초\n`);

    if (verification) console.log(verification.text());
    console.log(trial
      ? '\n[migration] 예행 통과 — 되돌렸으므로 대상은 그대로다. 당일에는 --apply로 같은 것을 돌린다'
      : '\n[migration] 이관 완료');
  } catch (err) {
    if (err instanceof VerificationFailed) {
      console.error('\n[migration] 검증 실패 — 아무것도 쓰지 않고 되돌렸다. 전환하지 않는다');
    } else {
      console.error(`\n[migration] 중단 — 되돌렸다: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exitCode = 1;
  } finally {
    await legacy.end();
    await pool.end();
  }
}

void main();
