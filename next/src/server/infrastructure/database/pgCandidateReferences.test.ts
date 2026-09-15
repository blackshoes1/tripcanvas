import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TripAuthorizationService } from '../../application/authorization/tripAuthorization';
import { CollabService } from '../../application/collaboration/collabService';
import { TripService } from '../../application/trip/tripService';
import type { RequestContext } from '../../auth/types';
import { PgCollabRepository } from './pgCollabRepository';
import { PgMembershipRepository } from './pgMembershipRepository';
import { PgTripRepository } from './pgTripRepository';
import { PgUserRepository } from './pgUserRepository';
import { createTestDatabase, type TestDatabase } from './testDb';

const context = (suffix: string): RequestContext => ({ userId: `00000000-0000-0000-0000-00000000000${suffix}`,
  email: `${suffix}@example.org`, legacySupabaseUserId: null, sessionId: null, tokenSource: 'supabase' });
const A = context('a'), B = context('b'), C = context('c');
const document = (spots: Record<string, unknown>[][]) => ({ name: '합성 여행', start: '2026-09-16',
  custom: { keep: true }, days: spots.map(list => ({ spots: list })) });
const spot = (candidateId: number) => ({ name: '같은 이름', candidateId, kakaoId: '12345', cost: 12.55, cur: 'EUR',
  bookAt: '12:00', admission: { source: 'USER', requirement: 'REQUIRED' }, custom: { keep: 'original' } });
let db: TestDatabase;
let trips: TripService;
let collab: CollabService;
let members: PgMembershipRepository;

beforeEach(async () => {
  db = await createTestDatabase();
  for (const user of [A, B, C]) await new PgUserRepository(db.db).ensure({ id: user.userId, email: user.email });
  const repository = new PgTripRepository(db.db);
  members = new PgMembershipRepository(db.db);
  trips = new TripService({ trips: repository, members, authz: new TripAuthorizationService(members) });
  collab = new CollabService({ trips: repository, collab: new PgCollabRepository(db.db) });
  await trips.create(A, { ...document([[], []]), id: 'trip1' });
});
afterEach(async () => { await db.close(); });

async function scheduledCandidate() {
  const id = await collab.addCandidate(A, 'trip1', { title: '합성 명소', provider: 'kakao', providerId: '12345' });
  await trips.update(A, 'trip1', document([[spot(id)], []]), 1);
  await collab.manageCandidate(A, 'trip1', id, 'SCHEDULE', '1');
  return id;
}
async function candidate(id: number) { return (await collab.listCandidates(A, 'trip1')).find(row => row.id === id); }

describe('문서 CAS와 후보 날짜 참조', () => {
  it('명소의 날짜 이동과 시작일 앞 빈 날 삽입을 같은 저장에서 반영한다', async () => {
    const id = await scheduledCandidate();
    const view = await trips.get(A, 'trip1');
    await members.add({ tripId: view.record.id, userId: B.userId, role: 'EDITOR', displayName: null, invitedBy: A.userId });
    const saved = await trips.update(B, 'trip1', { ...document([[], [spot(id)]]), start: '2026-09-15' }, 2);
    expect(saved.record.revision).toBe(3);
    expect(saved.record.data).toMatchObject({ custom: { keep: true }, days: [{ spots: [] }, { spots: [spot(id)] }] });
    expect(await candidate(id)).toMatchObject({ status: 'SCHEDULED', scheduled_ref: '2', provider: 'kakao', provider_id: '12345' });
    const activity = await collab.listActivity(A, 'trip1', 100);
    expect(activity.filter(row => row.kind === 'CANDIDATE_SCHEDULED')).toHaveLength(1);
    expect(activity.filter(row => row.kind === 'SCHEDULE_CHANGED')).toHaveLength(1);
  });

  it('연결 장소 삭제는 후보를 미배치로 되돌리고 반응은 보존한다', async () => {
    const id = await scheduledCandidate();
    await trips.update(A, 'trip1', document([[], []]), 2);
    expect(await candidate(id)).toMatchObject({ status: 'PROPOSED', scheduled_ref: null, my_reaction: 'MUST' });
  });

  it('stale revision은 문서와 후보 모두 바꾸지 않는다', async () => {
    const id = await scheduledCandidate();
    await expect(trips.update(A, 'trip1', document([[], [spot(id)]]), 1)).rejects.toMatchObject({ code: 'STALE_VERSION' });
    expect((await trips.get(A, 'trip1')).record.revision).toBe(2);
    expect(await candidate(id)).toMatchObject({ status: 'SCHEDULED', scheduled_ref: '1' });
  });

  it('VIEWER·비멤버는 후보 참조도 바꿀 수 없다', async () => {
    const id = await scheduledCandidate();
    const view = await trips.get(A, 'trip1');
    await members.add({ tripId: view.record.id, userId: B.userId, role: 'VIEWER', displayName: null, invitedBy: A.userId });
    await expect(trips.update(B, 'trip1', document([[], [spot(id)]]), 2)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(trips.update(C, 'trip1', document([[], [spot(id)]]), 2)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await candidate(id)).toMatchObject({ scheduled_ref: '1' });
  });

  it('다른 여행 후보의 ID를 문서에 넣고 빼도 그 후보를 수정하지 않는다', async () => {
    await trips.create(A, { ...document([[], []]), id: 'trip2' });
    const foreign = await collab.addCandidate(A, 'trip2', { title: '다른 여행 명소' });
    await collab.manageCandidate(A, 'trip2', foreign, 'SCHEDULE', '2');
    await trips.update(A, 'trip1', document([[spot(foreign)], []]), 1);
    await trips.update(A, 'trip1', document([[], []]), 2);
    expect((await collab.listCandidates(A, 'trip2'))[0]).toMatchObject({ id: foreign, status: 'SCHEDULED', scheduled_ref: '2' });
  });

  it('명시적 연결이 없던 legacy와 새 PROPOSED·REJECTED는 추측 변경하지 않는다', async () => {
    const legacy = await collab.addCandidate(A, 'trip1', { title: '같은 이름' });
    const proposed = await collab.addCandidate(A, 'trip1', { title: '새 후보' });
    const rejected = await collab.addCandidate(A, 'trip1', { title: '제외된 후보' });
    await collab.manageCandidate(A, 'trip1', legacy, 'SCHEDULE', '1');
    await collab.manageCandidate(A, 'trip1', rejected, 'REJECT', null);
    await trips.update(A, 'trip1', document([[{ name: '같은 이름' }, spot(proposed), spot(rejected)], []]), 1);
    await trips.update(A, 'trip1', document([[], [spot(proposed), spot(rejected)]]), 2);
    expect(await candidate(legacy)).toMatchObject({ status: 'SCHEDULED', scheduled_ref: '1' });
    expect(await candidate(proposed)).toMatchObject({ status: 'PROPOSED', scheduled_ref: null });
    expect(await candidate(rejected)).toMatchObject({ status: 'REJECTED', scheduled_ref: null });
  });

  it('같은 후보 ID가 여러 날짜에 중복되면 목적지를 추측하지 않는다', async () => {
    const id = await scheduledCandidate();
    await trips.update(A, 'trip1', document([[spot(id)], [spot(id)]]), 2);
    expect(await candidate(id)).toMatchObject({ status: 'SCHEDULED', scheduled_ref: '1' });
  });

  it('후보 표시 쓰기가 실패하면 문서와 revision도 롤백한다', async () => {
    const id = await scheduledCandidate();
    const before = await trips.get(A, 'trip1');
    await db.db.execute(`create function reject_candidate_change() returns trigger language plpgsql as $$
      begin raise exception 'synthetic candidate failure'; end $$`);
    await db.db.execute(`create trigger reject_candidate_change before update on trip_candidates
      for each row execute function reject_candidate_change()`);
    await expect(trips.update(A, 'trip1', document([[], [spot(id)]]), 2)).rejects.toThrow();
    const after = await trips.get(A, 'trip1');
    expect(after.record.revision).toBe(before.record.revision);
    expect(after.record.data).toEqual(before.record.data);
    expect(await candidate(id)).toMatchObject({ status: 'SCHEDULED', scheduled_ref: '1' });
  });
});
