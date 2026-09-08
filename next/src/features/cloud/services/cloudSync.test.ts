// 새 웹 → 공통 HTTP 클라이언트 → 실제 API 라우트·서비스 → 메모리 저장소.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import api from '@legacy/api.js';
import lib from '@legacy/lib.js';
import { TripService } from '@/server/application/trip/tripService';
import { TripAuthorizationService } from '@/server/application/authorization/tripAuthorization';
import { createTripRoutes } from '@/server/api/tripRoutes';
import type { RequestContext } from '@/server/auth/types';
import { MemoryStore, MemoryTripRepository, MemoryMembershipRepository } from '@/server/repositories/memory/memoryRepositories';
import type { Trip } from '@/features/trip/domain/types';
import { syncTripCloud, performCloudDelete, syncOnLogin, type SyncHooks } from './cloudSync';
import { replaceSyncMeta, syncEntry } from './syncMetaStore';

vi.mock('./tripCanvasClient', async () => ({ cloudApi: (await import('@legacy/api.js')).default, hasCloudSession: () => true }));
vi.mock('./tripSnapshots', () => ({ snapshotTrip: vi.fn() }));

const owner: RequestContext = { userId: 'owner', email: null, sessionId: null, legacySupabaseUserId: null, tokenSource: 'tripcanvas' };
const viewer: RequestContext = { ...owner, userId: 'viewer' };
let service: TripService;
let members: MemoryMembershipRepository;
let actor: RequestContext;
let hooks: SyncHooks;
let paths: string[];

const doc = (name = '여행') => lib.normalizeTrip({ id: 'trip1', name, days: [{ spots: [] }], future: { keep: true } }) as Trip;

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('window', { localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) } });
  replaceSyncMeta({});
  const store = new MemoryStore();
  members = new MemoryMembershipRepository(store);
  service = new TripService({ trips: new MemoryTripRepository(store), members, authz: new TripAuthorizationService(members) });
  actor = owner;
  const routes = createTripRoutes({ verifier: { verify: async token => token === 'test-token' ? actor : null }, serviceFor: async () => service });
  paths = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const request = new Request(url, init);
    const path = new URL(url).pathname;
    paths.push(path);
    expect(request.headers.get('authorization')).toBe('Bearer test-token');
    if (path === '/api/v1/sync/trips') return routes.syncList(request);
    if (path === '/api/v1/trips') return request.method === 'POST' ? routes.create(request) : routes.list(request);
    if (path === '/api/v1/trips/trip1') return request.method === 'DELETE' ? routes.remove(request, 'trip1') : routes.update(request, 'trip1');
    throw new Error(`unexpected route: ${path}`);
  });
  api.configure({ baseUrl: 'http://api.test', getToken: async () => 'test-token' });
  hooks = { onConflict: vi.fn(), onNotice: vi.fn(), applyTrips: vi.fn(() => true) };
});
afterEach(() => vi.unstubAllGlobals());

it('creates and updates through the API while preserving unknown document fields', async () => {
  await syncTripCloud(doc(), hooks);
  expect(syncEntry('trip1')).toMatchObject({ revision: 1, status: 'clean' });
  await syncTripCloud(doc('수정'), hooks);
  expect(syncEntry('trip1')).toMatchObject({ revision: 2, status: 'clean' });
  expect((await service.get(owner, 'trip1')).record.data).toMatchObject({ name: '수정', future: { keep: true } });
  expect(paths).toEqual(['/api/v1/trips', '/api/v1/trips/trip1']);
});
it('stale save preserves the base revision and provides both versions for a choice', async () => {
  await syncTripCloud(doc(), hooks);
  await service.update(owner, 'trip1', doc('다른 기기'), 1);
  await syncTripCloud(doc('로컬'), hooks);
  expect(syncEntry('trip1')).toMatchObject({ revision: 1, status: 'conflict' });
  expect(hooks.onConflict).toHaveBeenCalledWith(expect.objectContaining({ local: expect.objectContaining({ name: '로컬' }), remote: expect.objectContaining({ name: '다른 기기' }), revision: 2 }));
});
it('VIEWER writes and deletes stop as forbidden instead of entering a retry loop', async () => {
  const trip = await service.create(owner, doc());
  await members.add({ tripId: trip.record.id, userId: viewer.userId, role: 'VIEWER', displayName: null, invitedBy: owner.userId });
  actor = viewer;
  Object.assign(syncEntry('trip1'), { revision: 1, status: 'dirty' });
  await syncTripCloud(doc('금지'), hooks);
  expect(syncEntry('trip1').status).toBe('forbidden');
  await performCloudDelete('trip1', 'delete1', doc(), hooks);
  expect(syncEntry('trip1').status).toBe('forbidden');
  expect((await service.get(owner, 'trip1')).record.data).toMatchObject({ name: '여행' });
});
it('login uses the sync endpoint including tombstones', async () => {
  const trip = await service.create(owner, doc());
  await service.delete(owner, 'trip1', trip.record.revision);
  await syncOnLogin([], hooks);
  expect(paths).toEqual(['/api/v1/sync/trips']);
  expect(syncEntry('trip1').status).toBe('tombstoned');
  expect(hooks.applyTrips).toHaveBeenCalledWith([]);
});
