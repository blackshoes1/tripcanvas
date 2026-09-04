// TripCanvas 인증 클라이언트 (웹) — Supabase Auth와 자체 Auth를 **같은 모양**으로 감싼다(PR11, docs/supabase-migration.md).
//
// api.js와 같은 원칙이다: 호출부의 모양을 바꾸지 않는다.
//   · `{data, error}`를 돌려주고 예외를 던지지 않는다
//   · 오류는 화면이 분기할 수 있는 **코드**로 정규화한다 — 제공자마다 다른 문구를 app.js가 알 필요가 없다
//   · 누가 로그인/로그아웃했는지는 onChange 하나로 알린다 (Supabase의 onAuthStateChange 자리)
//
// ⚠️ **어느 쪽을 쓸지는 서버가 정한다**(`GET /api/v1/auth-config`). 클라이언트가 고르면,
// 서버에 자체 Auth가 꺼져 있는데 웹만 그쪽으로 로그인하려다 아무 데도 못 들어가는 상태가 된다.
// 응답을 못 받으면 SUPABASE로 남는다 — 오늘의 동작이 기본값이다.
//
// 기존 사용자(§19): Supabase의 비밀번호 해시는 **옮기지 않는다.** 자체 Auth로 넘어간 뒤 처음 로그인하면
// 비밀번호를 새로 정해야 한다. 확인된 이메일로 기존 도메인 사용자와 이어지므로(server/auth/identity.ts)
// 여행은 그대로 있다. 그래서 로그인 실패는 '틀렸다'로 끝내지 않고 재설정 길을 함께 알린다.
(function (global) {
  'use strict';

  // 운영 API는 NAS다(2026-09-04 전환). Tailscale Funnel이 ts.net 이름에 HTTPS를 붙여 준다 —
  // 도메인을 사지 않고 공개 주소를 얻는 길이고, TLS는 Tailscale이 끝낸다(docs/nas-deployment.md).
  const DEFAULT_BASE = 'https://bokbok9.tail8b977f.ts.net';
  /** 자체 Auth 세션 토큰을 두는 곳. Supabase 모드에서는 쓰지 않는다(SDK가 제 저장소를 쓴다) */
  const TOKEN_KEY = 'tripcanvas_auth_v1';

  let _base = DEFAULT_BASE;
  /** @type {typeof fetch|null} */
  let _fetch = null;
  /** @type {Storage|null} */
  let _storage = null;
  /** @type {any} */
  let _sb = null;
  /** @type {'SUPABASE'|'TRIPCANVAS'} */
  let _provider = 'SUPABASE';
  /** @type {{token:string|null, user:{id:string,email:string}}|null} */
  let _session = null;
  /** @type {((user:{id:string,email:string}|null)=>void)[]} */
  const _listeners = [];

  /**
   * @param {{baseUrl?:string, fetchImpl?:typeof fetch, storage?:Storage|null, supabase?:any}} options
   */
  function configure(options) {
    const o = options || {};
    if (o.baseUrl) _base = String(o.baseUrl).replace(/\/+$/, '');
    if (o.fetchImpl) _fetch = o.fetchImpl;
    if ('storage' in o) _storage = o.storage || null;
    if ('supabase' in o) _sb = o.supabase || null;
  }

  /** @param {string} path @param {RequestInit=} init */
  async function call(path, init) {
    const f = _fetch || (typeof fetch === 'function' ? fetch : null);
    if (!f) throw new Error('fetch 없음');
    return f(_base + path, init);
  }

  function readToken() {
    if (!_storage) return null;
    try { return _storage.getItem(TOKEN_KEY); } catch (_) { return null; }
  }
  /** @param {string|null} token */
  function writeToken(token) {
    if (!_storage) return;
    try { if (token) _storage.setItem(TOKEN_KEY, token); else _storage.removeItem(TOKEN_KEY); } catch (_) { /* 사파리 시크릿 모드 등 */ }
  }

  /** 로그인 상태가 바뀐 것을 한 곳에서 알린다 @param {{token:string|null,user:{id:string,email:string}}|null} next */
  function setSession(next) {
    _session = next;
    const u = next ? next.user : null;
    for (const cb of _listeners.slice()) { try { cb(u); } catch (_) { /* 구독자 하나가 죽어도 나머지는 받는다 */ } }
  }

  /**
   * 제공자마다 다른 실패를 화면이 분기할 수 있는 코드로 옮긴다.
   * 문구가 아니라 코드로 분기해야 제공자를 바꿔도 UI가 그대로다.
   * @param {number} status @param {any} body @returns {{code:string, message:string}}
   */
  function toError(status, body) {
    const b = /** @type {any} */ (body && typeof body === 'object' ? body : {});
    const raw = String(b.message || b.error || b.code || '');
    const code = String(b.code || '');
    if (status === 429) return { code: 'RATE_LIMITED', message: '너무 여러 번 시도했어 — 잠시 뒤에 다시 해줘' };
    if (/EMAIL_NOT_VERIFIED|verify|verification/i.test(code + ' ' + raw)) {
      return { code: 'EMAIL_NOT_VERIFIED', message: '메일의 확인 링크를 먼저 눌러줘 (스팸함도 확인)' };
    }
    if (status === 401 || status === 403 || /invalid|credential|password/i.test(code + ' ' + raw)) {
      return { code: 'INVALID_CREDENTIALS', message: '이메일 또는 비밀번호가 맞지 않아' };
    }
    if (/exist|already/i.test(code + ' ' + raw)) return { code: 'EMAIL_TAKEN', message: '이미 가입된 이메일이야 — 로그인해줘' };
    return { code: 'UNKNOWN', message: raw || '알 수 없는 오류' };
  }

  /** @param {unknown} err */
  function networkError(err) {
    return { code: 'NETWORK', message: '네트워크에 연결하지 못했어 — 잠시 뒤에 다시 해줘', cause: err };
  }

  /** @param {Response} res */
  async function readBody(res) {
    try { return await res.json(); } catch (_) { return null; }
  }

  // ── 어느 Auth를 쓸지: 서버가 정한다 ────────────────────────────────────────

  /**
   * `GET /api/v1/auth-config` — 토큰 없이 부른다(로그인 전에 알아야 하므로).
   * 못 받으면 SUPABASE로 남긴다: 서버가 옛 배포이거나 네트워크가 끊겼을 때 오늘의 동작이 이어진다.
   * @returns {Promise<'SUPABASE'|'TRIPCANVAS'>}
   */
  async function resolveProvider() {
    try {
      const res = await call('/api/v1/auth-config');
      if (!res.ok) return _provider;
      const body = await readBody(res);
      const p = body && body.provider;
      if ((p === 'TRIPCANVAS' || p === 'SUPABASE') && p !== _provider) use(p);
    } catch (_) { /* 오늘의 동작을 유지한다 */ }
    return _provider;
  }

  function provider() { return _provider; }
  /**
   * 이 Auth를 쓰겠다고 정한다. **들고 있던 세션은 버린다** —
   * 다른 Auth에서 얻은 사용자를 이어서 들고 있으면, 그 토큰으로는 아무것도 못 하면서 로그인한 것처럼 보인다.
   * @param {'SUPABASE'|'TRIPCANVAS'} p
   */
  function use(p) {
    _provider = p === 'TRIPCANVAS' ? 'TRIPCANVAS' : 'SUPABASE';
    setSession(null);
  }

  // ── Supabase 경로 (오늘) ─────────────────────────────────────────────────

  /** Supabase SDK의 상태 변화를 우리 onChange로 잇는다 */
  function attachSupabase() {
    if (!_sb || !_sb.auth || typeof _sb.auth.onAuthStateChange !== 'function') return;
    _sb.auth.onAuthStateChange((/** @type {any} */ _e, /** @type {any} */ session) => {
      const u = (session && session.user) || null;
      setSession(u ? { token: (session && session.access_token) || null, user: { id: u.id, email: u.email || '' } } : null);
    });
  }

  // ── 자체 Auth 경로 ───────────────────────────────────────────────────────

  /** 세션 토큰으로 지금 누구인지 확인한다. 토큰이 죽었으면 지운다 */
  async function restoreTripCanvas() {
    const token = readToken();
    if (!token) { setSession(null); return null; }
    try {
      const res = await call('/api/auth/get-session', { headers: { authorization: 'Bearer ' + token } });
      const body = res.ok ? await readBody(res) : null;
      const u = body && body.user;
      if (!u || !u.id) { writeToken(null); setSession(null); return null; }
      setSession({ token, user: { id: String(u.id), email: String(u.email || '') } });
      return _session;
    } catch (_) {
      // 네트워크 문제로 토큰을 버리지 않는다 — 오프라인에서 로그아웃당하지 않게
      return _session;
    }
  }

  /** 로그인 상태를 복구한다. 앱이 뜰 때 한 번 */
  async function restore() {
    if (_provider === 'TRIPCANVAS') return restoreTripCanvas();
    // Supabase는 SDK가 제 저장소에서 복구하고 onAuthStateChange로 알려 준다
    return _session;
  }

  /**
   * @param {{email:string, password:string}} creds
   * @returns {Promise<{data:any, error:{code:string,message:string}|null}>}
   */
  async function signIn(creds) {
    if (_provider === 'SUPABASE') {
      if (!_sb) return { data: null, error: { code: 'UNAVAILABLE', message: '온라인 상태에서 다시 시도해줘' } };
      const { data, error } = await _sb.auth.signInWithPassword(creds);
      return { data, error: error ? toError(error.status || 401, error) : null };
    }
    try {
      const res = await call('/api/auth/sign-in/email', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(creds)
      });
      if (!res.ok) return { data: null, error: toError(res.status, await readBody(res)) };
      // bearer 플러그인이 세션 토큰을 헤더로 준다 — 쿠키를 쓰지 않는다(교차 출처)
      const token = res.headers.get('set-auth-token');
      const body = await readBody(res);
      const u = (body && body.user) || null;
      if (!token || !u) return { data: null, error: { code: 'UNKNOWN', message: '세션을 받지 못했어' } };
      writeToken(token);
      setSession({ token, user: { id: String(u.id), email: String(u.email || creds.email) } });
      return { data: _session, error: null };
    } catch (err) { return { data: null, error: networkError(err) }; }
  }

  /**
   * @param {{email:string, password:string}} creds
   * @returns {Promise<{data:any, error:{code:string,message:string}|null, verificationSent:boolean}>}
   */
  async function signUp(creds) {
    if (_provider === 'SUPABASE') {
      if (!_sb) return { data: null, error: { code: 'UNAVAILABLE', message: '온라인 상태에서 다시 시도해줘' }, verificationSent: false };
      const { data, error } = await _sb.auth.signUp(creds);
      return { data, error: error ? toError(error.status || 400, error) : null, verificationSent: !!(data && !data.session) };
    }
    try {
      const res = await call('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 이름은 받지 않는다 — 여행에 보이는 이름은 여행별로 정한다(§69)
        body: JSON.stringify({ email: creds.email, password: creds.password, name: creds.email.split('@')[0] })
      });
      if (!res.ok) return { data: null, error: toError(res.status, await readBody(res)), verificationSent: false };
      // 이메일 확인 전에는 로그인이 열리지 않는다 — 가입 직후 세션을 기대하지 않는다
      return { data: await readBody(res), error: null, verificationSent: true };
    } catch (err) { return { data: null, error: networkError(err), verificationSent: false }; }
  }

  /**
   * 비밀번호 재설정 메일. **있는 이메일인지 알려주지 않는다** — 계정이 있는지 떠보는 데 쓰이지 않게
   * 성공/실패를 구분하지 않고 같은 답을 돌려준다.
   * @param {string} email
   */
  async function requestPasswordReset(email) {
    if (_provider === 'SUPABASE') {
      if (!_sb || !_sb.auth.resetPasswordForEmail) return { error: { code: 'UNAVAILABLE', message: '지금은 할 수 없어' } };
      try { await _sb.auth.resetPasswordForEmail(email); } catch (_) { /* 같은 답을 준다 */ }
      return { error: null };
    }
    try {
      await call('/api/auth/request-password-reset', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email })
      });
    } catch (_) { /* 같은 답을 준다 */ }
    return { error: null };
  }

  /**
   * 메일 링크로 받은 토큰 + 새 비밀번호. 토큰 검증은 서버(better-auth)가 한다.
   * @param {string} token @param {string} password
   */
  async function resetPassword(token, password) {
    if (_provider === 'SUPABASE') return { error: { code: 'UNAVAILABLE', message: '지금은 할 수 없어' } };
    try {
      const res = await call('/api/auth/reset-password', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPassword: password, token: token })
      });
      if (!res.ok) {
        const mapped = toError(res.status, await readBody(res));
        // 토큰 문제는 '비밀번호가 틀렸다'와 전혀 다른 상황이다 — 링크는 한 번만 쓰이고, 새로 요청하면 앞의 것이 무효가 된다.
        // 일반 매퍼는 그것을 알 수 없으므로(본문에 'invalid'만 온다) 여기서 갈라 준다.
        if (mapped.code !== 'RATE_LIMITED' && res.status >= 400 && res.status < 500) {
          return { error: { code: 'INVALID_RESET_TOKEN', message: '링크가 만료됐거나 이미 쓴 링크야 — 재설정을 다시 요청해줘' } };
        }
        return { error: mapped };
      }
      return { error: null };
    } catch (err) { return { error: networkError(err) }; }
  }

  async function signOut() {
    if (_provider === 'SUPABASE') {
      if (_sb) { try { await _sb.auth.signOut(); } catch (_) { /* 이미 끊김 */ } }
      return { error: null };
    }
    const token = readToken();
    // 로컬 세션은 먼저 지운다 — 서버 호출이 실패해도 이 기기에서는 로그아웃돼야 한다
    writeToken(null);
    setSession(null);
    if (token) {
      try { await call('/api/auth/sign-out', { method: 'POST', headers: { authorization: 'Bearer ' + token } }); }
      catch (_) { /* 서버 세션은 만료로 정리된다 */ }
    }
    return { error: null };
  }

  /** API·실시간이 함께 쓰는 토큰 @returns {Promise<string|null>} */
  async function getToken() {
    if (_provider === 'TRIPCANVAS') return (_session && _session.token) || readToken();
    if (!_sb) return null;
    try { const { data } = await _sb.auth.getSession(); return (data && data.session && data.session.access_token) || null; }
    catch (_) { return null; }
  }

  /** @returns {{id:string,email:string}|null} */
  function user() { return _session ? _session.user : null; }

  /** @param {(user:{id:string,email:string}|null)=>void} cb */
  function onChange(cb) { if (typeof cb === 'function') _listeners.push(cb); }

  const AUTH = {
    configure, resolveProvider, provider, use, attachSupabase, restore,
    signIn, signUp, signOut, requestPasswordReset, resetPassword, getToken, user, onChange,
    DEFAULT_BASE, TOKEN_KEY
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = AUTH; }   // Node (테스트)
  global.TC_AUTH = AUTH;
})(/** @type {any} */ (typeof globalThis !== 'undefined' ? globalThis : this));
