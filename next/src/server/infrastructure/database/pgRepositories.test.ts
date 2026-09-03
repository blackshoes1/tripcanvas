// 독립 PostgreSQL Repository — PGlite(진짜 PostgreSQL을 WASM으로) 위에 같은 마이그레이션을 적용해 돌린다.
// 판정 기준은 test/rls/collaboration.sql 1단계와 같다: 소유한 쪽 우선 · CAS · 나간 사람은 보이지 않는다 · 삭제는 tombstone.
// 여기에는 RLS가 없다 — 권한 판정은 application(TripService)이 하고, 이 계층은 "누가 볼 수 있는가"를 조회로만 답한다.
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from './testDb';
import { PgMembershipRepository } from './pgMembershipRepository';
import { PgTripRepository } from './pgTripRepository';
import { PgUserRepository } from './pgUserRepository';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
const doc = (name: string) => ({ name, start: '2026-10-25', days: [{ spots: [] }, { spots: [] }] });

let db: TestDatabase;
let users: PgUserRepository;
let trips: PgTripRepository;
let members: PgMembershipRepository;

beforeEach(async () => {
  db = await createTestDatabase();
  users = new PgUserRepository(db.db);
  trips = new PgTripRepository(db.db);
  members = new PgMembershipRepository(db.db);
  for (const id of [A, B, C]) await users.ensure({ id, email: `${id.slice(-1)}@example.com` });
});

describe('users', () => {
  it('ensure는 멱등이고 Supabase user id를 그대로 보존한다', async () => {
    const again = await users.ensure({ id: A, email: 'a@example.com' });
    expect(again.id).toBe(A);
    expect(again.legacySupabaseUserId).toBe(A);
    const found = await users.findById(A);
    expect(found?.email).toBe('a@example.com');
  });
});

describe('trips', () => {
  it('만든 사람이 소유자다 — 같은 트랜잭션에서 OWNER 멤버 행이 생기고 인원은 1부터 센다', async () => {
    const created = await trips.create({ ownerId: A, clientId: 'trip1', data: doc('스페인') });
    expect(created.revision).toBe(1);
    expect(created.deletedAt).toBeNull();
    const [view] = await trips.listVisible(A);
    expect(view.record.clientId).toBe('trip1');
    expect(view.role).toBe('OWNER');
    expect(view.memberCount).toBe(1);
  });

  it('멤버가 아니면 아무것도 보이지 않는다', async () => {
    await trips.create({ ownerId: A, clientId: 'trip1', data: doc('스페인') });
    expect(await trips.listVisible(B)).toEqual([]);
    expect(await trips.findVisible(B, 'trip1')).toBeNull();
  });

  it('활성 멤버는 자기 역할로 본다', async () => {
    const t = await trips.create({ ownerId: A, clientId: 'trip1', data: doc('스페인') });
    await members.add({ tripId: t.id, userId: B, role: 'EDITOR', displayName: '영희', invitedBy: A });
    const view = await trips.findVisible(B, 'trip1');
    expect(view?.role).toBe('EDITOR');
    expect(view?.memberCount).toBe(2);
    expect(view?.record.ownerId).toBe(A);
    const [mine] = await trips.listVisible(A);
    expect(mine.memberCount).toBe(2);
  });

  it('CAS: 읽은 revision이 같을 때만 저장되고, 다르면 현재 본문과 revision을 돌려준다', async () => {
    const t = await trips.create({ ownerId: A, clientId: 'trip1', data: doc('스페인') });
    const ok = await trips.updateCas(t.id, doc('스페인 (편집)'), 1);
    expect(ok.applied).toBe(true);
    expect(ok.conflict).toBe(false);
    expect(ok.record.revision).toBe(2);
    expect(ok.record.data).toEqual(doc('스페인 (편집)'));

    const stale = await trips.updateCas(t.id, doc('낡은 편집'), 1);
    expect(stale.applied).toBe(false);
    expect(stale.conflict).toBe(true);
    expect(stale.record.revision).toBe(2);
    expect(stale.record.data).toEqual(doc('스페인 (편집)'));
  });

  it('CAS: force면 revision이 달라도 덮어쓴다 — 충돌 카드에서 사용자가 고른 경우', async () => {
    const t = await trips.create({ ownerId: A, clientId: 'trip1', data: doc('스페인') });
    await trips.updateCas(t.id, doc('v2'), 1);
    const forced = await trips.updateCas(t.id, doc('내 것으로'), 1, { force: true });
    expect(forced.applied).toBe(true);
    expect(forced.record.revision).toBe(3);
  });

  it('tombstone: 삭제는 행을 지우지 않고 deleted_at과 revision을 올린다. 목록에서 빠지고, 저장하면 충돌이다', async () => {
    const t = await trips.create({ ownerId: A, clientId: 'trip1', data: doc('스페인') });
    const gone = await trips.tombstoneCas(t.id, 1);
    expect(gone.applied).toBe(true);
    expect(gone.record.deletedAt).not.toBeNull();
    expect(gone.record.revision).toBe(2);
    expect(await trips.listVisible(A)).toEqual([]);
    const view = await trips.findVisible(A, 'trip1');     // 상세는 tombstone도 돌려준다 — 호출측이 판단한다
    expect(view?.record.deletedAt).not.toBeNull();
    const write = await trips.updateCas(t.id, doc('부활?'), 2);
    expect(write.conflict).toBe(true);
    const forced = await trips.updateCas(t.id, doc('부활'), 2, { force: true });
    expect(forced.applied).toBe(true);
    expect(forced.record.deletedAt).toBeNull();          // force 저장은 되살린다(sync_trip과 같다)
  });

  it('tombstone: revision이 다르면 지우지 않는다', async () => {
    const t = await trips.create({ ownerId: A, clientId: 'trip1', data: doc('스페인') });
    await trips.updateCas(t.id, doc('v2'), 1);
    const stale = await trips.tombstoneCas(t.id, 1);
    expect(stale.applied).toBe(false);
    expect(stale.conflict).toBe(true);
    expect(stale.record.deletedAt).toBeNull();
  });

  it('client_id는 사용자별이다 — 같은 id로 C가 만들면 제 여행이 될 뿐 A의 행은 그대로', async () => {
    await trips.create({ ownerId: A, clientId: 'trip1', data: doc('스페인') });
    await trips.create({ ownerId: C, clientId: 'trip1', data: doc('C의 trip1') });
    expect((await trips.findVisible(A, 'trip1'))?.record.data).toEqual(doc('스페인'));
    expect((await trips.findVisible(C, 'trip1'))?.record.data).toEqual(doc('C의 trip1'));
    await expect(trips.create({ ownerId: A, clientId: 'trip1', data: doc('중복') })).rejects.toThrow();
  });

  it('같은 client_id가 둘(내 것 + 공유받은 것)이면 소유한 쪽이 이긴다', async () => {
    const shared = await trips.create({ ownerId: A, clientId: 'trip1', data: doc('A의 것') });
    await members.add({ tripId: shared.id, userId: B, role: 'VIEWER', displayName: null, invitedBy: A });
    await trips.create({ ownerId: B, clientId: 'trip1', data: doc('B의 것') });
    expect((await trips.findVisible(B, 'trip1'))?.record.data).toEqual(doc('B의 것'));
    const list = await trips.listVisible(B);
    expect(list).toHaveLength(1);
    expect(list[0].role).toBe('OWNER');
  });

  it('목록은 최근 수정 순이다', async () => {
    const t1 = await trips.create({ ownerId: A, clientId: 'old', data: doc('먼저') });
    await trips.create({ ownerId: A, clientId: 'new', data: doc('나중') });
    await trips.updateCas(t1.id, doc('먼저 (편집)'), 1);
    expect((await trips.listVisible(A)).map((v) => v.record.clientId)).toEqual(['old', 'new']);
  });
});

describe('membership', () => {
  it('나간 사람은 보이지 않고, 나갔던 사실은 남는다 — 로컬 사본이 조용히 복제되는 것을 막는 근거', async () => {
    const t = await trips.create({ ownerId: A, clientId: 'trip1', data: doc('스페인') });
    await members.add({ tripId: t.id, userId: B, role: 'EDITOR', displayName: '영희', invitedBy: A });
    expect(await members.roleOf(B, t.id)).toBe('EDITOR');
    await members.setStatus(t.id, B, 'LEFT');
    expect(await members.roleOf(B, t.id)).toBeNull();
    expect(await trips.findVisible(B, 'trip1')).toBeNull();
    expect(await members.wasMember(B, 'trip1')).toBe(true);
    expect(await members.wasMember(C, 'trip1')).toBe(false);
    expect((await trips.findVisible(A, 'trip1'))?.memberCount).toBe(1);
  });

  it('소유자는 멤버 행이 없어도 OWNER다(백필 전 데이터 방어) · 다시 add하면 역할만 갱신된다', async () => {
    const t = await trips.create({ ownerId: A, clientId: 'trip1', data: doc('스페인') });
    expect(await members.roleOf(A, t.id)).toBe('OWNER');
    await members.add({ tripId: t.id, userId: B, role: 'VIEWER', displayName: null, invitedBy: A });
    await members.add({ tripId: t.id, userId: B, role: 'EDITOR', displayName: '영희', invitedBy: A });
    expect(await members.roleOf(B, t.id)).toBe('EDITOR');
    expect((await trips.findVisible(A, 'trip1'))?.memberCount).toBe(2);
  });
});
