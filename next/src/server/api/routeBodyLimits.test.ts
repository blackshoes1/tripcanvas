// 본문 크기 상한이 **라우트에서** 걸려 있는가 — `readJsonBody` 자체는 jsonBody.test.ts가 본다.
// 여기서 지키는 것: 여행·함께하기·버전 이력·붙여넣기 라우트가 상한을 넘는 본문을 400으로 돌려보내고 서비스를
// 부르지 않는다. 병합 중에 `request.json()`으로 되돌아가면 여기가 먼저 깨진다.
import lib from '@legacy/lib.js';
import { describe, expect, it } from 'vitest';

import type { CollabApi } from '../application/collaboration/types';
import { TripAuthorizationService } from '../application/authorization/tripAuthorization';
import type { SnapshotService } from '../application/trip/snapshotService';
import { TripService } from '../application/trip/tripService';
import type { RequestContext, TokenVerifier } from '../auth/types';
import { MemoryMembershipRepository, MemoryStore, MemoryTripRepository } from '../repositories/memory/memoryRepositories';
import { createCollabRoutes } from './collabRoutes';
import { createItineraryRoutes, MAX_BODY_BYTES, TOO_LONG_MESSAGE } from './itineraryRoutes';
import { BODY_TOO_LARGE_MESSAGE, REQUEST_BODY_MAX_BYTES } from './jsonBody';
import { createSnapshotRoutes } from './snapshotRoutes';
import { createTripRoutes } from './tripRoutes';

const A: RequestContext = { userId: 'u-a', legacySupabaseUserId: 'u-a', email: null, sessionId: null, tokenSource: 'supabase' };
const verifier: TokenVerifier = { async verify(token) { return token === 'tok-a' ? A : null; } };

/** 상한보다 1바이트 큰 본문 — JSON인지 보기 전에 크기에서 막혀야 한다 */
const oversized = (max: number, method = 'POST') =>
  new Request('http://api.test/x', {
    method, headers: { authorization: 'Bearer tok-a', 'content-type': 'application/json' }, body: 'x'.repeat(max + 1)
  });

/** 어떤 메서드든 불리면 기록하는 가짜 서비스 */
function recorder<T>(calls: string[]): T {
  // `then`은 비워 둔다 — 있으면 `await serviceFor()`가 이 객체를 프라미스로 여겨 영영 기다린다
  return new Proxy({}, { get: (_t, name) => (name === 'then' ? undefined : async () => { calls.push(String(name)); return {}; }) }) as T;
}

async function expectRejected(response: Response, message: string) {
  expect(response.status).toBe(400);
  const body = await response.json();
  expect(body.code).toBe('VALIDATION_ERROR');
  expect(body.message).toBe(message);
}

describe('라우트마다 본문 상한', () => {
  it('여행 POST·PUT', async () => {
    const calls: string[] = [];
    const routes = createTripRoutes({ verifier, serviceFor: async () => recorder<TripService>(calls) });
    await expectRejected(await routes.create(oversized(REQUEST_BODY_MAX_BYTES)), BODY_TOO_LARGE_MESSAGE);
    await expectRejected(await routes.update(oversized(REQUEST_BODY_MAX_BYTES, 'PUT'), 'trip1'), BODY_TOO_LARGE_MESSAGE);
    expect(calls).toEqual([]);
  });

  it('함께하기', async () => {
    const calls: string[] = [];
    const routes = createCollabRoutes({ verifier, apiFor: async () => recorder<CollabApi>(calls) });
    await expectRejected(await routes.addCandidate(oversized(REQUEST_BODY_MAX_BYTES), 'trip1'), BODY_TOO_LARGE_MESSAGE);
    expect(calls).toEqual([]);
  });

  it('버전 이력 — 본문 없이 불러도 되지만 큰 본문은 거절한다', async () => {
    const calls: string[] = [];
    const routes = createSnapshotRoutes({ verifier, serviceFor: async () => recorder<SnapshotService>(calls) });
    await expectRejected(await routes.create(oversized(REQUEST_BODY_MAX_BYTES), 'trip1'), BODY_TOO_LARGE_MESSAGE);
    expect(calls).toEqual([]);
  });

  it('붙여넣기 — 글자 상한에 맞춘 작은 상한', async () => {
    const routes = createItineraryRoutes({ verifier, now: () => new Date('2026-09-07T00:00:00Z') });
    await expectRejected(await routes.parse(oversized(MAX_BODY_BYTES)), TOO_LONG_MESSAGE);
  });
});

describe('상한에 닿은 여행 문서는 여행 라우트를 지나간다', () => {
  it('iOS 인코더처럼 `/`를 `\/`로 써서 문서 상한 가까이 온 PUT도 저장된다', async () => {
    const store = new MemoryStore();
    const members = new MemoryMembershipRepository(store);
    const service = new TripService({ trips: new MemoryTripRepository(store), members, authz: new TripAuthorizationService(members) });
    const routes = createTripRoutes({ verifier, serviceFor: async () => service, now: () => new Date('2026-10-25T00:00:00Z') });
    const send = (method: string, body: string) => new Request('http://api.test/api/v1/trips/trip1', {
      method, headers: { authorization: 'Bearer tok-a', 'content-type': 'application/json' }, body
    });
    const small = { id: 'trip1', name: '작은 여행', start: '2026-10-25', days: [{ mode: 'car', spots: [{ name: '숙소', lat: 37.5, lng: 127 }] }] };
    expect((await routes.create(send('POST', JSON.stringify({ trip: small })))).status).toBe(201);

    // jsonBody.test.ts와 같은 방식 — 한글과 '/'를 섞어 문서 상한 바로 아래까지 채운다
    const spots = Array.from({ length: 150 }, (_, i) => ({ name: `장소 ${i}`, lat: 37.5, lng: 127, note: '' }));
    const trip = { id: 'trip1', name: '큰 여행', start: '2026-10-25', days: [{ mode: 'car', spots }] };
    const unit = '여행/';
    const per = Math.floor(lib.TC_LIMITS.stringChars / unit.length) * unit.length;
    let left = Math.floor((lib.TC_LIMITS.jsonBytes - Buffer.byteLength(JSON.stringify(trip)) - 64) / Buffer.byteLength(unit)) * unit.length;
    for (const spot of spots) {
      if (left <= 0) break;
      const take = Math.min(per, left);
      spot.note = unit.repeat(take / unit.length);
      left -= take;
    }
    const wire = JSON.stringify({ trip, expectedRevision: 1 }).replace(/\//g, '\/');
    expect(Buffer.byteLength(wire)).toBeGreaterThan(lib.TC_LIMITS.jsonBytes * 0.95);

    const response = await routes.update(send('PUT', wire), 'trip1');
    expect(response.status).toBe(200);
    expect((await response.json()).trip).toMatchObject({ name: '큰 여행', revision: 2 });
  });
});
