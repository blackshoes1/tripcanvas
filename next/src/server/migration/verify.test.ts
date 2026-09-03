// 검증이 리허설의 본체다(§79·§80). "돌았다"가 아니라 **"같다"**를 판정한다.
// 통과하지 못하면 전환하지 않는다는 기준선이므로, 어긋난 것을 반드시 잡아야 한다.
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../infrastructure/database/testDb';
import { importAll } from './importer';
import { MemorySource } from './memorySource';
import { verifyMigration } from './verify';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const TRIP = '11111111-1111-4111-8111-111111111111';
const TRIP2 = '22222222-2222-4222-8222-222222222222';

let db: TestDatabase;

function source(): MemorySource {
  return new MemorySource({
    users: [{ id: A, email: 'a@example.com' }, { id: B, email: 'b@example.com' }],
    trips: [
      { id: TRIP, user_id: A, client_id: 'trip1', data: { name: '스페인', days: [{ spots: [] }] }, revision: 3, deleted_at: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-02T00:00:00Z' },
      { id: TRIP2, user_id: B, client_id: 'trip2', data: { name: '일본', days: [] }, revision: 1, deleted_at: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' }
    ],
    trip_snapshots: [{ id: 7, user_id: A, client_id: 'trip1', name: '옛 버전', data: { name: '스페인(옛)' }, source_revision: 2, created_at: '2026-08-01T12:00:00Z' }],
    trip_members: [{ id: 4, trip_id: TRIP, user_id: A, role: 'OWNER', status: 'ACTIVE', display_name: null, invited_by: null, joined_at: '2026-08-01T00:00:00Z', prefs: {}, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' }],
    trip_candidates: [{ id: 5, trip_id: TRIP, title: '사그라다', place_id: null, lat: null, lng: null, addr: null, note: null, url: null, proposed_by: A, status: 'PROPOSED', scheduled_ref: null, created_at: '2026-08-04T00:00:00Z', updated_at: '2026-08-04T00:00:00Z' }],
    candidate_reactions: [{ id: 11, candidate_id: 5, user_id: A, reaction: 'MUST', created_at: '2026-08-04T01:00:00Z', updated_at: '2026-08-04T01:00:00Z' }],
    suggestion_feedback: null, device_tokens: null, notification_log: null, trip_memories: null
  });
}

beforeEach(async () => { db = await createTestDatabase(); });

describe('verifyMigration', () => {
  it('제대로 옮겼으면 통과하고, 원본에 없던 테이블은 건너뛴 것으로 보고한다', async () => {
    const src = source();
    await importAll(db.db, src);
    const report = await verifyMigration(db.db, src);

    expect(report.ok).toBe(true);
    expect(report.counts.find((c) => c.table === 'trips')).toMatchObject({ source: 2, target: 2, ok: true });
    expect(report.counts.filter((c) => c.source === null).map((c) => c.table).sort())
      .toEqual(['device_tokens', 'notification_log', 'suggestion_feedback', 'trip_memories']);
    expect(report.orphans.every((o) => o.count === 0)).toBe(true);
    expect(report.content.every((c) => c.ok)).toBe(true);
  });

  it('행이 하나라도 빠지면 잡는다', async () => {
    const src = source();
    await importAll(db.db, src);
    await db.db.execute(`delete from trip_candidates where id = 5`);

    const report = await verifyMigration(db.db, src);
    expect(report.ok).toBe(false);
    expect(report.counts.find((c) => c.table === 'trip_candidates')).toMatchObject({ source: 1, target: 0, ok: false });
  });

  it('문서 내용이 한 글자라도 다르면 잡는다 — 개수만 맞는 것으로는 부족하다', async () => {
    const src = source();
    await importAll(db.db, src);
    await db.db.execute(`update trips set data = '{"name":"스페인!","days":[{"spots":[]}]}'::jsonb where client_id = 'trip1'`);

    const report = await verifyMigration(db.db, src);
    expect(report.ok).toBe(false);
    const trips = report.content.find((c) => c.check === 'trips.data');
    expect(trips?.ok).toBe(false);
    expect(trips?.detail).toMatch(/trip1/);
  });

  it('키 순서만 다른 같은 문서는 같다고 본다 — jsonb를 거치면 순서가 바뀐다', async () => {
    const src = new MemorySource({
      users: [{ id: A, email: 'a@example.com' }],
      trips: [{ id: TRIP, user_id: A, client_id: 'trip1', data: { days: [], name: '스페인' }, revision: 1, deleted_at: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' }]
    });
    await importAll(db.db, src);
    await db.db.execute(`update trips set data = '{"name":"스페인","days":[]}'::jsonb where client_id = 'trip1'`);
    const report = await verifyMigration(db.db, src);
    expect(report.content.find((c) => c.check === 'trips.data')?.ok).toBe(true);
  });

  it('revision이 어긋나면 잡는다', async () => {
    const src = source();
    await importAll(db.db, src);
    await db.db.execute(`update trips set revision = 99 where client_id = 'trip1'`);
    const report = await verifyMigration(db.db, src);
    expect(report.ok).toBe(false);
    expect(report.content.find((c) => c.check === 'trips.revision')?.ok).toBe(false);
  });

  it('고아 행을 잡는다 — 사용자가 없는 여행은 통과시키지 않는다', async () => {
    const src = source();
    await importAll(db.db, src);
    // 참조 무결성을 우회해 고아를 만든다(운영 덤프에 깨진 참조가 섞여 있을 수 있다)
    await db.db.execute(`alter table trips drop constraint trips_user_id_users_id_fk`);
    await db.db.execute(`delete from users where id = '${B}'`);

    const report = await verifyMigration(db.db, src);
    expect(report.ok).toBe(false);
    expect(report.orphans.find((o) => o.check === 'trips → users')?.count).toBe(1);
  });

  it('사람이 읽는 리포트로 만들어진다', async () => {
    const src = source();
    await importAll(db.db, src);
    const text = (await verifyMigration(db.db, src)).text();
    expect(text).toMatch(/통과/);
    expect(text).toMatch(/trips\s+2\s+2/);
    expect(text).toMatch(/원본에 없음/);
  });
});
