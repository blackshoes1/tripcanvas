// GET /api/v1/me — 로그인 직후 한 번 부르는 가벼운 조회. my_trip_roles를 대신하고, **어느 실시간을 쓸지**도 여기서 알려 준다.
//
// 왜 서버가 정하는가: 협업 데이터가 아직 Supabase에 있으면 새 사이드카에는 보낼 이벤트가 없다.
// 클라이언트가 스스로 고르면 "실시간이라고 표시되는데 아무것도 안 오는" 상태가 된다 — 서버만이 그 답을 안다.
import { beforeEach, describe, expect, it } from 'vitest';

import type { MigrationRegistry } from '../config/migrationRegistry';
import type { RequestContext, TokenVerifier } from '../auth/types';
import type { TripView } from '../repositories/types';
import { createMeRoutes, resolveRealtime } from './meRoutes';

const ctx: RequestContext = { userId: 'u-a', legacySupabaseUserId: 'u-a', email: 'a@example.com', sessionId: null, tokenSource: 'supabase' };
const verifier: TokenVerifier = { async verify(token) { return token === 'tok-a' ? ctx : null; } };
const registry = (over: Partial<MigrationRegistry> = {}): MigrationRegistry => ({
  AUTH: 'LEGACY', TRIP: 'LEGACY', BOOKING: 'LEGACY', PRICING: 'LEGACY', ADAPTIVE: 'LEGACY', COLLAB: 'LEGACY', REALTIME: 'LEGACY', STORAGE: 'LEGACY', ...over
});

const view = (clientId: string, role: 'OWNER' | 'EDITOR' | 'VIEWER', id: string): TripView => ({
  record: { id, ownerId: role === 'OWNER' ? 'u-a' : 'u-b', clientId, data: {}, revision: 1, deletedAt: null, updatedAt: '2026-09-01T00:00:00Z' },
  role, memberCount: role === 'OWNER' ? 1 : 2
});

let views: TripView[];
const req = (token: string | null) => new Request('http://api.test/api/v1/me', { headers: token ? { authorization: `Bearer ${token}` } : {} });

function routes(over: Partial<MigrationRegistry> = {}, realtimeUrl: string | null = 'wss://api.test/ws') {
  return createMeRoutes({ verifier, listTrips: async () => views, registry: registry(over), realtimeUrl });
}

beforeEach(() => {
  views = [view('trip1', 'OWNER', 'row-1'), view('trip2', 'EDITOR', 'row-2')];
});

describe('resolveRealtime', () => {
  it('협업이 새 DB에 있고 주소가 있을 때만 자체 실시간을 쓴다', () => {
    expect(resolveRealtime(registry({ COLLAB: 'NEW_BACKEND' }), 'wss://api.test/ws')).toEqual({ provider: 'TRIPCANVAS', url: 'wss://api.test/ws' });
  });

  it('협업이 아직 Supabase면 Supabase 실시간을 그대로 쓴다 — 새 사이드카에는 보낼 이벤트가 없다', () => {
    expect(resolveRealtime(registry({ COLLAB: 'LEGACY' }), 'wss://api.test/ws')).toEqual({ provider: 'SUPABASE', url: null });
  });

  it('주소가 없으면 실시간이 없다고 정직하게 답한다 — 켜진 척하지 않는다', () => {
    expect(resolveRealtime(registry({ COLLAB: 'NEW_BACKEND' }), null)).toEqual({ provider: 'NONE', url: null });
  });
});

describe('GET /api/v1/me', () => {
  it('토큰이 없으면 401', async () => {
    expect((await routes().me(req(null))).status).toBe(401);
    expect((await routes().me(req('nope'))).status).toBe(401);
  });

  it('내가 볼 수 있는 여행의 역할과 인원을 준다 — my_trip_roles를 대신한다', async () => {
    const body = await (await routes().me(req('tok-a'))).json();
    expect(body.user).toEqual({ id: 'u-a', email: 'a@example.com' });
    expect(body.trips).toEqual([
      { id: 'trip1', role: 'OWNER', memberCount: 1, owner: true, supabaseTripId: 'row-1' },
      { id: 'trip2', role: 'EDITOR', memberCount: 2, owner: false, supabaseTripId: 'row-2' }
    ]);
  });

  it('Supabase 실시간을 쓸 때만 내부 여행 id를 함께 준다 — 그것 말고는 쓸 데가 없다', async () => {
    const legacy = await (await routes({ COLLAB: 'LEGACY' }).me(req('tok-a'))).json();
    expect(legacy.realtime).toEqual({ provider: 'SUPABASE', url: null });
    expect(legacy.trips[0].supabaseTripId).toBe('row-1');

    const fresh = await (await routes({ COLLAB: 'NEW_BACKEND' }).me(req('tok-a'))).json();
    expect(fresh.realtime).toEqual({ provider: 'TRIPCANVAS', url: 'wss://api.test/ws' });
    expect(fresh.trips[0]).not.toHaveProperty('supabaseTripId');
    expect(JSON.stringify(fresh)).not.toContain('row-1');
  });

  it('삭제된 여행은 빼고, 저장소가 죽으면 502로 알린다', async () => {
    views = [view('trip1', 'OWNER', 'row-1')];
    views[0].record.deletedAt = '2026-09-02T00:00:00Z';
    expect((await (await routes().me(req('tok-a'))).json()).trips).toEqual([]);

    const broken = createMeRoutes({
      verifier, listTrips: async () => { throw new Error('db down'); }, registry: registry(), realtimeUrl: null
    });
    const res = await broken.me(req('tok-a'));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('INTERNAL_ERROR');
  });
});
