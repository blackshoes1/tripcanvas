// 여행 목록 쿼리(/trips · /me · /sync/trips) — 소유와 참여를 **따로** 찾아도 예전 한 쿼리와 같은 답을 내는가.
//
// 예전 쿼리는 `소유 OR 멤버` 조인 조건이라 어느 인덱스로도 시작할 수 없어 trips를 통째로 훑었다. 이제 소유는
// trips_user_updated_idx, 참여는 trip_members_user_idx에서 출발한다. 결과·정렬·중복 제거가 같아야 한다 —
// 그래서 예전 쿼리를 여기 그대로 옮겨 두고 같은 데이터에서 답을 맞춰 본다.
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type { MemberRole, TripView } from '../../repositories/types';
import { PgMembershipRepository } from './pgMembershipRepository';
import { PgTripRepository } from './pgTripRepository';
import { PgUserRepository } from './pgUserRepository';
import { tripMembers, trips } from './schema';
import { createTestDatabase, type TestDatabase } from './testDb';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
const D = '00000000-0000-0000-0000-00000000000d';
const doc = (name: string) => ({ name, start: '2026-10-25', days: [{ spots: [] }] });

let db: TestDatabase;
let repo: PgTripRepository;
let members: PgMembershipRepository;

beforeEach(async () => {
  db = await createTestDatabase();
  repo = new PgTripRepository(db.db);
  members = new PgMembershipRepository(db.db);
  const users = new PgUserRepository(db.db);
  for (const id of [A, B, C, D]) await users.ensure({ id, email: `${id.slice(-1)}@example.com` });
});

/** 예전 구현 그대로(2026-10-02까지) — 소유 OR 활성 멤버를 한 쿼리로, 소유한 쪽 먼저 · 최근 수정 순 */
async function legacyRows(userId: string) {
  const roleExpr = sql<string>`case when ${trips.userId} = ${userId} then 'OWNER' else ${tripMembers.role} end`;
  const countExpr = sql<number>`(select count(*)::int from ${tripMembers} m where m.trip_id = ${trips.id} and m.status = 'ACTIVE')`;
  return db.db.select({ row: trips, role: roleExpr, memberCount: countExpr }).from(trips)
    .leftJoin(tripMembers, and(eq(tripMembers.tripId, trips.id), eq(tripMembers.userId, userId), eq(tripMembers.status, 'ACTIVE')))
    .where(or(eq(trips.userId, userId), sql`${tripMembers.id} is not null`))
    .orderBy(desc(sql`${trips.userId} = ${userId}`), desc(trips.updatedAt), desc(trips.updatedSeq));
}

type LegacyRow = Awaited<ReturnType<typeof legacyRows>>[number];
const view = (r: LegacyRow): TripView => ({
  record: {
    id: r.row.id, ownerId: r.row.userId, clientId: r.row.clientId, data: r.row.data, revision: Number(r.row.revision),
    deletedAt: r.row.deletedAt ? r.row.deletedAt.toISOString() : null, updatedAt: r.row.updatedAt.toISOString()
  },
  role: r.role as MemberRole, memberCount: Number(r.memberCount)
});

async function legacyListVisible(userId: string): Promise<TripView[]> {
  const seen = new Set<string>();
  const kept: LegacyRow[] = [];
  for (const r of await legacyRows(userId)) {
    if (r.row.deletedAt || seen.has(r.row.clientId)) continue;
    seen.add(r.row.clientId);
    kept.push(r);
  }
  kept.sort((a, b) => b.row.updatedAt.getTime() - a.row.updatedAt.getTime() || Number(b.row.updatedSeq) - Number(a.row.updatedSeq));
  return kept.map(view);
}

async function legacyListForSync(userId: string): Promise<TripView[]> {
  const seen = new Set<string>();
  const out: TripView[] = [];
  for (const r of await legacyRows(userId)) {
    if (seen.has(r.row.clientId)) continue;
    seen.add(r.row.clientId);
    out.push(view(r));
  }
  return out;
}

/** 소유 · 참여(편집·보기) · 삭제됨 · 나간/내보내진 멤버 · 초대만 받은 멤버 · 같은 clientId가 겹치는 경우를 한 데이터에 */
async function seed(): Promise<void> {
  const a1 = await repo.create({ ownerId: A, clientId: 'a1', data: doc('A의 여행') });
  const a2 = await repo.create({ ownerId: A, clientId: 'a2', data: doc('A가 지운 여행') });
  await repo.create({ ownerId: A, clientId: 'a3', data: doc('A의 다른 여행') });
  const b1 = await repo.create({ ownerId: B, clientId: 'b1', data: doc('B가 A를 부른 여행') });
  const b2 = await repo.create({ ownerId: B, clientId: 'b2', data: doc('A가 내보내진 여행') });
  const b3 = await repo.create({ ownerId: B, clientId: 'b3', data: doc('A가 나간 여행') });
  const b4 = await repo.create({ ownerId: B, clientId: 'b4', data: doc('B가 지운 공유 여행') });
  const b5 = await repo.create({ ownerId: B, clientId: 'b5', data: doc('A가 초대만 받은 여행') });
  // A의 것과 clientId가 겹치는 남의 여행 — 소유한 쪽이 이긴다. 지워진 내 것과 겹치면 목록과 동기화의 답이 다르다
  const c1 = await repo.create({ ownerId: C, clientId: 'a1', data: doc('C의 같은 id 여행') });
  const c2 = await repo.create({ ownerId: C, clientId: 'a2', data: doc('C가 A를 부른 같은 id 여행') });
  const c3 = await repo.create({ ownerId: C, clientId: 'b1', data: doc('B·C 둘 다 A를 부른 같은 id 여행') });
  await repo.create({ ownerId: D, clientId: 'd1', data: doc('A와 무관한 여행') });

  await members.add({ tripId: b1.id, userId: A, role: 'EDITOR', displayName: 'A', invitedBy: B });
  await members.add({ tripId: b1.id, userId: C, role: 'VIEWER', displayName: 'C', invitedBy: B });
  await members.add({ tripId: b2.id, userId: A, role: 'EDITOR', displayName: 'A', invitedBy: B });
  await members.setStatus(b2.id, A, 'REMOVED');
  await members.add({ tripId: b3.id, userId: A, role: 'VIEWER', displayName: 'A', invitedBy: B });
  await members.setStatus(b3.id, A, 'LEFT');
  await members.add({ tripId: b4.id, userId: A, role: 'VIEWER', displayName: 'A', invitedBy: B });
  await members.add({ tripId: b5.id, userId: A, role: 'VIEWER', displayName: 'A', invitedBy: B });
  await members.setStatus(b5.id, A, 'INVITED');
  await members.add({ tripId: c1.id, userId: A, role: 'VIEWER', displayName: 'A', invitedBy: C });
  await members.add({ tripId: c2.id, userId: A, role: 'EDITOR', displayName: 'A', invitedBy: C });
  await members.add({ tripId: c3.id, userId: A, role: 'VIEWER', displayName: 'A', invitedBy: C });
  await members.add({ tripId: a1.id, userId: B, role: 'VIEWER', displayName: 'B', invitedBy: A });

  // 순서를 섞는다 — 최근 수정 순과 생성 순이 다르게
  await repo.updateCas(b1.id, doc('B가 A를 부른 여행 · 고침'), 1);
  await repo.updateCas(a1.id, doc('A의 여행 · 고침'), 1);
  await repo.tombstoneCas(a2.id, 1);
  await repo.tombstoneCas(b4.id, 1);
  await repo.updateCas(c3.id, doc('B·C 둘 다 · 고침'), 1);
}

describe('목록 쿼리 — 소유와 참여를 나눠도 예전과 같은 답', () => {
  it('목록(/trips · /me): 사람마다 결과·역할·인원·정렬·중복 제거가 같다', async () => {
    await seed();
    for (const user of [A, B, C, D]) {
      expect(await repo.listVisible(user)).toEqual(await legacyListVisible(user));
    }
    // 무엇이 보이는지 사람 말로도 고정해 둔다 — 같다는 것만으로는 둘 다 틀릴 수 있다
    const seen = (await repo.listVisible(A)).map((v) => `${v.record.clientId}:${v.role}:${v.memberCount}`);
    // b1은 C의 같은 id 여행(가장 최근)이 B의 것을 가리고, a2는 내 것이 지워져 C의 것이 보인다 — 예전과 같은 규칙
    expect(seen).toEqual(['b1:VIEWER:2', 'a1:OWNER:2', 'a2:EDITOR:2', 'a3:OWNER:1']);
  });

  it('동기화(/sync/trips): 지워진 것까지 — 사람마다 같은 답이고 내 tombstone이 남의 같은 id를 가린다', async () => {
    await seed();
    for (const user of [A, B, C, D]) {
      expect(await repo.listForSync(user)).toEqual(await legacyListForSync(user));
    }
    const sync = await repo.listForSync(A);
    expect(sync.map((v) => v.record.clientId)).toEqual(['a2', 'a1', 'a3', 'b1', 'b4']);
    expect(sync.find((v) => v.record.clientId === 'a2')).toMatchObject({ role: 'OWNER', record: { ownerId: A } });
    expect(sync.find((v) => v.record.clientId === 'a2')!.record.deletedAt).not.toBeNull();
    expect(sync.find((v) => v.record.clientId === 'b4')!.record.deletedAt).not.toBeNull();
  });

  it('아무것도 없으면 빈 목록', async () => {
    expect(await repo.listVisible(A)).toEqual([]);
    expect(await repo.listForSync(A)).toEqual([]);
  });
});

describe('목록 쿼리 — 인덱스에서 출발한다', () => {
  type Query = { toSQL(): { sql: string; params: unknown[] } };
  /** 실행 계획. 데이터가 적으면 플래너가 순차 탐색을 고르므로 그 길을 막고 본다 — 인덱스로 갈 수 있는가가 질문이다 */
  async function plan(query: Query): Promise<string> {
    const { sql: text, params } = query.toSQL();
    const inlined = text.replace(/\$(\d+)/g, (_, i: string) => `'${String(params[Number(i) - 1]).replace(/'/g, "''")}'`);
    await db.db.execute(sql.raw('set enable_seqscan = off'));
    const result = await db.db.execute(sql.raw(`explain ${inlined}`)) as unknown as { rows: Record<string, string>[] };
    return result.rows.map((r) => Object.values(r)[0]).join('\n');
  }
  const internals = () => repo as unknown as { ownedQuery(userId: string): Query; sharedQuery(userId: string): Query };
  /** 인덱스 스캔(`… using 이름 on 표`)이든 비트맵(`Bitmap Index Scan on 이름`)이든 그 인덱스로 찾았는가 */
  const usesIndex = (text: string, name: string) =>
    text.split('\n').some((line) => line.includes(`using ${name} on `) || line.trim().startsWith(`->  Bitmap Index Scan on ${name} `));

  it('소유는 trips의 user_id 인덱스, 참여는 trip_members_user_idx에서 찾는다 — trips를 훑지 않는다', async () => {
    await seed();
    const owned = await plan(internals().ownedQuery(A));
    expect(owned).not.toMatch(/Seq Scan/);
    expect(usesIndex(owned, 'trips_user_updated_idx') || usesIndex(owned, 'trips_user_client_uidx')).toBe(true);
    expect(owned).toMatch(/Index Cond: \(+user_id = /);

    const shared = await plan(internals().sharedQuery(A));
    expect(shared).not.toMatch(/Seq Scan/);
    expect(usesIndex(shared, 'trip_members_user_idx')).toBe(true);
    expect(shared).toMatch(/Index Cond: \(+user_id = /);
    // 참여한 여행은 기본 키로 하나씩 찾는다 — trips 전체를 거르지 않는다(예전 쿼리는 trips_pkey를 조건 없이 끝까지 읽었다)
    expect(shared).toMatch(/Index Cond: \(id = trip_members\.trip_id\)/);
  });
});
