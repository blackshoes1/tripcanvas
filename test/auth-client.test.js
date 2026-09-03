// 웹의 인증 클라이언트 — Supabase Auth와 자체 Auth를 같은 모양으로 감싼다(PR11).
//
// 검사하는 것은 셋이다:
//   1. **누가 정하는가** — 제공자는 서버가 정하고, 못 받으면 오늘의 동작(SUPABASE)이 남는다
//   2. **기존 사용자가 들어올 수 있는가**(§19) — 해시를 옮기지 않으므로 재설정 길이 반드시 열려 있어야 한다
//   3. **호출부 모양** — {data,error}를 돌려주고 예외를 던지지 않는다
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const TC_AUTH = require('../auth.js');

/** 호출을 기록하는 가짜 fetch. 헤더도 돌려줄 수 있어야 한다 — 세션 토큰이 헤더로 온다 */
function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({
      url: String(url), method: (init && init.method) || 'GET',
      headers: (init && init.headers) || {},
      body: init && init.body ? JSON.parse(init.body) : undefined
    });
    const r = handler(String(url), init) || {};
    if (r.throws) throw new Error('네트워크 끊김');
    const headers = new Map(Object.entries(r.headers || {}));
    return {
      ok: (r.status || 200) < 400,
      status: r.status || 200,
      headers: { get: (k) => headers.get(String(k).toLowerCase()) ?? null },
      async json() { return r.body === undefined ? {} : r.body; }
    };
  };
  return { impl, calls };
}

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    get size() { return m.size; }
  };
}

/** 각 테스트가 깨끗한 상태에서 시작하도록 */
function setup(handler, opts = {}) {
  const { impl, calls } = fakeFetch(handler || (() => ({})));
  const storage = memoryStorage();
  TC_AUTH.use(opts.provider || 'TRIPCANVAS');
  TC_AUTH.configure({ baseUrl: 'https://api.test', fetchImpl: impl, storage, supabase: opts.supabase || null });
  return { calls, storage };
}

// ───────────────── 제공자는 서버가 정한다 ─────────────────

test('제공자를 서버에서 받아 쓴다', async () => {
  setup((url) => (url.endsWith('/api/v1/auth-config') ? { body: { provider: 'TRIPCANVAS' } } : {}), { provider: 'SUPABASE' });
  assert.equal(await TC_AUTH.resolveProvider(), 'TRIPCANVAS');
  assert.equal(TC_AUTH.provider(), 'TRIPCANVAS');
});

test('서버가 답하지 않으면 오늘의 동작(SUPABASE)이 남는다 — 옛 배포·오프라인에서 로그인이 막히지 않게', async () => {
  setup(() => ({ throws: true }), { provider: 'SUPABASE' });
  assert.equal(await TC_AUTH.resolveProvider(), 'SUPABASE');

  setup(() => ({ status: 404 }), { provider: 'SUPABASE' });
  assert.equal(await TC_AUTH.resolveProvider(), 'SUPABASE');
});

test('모르는 제공자 이름은 무시한다', async () => {
  setup(() => ({ body: { provider: 'FIREBASE' } }), { provider: 'SUPABASE' });
  assert.equal(await TC_AUTH.resolveProvider(), 'SUPABASE');
});

// ───────────────── 자체 Auth 로그인 ─────────────────

test('로그인하면 세션 토큰을 헤더에서 받아 저장하고, API가 그 토큰을 쓴다', async () => {
  const { calls, storage } = setup((url) => url.endsWith('/api/auth/sign-in/email')
    ? { headers: { 'set-auth-token': 'tok-1' }, body: { user: { id: 'u1', email: 'a@example.com' } } }
    : {});

  const { data, error } = await TC_AUTH.signIn({ email: 'a@example.com', password: 'pw123456' });
  assert.equal(error, null);
  assert.equal(data.user.id, 'u1');
  assert.equal(await TC_AUTH.getToken(), 'tok-1');
  assert.equal(storage.getItem(TC_AUTH.TOKEN_KEY), 'tok-1');
  assert.equal(calls[0].url, 'https://api.test/api/auth/sign-in/email');
});

test('토큰 없이 200이 와도 로그인으로 치지 않는다', async () => {
  setup(() => ({ body: { user: { id: 'u1', email: 'a@example.com' } } }));   // set-auth-token 없음
  const { data, error } = await TC_AUTH.signIn({ email: 'a@example.com', password: 'pw123456' });
  assert.equal(data, null);
  assert.equal(error.code, 'UNKNOWN');
  assert.equal(TC_AUTH.user(), null);
});

test('실패는 제공자 문구가 아니라 코드로 분기한다', async () => {
  const cases = [
    [401, { message: 'Invalid email or password' }, 'INVALID_CREDENTIALS'],
    [403, { code: 'EMAIL_NOT_VERIFIED', message: 'Email not verified' }, 'EMAIL_NOT_VERIFIED'],
    [429, { message: 'Too many requests' }, 'RATE_LIMITED'],
    [500, { message: '' }, 'UNKNOWN']
  ];
  for (const [status, body, expected] of cases) {
    setup(() => ({ status, body }));
    const { error } = await TC_AUTH.signIn({ email: 'a@example.com', password: 'pw123456' });
    assert.equal(error.code, expected, `${status} → ${expected}`);
  }
});

test('네트워크가 끊겨도 던지지 않고 error로 돌려준다', async () => {
  setup(() => ({ throws: true }));
  const { data, error } = await TC_AUTH.signIn({ email: 'a@example.com', password: 'pw123456' });
  assert.equal(data, null);
  assert.equal(error.code, 'NETWORK');
});

// ───────────────── 기존 사용자의 길 (§19) ─────────────────

test('재설정 요청은 이메일이 있든 없든 같은 답이다 — 계정 유무를 떠보는 데 쓰이지 않게', async () => {
  const seen = [];
  setup((url, init) => { seen.push(JSON.parse(init.body).email); return { status: 404, body: { message: 'User not found' } }; });

  const a = await TC_AUTH.requestPasswordReset('있는@example.com');
  const b = await TC_AUTH.requestPasswordReset('없는@example.com');
  assert.deepEqual(a, { error: null });
  assert.deepEqual(b, { error: null });
  assert.deepEqual(seen, ['있는@example.com', '없는@example.com']);
});

test('재설정은 네트워크가 끊겨도 같은 답이다', async () => {
  setup(() => ({ throws: true }));
  assert.deepEqual(await TC_AUTH.requestPasswordReset('a@example.com'), { error: null });
});

// ───────────────── 가입 ─────────────────

test('가입하면 확인 메일을 기다린다 — 확인 전에는 로그인이 열리지 않는다', async () => {
  const { calls } = setup(() => ({ body: { user: { id: 'u2' } } }));
  const r = await TC_AUTH.signUp({ email: 'b@example.com', password: 'pw123456' });
  assert.equal(r.error, null);
  assert.equal(r.verificationSent, true);
  assert.equal(TC_AUTH.user(), null, '확인 전에는 로그인 상태가 아니다');
  assert.equal(calls[0].body.email, 'b@example.com');
});

// ───────────────── 세션 복구 · 로그아웃 ─────────────────

test('저장된 토큰으로 로그인 상태를 복구한다', async () => {
  const { storage } = setup((url) => url.endsWith('/api/auth/get-session')
    ? { body: { user: { id: 'u1', email: 'a@example.com' } } } : {});
  storage.setItem(TC_AUTH.TOKEN_KEY, 'tok-1');

  await TC_AUTH.restore();
  assert.deepEqual(TC_AUTH.user(), { id: 'u1', email: 'a@example.com' });
});

test('죽은 토큰은 지운다', async () => {
  const { storage } = setup(() => ({ status: 401, body: {} }));
  storage.setItem(TC_AUTH.TOKEN_KEY, 'stale');

  await TC_AUTH.restore();
  assert.equal(TC_AUTH.user(), null);
  assert.equal(storage.getItem(TC_AUTH.TOKEN_KEY), null);
});

test('네트워크 문제로는 토큰을 버리지 않는다 — 오프라인에서 로그아웃당하지 않게', async () => {
  const { storage } = setup(() => ({ throws: true }));
  storage.setItem(TC_AUTH.TOKEN_KEY, 'tok-1');

  await TC_AUTH.restore();
  assert.equal(storage.getItem(TC_AUTH.TOKEN_KEY), 'tok-1');
});

test('로그아웃은 서버 호출이 실패해도 이 기기에서 끝난다', async () => {
  const { storage } = setup(() => ({ throws: true }));
  storage.setItem(TC_AUTH.TOKEN_KEY, 'tok-1');
  await TC_AUTH.restore().catch(() => {});

  await TC_AUTH.signOut();
  assert.equal(storage.getItem(TC_AUTH.TOKEN_KEY), null);
  assert.equal(TC_AUTH.user(), null);
  assert.equal(await TC_AUTH.getToken(), null);
});

test('로그인·로그아웃은 onChange 하나로 알린다', async () => {
  const seen = [];
  setup((url) => url.endsWith('/api/auth/sign-in/email')
    ? { headers: { 'set-auth-token': 'tok-1' }, body: { user: { id: 'u1', email: 'a@example.com' } } } : {});
  TC_AUTH.onChange((u) => seen.push(u ? u.id : null));

  await TC_AUTH.signIn({ email: 'a@example.com', password: 'pw123456' });
  await TC_AUTH.signOut();
  assert.deepEqual(seen.slice(-2), ['u1', null]);
});

// ───────────────── Supabase 경로는 그대로 (오늘) ─────────────────

test('SUPABASE 모드는 SDK를 그대로 쓴다 — 오늘의 동작이 변하지 않는다', async () => {
  const seen = [];
  const sb = {
    auth: {
      signInWithPassword: async (c) => { seen.push(['in', c.email]); return { data: { user: { id: 'u1' } }, error: null }; },
      signOut: async () => { seen.push(['out']); },
      getSession: async () => ({ data: { session: { access_token: 'sb-tok' } } }),
      onAuthStateChange: () => {}
    }
  };
  setup(() => ({}), { provider: 'SUPABASE', supabase: sb });

  const { error } = await TC_AUTH.signIn({ email: 'a@example.com', password: 'pw123456' });
  assert.equal(error, null);
  assert.equal(await TC_AUTH.getToken(), 'sb-tok');
  await TC_AUTH.signOut();
  assert.deepEqual(seen, [['in', 'a@example.com'], ['out']]);
});

test('SUPABASE 모드에서는 자체 Auth 저장소를 건드리지 않는다', async () => {
  const sb = { auth: { signOut: async () => {}, getSession: async () => ({ data: null }), onAuthStateChange: () => {} } };
  const { storage } = setup(() => ({}), { provider: 'SUPABASE', supabase: sb });
  await TC_AUTH.signOut();
  assert.equal(storage.size, 0);
});
