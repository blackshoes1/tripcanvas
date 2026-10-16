import { afterEach, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../infrastructure/database/testDb';
import { users, trips, tripMembers, tripFiles } from '../infrastructure/database/schema';
import { PgTripFileRepository } from '../infrastructure/database/pgTripFileRepository';
import { PgTripRepository } from '../infrastructure/database/pgTripRepository';
import { PgMembershipRepository } from '../infrastructure/database/pgMembershipRepository';
import { TripService } from '../application/trip/tripService';
import { TripAuthorizationService } from '../application/authorization/tripAuthorization';
import { TripFilesService, filePlaceKey } from '../application/trip/tripFiles';
import { createTripFileRoutes } from './tripFileRoutes';

const owner = '00000000-0000-0000-0000-000000000001';
const viewer = '00000000-0000-0000-0000-000000000002';
const stranger = '00000000-0000-0000-0000-000000000003';
const tripId = '10000000-0000-0000-0000-000000000001';
let db: TestDatabase, routes: ReturnType<typeof createTripFileRoutes>;
beforeEach(async () => {
  db = await createTestDatabase();
  await db.db.insert(users).values([owner, viewer, stranger].map(id => ({ id })));
  await db.db.insert(trips).values({ id: tripId, userId: owner, clientId: 'honeymoon', data: { days: [{ spots: [{ name: '대성당', placeId: 'cathedral' }] }] } });
  await db.db.insert(tripMembers).values({ tripId, userId: viewer, role: 'VIEWER', status: 'ACTIVE' });
  const members = new PgMembershipRepository(db.db);
  const service = new TripFilesService(new TripService({ trips: new PgTripRepository(db.db), members, authz: new TripAuthorizationService(members) }), new PgTripFileRepository(db.db));
  routes = createTripFileRoutes({ verifier: { verify: async token => [owner, viewer, stranger].includes(token) ? { userId: token, email: null, legacySupabaseUserId: null, sessionId: null, tokenSource: 'tripcanvas' } : null },
    serviceFor: async () => service });
});
afterEach(async () => { await db.close(); });
function req(method: string, user = owner, body?: string | Uint8Array, query = '') {
  return new Request('http://local/api/v1/trips/honeymoon/files' + query, {
    method, headers: { authorization: 'Bearer ' + user }, body: body as BodyInit | undefined
  });
}
async function upload(user = owner, body = '%PDF-1.4\nticket', query = '?kind=DOCUMENT&name=ticket.pdf') {
  return routes.upload(req('POST', user, body, query), 'honeymoon');
}
it('persists exact bytes, shares with viewers, and deduplicates a lost-response retry', async () => {
  const first = await (await upload()).json();
  const retry = await (await upload()).json();
  expect(retry.file.id).toBe(first.file.id);
  const list = await (await routes.list(req('GET', viewer), 'honeymoon')).json();
  expect(list.files).toHaveLength(1);
  expect(list.canEdit).toBe(false);
  expect(list.files[0].contentBase64).toBeUndefined();
  const file = await routes.get(req('GET', viewer), 'honeymoon', first.file.id);
  expect(file.headers.get('cache-control')).toContain('no-store');
  expect(file.headers.get('content-disposition')).toContain('attachment');
  expect(await file.text()).toBe('%PDF-1.4\nticket');
});
it('blocks strangers, read-only uploads, revoked members, and cross-trip file IDs', async () => {
  const { file } = await (await upload()).json();
  expect((await upload(viewer)).status).toBe(403);
  expect((await routes.get(req('GET', stranger), 'honeymoon', file.id)).status).toBe(404);
  await db.db.update(tripMembers).set({ status: 'REMOVED' }).where(eq(tripMembers.userId, viewer));
  expect((await routes.get(req('GET', viewer), 'honeymoon', file.id)).status).toBe(404);
  await db.db.insert(trips).values({ userId: owner, clientId: 'other', data: {} });
  expect((await routes.get(req('GET'), 'other', file.id)).status).toBe(404);
});
it('matches audio to a stable place, rejects renamed executables and stale places', async () => {
  const query = '?kind=AUDIO&name=story.mp3&placeKey=' + encodeURIComponent('["google","cathedral"]');
  expect((await upload(owner, 'ID3story', query)).status).toBe(200);
  expect((await upload(owner, 'executable', query)).status).toBe(400);
  expect((await upload(owner, 'ID3story', query.replace('cathedral', 'removed'))).status).toBe(409);
  expect(filePlaceKey({ lat: 37.3858333, lng: -5.9930556, name: '이름 수정' })).toBe('["point","37.385833","-5.993056"]');
  expect(filePlaceKey({ name: ' ' })).toBe('');
});
it('bounds chunked request bodies before persistence and rejects blank/active document types', async () => {
  const large = new Request('http://local/?kind=DOCUMENT&name=ticket.pdf', {
    method: 'POST', headers: { authorization: 'Bearer ' + owner },
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1)); controller.close(); } }), duplex: 'half'
  } as RequestInit);
  expect((await routes.upload(large, 'honeymoon')).status).toBe(400);
  expect((await upload(owner, '')).status).toBe(400);
  expect((await upload(owner, '<script>evil</script>', '?kind=DOCUMENT&name=bad.html')).status).toBe(400);
  expect(await db.db.select().from(tripFiles)).toHaveLength(0);
});
it('renames and reorders without changing bytes, and deletes idempotently', async () => {
  const { file } = await (await upload()).json();
  expect((await routes.edit(req('PATCH', viewer, '{"title":"bad"}'), 'honeymoon', file.id)).status).toBe(403);
  expect((await routes.edit(req('PATCH', owner, '{"title":"입장 티켓","position":3}'), 'honeymoon', file.id)).status).toBe(200);
  const list = await (await routes.list(req('GET'), 'honeymoon')).json();
  expect(list.files[0].title).toBe('입장 티켓');
  expect(list.files[0].position).toBe(3);
  expect((await routes.remove(req('DELETE'), 'honeymoon', file.id)).status).toBe(200);
  expect((await routes.remove(req('DELETE'), 'honeymoon', file.id)).status).toBe(200);
  expect((await routes.get(req('GET'), 'honeymoon', file.id)).status).toBe(404);
});
it('quota rejection keeps existing files intact, even when uploading as an editor', async () => {
  await db.db.update(tripMembers).set({ role: 'EDITOR' }).where(eq(tripMembers.userId, viewer));
  const { file } = await (await upload()).json();
  await db.db.insert(tripFiles).values(Array.from({ length: 99 }, (_, i) => ({
    id: crypto.randomUUID(), tripId, uploadedBy: owner, kind: 'DOCUMENT', placeKey: '',
    name: 'saved.pdf', title: 'saved', mime: 'application/pdf', size: 1, position: i + 1,
    sha256: 'seed-' + i, contentBase64: 'YQ=='
  })));
  const response = await upload(viewer, '%PDF-other');
  expect(response.status).toBe(400);
  expect((await response.json()).message).toContain('100개');
  expect((await routes.get(req('GET'), 'honeymoon', file.id)).status).toBe(200);
});
it('moves a chapter atomically within its place without reordering another place', async () => {
  const query = '?kind=AUDIO&name=story.mp3&placeKey=' + encodeURIComponent('["google","cathedral"]');
  const first = await (await upload(owner, 'ID3one', query)).json();
  const second = await (await upload(owner, 'ID3two', query)).json();
  expect((await routes.edit(req('PATCH', owner, '{"move":"UP"}'), 'honeymoon', second.file.id)).status).toBe(200);
  const list = await (await routes.list(req('GET'), 'honeymoon')).json();
  expect(list.files.map((file: { id: string }) => file.id)).toEqual([second.file.id, first.file.id]);
});
it('enforces the aggregate byte quota before adding a new file', async () => {
  await db.db.insert(tripFiles).values(Array.from({ length: 8 }, (_, i) => ({
    id: crypto.randomUUID(), tripId, uploadedBy: owner, kind: 'AUDIO', placeKey: '',
    name: 'existing.mp3', title: 'saved', mime: 'audio/mpeg', size: 25 * 1024 * 1024,
    sha256: 'seed-' + i, contentBase64: 'YQ=='
  })));
  const response = await upload();
  expect(response.status).toBe(400);
  expect((await response.json()).message).toContain('200MB');
});
