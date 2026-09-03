// 이관 실행기. docs/backup-restore.md가 나열한 함정을 코드로 막는다:
//
//   1. FK 순서대로 넣고, 되돌릴 때는 역순으로 비운다
//   2. identity 시퀀스를 다시 맞춘다 — 안 하면 전환 후 **첫 쓰기가 중복키로 죽는다**
//   3. trip_activity 알림 트리거를 끄고 넣는다 — 행마다 pg_notify가 나가면 알림 폭풍이다
//   4. 원본에 없는 테이블(운영 미적용 3개)은 '없음'으로 보고하고 실패로 치지 않는다
//   5. 두 번 돌려도 같다(멱등) — 리허설을 반복할 수 있어야 한다
//
// 컬럼 매핑은 손으로 적지 않는다: Drizzle 테이블에서 컬럼 이름·타입을 읽어 원본 행과 교집합을 취한다.
// 새 스키마에 없는 원본 컬럼은 버리되 **무엇을 버렸는지 보고**한다 — 조용히 잃지 않는다.
import { getTableColumns, sql, type Column } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

import type { Db } from '../infrastructure/database/db';
import {
  MIGRATION_ORDER, MIGRATION_TABLES, type ImportReport, type MigratedTable,
  type MigrationSource, type SourceRow, type TableImportReport
} from './types';

/** 한 번에 넣는 행 수 — 파라미터 한도(65535)와 메모리 사이의 타협 */
const BATCH = 500;

interface ColumnInfo { tsName: string; column: Column }

/** DB 컬럼 이름 → { TS 속성 이름, 컬럼 } */
function columnsByDbName(table: PgTable): Map<string, ColumnInfo> {
  const map = new Map<string, ColumnInfo>();
  for (const [tsName, column] of Object.entries(getTableColumns(table))) {
    map.set((column as Column).name, { tsName, column: column as Column });
  }
  return map;
}

/**
 * 덤프에서 온 값을 컬럼 타입에 맞춘다.
 * ⚠️ 드라이버마다 모양이 다르다: node-postgres는 **bigint를 문자열로** 주고(PGlite는 number),
 * CSV를 거치면 날짜도 문자열이다. R1에서만 터지지 않도록 여기서 흡수한다.
 */
function coerce(value: unknown, column: Column): unknown {
  if (value == null) return null;
  if (column.dataType === 'date' && !(value instanceof Date)) return new Date(String(value));
  if (column.dataType === 'number' && typeof value === 'string') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`숫자가 아닌 값: ${value}`);
    return n;
  }
  if (column.dataType === 'boolean' && typeof value === 'string') return value === 't' || value === 'true';
  return value;
}

async function importTable(
  db: Db, table: MigratedTable, source: MigrationSource
): Promise<TableImportReport> {
  const rows = await source.rows(table);
  if (rows === null) return { table, sourceRows: null, inserted: 0, droppedColumns: [] };

  const target = MIGRATION_TABLES[table] as PgTable;
  const columns = columnsByDbName(target);
  const dropped = new Set<string>();
  const mapped = rows.map((row: SourceRow) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const info = columns.get(key);
      if (!info) { dropped.add(key); continue; }
      out[info.tsName] = coerce(value, info.column);
    }
    return out;
  });

  let inserted = 0;
  for (let i = 0; i < mapped.length; i += BATCH) {
    const batch = mapped.slice(i, i + BATCH);
    try {
      // 멱등: 이미 있는 기본키는 건드리지 않는다(두 번 돌려도 같다)
      const result = await db.insert(target).values(batch).onConflictDoNothing().returning({ marker: sql<number>`1` });
      inserted += result.length;
    } catch (e) {
      // 참조가 깨진 행 등 — 조용히 버리지 않고 어느 테이블에서 멈췄는지 알린다
      throw new Error(`[migration] ${table} 삽입 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { table, sourceRows: rows.length, inserted, droppedColumns: [...dropped].sort() };
}

/**
 * identity 컬럼의 시퀀스를 현재 최대값 다음으로 올린다.
 * 카탈로그에서 **시퀀스가 실제로 붙어 있는 컬럼만** 찾는다 — uuid 기본키에 max()를 걸지 않기 위해서다.
 */
/**
 * identity 시퀀스를 데이터의 max(id)로 다시 맞춘다.
 * ⚠️ setval은 **트랜잭션을 따르지 않는다** — 되돌려도 시퀀스 값은 남는다.
 * 그래서 예행(trial)에서는 실행하지 않고 무엇을 맞출지만 돌려준다.
 */
async function resetSequences(db: Db, opts: { apply: boolean }): Promise<string[]> {
  const names = MIGRATION_ORDER.map((t) => sql`${t}`);
  const { rows } = (await db.execute(sql`
    select c.relname::text as tbl, a.attname::text as col,
           pg_get_serial_sequence(c.relname, a.attname) as seq
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where c.relname in (${sql.join(names, sql`, `)})
       and pg_get_serial_sequence(c.relname, a.attname) is not null
     order by c.relname, a.attname`)) as { rows: { tbl: string; col: string; seq: string }[] };

  const reset: string[] = [];
  for (const row of rows) {
    if (!opts.apply) { reset.push(`${row.tbl}.${row.col}`); continue; }
    await db.execute(sql`
      select setval(${row.seq}::regclass,
                    coalesce((select max(${sql.identifier(row.col)}) from ${sql.identifier(row.tbl)}), 0) + 1,
                    false)`);
    reset.push(`${row.tbl}.${row.col}`);
  }
  return reset;
}

export interface ImportOptions {
  /** 넣기 전에 대상 테이블을 비운다(역순). 전환 당일처럼 "정확히 같게" 만들 때 */
  reset?: boolean;
  /**
   * 예행 — 전부 해 본 뒤 **되돌린다**. 대상에는 아무것도 남지 않는다.
   * 전환 당일의 중단 시간에 처음 돌려 보는 일이 없게 한다(§61).
   */
  trial?: boolean;
  /**
   * 커밋(또는 되돌리기) 직전에 **같은 트랜잭션 안에서** 돌릴 검사.
   * 여기서 던지면 이관 전체가 없던 일이 된다 — "검증을 통과하지 못하면 전환하지 않는다"를
   * 사람의 판단이 아니라 도구가 지킨다(§79).
   */
  inTransaction?: (tx: Db) => Promise<void>;
}

/** 예행에서 트랜잭션을 되돌리기 위한 신호. 실패가 아니다 */
class TrialRollback extends Error {
  constructor(readonly report: ImportReport) { super('trial rollback'); }
}

/**
 * 전부 **한 트랜잭션**에서 옮긴다 — 중간에 걸리면 대상은 손대기 전 그대로다.
 * 나눠서 커밋하면 14개 중 7번째에서 제약에 걸렸을 때 반쯤 채워진 DB가 남고,
 * 그것을 전환 당일 중단 시간에 수습해야 한다.
 */
export async function importAll(db: Db, source: MigrationSource, opts: ImportOptions = {}): Promise<ImportReport> {
  const run = async (tx: Db): Promise<ImportReport> => {
    if (opts.reset) {
      const names = [...MIGRATION_ORDER].reverse().map((t) => sql.identifier(t));
      await tx.execute(sql`truncate table ${sql.join(names, sql`, `)} restart identity cascade`);
    }

    // 활동 행이 들어갈 때마다 실시간 알림이 나가면 안 된다(마이그레이션 0004의 트리거).
    // 되돌리기는 트랜잭션이 같이 해 주므로 finally로 감싸지 않는다 —
    // 이미 실패한 트랜잭션 안에서 alter를 또 부르면 원래 오류가 그것으로 덮인다.
    await tx.execute(sql`alter table trip_activity disable trigger tc_notify_activity`);
    const tables: TableImportReport[] = [];
    for (const table of MIGRATION_ORDER) tables.push(await importTable(tx, table, source));
    const sequencesReset = await resetSequences(tx, { apply: !opts.trial });
    await tx.execute(sql`alter table trip_activity enable trigger tc_notify_activity`);

    const report: ImportReport = { ok: true, tables, sequencesReset };
    if (opts.inTransaction) await opts.inTransaction(tx);   // 검증이 여기서 던지면 통째로 되돌아간다
    return report;
  };

  try {
    return await db.transaction(async (tx) => {
      const report = await run(tx as unknown as Db);
      if (opts.trial) throw new TrialRollback(report);
      return report;
    });
  } catch (err) {
    if (err instanceof TrialRollback) return err.report;
    throw err;
  }
}
