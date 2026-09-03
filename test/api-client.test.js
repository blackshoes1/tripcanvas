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
