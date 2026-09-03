// 새 Auth 계정 ↔ 도메인 사용자 연결(§12·§13·§19). 이관의 핵심이자 가장 위험한 지점이다.
//
// 규칙: **이메일로 잇는 것은 그 이메일이 확인된 뒤에만.** 확인 전에 이어 주면 남의 이메일로 가입해
// 그 사람의 여행을 가져가는 계정 탈취가 된다. 이어질 때 도메인 users.id(= Supabase user id)는 그대로 두어
// trips.user_id·trip_members.user_id 같은 기존 참조가 하나도 깨지지 않는다.
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../infrastructure/database/testDb';
import { PgAuthIdentityRepository } from '../infrastructure/database/pgAuthIdentityRepository';
import { PgTripRepository } from '../infrastructure/database/pgTripRepository';
import { PgUserRepository } from '../infrastructure/database/pgUserRepository';
import { resolveDomainUser } from './identity';

const LEGACY = '00000000-0000-0000-0000-00000000000a';

let db: TestDatabase;
let identities: PgAuthIdentityRepository;

/** better-auth가 만들 auth_user 행을 흉내 낸다 */
async function makeAuthUser(id: string, email: string, verified: boolean): Promise<void> {
  await db.db.execute(
    `insert into auth_user (id, name, email, email_verified) values ('${id}', '이름', '${email}', ${verified})`
  );
}
const authUser = (id: string, email: string, emailVerified: boolean) => ({ id, email, emailVerified });

beforeEach(async () => {
  db = await createTestDatabase();
  identities = new PgAuthIdentityRepository(db.db);
});

describe('resolveDomainUser', () => {
  it('이메일이 확인되지 않았으면 잇지 않는다 — 남의 계정을 가져갈 수 없다', async () => {
    await new PgUserRepository(db.db).ensure({ id: LEGACY, email: 'a@example.com' });
    await makeAuthUser('auth-1', 'a@example.com', false);
    expect(await resolveDomainUser(identities, authUser('auth-1', 'a@example.com', false))).toBeNull();
    expect(await identities.findByAuthUserId('auth-1')).toBeNull();
  });

  it('확인된 이메일이 기존 사용자와 같으면 그 사용자에 잇는다 — id가 그대로라 여행이 따라온다', async () => {
    await new PgUserRepository(db.db).ensure({ id: LEGACY, email: 'a@example.com' });
    const trips = new PgTripRepository(db.db);
    await trips.create({ ownerId: LEGACY, clientId: 'trip1', data: { name: '스페인' } });

    const resolved = await resolveDomainUser(identities, authUser('auth-1', 'a@example.com', true));
    expect(resolved).toBe(LEGACY);
    expect((await trips.listVisible(resolved!)).map((v) => v.record.clientId)).toEqual(['trip1']);
  });

  it('대소문자·앞뒤 공백이 달라도 같은 이메일로 본다', async () => {
    await new PgUserRepository(db.db).ensure({ id: LEGACY, email: 'A@Example.com ' });
    await makeAuthUser('auth-1', 'a@example.com', true);
    expect(await resolveDomainUser(identities, authUser('auth-1', 'a@example.com', true))).toBe(LEGACY);
  });

  it('처음 보는 이메일이면 새 도메인 사용자를 만든다', async () => {
    const resolved = await resolveDomainUser(identities, authUser('auth-1', 'new@example.com', true));
    expect(resolved).toMatch(/^[0-9a-f-]{36}$/);
    expect(await identities.findByAuthUserId('auth-1')).toBe(resolved);
  });

  it('두 번 불러도 같은 사용자다(멱등) — 로그인할 때마다 계정이 늘지 않는다', async () => {
    const first = await resolveDomainUser(identities, authUser('auth-1', 'new@example.com', true));
    const second = await resolveDomainUser(identities, authUser('auth-1', 'new@example.com', true));
    expect(second).toBe(first);
    const count = (await db.db.execute(`select count(*)::int as n from users`)) as { rows: { n: number }[] };
    expect(count.rows[0].n).toBe(1);
  });

  it('이미 다른 계정에 이어진 사용자는 빼앗기지 않는다 — 새 도메인 사용자가 생긴다', async () => {
    await new PgUserRepository(db.db).ensure({ id: LEGACY, email: 'a@example.com' });
    expect(await resolveDomainUser(identities, authUser('auth-1', 'a@example.com', true))).toBe(LEGACY);
    const second = await resolveDomainUser(identities, authUser('auth-2', 'a@example.com', true));
    expect(second).not.toBe(LEGACY);
    expect(await identities.findByAuthUserId('auth-1')).toBe(LEGACY);
  });

  it('이메일이 없는 계정은 잇지 않는다', async () => {
    expect(await resolveDomainUser(identities, authUser('auth-1', '', true))).toBeNull();
  });
});
