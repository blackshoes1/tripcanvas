// 이관 검증(§79·§80). **"돌았다"가 아니라 "같다"**를 판정한다 — 통과하지 못하면 전환하지 않는다.
//
// 표본이 아니라 전수로 본다: 개수 · 관계 무결성 · 내용(문서 해시). 개수만 맞고 내용이 어긋나는 사고가
// 가장 알아채기 어렵기 때문에, 여행 문서는 한 글자 단위로 비교한다.
import { sql } from 'drizzle-orm';

import type { Db } from '../infrastructure/database/db';
import { MIGRATION_ORDER, type MigratedTable, type MigrationSource, type SourceRow } from './types';

export interface CountCheck { table: MigratedTable; source: number | null; target: number; ok: boolean }
export interface OrphanCheck { check: string; count: number }
export interface ContentCheck { check: string; ok: boolean; detail: string }

export interface VerificationReport {
  ok: boolean;
  counts: CountCheck[];
  orphans: OrphanCheck[];
  content: ContentCheck[];
  /** 사람이 읽는 리포트 — 리허설 결과로 남긴다 */
  text(): string;
}

/** 키 순서를 정규화한 문자열. jsonb를 거치면 키 순서가 바뀌므로 그대로 비교하면 안 된다 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** 원본과 대상을 키로 맞춰 값을 비교한다. 어긋난 키를 최대 5개까지 알린다 */
function compareByKey(
  sourceRows: SourceRow[], targetRows: Record<string, unknown>[],
  keyOf: (row: Record<string, unknown>) => string, valueOf: (row: Record<string, unknown>) => string
): { ok: boolean; detail: string } {
  const target = new Map(targetRows.map((r) => [keyOf(r), valueOf(r)]));
  const bad: string[] = [];
  for (const row of sourceRows) {
    const key = keyOf(row);
    const expected = valueOf(row);
    const actual = target.get(key);
    if (actual === undefined) bad.push(`${key}(없음)`);
    else if (actual !== expected) bad.push(key);
    if (bad.length >= 5) break;
  }
  const extra = target.size - sourceRows.length;
  if (extra > 0) bad.push(`대상에만 ${extra}건`);
  return { ok: bad.length === 0, detail: bad.length ? `어긋남: ${bad.join(', ')}` : `${sourceRows.length}건 일치` };
}

export async function verifyMigration(db: Db, source: MigrationSource): Promise<VerificationReport> {
  const counts: CountCheck[] = [];
  for (const table of MIGRATION_ORDER) {
    const rows = await source.rows(table);
    const { rows: got } = (await db.execute(sql`select count(*)::int as n from ${sql.identifier(table)}`)) as { rows: { n: number }[] };
    const target = Number(got[0]?.n ?? 0);
    // 원본에 테이블이 없던 것(운영 미적용)은 건너뛴 것으로 본다 — 대상이 비어 있으면 정상이다
    counts.push({ table, source: rows === null ? null : rows.length, target, ok: rows === null ? target === 0 : rows.length === target });
  }

  // 관계 무결성 — 운영 덤프에 깨진 참조가 섞여 있을 수 있어 외래키와 별개로 다시 센다
  const orphanQueries: [string, ReturnType<typeof sql>][] = [
    ['trips → users', sql`select count(*)::int as n from trips t left join users u on u.id = t.user_id where u.id is null`],
    ['trip_members → trips', sql`select count(*)::int as n from trip_members m left join trips t on t.id = m.trip_id where t.id is null`],
    ['trip_members → users', sql`select count(*)::int as n from trip_members m left join users u on u.id = m.user_id where u.id is null`],
    ['candidate_reactions → trip_candidates', sql`select count(*)::int as n from candidate_reactions r left join trip_candidates c on c.id = r.candidate_id where c.id is null`],
    ['trip_comments → trip_candidates', sql`select count(*)::int as n from trip_comments cm left join trip_candidates c on c.id = cm.candidate_id where c.id is null`],
    ['trip_activity → trips', sql`select count(*)::int as n from trip_activity a left join trips t on t.id = a.trip_id where t.id is null`],
    ['trip_snapshots → users', sql`select count(*)::int as n from trip_snapshots s left join users u on u.id = s.user_id where u.id is null`]
  ];
  const orphans: OrphanCheck[] = [];
  for (const [check, query] of orphanQueries) {
    const { rows } = (await db.execute(query)) as { rows: { n: number }[] };
    orphans.push({ check, count: Number(rows[0]?.n ?? 0) });
  }

  // 내용 — 여행 문서와 스냅샷은 개수가 아니라 본문이 같아야 한다
  const content: ContentCheck[] = [];
  const sourceTrips = (await source.rows('trips')) ?? [];
  const { rows: targetTrips } = (await db.execute(sql`select client_id, user_id, revision, data from trips`)) as { rows: Record<string, unknown>[] };
  const tripKey = (r: Record<string, unknown>) => `${String(r.user_id)}/${String(r.client_id)}`;
  content.push({ check: 'trips.data', ...compareByKey(sourceTrips, targetTrips, tripKey, (r) => stableStringify(r.data)) });
  content.push({ check: 'trips.revision', ...compareByKey(sourceTrips, targetTrips, tripKey, (r) => String(Number(r.revision))) });

  const sourceSnapshots = (await source.rows('trip_snapshots')) ?? [];
  const { rows: targetSnapshots } = (await db.execute(sql`select id, data from trip_snapshots`)) as { rows: Record<string, unknown>[] };
  content.push({
    check: 'trip_snapshots.data',
    ...compareByKey(sourceSnapshots, targetSnapshots, (r) => String(r.id), (r) => stableStringify(r.data))
  });

  const ok = counts.every((c) => c.ok) && orphans.every((o) => o.count === 0) && content.every((c) => c.ok);
  return {
    ok, counts, orphans, content,
    text() {
      const lines: string[] = [`이관 검증: ${ok ? '통과' : '실패'}`, '', '[개수]  테이블  원본  대상'];
      for (const c of counts) {
        lines.push(c.source === null
          ? `  ${c.table}  —  ${c.target}  (원본에 없음${c.ok ? '' : ' — 그런데 대상에 행이 있다'})`
          : `  ${c.table}  ${c.source}  ${c.target}  ${c.ok ? 'ok' : '불일치'}`);
      }
      lines.push('', '[고아 행]');
      for (const o of orphans) lines.push(`  ${o.check}: ${o.count}${o.count ? '  ← 문제' : ''}`);
      lines.push('', '[내용]');
      for (const c of content) lines.push(`  ${c.check}: ${c.ok ? 'ok' : '불일치'} — ${c.detail}`);
      return lines.join('\n');
    }
  };
}
