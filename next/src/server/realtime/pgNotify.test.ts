// 커밋 → 알림(§42) — 활동 행이 들어가면 트리거가 pg_notify를 쏜다. NOTIFY는 트랜잭션이라 **커밋된 뒤에만** 나간다.
// 어떤 경로로 활동이 쌓이든(협업 RPC·문서 저장) 같은 알림이 나가는지 진짜 PostgreSQL(PGlite)에서 확인한다.
import { beforeEach, describe, expect, it } from 'vitest';

import { CollabService } from '../application/collaboration/collabService';
import { createTestDatabase, type TestDatabase } from '../infrastructure/database/testDb';
import { PgCollabRepository } from '../infrastructure/database/pgCollabRepository';
import { PgTripRepository } from '../infrastructure/database/pgTripRepository';
import { PgUserRepository } from '../infrastructure/database/pgUserRepository';
import type { RequestContext } from '../auth/types';
import { parseNotification, REALTIME_CHANNEL, type RealtimeEvent } from './events';

const ctx = (userId: string): RequestContext => ({ userId, legacySupabaseUserId: userId, email: null, sessionId: null, tokenSource: 'supabase' });
const A = ctx('00000000-0000-0000-0000-00000000000a');
const B = ctx('00000000-0000-0000-0000-00000000000b');
const doc = (name: string) => ({ id: 'trip1', name, start: '2026-10-25', days: [{ spots: [] }] });

let db: TestDatabase;
let trips: PgTripRepository;
let service: CollabService;
let received: RealtimeEvent[];

beforeEach(async () => {
  db = await createTestDatabase();
  const users = new PgUserRepository(db.db);
  for (const u of [A, B]) await users.ensure({ id: u.userId, email: null });
  trips = new PgTripRepository(db.db);
  service = new CollabService({ trips, collab: new PgCollabRepository(db.db) });
  await trips.create({ ownerId: A.userId, clientId: 'trip1', data: doc('스페인') });
  received = [];
  await db.listen(REALTIME_CHANNEL, (payload) => {
    const event = parseNotification(payload);
    if (event) received.push(event);
  });
});

/** NOTIFY는 커밋 뒤 비동기로 도착한다 */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

describe('trip_activity 알림 트리거', () => {
  it('참여·후보·반응이 여행의 client_id와 함께 나간다', async () => {
    const inv = await service.createInvite(A, 'trip1', 'EDITOR', null, null);
    await service.acceptInvite(B, inv.token, '영희');
    const id = await service.addCandidate(A, 'trip1', { title: '사그라다 파밀리아' });
    await service.reactToCandidate(B, 'trip1', id, 'MUST');
    await settle();

    expect(received.map((e) => e.kind)).toEqual(['MEMBER_JOINED', 'CANDIDATE_PROPOSED', 'REACTION']);
    expect(received[2]).toMatchObject({ clientId: 'trip1', kind: 'REACTION', actorId: B.userId });
    expect(received[2].tripId).toMatch(/^[0-9a-f-]{36}$/);
    expect(received[2].id).toBeGreaterThan(0);
  });

  it('문서 저장도 같은 알림을 낸다 — 혼자 쓰는 여행은 활동이 없으니 알림도 없다', async () => {
    const t = (await trips.findVisible(A.userId, 'trip1'))!.record;
    await trips.updateCas(t.id, doc('혼자 편집'), 1, { actorId: A.userId });
    await settle();
    expect(received).toEqual([]);

    const inv = await service.createInvite(A, 'trip1', 'EDITOR', null, null);
    await service.acceptInvite(B, inv.token, '영희');
    await trips.updateCas(t.id, doc('같이 편집'), 2, { actorId: A.userId });
    await settle();
    expect(received.map((e) => e.kind)).toEqual(['MEMBER_JOINED', 'SCHEDULE_CHANGED']);
  });

  it('페이로드는 작다 — 여행 문서·코멘트 본문은 실리지 않는다(§44)', async () => {
    const id = await service.addCandidate(A, 'trip1', { title: '아주 긴 후보 이름'.repeat(20), note: '메모'.repeat(50) });
    const inv = await service.createInvite(A, 'trip1', 'EDITOR', null, null);
    await service.acceptInvite(B, inv.token, '영희');
    await service.addComment(B, 'trip1', id, '비밀스러운 코멘트 본문');
    await settle();

    const comment = received.find((e) => e.kind === 'COMMENT_ADDED')!;
    expect(JSON.stringify(comment)).not.toMatch(/비밀스러운/);
    expect(JSON.stringify(comment).length).toBeLessThan(300);
  });
});
