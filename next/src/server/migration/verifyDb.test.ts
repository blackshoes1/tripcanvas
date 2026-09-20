// PostgreSQL→PostgreSQL 검증 — 같으면 통과하고, 어긋난 것은 **무엇이** 어긋났는지 이름으로 잡아야 한다.
// 두 PGlite에 같은 마이그레이션·같은 데이터를 넣고 한쪽만 건드려 본다.
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../infrastructure/database/migrationsPath';
import * as schema from '../infrastructure/database/schema';
import { readRepoJournal, verifyDatabases, type DbCheck, type DbClient } from './verifyDb';

interface Side { client: PGlite; db: DbClient; close(): Promise<void> }

async function fresh(): Promise<Side> {
  const client = new PGlite();
  await migrate(drizzle(client, { schema }), { migrationsFolder: MIGRATIONS_FOLDER });
  return {
    client,
    db: { query: async (text) => ({ rows: (await client.query(text)).rows as Record<string, unknown>[] }) },
    close: () => client.close()
  };
}

const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
const T1 = '00000000-0000-4000-8000-000000000010';
const T2 = '00000000-0000-4000-8000-000000000011';

// 기본값(gen_random_uuid·now())에 기대면 두 DB가 달라지므로 전부 명시한다 — 복원한 DB도 원본 값을 그대로 갖는다
const SEED = `
insert into users(id, email, created_at) values ('${U1}', 'owner@example.invalid', '2026-07-01T00:00:00Z'), ('${U2}', 'viewer@example.invalid', '2026-07-01T00:00:00Z');
insert into trips(id, user_id, client_id, data, revision, created_at, updated_at)
  values ('${T1}', '${U1}', 't1', '{"name":"스페인","days":[{"spots":[]}],"future":{"keep":true}}', 7, '2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z');
insert into trips(id, user_id, client_id, data, revision, deleted_at, created_at, updated_at)
  values ('${T2}', '${U1}', 't2', '{"id":"t2","days":[]}', 3, '2026-08-03T00:00:00Z', '2026-08-01T00:00:00Z', '2026-08-03T00:00:00Z');
insert into trip_members(trip_id, user_id, role, joined_at, created_at, updated_at)
  values ('${T1}', '${U1}', 'OWNER', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'),
         ('${T1}', '${U2}', 'VIEWER', '2026-08-01T01:00:00Z', '2026-08-01T01:00:00Z', '2026-08-01T01:00:00Z');
insert into trip_snapshots(user_id, client_id, name, data, source_revision, created_at)
  values ('${U1}', 't1', '옛 버전', '{"name":"스페인(옛)"}', 6, '2026-08-01T12:00:00Z');
`;

let source: Side; let target: Side;
const repo = readRepoJournal(MIGRATIONS_FOLDER);

beforeEach(async () => {
  [source, target] = await Promise.all([fresh(), fresh()]);
  await source.client.exec(SEED);
  await target.client.exec(SEED);
});
afterEach(async () => { await Promise.all([source.close(), target.close()]); });

const find = (checks: DbCheck[], group: string, name: string) =>
  checks.find((c) => c.group === group && c.name === name);

describe('verifyDatabases', () => {
  it('같은 스키마·같은 데이터면 PASS이고 SKIP이 없다', async () => {
    const report = await verifyDatabases(source.db, target.db, { repoJournal: repo });
    expect(report.status).toBe('PASS');
    expect(report.summary.fail).toBe(0);
    expect(report.summary.skip).toBe(0);
    expect(find(report.checks, 'rows', 'trips')?.detail).toBe('2행');
    expect(find(report.checks, 'jsonb', 'trips.data')?.status).toBe('PASS');
    expect(find(report.checks, 'aggregates', 'trips.deleted_at')?.detail).toBe('active=1, tombstone=1');
    expect(find(report.checks, 'aggregates', 'trip_members.role')?.detail).toBe('OWNER=1, VIEWER=1');
    expect(find(report.checks, 'sequences', 'next-insert-safe')?.status).toBe('PASS');
    expect(find(report.checks, 'constraints', 'orphans(target)')?.status).toBe('PASS');
    expect(find(report.checks, 'journal', 'target=repo')?.status).toBe('PASS');
    expect(find(report.checks, 'journal', 'source⊆target')?.status).toBe('PASS');
    expect(report.text()).toContain('DB 검증: 통과');
  });

  it('저장소 journal을 주지 않으면 그 검사는 SKIP이고 전체는 INCOMPLETE다 — SKIP은 통과가 아니다', async () => {
    const report = await verifyDatabases(source.db, target.db);
    expect(report.status).toBe('INCOMPLETE');
    expect(find(report.checks, 'journal', 'target=repo')?.status).toBe('SKIP');
    expect(report.text()).toContain('SKIP은 통과가 아니다');
  });

  it('대상의 문서 한 글자·행 하나·시퀀스가 어긋나면 각각 이름으로 잡힌다', async () => {
    await target.client.exec(`update trips set data = '{"name":"스페인!","days":[{"spots":[]}],"future":{"keep":true}}', updated_at = '2026-09-01T00:00:00Z' where client_id = 't1'`);
    await target.client.exec(`delete from trip_members where role = 'VIEWER'`);
    const { rows } = await target.client.query(`select pg_get_serial_sequence('trip_members', 'id') as s`);
    await target.client.exec(`select setval('${String((rows[0] as { s: string }).s)}', 1, true)`);

    const report = await verifyDatabases(source.db, target.db, { repoJournal: repo });
    expect(report.status).toBe('FAIL');
    expect(find(report.checks, 'content', 'trips')?.status).toBe('FAIL');
    expect(find(report.checks, 'jsonb', 'trips.data')?.status).toBe('FAIL');
    expect(find(report.checks, 'timestamps', 'trips.updated_at')?.status).toBe('FAIL');
    expect(find(report.checks, 'rows', 'trip_members')?.status).toBe('FAIL');
    expect(find(report.checks, 'aggregates', 'trip_members.role')?.status).toBe('FAIL');
    expect(find(report.checks, 'sequences', 'values')?.status).toBe('FAIL');
    // 남은 최대 id(1)가 시퀀스(1)를 넘지 않으니 안전 — 시퀀스 검사와 다음 삽입 검사는 다른 질문이다
    expect(find(report.checks, 'sequences', 'next-insert-safe')?.status).toBe('PASS');
    // 건드리지 않은 표는 여전히 통과한다 — 실패가 번지지 않는다
    expect(find(report.checks, 'content', 'users')?.status).toBe('PASS');
    expect(report.text()).toContain('DB 검증: 실패');
  });

  it('시퀀스가 실제 최대 id보다 뒤처지면 다음 삽입이 죽는다고 알린다', async () => {
    const { rows } = await target.client.query(`select pg_get_serial_sequence('trip_members', 'id') as s`);
    await target.client.exec(`select setval('${String((rows[0] as { s: string }).s)}', 1, true)`);
    const report = await verifyDatabases(source.db, target.db, { repoJournal: repo });
    const check = find(report.checks, 'sequences', 'next-insert-safe');
    expect(check?.status).toBe('FAIL');
    expect(check?.detail).toContain('trip_members.id');
  });

  it('제외한 표는 SKIP으로 남고, 원본에 없는 대상 표는 비어 있을 때만 통과한다', async () => {
    const report = await verifyDatabases(source.db, target.db, { repoJournal: repo, ignoreTables: ['auth_rate_limit'] });
    expect(find(report.checks, 'content', 'auth_rate_limit')?.status).toBe('SKIP');
    expect(report.status).toBe('INCOMPLETE');

    await target.client.exec(`create table extra_from_newer_migration(id int primary key)`);
    const empty = await verifyDatabases(source.db, target.db, { repoJournal: repo });
    expect(find(empty.checks, 'tables', 'list')?.status).toBe('PASS');
    expect(find(empty.checks, 'tables', 'list')?.detail).toContain('extra_from_newer_migration');

    await target.client.exec(`insert into extra_from_newer_migration values (1)`);
    const filled = await verifyDatabases(source.db, target.db, { repoJournal: repo });
    expect(find(filled.checks, 'tables', 'list')?.status).toBe('FAIL');
  });

  it('원본에만 있는 표는 데이터가 사라진 것이라 FAIL이다', async () => {
    await target.client.exec(`drop table leg_cache`);
    const report = await verifyDatabases(source.db, target.db, { repoJournal: repo });
    expect(find(report.checks, 'tables', 'list')?.status).toBe('FAIL');
    expect(find(report.checks, 'tables', 'list')?.detail).toContain('leg_cache');
  });

  it('대상이 새 컬럼을 더 가졌으면 공통 컬럼으로 비교하고 그 사실을 적는다', async () => {
    await target.client.exec(`alter table trip_snapshots add column note text`);
    const report = await verifyDatabases(source.db, target.db, { repoJournal: repo });
    expect(find(report.checks, 'columns', 'trip_snapshots')?.status).toBe('PASS');
    expect(find(report.checks, 'columns', 'trip_snapshots')?.detail).toContain('note');
    expect(find(report.checks, 'content', 'trip_snapshots')?.status).toBe('PASS');
    expect(find(report.checks, 'content', 'trip_snapshots')?.detail).toContain('공통 컬럼');
  });

  it('대상 journal이 저장소와 다르면(마이그레이션 미적용) FAIL이다', async () => {
    const report = await verifyDatabases(source.db, target.db, { repoJournal: { tags: [...repo.tags, '9999_future'], lastWhen: 1 } });
    expect(find(report.checks, 'journal', 'target=repo')?.status).toBe('FAIL');
    expect(report.status).toBe('FAIL');
  });

  it('외래키 고아 행(대상)을 센다', async () => {
    await target.client.exec(`alter table trip_members drop constraint trip_members_trip_id_trips_id_fk`);
    await target.client.exec(`delete from trips where client_id = 't1'`);
    await target.client.exec(`insert into trips(id, user_id, client_id, data, revision, created_at, updated_at) values ('${T1}', '${U1}', 't1', '{"name":"스페인","days":[{"spots":[]}],"future":{"keep":true}}', 7, '2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z')`);
    await target.client.exec(`update trip_members set trip_id = '00000000-0000-4000-8000-0000000000ff' where role = 'VIEWER'`);
    const report = await verifyDatabases(source.db, target.db, { repoJournal: repo });
    // 제약을 뺐으니 제약 검사도, 내용 검사도 실패한다 — 고아 행 검사는 FK가 남아 있는 다른 표에서 계속 돈다
    expect(find(report.checks, 'constraints', 'foreign')?.status).toBe('FAIL');
    expect(find(report.checks, 'content', 'trip_members')?.status).toBe('FAIL');
    expect(report.status).toBe('FAIL');
  });

  it('응답에 연결 문자열·비밀번호가 없다', async () => {
    const report = await verifyDatabases(source.db, target.db, { repoJournal: repo });
    expect(report.text()).not.toMatch(/postgres:\/\/|password/i);
  });
});
