import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TripAuthorizationService } from '../application/authorization/tripAuthorization';
import { CoverService, normalizeCover } from '../application/trip/coverService';
import { TripService } from '../application/trip/tripService';
import type { RequestContext, TokenVerifier } from '../auth/types';
import { PgCoverRepository } from '../infrastructure/database/pgCoverRepository';
import { PgMembershipRepository } from '../infrastructure/database/pgMembershipRepository';
import { PgTripRepository } from '../infrastructure/database/pgTripRepository';
import { PgUserRepository } from '../infrastructure/database/pgUserRepository';
import { createTestDatabase, type TestDatabase } from '../infrastructure/database/testDb';
import { createCoverRoutes } from './coverRoutes';

const ctx = (suffix: string): RequestContext => ({ userId: `00000000-0000-0000-0000-00000000000${suffix}`, email: null, legacySupabaseUserId: null, sessionId: null, tokenSource: 'tripcanvas' });
const identities = { a: ctx('a'), b: ctx('b'), c: ctx('c'), d: ctx('d') };
const verifier: TokenVerifier = { verify: async (token) => identities[token as keyof typeof identities] ?? null };
let db: TestDatabase;
let routes: ReturnType<typeof createCoverRoutes>;
let members: PgMembershipRepository;
let trips: TripService;
let image: string;

beforeAll(async () => {
  db = await createTestDatabase();
  const users = new PgUserRepository(db.db);
  for (const identity of Object.values(identities)) await users.ensure({ id: identity.userId, email: null });
  members = new PgMembershipRepository(db.db);
  trips = new TripService({ trips: new PgTripRepository(db.db), members, authz: new TripAuthorizationService(members) });
  routes = createCoverRoutes({ verifier, serviceFor: async () => new CoverService(trips, new PgCoverRepository(db.db)) });
  image = (await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#779955' } }).withExif({ IFD0: { Artist: 'private metadata' } }).jpeg().toBuffer()).toString('base64');
});
afterAll(async () => { await db?.close(); });

const request = (method: string, token: string, body?: unknown) => new Request('http://test/api/v1/trips/cover-test/cover', {
  method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body)
});
const read = (token: string, id = 'cover-test') => routes.get(request('GET', token), id);
const save = (token: string, revision: number, imageBase64: string | null = image, id = 'cover-test') =>
  routes.put(request('PUT', token, { expectedRevision: revision, imageBase64 }), id);

describe('공유 여행 표지 — 실제 DB 및 HTTP 경계', () => {
  it('업로드·일행 조회·편집·삭제가 권한과 독립 revision을 따른다', async () => {
    const trip = await trips.create(identities.a, { id: 'cover-test', name: '표지 검증', days: [{ spots: [] }] });
    for (const [user, role] of [['b', 'EDITOR'], ['c', 'VIEWER']] as const) {
      await members.add({ tripId: trip.record.id, userId: identities[user].userId, role, displayName: null, invitedBy: identities.a.userId });
    }
    expect(await (await read('a')).json()).toEqual({ revision: 0, imageBase64: null });
    const uploaded = await save('a', 0);
    expect(uploaded.status).toBe(200);
    const first = await uploaded.json();
    expect(first.revision).toBe(1);
    expect(first.imageBase64).toBeTruthy();
    for (const token of ['b', 'c']) {
      const response = await read(token);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual(first);
    }
    expect((await read('d')).status).toBe(404);
    expect((await save('d', 1)).status).toBe(404);
    expect((await save('c', 1)).status).toBe(403);
    expect((await save('b', 0)).status).toBe(409);
    expect((await save('b', 1)).status).toBe(200);
    expect((await save('a', 1, null)).status).toBe(409);
    expect(await (await save('a', 2, null)).json()).toEqual({ revision: 3, imageBase64: null });
    expect((await save('a', 0)).status).toBe(409); // 되돌린 뒤에도 오래된 최초 저장을 막는다.
    expect((await trips.get(identities.a, 'cover-test')).record.data).toEqual(trip.record.data);
    expect((await trips.get(identities.a, 'cover-test')).record.revision).toBe(1);
    await members.setStatus(trip.record.id, identities.b.userId, 'LEFT');
    expect((await read('b')).status).toBe(404);
    expect((await save('b', 3)).status).toBe(404);
    await trips.delete(identities.a, 'cover-test', 1);
    expect((await read('a')).status).toBe(404);
    expect((await save('a', 3)).status).toBe(404);
  });

  it('동시에 최초 저장하면 하나만 성공한다', async () => {
    await trips.create(identities.a, { id: 'cover-race', days: [{ spots: [] }] });
    const results = await Promise.all([save('a', 0, image, 'cover-race'), save('a', 0, image, 'cover-race')]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  });

  it('익명·잘못된 revision·위조 사진·큰 본문을 거절한다', async () => {
    expect((await read('invalid')).status).toBe(401);
    expect((await save('invalid', 0)).status).toBe(401);
    expect((await save('a', -1)).status).toBe(400);
    await trips.create(identities.a, { id: 'cover-invalid', days: [{ spots: [] }] });
    expect((await save('a', 1, 'not-a-jpeg', 'cover-invalid')).status).toBe(400);
    expect((await save('a', 1, 'A'.repeat(350000), 'cover-invalid')).status).toBe(400);
    expect((await save('a', 1, Buffer.from([255, 216, 255, 217]).toString('base64'), 'cover-invalid')).status).toBe(400);
  });

  it('재인코딩은 크기를 줄이고 EXIF를 보존하지 않는다', async () => {
    const normalized = Buffer.from(await normalizeCover(image), 'base64');
    const metadata = await sharp(normalized).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBeLessThanOrEqual(1200);
    expect(metadata.exif).toBeUndefined();
    expect(normalized.length).toBeLessThanOrEqual(250000);
  });
});
