// R0 — 이관 스크립트 자체를 진짜 PostgreSQL(PGlite)에서 검증한다. 여기서 잡지 못하면 전환 당일에야 드러난다.
// docs/backup-restore.md가 나열한 함정 그대로: FK 순서 · identity 시퀀스 · 알림 트리거 · 운영 미적용 테이블 · 멱등성.
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../infrastructure/database/testDb';
import { PgCollabRepository } from '../infrastructure/database/pgCollabRepository';
import { PgTripRepository } from '../infrastructure/database/pgTripRepository';
import { REALTIME_CHANNEL } from '../realtime/events';
import { importAll } from './importer';
import { MemorySource } from './memorySource';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const TRIP = '11111111-1111-4111-8111-111111111111';

let db: TestDatabase;

/** 운영에서 덤프해 온 모양 그대로(컬럼 이름은 snake_case) */
function source(): MemorySource {
  return new MemorySource({
    users: [{ id: A, email: 'a@example.com' }, { id: B, email: 'b@example.com' }],
    trips: [{ id: TRIP, user_id: A, client_id: 'trip1', data: { name: '스페인', days: [] }, revision: 3, deleted_at: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-02T00:00:00Z' }],
    trip_snapshots: [{ id: 7, user_id: A, client_id: 'trip1', name: '바꾸기 전', data: { name: '스페인(옛)' }, source_revision: 2, created_at: '2026-08-01T12:00:00Z' }],
    trip_members: [
      { id: 4, trip_id: TRIP, user_id: A, role: 'OWNER', status: 'ACTIVE', display_name: null, invited_by: null, joined_at: '2026-08-01T00:00:00Z', prefs: {}, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
      { id: 9, trip_id: TRIP, user_id: B, role: 'EDITOR', status: 'ACTIVE', display_name: '영희', invited_by: A, joined_at: '2026-08-03T00:00:00Z', prefs: { pace: 'RELAXED' }, created_at: '2026-08-03T00:00:00Z', updated_at: '2026-08-03T00:00:00Z' }
    ],
    trip_invites: [{ id: 2, trip_id: TRIP, token_hash: 'a'.repeat(64), role: 'EDITOR', created_by: A, expires_at: '2026-12-01T00:00:00Z', revoked_at: null, max_uses: null, use_count: 1, created_at: '2026-08-01T00:00:00Z' }],
    trip_candidates: [{ id: 5, trip_id: TRIP, title: '사그라다 파밀리아', place_id: null, lat: 41.4, lng: 2.17, addr: null, note: null, url: null, proposed_by: A, status: 'PROPOSED', scheduled_ref: null, created_at: '2026-08-04T00:00:00Z', updated_at: '2026-08-04T00:00:00Z' }],
    candidate_reactions: [{ id: 11, candidate_id: 5, user_id: B, reaction: 'MUST', created_at: '2026-08-04T01:00:00Z', updated_at: '2026-08-04T01:00:00Z' }],
    trip_comments: [{ id: 3, trip_id: TRIP, candidate_id: 5, user_id: B, body: '야경 보고 저녁 먹자', created_at: '2026-08-04T02:00:00Z', updated_at: '2026-08-04T02:00:00Z' }],
    trip_activity: [
      { id: 20, trip_id: TRIP, actor_id: B, kind: 'MEMBER_JOINED', subject: { member_id: B, role: 'EDITOR' }, created_at: '2026-08-03T00:00:00Z' },
      { id: 21, trip_id: TRIP, actor_id: A, kind: 'CANDIDATE_PROPOSED', subject: { title: '사그라다 파밀리아', candidate_id: 5 }, created_at: '2026-08-04T00:00:00Z' }
    ],
    hotel_price_snapshots: [{ id: '22222222-2222-4222-8222-222222222222', user_id: A, trip_client_id: 'trip1', booking_id: 'b1', seller: 'agoda', price: 120000, currency: 'KRW', quality: 'EXACT', verified: true, ptoken: null, offers: [], observed_at: '2026-08-05T00:00:00Z' }],
    // 운영에 적용되지 않은 마이그레이션의 테이블 — 원본에 아예 없다(null)
    suggestion_feedback: null,
    device_tokens: null,
    notification_log: null,
    trip_memories: null
  });
}

beforeEach(async () => { db = await createTestDatabase(); });

const count = async (table: string): Promise<number> => {
  const r = (await db.db.execute(`select count(*)::int as n from ${table}`)) as { rows: { n: number }[] };
  return r.rows[0].n;
};

describe('importAll', () => {
  it('FK 순서대로 전부 들어가고 id가 그대로 보존된다', async () => {
    const report = await importAll(db.db, source());
    expect(report.ok).toBe(true);

    expect(await count('users')).toBe(2);
    expect(await count('trips')).toBe(1);
    expect(await count('trip_snapshots')).toBe(1);
    expect(await count('trip_members')).toBe(2);
    expect(await count('trip_candidates')).toBe(1);
    expect(await count('candidate_reactions')).toBe(1);
    expect(await count('trip_comments')).toBe(1);
    expect(await count('trip_activity')).toBe(2);
    expect(await count('hotel_price_snapshots')).toBe(1);

    // id 보존 — 여행·사용자 id가 그대로여야 기존 참조가 안 깨진다(§13)
    const trips = new PgTripRepository(db.db);
    const view = await trips.findVisible(A, 'trip1');
    expect(view?.record.id).toBe(TRIP);
    expect(view?.record.revision).toBe(3);
    expect(view?.memberCount).toBe(2);
    expect((await trips.findVisible(B, 'trip1'))?.role).toBe('EDITOR');
  });

  it('원본에 없는 테이블(운영 미적용)은 "없음"으로 보고하고 실패로 치지 않는다', async () => {
    const report = await importAll(db.db, source());
    expect(report.ok).toBe(true);
    const missing = report.tables.filter((t) => t.sourceRows === null).map((t) => t.table);
    expect(missing.sort()).toEqual(['device_tokens', 'notification_log', 'suggestion_feedback', 'trip_memories']);
    expect(await count('suggestion_feedback')).toBe(0);
  });

  it('identity 시퀀스를 다시 맞춘다 — 전환 후 첫 쓰기가 중복키로 죽지 않게', async () => {
    await importAll(db.db, source());
    // 기존 최대 id(후보 5 · 코멘트 3 · 활동 21 · 멤버 9)보다 큰 값이 나와야 한다
    const collab = new PgCollabRepository(db.db);
    const candidateId = await collab.addCandidate(TRIP, A, { title: '새 후보', place_id: null, lat: null, lng: null, addr: null, note: null, url: null });
    expect(candidateId).toBeGreaterThan(5);
    const commentId = await collab.addComment(TRIP, candidateId, A, '새 코멘트');
    expect(commentId).toBeGreaterThan(3);
    const activity = (await db.db.execute(`select max(id)::int as n from trip_activity`)) as { rows: { n: number }[] };
    expect(activity.rows[0].n).toBeGreaterThan(21);
  });

  it('import 동안 실시간 알림을 쏘지 않는다 — 활동 수만 행이 알림 폭풍이 되면 안 된다', async () => {
    const received: string[] = [];
    await db.listen(REALTIME_CHANNEL, (p) => received.push(p));
    await importAll(db.db, source());
    await new Promise((r) => setTimeout(r, 60));
    expect(received).toEqual([]);

    // 끝난 뒤에는 트리거가 다시 살아 있어야 한다
    await new PgCollabRepository(db.db).addCandidate(TRIP, A, { title: '이건 알린다', place_id: null, lat: null, lng: null, addr: null, note: null, url: null });
    await new Promise((r) => setTimeout(r, 60));
    expect(received).toHaveLength(1);
  });

  it('두 번 돌려도 같은 결과다 — 리허설을 반복할 수 있다', async () => {
    await importAll(db.db, source());
    const second = await importAll(db.db, source());
    expect(second.ok).toBe(true);
    expect(await count('trips')).toBe(1);
    expect(await count('trip_members')).toBe(2);
    expect(await count('trip_activity')).toBe(2);
  });

  it('원본이 모르는 컬럼을 갖고 있어도 넘어가고, 무엇을 버렸는지 보고한다', async () => {
    const src = source();
    src.tables.trips![0].legacy_only_column = '운영에만 있던 값';
    const report = await importAll(db.db, src);
    expect(report.ok).toBe(true);
    expect(report.tables.find((t) => t.table === 'trips')?.droppedColumns).toEqual(['legacy_only_column']);
  });

  it('드라이버가 문자열로 준 숫자·불리언·날짜도 들어간다 — node-postgres의 bigint는 문자열이다', async () => {
    const src = source();
    src.tables.trips![0].revision = '3';                        // node-postgres의 bigint
    src.tables.hotel_price_snapshots![0].verified = 't';        // CSV의 불리언
    src.tables.trip_invites![0].use_count = '1';
    const report = await importAll(db.db, src);
    expect(report.ok).toBe(true);

    const trips = new PgTripRepository(db.db);
    expect((await trips.findVisible(A, 'trip1'))?.record.revision).toBe(3);
    const row = (await db.db.execute(`select verified from hotel_price_snapshots`)) as { rows: { verified: boolean }[] };
    expect(row.rows[0].verified).toBe(true);
  });

  it('참조가 깨진 행이 있으면 멈추고 이유를 알린다 — 조용히 버리지 않는다', async () => {
    const src = source();
    src.tables.trip_members!.push({ id: 99, trip_id: TRIP, user_id: '00000000-0000-0000-0000-0000000000ff', role: 'VIEWER', status: 'ACTIVE', display_name: null, invited_by: null, joined_at: null, prefs: {}, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' });
    await expect(importAll(db.db, src)).rejects.toThrow(/trip_members/);
  });
});
