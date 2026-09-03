// 여행 버전 이력(trip_snapshots) — 운영에는 있는데 새 DB에 없어 이관 전에 메운다.
// 규칙은 운영 그대로다: **사람마다 제 스냅샷을 본다**(운영 RLS가 소유자 행만 보여줬다). 최근 15개만 남긴다.
import { beforeEach, describe, expect, it } from 'vitest';

import { ApiError } from '../../api/errors';
import type { RequestContext } from '../../auth/types';
import { createTestDatabase, type TestDatabase } from '../../infrastructure/database/testDb';
import { PgMembershipRepository } from '../../infrastructure/database/pgMembershipRepository';
import { PgTripRepository } from '../../infrastructure/database/pgTripRepository';
import { PgTripSnapshotRepository } from '../../infrastructure/database/pgTripSnapshotRepository';
import { PgUserRepository } from '../../infrastructure/database/pgUserRepository';
import { TripAuthorizationService } from '../authorization/tripAuthorization';
import { SnapshotService } from './snapshotService';
import { TripService } from './tripService';

const ctx = (userId: string): RequestContext => ({ userId, legacySupabaseUserId: userId, email: null, sessionId: null, tokenSource: 'supabase' });
const A = ctx('00000000-0000-0000-0000-00000000000a');
const B = ctx('00000000-0000-0000-0000-00000000000b');
const doc = (name: string) => ({ id: 'trip1', name, start: '2026-10-25', days: [{ spots: [] }] });

let db: TestDatabase;
let trips: PgTripRepository;
let members: PgMembershipRepository;
let snapshots: SnapshotService;

async function code(p: Promise<unknown>): Promise<string> {
  try { await p; return 'OK'; } catch (e) { return e instanceof ApiError ? e.code : `THROWN:${String(e)}`; }
}

beforeEach(async () => {
  db = await createTestDatabase();
  const users = new PgUserRepository(db.db);
  for (const u of [A, B]) await users.ensure({ id: u.userId, email: null });
  trips = new PgTripRepository(db.db);
  members = new PgMembershipRepository(db.db);
  const tripService = new TripService({ trips, members, authz: new TripAuthorizationService(members) });
  snapshots = new SnapshotService({ trips: tripService, snapshots: new PgTripSnapshotRepository(db.db) });
  await trips.create({ ownerId: A.userId, clientId: 'trip1', data: doc('스페인') });
});

describe('만들기', () => {
  it('저장된 문서를 그대로 떠 둔다 — 클라이언트가 보낸 본문을 믿지 않는다', async () => {
    const made = await snapshots.create(A, 'trip1', '바꾸기 전');
    expect(made).toMatchObject({ name: '바꾸기 전', source_revision: 1 });
    expect(made.id).toBeGreaterThan(0);
    const loaded = await snapshots.load(A, 'trip1', made.id);
    expect(loaded.data).toMatchObject({ name: '스페인' });
  });

  it('이름은 없어도 되고 길면 자른다', async () => {
    expect((await snapshots.create(A, 'trip1', null)).name).toBe('');
    expect((await snapshots.create(A, 'trip1', 'x'.repeat(200))).name).toHaveLength(80);
  });

  it('최근 15개만 남는다 — 오래된 것부터 사라진다', async () => {
    for (let i = 1; i <= 18; i++) await snapshots.create(A, 'trip1', `v${i}`);
    const list = await snapshots.list(A, 'trip1');
    expect(list).toHaveLength(15);
    expect(list[0].name).toBe('v18');            // 최근이 먼저
    expect(list.at(-1)!.name).toBe('v4');        // v1~v3은 정리됐다
  });
});

describe('누가 보는가', () => {
  it('사람마다 제 스냅샷만 본다 — 편집자가 뜬 것이 주최자 목록에 섞이지 않는다', async () => {
    const view = await trips.findVisible(A.userId, 'trip1');
    await members.add({ tripId: view!.record.id, userId: B.userId, role: 'EDITOR', displayName: null, invitedBy: A.userId });
    await snapshots.create(A, 'trip1', 'A의 것');
    await snapshots.create(B, 'trip1', 'B의 것');
    expect((await snapshots.list(A, 'trip1')).map((s) => s.name)).toEqual(['A의 것']);
    expect((await snapshots.list(B, 'trip1')).map((s) => s.name)).toEqual(['B의 것']);
  });

  it('남의 스냅샷은 id를 알아도 못 읽는다', async () => {
    const view = await trips.findVisible(A.userId, 'trip1');
    await members.add({ tripId: view!.record.id, userId: B.userId, role: 'EDITOR', displayName: null, invitedBy: A.userId });
    const mine = await snapshots.create(A, 'trip1', 'A의 것');
    expect(await code(snapshots.load(B, 'trip1', mine.id))).toBe('NOT_FOUND');
  });

  it('볼 수 없는 여행이면 목록도 만들기도 NOT_FOUND', async () => {
    await trips.create({ ownerId: B.userId, clientId: 'other', data: doc('B의 여행') });
    expect(await code(snapshots.list(A, 'other'))).toBe('NOT_FOUND');
    expect(await code(snapshots.create(A, 'other', null))).toBe('NOT_FOUND');
    expect(await code(snapshots.load(A, 'trip1', 9999))).toBe('NOT_FOUND');
  });

  it('보기 권한도 제 버전 이력은 남길 수 있다 — 여행 문서를 바꾸는 일이 아니다', async () => {
    const view = await trips.findVisible(A.userId, 'trip1');
    await members.add({ tripId: view!.record.id, userId: B.userId, role: 'VIEWER', displayName: null, invitedBy: A.userId });
    expect((await snapshots.create(B, 'trip1', '보기 권한')).name).toBe('보기 권한');
  });
});
