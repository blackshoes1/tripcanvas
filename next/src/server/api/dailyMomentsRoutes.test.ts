import { beforeAll, afterAll, expect, it } from 'vitest';
import { createDailyMomentsRoutes } from './dailyMomentsRoutes';
import { DailyMomentsService } from '../application/collaboration/dailyMomentsService';
import { createTestDatabase, type TestDatabase } from '../infrastructure/database/testDb';
import { PgUserRepository } from '../infrastructure/database/pgUserRepository';
import { PgTripRepository } from '../infrastructure/database/pgTripRepository';
import { PgMembershipRepository } from '../infrastructure/database/pgMembershipRepository';
import { PgDailyMomentRepository } from '../infrastructure/database/pgDailyMomentRepository';
import type { RequestContext } from '../auth/types';

const a = '00000000-0000-0000-0000-00000000000a', b = '00000000-0000-0000-0000-00000000000b', outsider = '00000000-0000-0000-0000-00000000000c';
const context = (id: string): RequestContext => ({ userId: id, legacySupabaseUserId: null, email: null, sessionId: null, tokenSource: 'tripcanvas' });
let database: TestDatabase;
let trips: PgTripRepository, members: PgMembershipRepository, service: DailyMomentsService, internalId: string;
let routes: ReturnType<typeof createDailyMomentsRoutes>;
const document = { name: '하루', start: '2026-10-15', days: [{ spots: [{ name: '카페' }, { name: '노을' }] }, { spots: [{ name: '공원' }] }] };
const req = (method = 'GET', user = a, body?: unknown, query = 'dayIndex=0') => new Request(`http://api.test/x?${query}`, {
  method, headers: { authorization: `Bearer ${user}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
});

beforeAll(async () => {
  database = await createTestDatabase();
  const users = new PgUserRepository(database.db);
  for (const id of [a, b, outsider]) await users.ensure({ id, email: null });
  trips = new PgTripRepository(database.db); members = new PgMembershipRepository(database.db);
  internalId = (await trips.create({ ownerId: a, clientId: 'trip', data: document })).id;
  await members.add({ tripId: internalId, userId: b, role: 'VIEWER', displayName: '영희', invitedBy: a });
  service = new DailyMomentsService(trips, new PgDailyMomentRepository(database.db));
  routes = createDailyMomentsRoutes({ verifier: { verify: async token => token === 'bad' ? null : context(token) }, serviceFor: async () => service });
});
afterAll(async () => { await database?.close(); });

it('인증·여행 접근·본문을 검증하고 다른 사람을 지정하는 입력을 거절한다', async () => {
  expect((await routes.get(req('GET', 'bad'), 'trip')).status).toBe(401);
  expect((await routes.get(req('GET', outsider), 'trip')).status).toBe(404);
  expect((await routes.get(req('GET', a, undefined, 'dayIndex=-1'), 'trip')).status).toBe(400);
  expect((await routes.get(req('GET', a, undefined, ''), 'trip')).status).toBe(400);
  expect((await routes.put(req('PUT', a, { dayIndex: 0, expectedRevision: 1, spotKey: null, userId: b }), 'trip')).status).toBe(400);
  expect((await routes.put(req('PUT', a, { dayIndex: 0, expectedRevision: 1, spotKey: 'x'.repeat(64) }), 'trip')).status).toBe(400);
});

it('보기 권한도 자신의 하나를 저장하며 동시 일행 선택과 다른 날 선택을 덮어쓰지 않는다', async () => {
  const options = (await service.get(context(a), 'trip', 0)).options;
  await Promise.all([
    service.save(context(a), 'trip', 0, 1, options[0].key),
    service.save(context(b), 'trip', 0, 1, options[1].key)
  ]);
  const result = await service.get(context(a), 'trip', 0);
  expect(result.moments).toHaveLength(2);
  expect(result.moments.find(row => row.userId === b)).toMatchObject({ label: '영희', mine: false, spotName: '노을' });
  const tomorrow = await service.get(context(a), 'trip', 1);
  await service.save(context(a), 'trip', 1, 1, tomorrow.options[0].key);
  await service.save(context(a), 'trip', 0, 1, null);
  expect((await service.get(context(a), 'trip', 0)).moments.map(row => row.userId)).toEqual([b]);
  expect((await service.get(context(a), 'trip', 1)).moments[0].spotName).toBe('공원');
});

it('저장 사이 일정 변경·멤버 탈퇴를 다시 확인하고 사라진 장소를 다른 항목으로 바꾸지 않는다', async () => {
  const before = await service.get(context(a), 'trip', 0);
  await trips.updateCas(internalId, { ...document, days: [{ spots: [{ name: '다른 곳' }, { name: '또 다른 곳' }] }] }, 1);
  expect((await routes.put(req('PUT', a, { dayIndex: 0, expectedRevision: 1, spotKey: before.options[0].key }), 'trip')).status).toBe(409);
  const changed = await service.get(context(a), 'trip', 0);
  expect(changed.moments[0]).toMatchObject({ userId: b, spotName: '노을', status: 'UNAVAILABLE', activityId: null });
  const repo = new PgDailyMomentRepository(database.db);
  await members.setStatus(internalId, b, 'LEFT');
  await expect(repo.save({ tripId: internalId, userId: b, expectedRevision: 2, dayKey: changed.dayKey, spotKey: changed.options[0].key, spotName: '다른 곳' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect((await service.get(context(a), 'trip', 0)).moments).toEqual([]);
});
