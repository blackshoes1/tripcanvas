import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from './testDb';
import { PgLiveActivityRepository } from './pgLiveActivityRepository';
import { PgTripRepository } from './pgTripRepository';
import { authSession, authUser, users, liveActivitySubscriptions, tripMembers } from './schema';

const U = '00000000-0000-0000-0000-00000000000a';
const V = '00000000-0000-0000-0000-00000000000b';
const now = new Date('2026-10-27T09:00:00Z');
const later = new Date('2026-10-27T17:00:00Z');
let db: TestDatabase;
let repo: PgLiveActivityRepository;
let tripId: string;
const input = (extra = {}) => ({ userId: U, deviceId: 'd', activityId: 'a', sessionId: 'session', tripId,
  pushToken: 'ab'.repeat(32), environment: 'sandbox' as const, startedAt: now, expiresAt: later, now, tokenRevision: 1, ...extra });
beforeEach(async () => {
  db = await createTestDatabase(); repo = new PgLiveActivityRepository(db.db);
  await db.db.insert(authUser).values({ id: 'auth', name: '테스트', email: 'a@example.com', emailVerified: true });
  await db.db.insert(users).values([{ id: U, email: 'a@example.com', authUserId: 'auth' }, { id: V, email: 'b@example.com' }]);
  await db.db.insert(authSession).values({ id: 'session', userId: 'auth', token: 'opaque-secret-never-copied', expiresAt: later });
  tripId = (await new PgTripRepository(db.db).create({ ownerId: U, clientId: 'trip', data: { name: '여행', start: '2026-10-27', days: [{ spots: [] }] } })).id;
});
afterEach(async () => { await db.close(); });
const row = async () => (await db.db.select().from(liveActivitySubscriptions))[0];

describe('Live Activity 등록은 로그인 세션에 묶이고 종료·토큰 순서를 보존한다', () => {
  it('최신 토큰 revision보다 늦은 구버전 도착이 덮어쓰지 못한다', async () => {
    expect(await repo.register(input({ tokenRevision: 2 }))).toBe('registered');
    expect(await repo.register(input())).toBe('stale');
    expect(await repo.register(input({ tokenRevision: 2 }))).toBe('registered');
    expect(await repo.register(input({ tokenRevision: 2, pushToken: 'cd'.repeat(32) }))).toBe('stale');
    expect((await row()).pushToken).toBe('ab'.repeat(32));
  });
  it('DELETE가 POST보다 먼저 와도 늦은 등록은 부활하지 않는다', async () => {
    await repo.stop({ userId: U, deviceId: 'd', activityId: 'a', sessionId: 'session', now });
    expect(await repo.register(input())).toBe('ended');
    expect((await row()).pushToken).toBeNull();
  });
  it('worker가 종료한 활동은 같은 날 늦은 토큰이나 다음 tick으로 부활하지 않는다', async () => {
    await repo.register(input());
    const [claimed] = await repo.claimDue(now, 1);
    const endedAt = new Date('2026-10-27T12:00:00Z');
    await repo.discard(claimed, endedAt);
    expect(await row()).toMatchObject({ endedAt, pushToken: null, leaseId: null });
    expect(await repo.register(input({ now: new Date('2026-10-27T12:01:00Z'), tokenRevision: 2 }))).toBe('ended');
    expect(await repo.claimDue(new Date('2026-10-27T12:01:00Z'), 10)).toEqual([]);
  });
  it('기기에서 새 활동을 켜면 이전 활동은 종료되고 늦은 콜백도 거절한다', async () => {
    await repo.register(input());
    await repo.register(input({ activityId: 'new', pushToken: 'cd'.repeat(32), tokenRevision: 2 }));
    expect(await repo.register(input({ tokenRevision: 3 }))).toBe('ended');
    const active = (await db.db.select().from(liveActivitySubscriptions)).filter(r => !r.endedAt);
    expect(active.map(r => r.activityId)).toEqual(['new']);
  });
  it('다른 활동의 첫 등록이 늦게 도착해도 기기의 새 활동을 종료하지 않는다', async () => {
    await repo.register(input({ activityId: 'new', tokenRevision: 2 }));
    expect(await repo.register(input({ activityId: 'old', tokenRevision: 1, pushToken: 'cd'.repeat(32) }))).toBe('stale');
    expect((await row()).activityId).toBe('new');
    expect((await row()).endedAt).toBeNull();
  });
  it('사용자당 동시 활동 상한을 지킨다', async () => {
    for (let i = 0; i < 10; i++) {
      expect(await repo.register(input({ deviceId: `d${i}`, pushToken: i.toString(16).padStart(64, '0') }))).toBe('registered');
    }
    expect(await repo.register(input({ deviceId: 'extra' }))).toBe('limit');
  });
  it('다른 계정의 세션·만료 세션은 등록하지 않는다', async () => {
    expect(await repo.register(input({ userId: V }))).toBe('unauthorized');
    expect(await repo.register(input({ now: later }))).toBe('unauthorized');
    expect(await db.db.select().from(liveActivitySubscriptions)).toEqual([]);
  });
  it('로그아웃 세션 삭제는 원격 등록도 즉시 지운다', async () => {
    await repo.register(input());
    await db.db.delete(authSession).where(eq(authSession.id, 'session'));
    expect(await db.db.select().from(liveActivitySubscriptions)).toEqual([]);
  });
});

describe('다중 worker lease와 발송 직전 권한 확인', () => {
  it('같은 due 등록을 두 번 claim하지 않는다', async () => {
    await repo.register(input());
    expect(await repo.claimDue(now, 10)).toHaveLength(1);
    expect(await repo.claimDue(now, 10)).toHaveLength(0);
  });
  it('claim 후 토큰이 교체되면 늦은 완료와 재시도가 새 등록을 덮어쓰지 않는다', async () => {
    await repo.register(input());
    const [old] = await repo.claimDue(now, 10);
    await repo.register(input({ tokenRevision: 2, pushToken: 'cd'.repeat(32) }));
    await repo.complete(old, later, 'old');
    await repo.retry(old, later, 'old');
    await repo.discard(old, now);
    expect(await row()).toMatchObject({ lastStateVersion: null, failures: 0, pushToken: 'cd'.repeat(32), endedAt: null, nextUpdateAt: now });
    expect(await repo.delivery(old, now)).toBeNull();
  });
  it('만료 lease를 다른 worker가 받으면 이전 완료 응답은 무효다', async () => {
    await repo.register(input());
    const [old] = await repo.claimDue(now, 1);
    const [fresh] = await repo.claimDue(new Date(now.getTime() + 31_000), 1);
    expect(fresh.leaseId).not.toBe(old.leaseId);
    await repo.complete(old, later, 'old');
    expect((await row()).leaseId).toBe(fresh.leaseId);
  });
  it('발송 직전 세션 만료·확인 해제·여행 접근 회수를 반영한다', async () => {
    await repo.register(input());
    const [claim] = await repo.claimDue(now, 1);
    expect(await repo.delivery(claim, now)).toMatchObject({ tripId: 'trip' });
    await db.db.update(authUser).set({ emailVerified: false }).where(eq(authUser.id, 'auth'));
    expect(await repo.delivery(claim, now)).toBeNull();
    await db.db.update(authUser).set({ emailVerified: true }).where(eq(authUser.id, 'auth'));
    await db.db.update(authSession).set({ expiresAt: now }).where(eq(authSession.id, 'session'));
    expect(await repo.delivery(claim, now)).toBeNull();
  });
  it('공유 여행에서 나간 뒤에는 발송할 문서를 반환하지 않는다', async () => {
    const shared = await new PgTripRepository(db.db).create({ ownerId: V, clientId: 'shared', data: { name: '같이 여행' } });
    await db.db.insert(tripMembers).values({ tripId: shared.id, userId: U, role: 'VIEWER', status: 'ACTIVE' });
    await repo.register(input({ tripId: shared.id }));
    const [claim] = await repo.claimDue(now, 1);
    expect(await repo.delivery(claim, now)).not.toBeNull();
    await db.db.update(tripMembers).set({ status: 'LEFT' }).where(eq(tripMembers.userId, U));
    expect(await repo.delivery(claim, now)).toBeNull();
  });
});

describe('구독별 도착 근거는 좌표 없이 순서·세션·종료 경계를 지킨다', () => {
  const target = { dayIndex: 0, activityId: 'd0s0', revision: 1 };
  const arrival = (extra = {}) => ({ userId: U, deviceId: 'd', activityId: 'a', sessionId: 'session', tripId,
    arrival: { target, arrived: true, observedAtISO: now.toISOString() }, eventRevision: 1, now, ...extra });
  it('등록 전에는 기록하지 않고 다른 세션·여행도 바꿀 수 없다', async () => {
    expect(await repo.recordArrival(arrival())).toBe('missing');
    await repo.register(input());
    expect(await repo.recordArrival(arrival({ sessionId: 'other' }))).toBe('unauthorized');
    expect(await repo.recordArrival(arrival({ tripId: V }))).toBe('stale');
    expect(await repo.readArrival(U, 'd', 'trip', now, 'session')).toBeNull();
  });
  it('enter→exit 뒤 늦은 enter와 같은 sequence의 다른 payload는 표시를 되돌리지 못한다', async () => {
    await repo.register(input());
    expect(await repo.recordArrival(arrival())).toBe('recorded');
    expect(await repo.recordArrival(arrival())).toBe('recorded');
    const exit = { target, arrived: false, observedAtISO: now.toISOString() };
    expect(await repo.recordArrival(arrival({ arrival: exit, eventRevision: 2 }))).toBe('recorded');
    expect(await repo.recordArrival(arrival())).toBe('stale');
    expect(await repo.recordArrival(arrival({ eventRevision: 2 }))).toBe('stale');
    expect(await repo.readArrival(U, 'd', 'trip', now, 'session')).toMatchObject(exit);
  });
  it('새 장소 enter 뒤 옛 장소 exit는 새 도착을 지우지 않는다', async () => {
    await repo.register(input());
    await repo.recordArrival(arrival());
    const newer = { target: { ...target, activityId: 'd0s1' }, arrived: true, observedAtISO: now.toISOString() };
    await repo.recordArrival(arrival({ arrival: newer, eventRevision: 2 }));
    expect(await repo.recordArrival(arrival({ arrival: { ...arrival().arrival, arrived: false }, eventRevision: 3 }))).toBe('stale');
    expect(await repo.readArrival(U, 'd', 'trip', now, 'session')).toMatchObject(newer);
  });
  it('도착 기록은 토큰 교체로 사라지지 않고 이전 worker의 완료를 무효화한다', async () => {
    await repo.register(input());
    const [old] = await repo.claimDue(now, 1);
    await repo.recordArrival(arrival());
    await repo.complete(old, later, 'old');
    expect(await repo.delivery(old, now)).toBeNull();
    expect((await row()).nextUpdateAt).toEqual(now);
    await repo.register(input({ tokenRevision: 2, pushToken: 'cd'.repeat(32) }));
    expect(await repo.readArrival(U, 'd', 'trip', now, 'session')).toMatchObject(arrival().arrival);
    const [fresh] = await repo.claimDue(now, 1);
    expect(await repo.delivery(fresh, now)).toMatchObject({ arrival: arrival().arrival });
  });
  it('현재 여행 revision 변경·종료·다른 계정에는 근거를 돌려주지 않는다', async () => {
    await repo.register(input());
    await repo.recordArrival(arrival());
    expect(await repo.readArrival(V, 'd', 'trip', now, 'session')).toBeNull();
    expect(await repo.readArrival(U, 'd', 'trip', now, 'other')).toBeNull();
    await new PgTripRepository(db.db).updateCas(tripId, { name: '바뀜' }, 1);
    expect(await repo.recordArrival(arrival({ eventRevision: 2 }))).toBe('stale');
    expect(await repo.readArrival(U, 'd', 'trip', now, 'session')).toBeNull();
    await repo.stop({ userId: U, deviceId: 'd', activityId: 'a', sessionId: 'session', now });
    expect(await repo.recordArrival(arrival({ eventRevision: 3 }))).toBe('ended');
    expect(await repo.readArrival(U, 'd', 'trip', now, 'session')).toBeNull();
  });
  it('세션 만료·로그아웃 뒤에는 새 근거도 기록하지 않고 기존 근거도 노출하지 않는다', async () => {
    await repo.register(input());
    await repo.recordArrival(arrival());
    await db.db.update(authSession).set({ expiresAt: now }).where(eq(authSession.id, 'session'));
    expect(await repo.recordArrival(arrival({ eventRevision: 2 }))).toBe('unauthorized');
    expect(await repo.readArrival(U, 'd', 'trip', now, 'session')).toBeNull();
    await db.db.delete(authSession).where(eq(authSession.id, 'session'));
    expect(await repo.recordArrival(arrival({ eventRevision: 3 }))).toBe('missing');
    expect(await db.db.select().from(liveActivitySubscriptions)).toEqual([]);
  });
  it('공유 여행의 VIEWER도 자기 도착만 기록하고 나간 뒤에는 읽거나 기록할 수 없다', async () => {
    const shared = await new PgTripRepository(db.db).create({ ownerId: V, clientId: 'shared', data: { name: '공유 여행' } });
    await db.db.insert(tripMembers).values({ tripId: shared.id, userId: U, role: 'VIEWER', status: 'ACTIVE' });
    await repo.register(input({ tripId: shared.id }));
    expect(await repo.recordArrival(arrival({ tripId: shared.id }))).toBe('recorded');
    expect(await repo.readArrival(U, 'd', 'shared', now, 'session')).toMatchObject(arrival().arrival);
    await db.db.update(tripMembers).set({ status: 'LEFT' }).where(eq(tripMembers.userId, U));
    expect(await repo.recordArrival(arrival({ tripId: shared.id, eventRevision: 2 }))).toBe('unauthorized');
    expect(await repo.readArrival(U, 'd', 'shared', now, 'session')).toBeNull();
  });
});
