// Trip API(§26·§31) — 라우트 경계를 in-memory로 끝까지 통과시킨다: 401/403/404/409/400과 응답 계약.
import { beforeEach, describe, expect, it } from 'vitest';

import type { TripDetailResponse, TripListResponse } from '@/features/trip-state/domain/contract';
import { TripAuthorizationService } from '../application/authorization/tripAuthorization';
import { TripService } from '../application/trip/tripService';
import type { RequestContext, TokenVerifier } from '../auth/types';
import { MemoryMembershipRepository, MemoryStore, MemoryTripRepository } from '../repositories/memory/memoryRepositories';
import { createTripRoutes } from './tripRoutes';

const users: Record<string, RequestContext> = {};
for (const u of ['a', 'b', 'c']) users[`tok-${u}`] = { userId: `u-${u}`, legacySupabaseUserId: `u-${u}`, email: null, sessionId: null, tokenSource: 'supabase' };
const verifier: TokenVerifier = { async verify(token) { return users[token] ?? null; } };

const doc = (name: string) => ({ id: 'trip1', name, start: '2026-10-25', days: [{ mode: 'car', spots: [{ name: '숙소', city: '바르셀로나', lat: 41.4, lng: 2.17 }] }] });
const req = (method: string, path: string, token: string | null, body?: unknown) =>
  new Request(`http://api.test${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

let routes: ReturnType<typeof createTripRoutes>;
let members: MemoryMembershipRepository;
let service: TripService;

beforeEach(() => {
  const store = new MemoryStore();
  members = new MemoryMembershipRepository(store);
  service = new TripService({ trips: new MemoryTripRepository(store), members, authz: new TripAuthorizationService(members) });
  routes = createTripRoutes({ verifier, serviceFor: async () => service, now: () => new Date('2026-10-25T00:00:00Z') });
});

describe('인증', () => {
  it('토큰이 없거나 틀리면 401 UNAUTHORIZED', async () => {
    expect((await routes.list(req('GET', '/api/v1/trips', null))).status).toBe(401);
    const res = await routes.get(req('GET', '/api/v1/trips/trip1', 'tok-zzz'), 'trip1');
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('UNAUTHORIZED');
  });
});

describe('POST /trips · GET /trips · GET /trips/:id', () => {
  it('만들면 201과 상세, 목록과 상세에 그대로 보인다', async () => {
    const created = await routes.create(req('POST', '/api/v1/trips', 'tok-a', { trip: doc('스페인') }));
    expect(created.status).toBe(201);
    const body = (await created.json()) as TripDetailResponse;
    expect(body.schemaVersion).toBe(1);
    expect(body.trip).toMatchObject({ id: 'trip1', name: '스페인', revision: 1, role: 'OWNER', memberCount: 1, dayCount: 1, todayIndex: 0 });
    expect(body.document).toMatchObject({ name: '스페인' });

    const list = (await (await routes.list(req('GET', '/api/v1/trips', 'tok-a'))).json()) as TripListResponse;
    expect(list.trips.map((t) => t.id)).toEqual(['trip1']);

    const detail = await routes.get(req('GET', '/api/v1/trips/trip1', 'tok-a'), 'trip1');
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as TripDetailResponse).trip.revision).toBe(1);
  });

  it('본문이 없거나 trip이 여행 모양이 아니면 400 VALIDATION_ERROR', async () => {
    expect((await routes.create(req('POST', '/api/v1/trips', 'tok-a'))).status).toBe(400);
    const res = await routes.create(req('POST', '/api/v1/trips', 'tok-a', { trip: { name: 'x' } }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('남의 여행은 404 — 존재를 흘리지 않는다', async () => {
    await routes.create(req('POST', '/api/v1/trips', 'tok-a', { trip: doc('스페인') }));
    expect((await routes.get(req('GET', '/api/v1/trips/trip1', 'tok-b'), 'trip1')).status).toBe(404);
  });

  it('같은 id를 다시 만들면 409 CONFLICT', async () => {
    await routes.create(req('POST', '/api/v1/trips', 'tok-a', { trip: doc('스페인') }));
    const res = await routes.create(req('POST', '/api/v1/trips', 'tok-a', { trip: doc('또') }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('CONFLICT');
  });
});

describe('PUT /trips/:id', () => {
  beforeEach(async () => { await routes.create(req('POST', '/api/v1/trips', 'tok-a', { trip: doc('스페인') })); });

  it('expectedRevision이 맞으면 저장, 응답 revision이 오른다', async () => {
    const res = await routes.update(req('PUT', '/api/v1/trips/trip1', 'tok-a', { trip: doc('편집'), expectedRevision: 1 }), 'trip1');
    expect(res.status).toBe(200);
    expect(((await res.json()) as TripDetailResponse).trip.revision).toBe(2);
  });

  it('expectedRevision이 없으면 400 — 마지막에 읽은 버전을 모르는 저장은 받지 않는다(§91)', async () => {
    const res = await routes.update(req('PUT', '/api/v1/trips/trip1', 'tok-a', { trip: doc('편집') }), 'trip1');
    expect(res.status).toBe(400);
  });

  it('stale이면 409 STALE_VERSION + 현재 revision', async () => {
    await routes.update(req('PUT', '/api/v1/trips/trip1', 'tok-a', { trip: doc('v2'), expectedRevision: 1 }), 'trip1');
    const res = await routes.update(req('PUT', '/api/v1/trips/trip1', 'tok-a', { trip: doc('낡음'), expectedRevision: 1 }), 'trip1');
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('STALE_VERSION');
    expect(body.revision).toBe(2);
    expect(body.error).toBe('STALE_VERSION');
  });

  it('VIEWER는 403, EDITOR는 200', async () => {
    const view = await service.get(users['tok-a'], 'trip1');
    await members.add({ tripId: view.record.id, userId: 'u-b', role: 'VIEWER', displayName: null, invitedBy: 'u-a' });
    await members.add({ tripId: view.record.id, userId: 'u-c', role: 'EDITOR', displayName: null, invitedBy: 'u-a' });
    expect((await routes.update(req('PUT', '/api/v1/trips/trip1', 'tok-b', { trip: doc('x'), expectedRevision: 1 }), 'trip1')).status).toBe(403);
    expect((await routes.update(req('PUT', '/api/v1/trips/trip1', 'tok-c', { trip: doc('y'), expectedRevision: 1 }), 'trip1')).status).toBe(200);
  });
});

describe('DELETE /trips/:id', () => {
  beforeEach(async () => { await routes.create(req('POST', '/api/v1/trips', 'tok-a', { trip: doc('스페인') })); });

  it('소유자가 expectedRevision과 함께 지우면 200, 이후 목록에서 빠진다', async () => {
    const res = await routes.remove(req('DELETE', '/api/v1/trips/trip1?expectedRevision=1', 'tok-a'), 'trip1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ schemaVersion: 1, deleted: true, revision: 2 });
    const list = (await (await routes.list(req('GET', '/api/v1/trips', 'tok-a'))).json()) as TripListResponse;
    expect(list.trips).toEqual([]);
  });

  it('EDITOR는 403, revision이 틀리면 409, 없으면 404', async () => {
    const view = await service.get(users['tok-a'], 'trip1');
    await members.add({ tripId: view.record.id, userId: 'u-c', role: 'EDITOR', displayName: null, invitedBy: 'u-a' });
    expect((await routes.remove(req('DELETE', '/api/v1/trips/trip1?expectedRevision=1', 'tok-c'), 'trip1')).status).toBe(403);
    expect((await routes.remove(req('DELETE', '/api/v1/trips/trip1?expectedRevision=9', 'tok-a'), 'trip1')).status).toBe(409);
    expect((await routes.remove(req('DELETE', '/api/v1/trips/nope?expectedRevision=1', 'tok-a'), 'nope')).status).toBe(404);
  });
});
