// PostgreSQL → PostgreSQL 검증 — 원본(예: NAS 덤프를 복원한 DB)과 대상(예: 관리형 PostgreSQL)이 **같은가**를 판정한다.
//
// verify.ts가 Supabase→새 스키마 이관을 검증했다면, 여기는 **같은 스키마의 두 PostgreSQL**을 비교한다.
// 호스팅을 옮길 때(docs/managed-db-migration.md) 덤프·복원이 "돌았다"가 아니라 "같다"를 판정하는 것이 이 파일이다.
//
// 표본이 아니라 전수로 본다. 검사 하나하나가 PASS / FAIL / SKIP 셋 중 하나이고,
// **SKIP은 통과가 아니다** — 하나라도 SKIP이면 전체는 INCOMPLETE(종료 코드 2)다.
// 원본·대상 어느 쪽에도 쓰지 않는다: 보내는 SQL은 `set time zone`과 `select`뿐이다.
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** pg Client · Pool · PGlite가 모두 만족하는 최소 계약 */
export interface DbClient {
  query(text: string): Promise<{ rows: Record<string, unknown>[] }>;
}

export type CheckStatus = 'PASS' | 'FAIL' | 'SKIP';
export interface DbCheck { group: string; name: string; status: CheckStatus; detail: string }
export type VerdictStatus = 'PASS' | 'FAIL' | 'INCOMPLETE';

export interface DbVerificationReport {
  status: VerdictStatus;
  checks: DbCheck[];
  summary: { pass: number; fail: number; skip: number };
  /** 사람이 읽는 리포트 — 리허설 결과로 남긴다 */
  text(): string;
}

/** 저장소의 drizzle 마이그레이션 journal — 대상이 코드와 같은 스키마 버전인지 본다 */
export interface RepoJournal { tags: string[]; lastWhen: number }

export interface VerifyDbOptions {
  /** 비교할 스키마. 기본은 public + drizzle(마이그레이션 이력) */
  schemas?: string[];
  /** 내용 비교에서 제외할 테이블(예: 세션 만료로 늘 달라지는 표). **제외는 SKIP으로 남는다** */
  ignoreTables?: string[];
  /** 저장소 journal — 있으면 대상이 코드의 마이그레이션을 전부 적용했는지 본다 */
  repoJournal?: RepoJournal | null;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 식별자는 카탈로그에서 읽지만 그래도 검사한다 — 이상한 이름을 SQL에 그대로 끼우지 않는다 */
function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`[verify-db] 식별자가 올바르지 않다: ${name}`);
  return `"${name}"`;
}
function literal(value: string): string { return `'${value.replace(/'/g, "''")}'`; }
function schemaList(schemas: string[]): string { return schemas.map(literal).join(', '); }

export function readRepoJournal(migrationsFolder: string): RepoJournal {
  const raw = JSON.parse(readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string; when: number }[];
  };
  const entries = raw.entries ?? [];
  return { tags: entries.map((e) => e.tag), lastWhen: entries.length ? Number(entries[entries.length - 1].when) : 0 };
}

interface TableRef { schema: string; table: string }
interface ColumnInfo { name: string; type: string; nullable: string; def: string | null; identity: string }

type Rows = Record<string, unknown>[];
const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

async function q(client: DbClient, text: string): Promise<Rows> {
  return (await client.query(text)).rows;
}

async function listTables(client: DbClient, schemas: string[]): Promise<TableRef[]> {
  const rows = await q(client, `select schemaname, tablename from pg_tables where schemaname in (${schemaList(schemas)}) order by 1, 2`);
  return rows.map((r) => ({ schema: s(r.schemaname), table: s(r.tablename) }));
}

async function listColumns(client: DbClient, t: TableRef): Promise<ColumnInfo[]> {
  const rows = await q(client,
    `select column_name, data_type, is_nullable, column_default, is_identity from information_schema.columns
     where table_schema = ${literal(t.schema)} and table_name = ${literal(t.table)} order by ordinal_position`);
  return rows.map((r) => ({ name: s(r.column_name), type: s(r.data_type), nullable: s(r.is_nullable), def: r.column_default == null ? null : s(r.column_default), identity: s(r.is_identity) }));
}

function key(t: TableRef): string { return `${t.schema}.${t.table}`; }
function qualified(t: TableRef): string { return `${ident(t.schema)}.${ident(t.table)}`; }

/** 두 집합의 차이를 사람이 읽을 문장으로 */
function setDiff(a: string[], b: string[], aName: string, bName: string): string | null {
  const A = new Set(a); const B = new Set(b);
  const onlyA = a.filter((x) => !B.has(x));
  const onlyB = b.filter((x) => !A.has(x));
  if (!onlyA.length && !onlyB.length) return null;
  const parts: string[] = [];
  if (onlyA.length) parts.push(`${aName}에만: ${onlyA.slice(0, 5).join(', ')}${onlyA.length > 5 ? ` 외 ${onlyA.length - 5}` : ''}`);
  if (onlyB.length) parts.push(`${bName}에만: ${onlyB.slice(0, 5).join(', ')}${onlyB.length > 5 ? ` 외 ${onlyB.length - 5}` : ''}`);
  return parts.join(' · ');
}

/**
 * 표 하나의 내용 지문 — 행 수 + 정렬한 `to_jsonb(행)` 문자열의 md5.
 * jsonb는 키 순서가 정규화되고, 시각은 세션 time zone(UTC로 맞춘다)을 따르므로 두 DB에서 같은 값이 나온다.
 * `drop`에 든 컬럼은 빼고 본다 — 대상이 새 마이그레이션으로 컬럼을 더 가졌을 때 공통 컬럼만 비교하기 위해서다.
 */
async function fingerprint(client: DbClient, t: TableRef, drop: string[]): Promise<{ n: string; hash: string }> {
  const dropExpr = drop.length ? ` - array[${drop.map(literal).join(', ')}]::text[]` : '';
  const rows = await q(client,
    `select count(*)::text as n, coalesce(md5(string_agg(j, '' order by j)), 'empty') as h
     from (select (to_jsonb(t)${dropExpr})::text as j from ${qualified(t)} t) x`);
  return { n: s(rows[0]?.n), hash: s(rows[0]?.h) };
}

async function scalar(client: DbClient, text: string): Promise<string> {
  const rows = await q(client, text);
  const first = rows[0] ?? {};
  const k = Object.keys(first)[0];
  return k ? s(first[k]) : '';
}

export async function verifyDatabases(source: DbClient, target: DbClient, opts: VerifyDbOptions = {}): Promise<DbVerificationReport> {
  const schemas = (opts.schemas ?? ['public', 'drizzle']).map((x) => { ident(x); return x; });
  const ignored = new Set((opts.ignoreTables ?? []).map((x) => (x.includes('.') ? x : `public.${x}`)));
  const checks: DbCheck[] = [];
  const add = (group: string, name: string, status: CheckStatus, detail: string) => { checks.push({ group, name, status, detail }); };
  const same = (group: string, name: string, a: string, b: string, okDetail?: string) =>
    add(group, name, a === b ? 'PASS' : 'FAIL', a === b ? (okDetail ?? `${a}`) : `원본 ${a} ≠ 대상 ${b}`);

  // 시각을 문자열로 비교하므로 두 세션의 time zone을 맞춘다 — 서버 기본값이 다르면 같은 순간이 다르게 찍힌다
  for (const c of [source, target]) await c.query(`set time zone 'UTC'`);

  // ── 테이블 목록 ──
  const srcTables = await listTables(source, schemas);
  const dstTables = await listTables(target, schemas);
  const srcKeys = srcTables.map(key); const dstKeys = dstTables.map(key);
  const dstOnly = dstTables.filter((t) => !srcKeys.includes(key(t)));
  const srcOnly = srcTables.filter((t) => !dstKeys.includes(key(t)));
  if (srcOnly.length) {
    add('tables', 'list', 'FAIL', `원본에만 있는 표: ${srcOnly.map(key).join(', ')} — 대상에서 사라졌다`);
  } else if (dstOnly.length) {
    // 대상이 새 마이그레이션을 더 적용했으면 표가 늘 수 있다. 비어 있어야 정상이다.
    const counts = await Promise.all(dstOnly.map(async (t) => ({ t, n: await scalar(target, `select count(*)::text as n from ${qualified(t)}`) })));
    const filled = counts.filter((c) => c.n !== '0');
    add('tables', 'list', filled.length ? 'FAIL' : 'PASS',
      filled.length ? `대상에만 있는 표에 행이 있다: ${filled.map((c) => `${key(c.t)}(${c.n})`).join(', ')}`
        : `${srcTables.length}개 일치 · 대상에만(비어 있음): ${dstOnly.map(key).join(', ')}`);
  } else {
    add('tables', 'list', 'PASS', `${srcTables.length}개 일치`);
  }
  add('tables', 'count', srcTables.length === dstTables.length || (!srcOnly.length && dstOnly.length > 0) ? 'PASS' : 'FAIL',
    `원본 ${srcTables.length} · 대상 ${dstTables.length}`);

  const common = srcTables.filter((t) => dstKeys.includes(key(t)));

  // ── 표마다: 컬럼 · 행 수 · 내용 · jsonb · revision · 시각 · 집계 ──
  for (const t of common) {
    const name = key(t);
    const shortName = t.schema === 'public' ? t.table : name;
    const srcCols = await listColumns(source, t);
    const dstCols = await listColumns(target, t);
    const colSig = (c: ColumnInfo) => `${c.name}:${c.type}:${c.nullable}`;
    const colDiff = setDiff(srcCols.map(colSig), dstCols.map(colSig), '원본', '대상');
    const srcNames = srcCols.map((c) => c.name); const dstNames = dstCols.map((c) => c.name);
    const dstExtra = dstNames.filter((c) => !srcNames.includes(c));
    const srcExtra = srcNames.filter((c) => !dstNames.includes(c));
    if (srcExtra.length) add('columns', shortName, 'FAIL', `원본 컬럼이 대상에 없다: ${srcExtra.join(', ')} — 데이터가 사라진다`);
    else if (colDiff) add('columns', shortName, dstExtra.length && !colDiff.includes('원본에만') ? 'PASS' : 'FAIL', dstExtra.length ? `대상에만(새 마이그레이션): ${dstExtra.join(', ')}` : colDiff);
    else add('columns', shortName, 'PASS', `${srcCols.length}개 일치`);
    const defDiff = setDiff(
      srcCols.map((c) => `${c.name}=${c.def ?? ''}${c.identity === 'YES' ? ' identity' : ''}`),
      dstCols.filter((c) => !dstExtra.includes(c.name)).map((c) => `${c.name}=${c.def ?? ''}${c.identity === 'YES' ? ' identity' : ''}`),
      '원본', '대상');
    add('columns.defaults', shortName, defDiff ? 'FAIL' : 'PASS', defDiff ?? '일치');

    const srcN = await scalar(source, `select count(*)::text as n from ${qualified(t)}`);
    const dstN = await scalar(target, `select count(*)::text as n from ${qualified(t)}`);
    same('rows', shortName, srcN, dstN, `${srcN}행`);

    if (ignored.has(name)) {
      add('content', shortName, 'SKIP', '제외 목록(--ignore) — 내용을 비교하지 않았다');
    } else {
      const commonCols = srcNames.filter((c) => dstNames.includes(c));
      const a = await fingerprint(source, t, srcNames.filter((c) => !commonCols.includes(c)));
      const b = await fingerprint(target, t, dstNames.filter((c) => !commonCols.includes(c)));
      add('content', shortName, a.n === b.n && a.hash === b.hash ? 'PASS' : 'FAIL',
        a.n === b.n && a.hash === b.hash ? `${a.n}행 내용 일치${dstExtra.length ? ` (공통 컬럼 ${commonCols.length}개 기준)` : ''}` : `내용이 다르다 (원본 ${a.n}행 ${a.hash.slice(0, 8)} · 대상 ${b.n}행 ${b.hash.slice(0, 8)})`);

      for (const c of srcCols.filter((x) => x.type === 'jsonb' && dstNames.includes(x.name))) {
        const expr = `select count(${ident(c.name)})::text as n, coalesce(md5(string_agg(${ident(c.name)}::text, '' order by ${ident(c.name)}::text)), 'empty') as h from ${qualified(t)}`;
        const [ra] = await q(source, expr); const [rb] = await q(target, expr);
        const ok = s(ra?.n) === s(rb?.n) && s(ra?.h) === s(rb?.h);
        add('jsonb', `${shortName}.${c.name}`, ok ? 'PASS' : 'FAIL', ok ? `${s(ra?.n)}건 일치` : `원본 ${s(ra?.n)}건 ≠ 대상 ${s(rb?.n)}건 또는 본문 불일치`);
      }
    }

    if (srcNames.includes('revision') && dstNames.includes('revision')) {
      const expr = `select count(*)::text || '/' || coalesce(max(revision), 0)::text || '/' || coalesce(sum(revision), 0)::text as v from ${qualified(t)}`;
      same('revision', shortName, await scalar(source, expr), await scalar(target, expr), '행수/최대/합계 일치');
    }

    for (const col of ['updated_at', 'created_at'].filter((c) => srcNames.includes(c) && dstNames.includes(c))) {
      const expr = `select coalesce(max(${ident(col)})::text, 'none') as v from ${qualified(t)}`;
      const a = await scalar(source, expr); const b = await scalar(target, expr);
      add('timestamps', `${shortName}.${col}`, a === b ? 'PASS' : 'FAIL', a === b ? `max ${a}` : `원본 max ${a} ≠ 대상 max ${b}${b < a ? ' — 대상이 낡았다' : ''}`);
    }

    // 도메인 집계 — 열 이름으로 고른다(스키마를 손으로 적지 않는다)
    const groupCols = ['role', 'status', 'kind', 'provider', 'reaction'].filter((c) => srcNames.includes(c) && dstNames.includes(c));
    for (const col of groupCols) {
      const expr = `select coalesce(string_agg(k || '=' || n, ', ' order by k), 'empty') as v from (select coalesce(${ident(col)}::text, 'null') as k, count(*)::text as n from ${qualified(t)} group by 1) x`;
      same('aggregates', `${shortName}.${col}`, await scalar(source, expr), await scalar(target, expr));
    }
    if (srcNames.includes('deleted_at') && dstNames.includes('deleted_at')) {
      const expr = `select 'active=' || count(*) filter (where deleted_at is null) || ', tombstone=' || count(*) filter (where deleted_at is not null) as v from ${qualified(t)}`;
      same('aggregates', `${shortName}.deleted_at`, await scalar(source, expr), await scalar(target, expr));
    }
  }

  // ── 제약: PK · FK · unique · check ──
  const conQuery = `select n.nspname as sch, c.conrelid::regclass::text as tbl, c.conname as name, c.contype::text as typ, pg_get_constraintdef(c.oid) as def
     from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname in (${schemaList(schemas)}) order by 1, 2, 3`;
  const srcCons = await q(source, conQuery); const dstCons = await q(target, conQuery);
  const dstOnlyKeys = new Set(dstOnly.map(key));
  const conSig = (r: Record<string, unknown>) => `${s(r.tbl)} ${s(r.name)} ${s(r.def)}`;
  const onlyCommon = (rows: Rows) => rows.filter((r) => !dstOnlyKeys.has(`${s(r.sch)}.${s(r.tbl).replace(/^"?[^".]+"?\./, '')}`) && !dstOnlyKeys.has(`${s(r.sch)}.${s(r.tbl)}`));
  for (const [typ, label] of [['p', 'primary'], ['f', 'foreign'], ['u', 'unique'], ['c', 'check']] as const) {
    const a = srcCons.filter((r) => s(r.typ) === typ).map(conSig);
    const b = onlyCommon(dstCons).filter((r) => s(r.typ) === typ).map(conSig);
    const diff = setDiff(a, b, '원본', '대상');
    add('constraints', label, diff ? 'FAIL' : 'PASS', diff ?? `${a.length}개 일치`);
  }

  // ── 인덱스 ──
  const idxQuery = `select schemaname as sch, tablename as tbl, indexdef as def from pg_indexes where schemaname in (${schemaList(schemas)}) order by 1, 2, indexname`;
  const srcIdx = await q(source, idxQuery); const dstIdx = (await q(target, idxQuery)).filter((r) => !dstOnlyKeys.has(`${s(r.sch)}.${s(r.tbl)}`));
  const idxDiff = setDiff(srcIdx.map((r) => s(r.def)), dstIdx.map((r) => s(r.def)), '원본', '대상');
  add('indexes', 'definitions', idxDiff ? 'FAIL' : 'PASS', idxDiff ?? `${srcIdx.length}개 일치`);

  // ── 외래키 고아 행(대상) — 제약이 같아도 restore 옵션에 따라 검사가 꺼진 적재가 있을 수 있어 한 번 더 센다 ──
  const fkRows = await q(target,
    `select n.nspname as sch, cl.relname as tbl, c.conname as name,
            (select string_agg(quote_ident(a.attname), ',' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols,
            rn.nspname as rsch, rc.relname as rtbl,
            (select string_agg(quote_ident(a.attname), ',' order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as rcols
     from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace
          join pg_class rc on rc.oid = c.confrelid join pg_namespace rn on rn.oid = rc.relnamespace
     where c.contype = 'f' and n.nspname in (${schemaList(schemas)}) order by 1, 2, 3`);
  let orphanTotal = 0; const orphanDetail: string[] = [];
  for (const fk of fkRows) {
    const cols = s(fk.cols).split(','); const rcols = s(fk.rcols).split(',');
    const on = cols.map((c, i) => `t.${c} = r.${rcols[i]}`).join(' and ');
    const notNull = cols.map((c) => `t.${c} is not null`).join(' and ');
    const n = Number(await scalar(target,
      `select count(*)::text as n from ${ident(s(fk.sch))}.${ident(s(fk.tbl))} t left join ${ident(s(fk.rsch))}.${ident(s(fk.rtbl))} r on ${on} where ${notNull} and r.${rcols[0]} is null`));
    if (n > 0) { orphanTotal += n; orphanDetail.push(`${s(fk.tbl)}.${s(fk.name)}=${n}`); }
  }
  add('constraints', 'orphans(target)', fkRows.length === 0 ? 'SKIP' : orphanTotal ? 'FAIL' : 'PASS',
    fkRows.length === 0 ? '대상에 외래키가 없다' : orphanTotal ? `고아 행: ${orphanDetail.join(', ')}` : `외래키 ${fkRows.length}개 · 고아 0`);

  // ── 시퀀스 ──
  const seqQuery = `select schemaname || '.' || sequencename as name, coalesce(last_value::text, 'unused') as v from pg_sequences where schemaname in (${schemaList(schemas)}) order by 1`;
  const srcSeq = await q(source, seqQuery); const dstSeq = await q(target, seqQuery);
  const dstSeqMap = new Map(dstSeq.map((r) => [s(r.name), s(r.v)]));
  const seqBad: string[] = [];
  for (const r of srcSeq) {
    const b = dstSeqMap.get(s(r.name));
    if (b === undefined) seqBad.push(`${s(r.name)}(대상에 없음)`);
    else if (b !== s(r.v)) seqBad.push(`${s(r.name)} ${s(r.v)}→${b}`);
  }
  add('sequences', 'values', srcSeq.length === 0 ? 'SKIP' : seqBad.length ? 'FAIL' : 'PASS',
    srcSeq.length === 0 ? '원본에 시퀀스가 없다' : seqBad.length ? `어긋남: ${seqBad.join(', ')}` : `${srcSeq.length}개 일치`);
  // 다음 삽입이 중복키로 죽지 않는가 — identity/serial 컬럼의 최댓값 ≤ 시퀀스 값
  const serialBad: string[] = []; let serialCount = 0;
  for (const t of common.filter((x) => x.schema === 'public')) {
    const cols = (await listColumns(target, t)).filter((c) => c.identity === 'YES' || (c.def ?? '').startsWith('nextval('));
    for (const c of cols) {
      serialCount++;
      const seq = await scalar(target, `select pg_get_serial_sequence(${literal(key(t))}, ${literal(c.name)}) as v`);
      if (!seq) continue;
      const [sch, sq] = seq.split('.');
      const last = await scalar(target, `select case when is_called then last_value else 0 end::text as v from ${ident(sch.replace(/"/g, ''))}.${ident(sq.replace(/"/g, ''))}`);
      const max = await scalar(target, `select coalesce(max(${ident(c.name)}), 0)::text as v from ${qualified(t)}`);
      if (Number(max) > Number(last)) serialBad.push(`${t.table}.${c.name} max ${max} > seq ${last}`);
    }
  }
  add('sequences', 'next-insert-safe', serialCount === 0 ? 'SKIP' : serialBad.length ? 'FAIL' : 'PASS',
    serialCount === 0 ? '자동 증가 컬럼이 없다' : serialBad.length ? `다음 삽입이 중복키로 죽는다: ${serialBad.join(', ')}` : `${serialCount}개 컬럼 안전`);

  // ── 마이그레이션 journal ──
  const journalQuery = `select hash, created_at::text as w from drizzle.__drizzle_migrations order by created_at, id`;
  const hasJournal = async (c: DbClient) => (await scalar(c, `select (to_regclass('drizzle.__drizzle_migrations') is not null)::text as v`)) === 'true';
  const srcHasJ = await hasJournal(source); const dstHasJ = await hasJournal(target);
  if (!dstHasJ) {
    add('journal', 'target', 'FAIL', '대상에 drizzle.__drizzle_migrations가 없다 — 마이그레이션을 적용하지 않았다');
  } else {
    const dstJ = await q(target, journalQuery);
    if (!srcHasJ) {
      add('journal', 'source⊆target', 'SKIP', '원본에 마이그레이션 이력이 없다(스키마만 복원한 사본?)');
    } else {
      const srcJ = await q(source, journalQuery);
      const dstSet = new Set(dstJ.map((r) => `${s(r.hash)}@${s(r.w)}`));
      const missing = srcJ.filter((r) => !dstSet.has(`${s(r.hash)}@${s(r.w)}`));
      add('journal', 'source⊆target', missing.length ? 'FAIL' : 'PASS',
        missing.length ? `원본의 마이그레이션 ${missing.length}개가 대상에 없다` : `원본 ${srcJ.length}개 모두 대상에 있음 (대상 ${dstJ.length}개)`);
    }
    if (opts.repoJournal) {
      const last = dstJ.length ? s(dstJ[dstJ.length - 1].w) : '';
      const ok = dstJ.length === opts.repoJournal.tags.length && last === String(opts.repoJournal.lastWhen);
      add('journal', 'target=repo', ok ? 'PASS' : 'FAIL',
        ok ? `${dstJ.length}개 · 마지막 ${last} = ${opts.repoJournal.tags[opts.repoJournal.tags.length - 1] ?? ''}`
          : `대상 ${dstJ.length}개(마지막 ${last || '없음'}) ≠ 저장소 ${opts.repoJournal.tags.length}개(마지막 ${opts.repoJournal.lastWhen})`);
    } else {
      add('journal', 'target=repo', 'SKIP', '저장소 journal을 주지 않았다');
    }
  }

  const summary = {
    pass: checks.filter((c) => c.status === 'PASS').length,
    fail: checks.filter((c) => c.status === 'FAIL').length,
    skip: checks.filter((c) => c.status === 'SKIP').length
  };
  const status: VerdictStatus = summary.fail ? 'FAIL' : summary.skip ? 'INCOMPLETE' : 'PASS';
  return {
    status, checks, summary,
    text() {
      const lines = [`DB 검증: ${status === 'PASS' ? '통과' : status === 'FAIL' ? '실패' : '미완료(SKIP 있음)'}`, ''];
      const width = Math.max(...checks.map((c) => `${c.group}.${c.name}`.length));
      for (const c of checks) lines.push(`${c.status.padEnd(4)}  ${`${c.group}.${c.name}`.padEnd(width)}  ${c.detail}`);
      lines.push('', `PASS ${summary.pass} · FAIL ${summary.fail} · SKIP ${summary.skip}`);
      if (summary.skip) lines.push('SKIP은 통과가 아니다 — 무엇을 못 봤는지 위에서 확인한다.');
      return lines.join('\n');
    }
  };
}
