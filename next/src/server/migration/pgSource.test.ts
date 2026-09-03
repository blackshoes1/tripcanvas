// R1용 원본 — 운영 덤프를 복원한 사본에서 읽는다. "테이블이 없다"와 "비었다"를 구분하는 것이 핵심이다.
// 여기서는 PGlite를 레거시 사본 삼아 확인한다(같은 PostgreSQL이다).
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { createPgSource, type SourceQueryClient } from './pgSource';

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
