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
import { cancelSyncRetries, cloudDelete, retryPendingSync, syncTripCloud, performCloudDelete, syncOnLogin, type SyncHooks } from './cloudSync';
import { replaceSyncMeta, syncEntry } from './syncMetaStore';

const session = vi.hoisted(() => ({ version: 1 }));
vi.mock('./tripCanvasClient', async () => ({
  cloudApi: (await import('@legacy/api.js')).default, hasCloudSession: () => true,
  cloudSessionVersion: () => session.version
}));
vi.mock('./tripSnapshots', () => ({ snapshotTrip: vi.fn() }));

const owner: RequestContext = { userId: 'owner', email: null, sessionId: null, legacySupabaseUserId: null, tokenSource: 'tripcanvas' };
const viewer: RequestContext = { ...owner, userId: 'viewer' };
let service: TripService;
let members: MemoryMembershipRepository;
let actor: RequestContext;
let hooks: SyncHooks;
let paths: string[];
let localTrips: Trip[];

const doc = (name = '여행') => lib.normalizeTrip({ id: 'trip1', name, days: [{ spots: [] }], future: { keep: true } }) as Trip;

beforeEach(() => {
  session.version++;
  localTrips = [doc()];
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
  hooks = { onConflict: vi.fn(), onNotice: vi.fn(), applyTrips: vi.fn(next => { localTrips = next; return true; }), getTrips: () => localTrips };
});
afterEach(() => { cancelSyncRetries(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('creates and updates through the API while preserving unknown document fields', async () => {
  await syncTripCloud(doc(), hooks);
  expect(syncEntry('trip1')).toMatchObject({ revision: 1, status: 'clean' });
  localTrips = [doc('수정')];
  await syncTripCloud(localTrips[0], hooks);
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
  localTrips = [];
  await syncOnLogin(hooks);
  expect(paths).toEqual(['/api/v1/sync/trips']);
  expect(syncEntry('trip1').status).toBe('tombstoned');
  expect(hooks.applyTrips).toHaveBeenCalledWith([]);
});

it('login merges the latest local edits made while the list response is pending', async () => {
  const remote = await service.create(owner, doc());
  Object.assign(syncEntry('trip1'), { revision: 1, status: 'clean' });
  let finish!: (value: Awaited<ReturnType<typeof api.sync.list>>) => void;
  vi.spyOn(api.sync, 'list').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = syncOnLogin(hooks);
  localTrips = [doc('로그인 대기 중 편집')];
  finish({ data: [{ client_id: 'trip1', data: remote.record.data, revision: 1, deleted_at: null, updated_at: remote.record.updatedAt }], error: null });
  await pending;
  expect(localTrips[0].name).toBe('로그인 대기 중 편집');
  expect((await service.get(owner, 'trip1')).record.data).toMatchObject({ name: '로그인 대기 중 편집' });
});

it('a list response from the previous account cannot replace trips or revisions', async () => {
  let finish!: (value: Awaited<ReturnType<typeof api.sync.list>>) => void;
  vi.spyOn(api.sync, 'list').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = syncOnLogin(hooks);
  session.version++;
  finish({ data: [{ client_id: 'trip1', data: doc('이전 계정'), revision: 12, deleted_at: null, updated_at: '2026-09-25' }], error: null });
  await pending;
  expect(hooks.applyTrips).not.toHaveBeenCalled();
  expect(syncEntry('trip1').revision).toBeNull();
});

it('login retains and flushes an offline deletion instead of resurrecting the trip', async () => {
  await service.create(owner, doc());
  localTrips = [];
  Object.assign(syncEntry('trip1'), { revision: 1, status: 'delete-error', op: 'offline-delete' });
  await syncOnLogin(hooks);
  expect(hooks.applyTrips).toHaveBeenCalledWith([]);
  expect(syncEntry('trip1').status).toBe('tombstoned');
  expect((await service.listForSync(owner))[0].record.deletedAt).not.toBeNull();
});

it('edits during an upload wait for its revision and send the current document next', async () => {
  const save = api.sync.save;
  let finish!: () => void;
  const calls = vi.spyOn(api.sync, 'save').mockImplementationOnce(async (...args) => {
    await new Promise<void>(resolve => { finish = resolve; });
    return save(...args);
  });
  const pending = syncTripCloud(localTrips[0], hooks);
  localTrips = [doc('저장 중 새 편집')];
  await syncTripCloud(localTrips[0], hooks);
  expect(calls).toHaveBeenCalledTimes(1);
  finish();
  await pending;
  expect(calls).toHaveBeenCalledTimes(2);
  expect(calls.mock.calls[1][2]).toBe(1);
  expect(syncEntry('trip1')).toMatchObject({ status: 'clean', revision: 2 });
  expect((await service.get(owner, 'trip1')).record.data).toMatchObject({ name: '저장 중 새 편집' });
});

it('a late save response cannot stamp the revision after an account transition', async () => {
  let finish!: (value: Awaited<ReturnType<typeof api.sync.save>>) => void;
  vi.spyOn(api.sync, 'save').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = syncTripCloud(localTrips[0], hooks);
  session.version++;
  finish({ revision: 12, conflict: false, applied: true, data: null, deleted_at: null });
  await pending;
  expect(syncEntry('trip1').revision).toBeNull();
});

it('a temporary server failure retries the latest local document without another edit or online event', async () => {
  vi.useFakeTimers();
  const calls = vi.spyOn(api.sync, 'save').mockRejectedValueOnce({ status: 503, apiCode: 'MAINTENANCE' });
  await syncTripCloud(localTrips[0], hooks);
  expect(syncEntry('trip1').status).toBe('error');
  localTrips = [doc('재시도 전 새 편집')];
  await vi.advanceTimersByTimeAsync(15_000);
  expect(calls).toHaveBeenCalledTimes(2);
  expect(syncEntry('trip1').status).toBe('clean');
  expect((await service.get(owner, 'trip1')).record.data).toMatchObject({ name: '재시도 전 새 편집' });
});

it('automatic retries stop after three attempts and a manual retry can recover', async () => {
  vi.useFakeTimers();
  const save = api.sync.save;
  const calls = vi.spyOn(api.sync, 'save').mockRejectedValue({ status: 503 });
  await syncTripCloud(localTrips[0], hooks);
  await vi.runAllTimersAsync();
  expect(calls).toHaveBeenCalledTimes(4);
  expect(vi.getTimerCount()).toBe(0);
  calls.mockImplementation(save);
  await retryPendingSync(hooks);
  expect(syncEntry('trip1').status).toBe('clean');
  expect(calls).toHaveBeenCalledTimes(5);
});

it('authentication errors do not retry automatically and account changes cancel queued retries', async () => {
  vi.useFakeTimers();
  const calls = vi.spyOn(api.sync, 'save').mockRejectedValueOnce({ status: 401 }).mockRejectedValueOnce({ status: 503 });
  await syncTripCloud(localTrips[0], hooks);
  expect(vi.getTimerCount()).toBe(0);
  await syncTripCloud(localTrips[0], hooks);
  session.version++;
  await vi.runAllTimersAsync();
  expect(calls).toHaveBeenCalledTimes(2);
});

it('a remote edit made during an offline deletion is offered as a conflict instead of deleted', async () => {
  await service.create(owner, doc());
  await service.update(owner, 'trip1', doc('다른 기기 편집'), 1);
  localTrips = [];
  Object.assign(syncEntry('trip1'), { revision: 1, status: 'delete-error', op: 'offline-delete' });
  await syncOnLogin(hooks);
  expect(syncEntry('trip1')).toMatchObject({ status: 'conflict', revision: 1 });
  expect(hooks.onConflict).toHaveBeenCalledWith(expect.objectContaining({ revision: 2, remote: expect.objectContaining({ name: '다른 기기 편집' }) }));
  expect((await service.get(owner, 'trip1')).record.deletedAt).toBeNull();
});


it('deleting during the first upload waits and tombstones the revision that was actually created', async () => {
  const save = api.sync.save;
  let finish!: () => void;
  vi.spyOn(api.sync, 'save').mockImplementationOnce(async (...args) => {
    await new Promise<void>(resolve => { finish = resolve; });
    return save(...args);
  });
  const remove = vi.spyOn(api.sync, 'tombstone');
  const pending = syncTripCloud(localTrips[0], hooks);
  const deleted = localTrips[0];
  localTrips = [];
  cloudDelete('trip1', deleted, hooks);
  expect(remove).not.toHaveBeenCalled();
  finish();
  await pending;
  expect(remove).toHaveBeenCalledWith('trip1', 1);
  expect(syncEntry('trip1').status).toBe('tombstoned');
  expect((await service.listForSync(owner))[0].record.deletedAt).not.toBeNull();
});
