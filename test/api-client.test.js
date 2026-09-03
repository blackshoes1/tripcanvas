// 웹의 API 클라이언트 — Supabase SDK 직접 호출을 대신한다(PR12).
//
// 핵심은 **기존 호출부의 모양을 그대로 유지하는 것**이다: `{data,error}`를 돌려주고,
// 권한 오류는 Supabase가 주던 42501/403으로 옮겨 collab.js의 isForbiddenError가 그대로 동작하게 한다.
// 그래야 app.js의 오류 처리·재시도 규칙을 건드리지 않는다.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const TC_API = require('../api.js');
const TC_COLLAB = require('../collab.js');

/** 호출을 기록하는 가짜 fetch */
function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || 'GET', headers: (init && init.headers) || {}, body: init && init.body ? JSON.parse(init.body) : undefined });
    const result = handler(String(url), init) || {};
    return {
      ok: (result.status || 200) < 400,
      status: result.status || 200,
      async json() { return result.body === undefined ? {} : result.body; },
      async text() { return JSON.stringify(result.body || {}); }
    };
  };
  return { impl, calls };
}

function setup(handler, opts) {
  const f = fakeFetch(handler);
  TC_API.configure(Object.assign({
    baseUrl: 'https://api.test', getToken: async () => 'tok-1', fetchImpl: f.impl
  }, opts || {}));
  return f;
}

test('RPC 이름을 HTTP 호출로 옮기고 토큰을 싣는다', async () => {
  const f = setup(() => ({ body: { schemaVersion: 1, members: [{ id: 1, role: 'OWNER', me: true }] } }));
  const { data, error } = await TC_API.rpc('list_trip_members', { p_client_id: 'trip1' });
  assert.equal(error, null);
  assert.deepEqual(data, [{ id: 1, role: 'OWNER', me: true }]);
  assert.equal(f.calls[0].method, 'GET');
  assert.equal(f.calls[0].url, 'https://api.test/api/v1/trips/trip1/members');
  assert.equal(f.calls[0].headers.authorization, 'Bearer tok-1');
});

test('여행 안의 대상(멤버·후보·코멘트)은 여행 id를 함께 받아 경로를 만든다', async () => {
  const f = setup(() => ({ body: { ok: true } }));
  await TC_API.rpc('manage_trip_member', { p_member_id: 9, p_action: 'SET_ROLE', p_value: 'VIEWER' }, 'trip1');
  assert.equal(f.calls[0].url, 'https://api.test/api/v1/trips/trip1/members/9');
  assert.equal(f.calls[0].method, 'PATCH');
  assert.deepEqual(f.calls[0].body, { action: 'SET_ROLE', value: 'VIEWER' });

  await TC_API.rpc('react_to_candidate', { p_candidate_id: 5, p_reaction: 'MUST' }, 'trip1');
  assert.equal(f.calls[1].url, 'https://api.test/api/v1/trips/trip1/candidates/5/reaction');
  assert.equal(f.calls[1].method, 'PUT');
  assert.deepEqual(f.calls[1].body, { reaction: 'MUST' });
});

test('여행 id가 필요한데 없으면 부르기 전에 오류로 알린다', async () => {
  const f = setup(() => ({ body: {} }));
  const { data, error } = await TC_API.rpc('manage_trip_member', { p_member_id: 9, p_action: 'REMOVE' });
  assert.equal(data, null);
  assert.match(String(error.message), /여행/);
  assert.equal(f.calls.length, 0);
});

test('RPC마다 예전과 같은 모양으로 벗겨 준다', async () => {
  const bodies = {
    '/candidates': { candidates: [{ id: 1, title: '사그라다' }] },
    '/activity': { activity: [{ id: 2, kind: 'REACTION' }] },
    '/preferences': { preferences: [{ user_id: 'u', prefs: {} }] },
    '/invites': { invites: [{ id: 3, active: true }] }
  };
  setup((url) => {
    for (const [suffix, body] of Object.entries(bodies)) if (url.split('?')[0].endsWith(suffix)) return { body };
    return { body: {} };
  });
  assert.deepEqual((await TC_API.rpc('list_trip_candidates', { p_client_id: 't' })).data, [{ id: 1, title: '사그라다' }]);
  assert.deepEqual((await TC_API.rpc('list_trip_activity', { p_client_id: 't', p_limit: 40 })).data, [{ id: 2, kind: 'REACTION' }]);
  assert.deepEqual((await TC_API.rpc('list_trip_preferences', { p_client_id: 't' })).data, [{ user_id: 'u', prefs: {} }]);
  assert.deepEqual((await TC_API.rpc('list_trip_invites', { p_client_id: 't' })).data, [{ id: 3, active: true }]);
});

test('단일 값을 돌려주던 RPC는 그대로 단일 값이다 — rpcRow가 그대로 동작한다', async () => {
  setup((url) => {
    // 경로가 비슷해 순서가 중요하다: 미리보기(/api/v1/invites/:token)와 초대 만들기(/trips/:id/invites)는 다른 곳이다
    if (url.includes('/accept')) return { body: { result: { ok: true, reason: 'OK', client_id: 'trip1' } } };
    if (url.includes('/api/v1/invites/')) return { body: { preview: { valid: true, reason: 'OK', trip_name: '스페인' } } };
    if (url.endsWith('/invites')) return { body: { invite: { id: 1, token: 'T'.repeat(32), role: 'EDITOR', expires_at: 'x' } } };
    return { body: { id: 7 } };
  });
  assert.equal((await TC_API.rpc('create_trip_invite', { p_client_id: 't', p_role: 'EDITOR', p_hours: 168 })).data.token.length, 32);
  assert.equal((await TC_API.rpc('accept_trip_invite', { p_token: 'x'.repeat(20), p_display_name: '영희' })).data.client_id, 'trip1');
  assert.equal((await TC_API.rpc('invite_preview', { p_token: 'x'.repeat(20) })).data.trip_name, '스페인');
  assert.equal((await TC_API.rpc('add_trip_candidate', { p_client_id: 't', p_title: '새 후보', p_note: null })).data, 7);
});

test('권한 오류는 Supabase가 주던 모양으로 옮긴다 — isForbiddenError가 그대로 걸러 낸다', async () => {
  setup(() => ({ status: 403, body: { code: 'FORBIDDEN', error: 'FORBIDDEN', message: '이 여행을 바꿀 권한이 없습니다.' } }));
  const { data, error } = await TC_API.rpc('list_trip_members', { p_client_id: 'trip1' });
  assert.equal(data, null);
  assert.equal(error.code, '42501');
  assert.equal(error.status, 403);
  assert.ok(TC_COLLAB.isForbiddenError(error), 'isForbiddenError가 알아봐야 한다');
});

test('그 밖의 오류는 코드와 메시지를 그대로 전한다', async () => {
  setup(() => ({ status: 409, body: { code: 'STALE_VERSION', message: '다른 기기에서 먼저 바뀌었습니다.', revision: 7 } }));
  const { error } = await TC_API.rpc('list_trip_members', { p_client_id: 'trip1' });
  assert.equal(error.status, 409);
  assert.equal(error.apiCode, 'STALE_VERSION');
  assert.match(error.message, /먼저 바뀌었습니다/);
  assert.ok(!TC_COLLAB.isForbiddenError(error));
});

test('네트워크가 끊겨도 예외를 던지지 않고 error로 돌려준다 — 호출부가 그대로다', async () => {
  TC_API.configure({ baseUrl: 'https://api.test', getToken: async () => 'tok', fetchImpl: async () => { throw new Error('offline'); } });
  const { data, error } = await TC_API.rpc('list_trip_members', { p_client_id: 'trip1' });
  assert.equal(data, null);
  assert.match(String(error.message), /offline|연결/);
});

test('로그인하지 않았으면 부르지 않는다', async () => {
  const f = setup(() => ({ body: {} }), { getToken: async () => null });
  const { data, error } = await TC_API.rpc('list_trip_members', { p_client_id: 'trip1' });
  assert.equal(data, null);
  assert.equal(error.status, 401);
  assert.equal(f.calls.length, 0);
});

test('모르는 RPC 이름은 조용히 통과시키지 않는다', async () => {
  setup(() => ({ body: {} }));
  const { error } = await TC_API.rpc('drop_everything', {});
  assert.match(String(error.message), /drop_everything/);
});

test('버전 이력 — 만들기·목록·불러오기', async () => {
  const f = setup((url) => {
    if (url.endsWith('/snapshots')) return { body: { snapshot: { id: 3, name: '스페인', created_at: 'x' }, snapshots: [{ id: 3, name: '스페인', created_at: 'x' }] } };
    return { body: { snapshot: { id: 3, data: { name: '스페인' } } } };
  });
  const made = await TC_API.snapshots.create('trip1', '스페인');
  assert.equal(made.data.id, 3);
  assert.equal(f.calls[0].method, 'POST');
  assert.deepEqual(f.calls[0].body, { name: '스페인' });

  const list = await TC_API.snapshots.list('trip1');
  assert.deepEqual(list.data, [{ id: 3, name: '스페인', created_at: 'x' }]);

  const loaded = await TC_API.snapshots.load('trip1', 3);
  assert.deepEqual(loaded.data.data, { name: '스페인' });
  assert.equal(f.calls[2].url, 'https://api.test/api/v1/trips/trip1/snapshots/3');
});

test('여행 id에 특수문자가 있어도 경로가 깨지지 않는다', async () => {
  const f = setup(() => ({ body: { members: [] } }));
  await TC_API.rpc('list_trip_members', { p_client_id: 'a b/c?d' });
  assert.ok(f.calls[0].url.includes('a%20b%2Fc%3Fd'), f.calls[0].url);
});

test('초대 미리보기는 로그인 전에도 부른다 — 토큰 없이 나가고 Authorization을 붙이지 않는다(§6)', async () => {
  const f = setup(() => ({ body: { preview: { valid: true, reason: 'OK', trip_name: '스페인' } } }), { getToken: async () => null });
  const { data, error } = await TC_API.rpc('invite_preview', { p_token: 'x'.repeat(20) });
  assert.equal(error, null);
  assert.equal(data.trip_name, '스페인');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].headers.authorization, undefined);
});

test('로그인했으면 미리보기에도 토큰을 실어 already_member가 정확해진다', async () => {
  const f = setup(() => ({ body: { preview: { valid: true, already_member: true } } }));
  await TC_API.rpc('invite_preview', { p_token: 'x'.repeat(20) });
  assert.equal(f.calls[0].headers.authorization, 'Bearer tok-1');
});

// ── /me 와 자체 실시간 (PR12b) ──

test('/me — 역할·인원과 실시간 선택을 한 번에 받는다', async () => {
  const f = setup(() => ({ body: {
    user: { id: 'u1', email: 'a@b.c' },
    trips: [{ id: 'trip1', role: 'EDITOR', memberCount: 3, owner: false, supabaseTripId: 'row-1' }],
    realtime: { provider: 'SUPABASE', url: null }
  } }));
  const { data, error } = await TC_API.me();
  assert.equal(error, null);
  assert.equal(f.calls[0].url, 'https://api.test/api/v1/me');
  assert.equal(data.trips[0].supabaseTripId, 'row-1');
  assert.equal(data.realtime.provider, 'SUPABASE');
});

/** 가짜 WebSocket — 열림·메시지·닫힘을 손으로 몬다 */
function fakeSocketFactory() {
  const made = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.sent = []; this.closed = null; made.push(this); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close(code) { this.closed = code || 1000; if (this.onclose) this.onclose({ code: this.closed }); }
    open() { if (this.onopen) this.onopen(); }
    deliver(msg) { if (this.onmessage) this.onmessage({ data: JSON.stringify(msg) }); }
  }
  return { made, FakeSocket };
}

test('실시간 — 붙으면 인증하고 구독한다. 여행 id는 client_id다(내부 id를 쓰지 않는다)', async () => {
  const { made, FakeSocket } = fakeSocketFactory();
  const events = [], states = [];
  const conn = TC_API.realtime.connect({
    url: 'wss://api.test/ws', tripId: 'trip1', getToken: async () => 'tok-1',
    onEvent: (e) => events.push(e), onState: (on) => states.push(on), socketImpl: FakeSocket
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(made[0].url, 'wss://api.test/ws');
  made[0].open();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(made[0].sent[0], { type: 'AUTH', token: 'tok-1' });

  made[0].deliver({ type: 'READY' });
  assert.deepEqual(made[0].sent[1], { type: 'SUBSCRIBE', tripId: 'trip1' });
  assert.deepEqual(states, [false]);                       // 구독 전에는 아직 '실시간'이 아니다

  made[0].deliver({ type: 'SUBSCRIBED', tripId: 'trip1' });
  assert.deepEqual(states, [false, true]);

  made[0].deliver({ type: 'ACTIVITY', tripId: 'trip1', id: 7, kind: 'REACTION', mine: false });
  assert.deepEqual(events, [{ type: 'ACTIVITY', tripId: 'trip1', id: 7, kind: 'REACTION', mine: false }]);
  conn.close();
  assert.equal(made[0].closed, 1000);
});

test('실시간 — PING에 PONG으로 답한다(답하지 않으면 서버가 끊는다)', async () => {
  const { made, FakeSocket } = fakeSocketFactory();
  TC_API.realtime.connect({ url: 'wss://x/ws', tripId: 't', getToken: async () => 'tok', onEvent: () => {}, onState: () => {}, socketImpl: FakeSocket });
  await new Promise((r) => setTimeout(r, 0));
  made[0].open(); await new Promise((r) => setTimeout(r, 0));
  made[0].deliver({ type: 'PING' });
  assert.deepEqual(made[0].sent.at(-1), { type: 'PONG' });
});

test('실시간 — 거절당하면 상태를 내리고 다시 붙지 않는다(권한 문제는 재시도해도 같다)', async () => {
  const { made, FakeSocket } = fakeSocketFactory();
  const states = [];
  TC_API.realtime.connect({ url: 'wss://x/ws', tripId: 't', getToken: async () => 'tok', onEvent: () => {}, onState: (on) => states.push(on), socketImpl: FakeSocket, retryMs: 1 });
  await new Promise((r) => setTimeout(r, 0));
  made[0].open(); await new Promise((r) => setTimeout(r, 0));
  made[0].deliver({ type: 'ERROR', code: 'FORBIDDEN', tripId: 't' });
  made[0].close(4403);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(made.length, 1, '재시도하지 않아야 한다');
  assert.equal(states.at(-1), false);
});

test('실시간 — 그냥 끊기면 다시 붙는다(네트워크는 흔들린다)', async () => {
  const { made, FakeSocket } = fakeSocketFactory();
  const conn = TC_API.realtime.connect({ url: 'wss://x/ws', tripId: 't', getToken: async () => 'tok', onEvent: () => {}, onState: () => {}, socketImpl: FakeSocket, retryMs: 1 });
  await new Promise((r) => setTimeout(r, 0));
  made[0].open(); await new Promise((r) => setTimeout(r, 0));
  made[0].close(1006);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(made.length, 2, '다시 붙어야 한다');
  conn.close();
});

test('실시간 — 닫은 뒤에는 다시 붙지 않는다', async () => {
  const { made, FakeSocket } = fakeSocketFactory();
  const conn = TC_API.realtime.connect({ url: 'wss://x/ws', tripId: 't', getToken: async () => 'tok', onEvent: () => {}, onState: () => {}, socketImpl: FakeSocket, retryMs: 1 });
  await new Promise((r) => setTimeout(r, 0));
  made[0].open(); await new Promise((r) => setTimeout(r, 0));
  conn.close();
  made[0].close(1000);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(made.length, 1);
});

test('실시간 — 토큰이 없으면 붙지 않는다', async () => {
  const { made, FakeSocket } = fakeSocketFactory();
  TC_API.realtime.connect({ url: 'wss://x/ws', tripId: 't', getToken: async () => null, onEvent: () => {}, onState: () => {}, socketImpl: FakeSocket });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(made.length, 0);
});
