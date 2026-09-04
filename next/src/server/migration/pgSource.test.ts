// R1용 원본 — 운영 덤프를 복원한 사본에서 읽는다. "테이블이 없다"와 "비었다"를 구분하는 것이 핵심이다.
// 여기서는 PGlite를 레거시 사본 삼아 확인한다(같은 PostgreSQL이다).
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { createPgSource, describeConnection, type SourceQueryClient } from './pgSource';

let legacy: PGlite;
let client: SourceQueryClient;

beforeEach(async () => {
  legacy = new PGlite();
  client = { query: async (text) => (await legacy.query(text)) as { rows: Record<string, unknown>[] } };
  await legacy.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, email text, encrypted_password text);
    insert into auth.users values
      ('00000000-0000-0000-0000-00000000000a', 'a@example.com', '$2a$10$hash'),
      ('00000000-0000-0000-0000-00000000000b', 'b@example.com', '$2a$10$hash');
    create table trips (id uuid primary key, user_id uuid, client_id text, data jsonb, revision bigint, deleted_at timestamptz, created_at timestamptz, updated_at timestamptz);
    insert into trips values ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-00000000000a', 'trip1', '{"name":"스페인"}', 3, null, now(), now());
    create table trip_members (id bigint, trip_id uuid, user_id uuid, role text, status text);
  `);
});

describe('createPgSource', () => {
  it('있는 테이블은 행을 그대로 준다', async () => {
    const source = createPgSource(client);
    const trips = await source.rows('trips');
    expect(trips).toHaveLength(1);
    expect(trips![0]).toMatchObject({ client_id: 'trip1', revision: 3 });
    expect(trips![0].data).toEqual({ name: '스페인' });
  });

  it('사용자는 auth.users에서 id·email만 가져온다 — 비밀번호 해시는 옮기지 않는다(§19)', async () => {
    const users = await createPgSource(client).rows('users');
    expect(users).toEqual([
      { id: '00000000-0000-0000-0000-00000000000a', email: 'a@example.com' },
      { id: '00000000-0000-0000-0000-00000000000b', email: 'b@example.com' }
    ]);
    expect(JSON.stringify(users)).not.toMatch(/\$2a\$10\$/);
  });

  it('비어 있는 테이블은 빈 배열 — "없음"과 다르다', async () => {
    expect(await createPgSource(client).rows('trip_members')).toEqual([]);
  });

  it('없는 테이블은 null — 운영에 적용되지 않은 마이그레이션의 테이블이 여기 해당한다', async () => {
    const source = createPgSource(client);
    expect(await source.rows('suggestion_feedback')).toBeNull();
    expect(await source.rows('trip_memories')).toBeNull();
  });

  it('사용자 테이블 위치를 바꿀 수 있다 — auth 스키마 없이 CSV로 받아 온 경우', async () => {
    await legacy.exec(`create table legacy_users (id uuid, email text); insert into legacy_users values ('00000000-0000-0000-0000-00000000000c', 'c@example.com');`);
    const source = createPgSource(client, { usersTable: 'public.legacy_users' });
    expect(await source.rows('users')).toEqual([{ id: '00000000-0000-0000-0000-00000000000c', email: 'c@example.com' }]);
  });

  it('사용자 테이블조차 없으면 null — 조용히 빈 이관을 만들지 않는다', async () => {
    expect(await createPgSource(client, { usersTable: 'public.nope' }).rows('users')).toBeNull();
  });
});

// 검증은 "원본과 대상이 같은가"만 본다 — 원본이 운영인지는 아무도 확인하지 않아, 낡은 사본을 가리켜도
// 조용히 통과한다(2026-09-04에 실제로 그랬다). 그래서 어디를 읽는지 사람이 눈으로 볼 수 있어야 한다.
describe('describeConnection', () => {
  it('계정@호스트/DB 한 줄로 알려 준다', async () => {
    const fake: SourceQueryClient = {
      query: async () => ({ rows: [{ db: 'legacy_copy', usr: 'tripcanvas', host: '10.0.0.2' }] })
    };
    expect(await describeConnection(fake)).toBe('tripcanvas@10.0.0.2/legacy_copy');
  });

  it('소켓 연결이라 서버 주소가 없으면 local', async () => {
    const fake: SourceQueryClient = {
      query: async () => ({ rows: [{ db: 'postgres', usr: 'postgres', host: 'local' }] })
    };
    expect(await describeConnection(fake)).toBe('postgres@local/postgres');
  });

  it('물어볼 수 없어도 이관을 막지 않는다 — 진단용 한 줄이다', async () => {
    const broken: SourceQueryClient = { query: async () => { throw new Error('no such function'); } };
    expect(await describeConnection(broken)).toBe('(확인 불가)');
  });

  it('진짜 연결에도 물어본다 — 무엇을 읽는지 이름은 나온다', async () => {
    const line = await describeConnection(client);
    expect(line).toMatch(/\//);
  });
});
