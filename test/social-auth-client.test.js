'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto, createHash } = require('node:crypto');
function storage() {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
}
function browser() {
  const local = storage(); const calls = [];
  const location = { pathname: '/trips', search: '', hash: '#day=2', origin: 'https://web.test', assign(url) { this.assigned = url; } };
  const context = vm.createContext({ URL, URLSearchParams, Uint8Array, TextEncoder, crypto: webcrypto,
    btoa: s => Buffer.from(s, 'binary').toString('base64'), sessionStorage: storage(), location,
    history: { replaceState(_state, _title, path) { const u = new URL(path, location.origin); location.pathname = u.pathname; location.hash = u.hash; } }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../auth.js'), 'utf8'), context);
  const auth = context.TC_AUTH;
  auth.configure({ baseUrl: 'https://api.test', storage: local, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => url.endsWith('auth-config')
      ? { provider: 'TRIPCANVAS', socialProviders: ['google', 'unknown'] }
      : { token: 'signed-session', user: { id: 'user', email: 'test@example.com' } } };
  } });
  return { auth, context, calls, local, location };
}
test('browser binds callback to its proof and restores the original route without URL session tokens', async () => {
  const { auth, context, calls, local, location } = browser();
  await auth.resolveProvider();
  assert.deepEqual(Array.from(auth.socialProviders()), ['google']);
  await auth.startSocial('google');
  const pending = JSON.parse(context.sessionStorage.getItem('withj.oauth.pending.v1'));
  assert.equal(pending.challenge, createHash('sha256').update(pending.verifier).digest('base64url'));
  assert.equal(new URL(location.assigned).searchParams.get('webOrigin'), location.origin);
  location.hash = '#social_ticket=encrypted-ticket&social_state=' + pending.challenge;
  await auth.completeSocial();
  assert.equal(local.getItem(auth.TOKEN_KEY), 'signed-session');
  assert.equal(location.hash, '#day=2');
  assert.equal(JSON.parse(calls.at(-1).init.body).verifier, pending.verifier);
  assert.equal(context.sessionStorage.getItem('withj.oauth.pending.v1'), null);
  await auth.completeSocial();
  assert.equal(calls.length, 2);
});
test('foreign callback state fails without exchanging or saving a session', async () => {
  const { auth, calls, local, location } = browser();
  await auth.resolveProvider(); await auth.startSocial('google');
  location.hash = '#social_ticket=stolen&social_state=wrong';
  await auth.completeSocial();
  assert.equal(calls.length, 1);
  assert.equal(local.getItem(auth.TOKEN_KEY), null);
  assert.ok(auth.socialError());
  assert.equal(location.hash, '');
});

test('proxied web exchanges through the web origin but starts OAuth at the NAS origin', async () => {
  const { auth, context, calls, location } = browser();
  auth.configure({ baseUrl: 'https://web.test/nas', socialStartBaseUrl: 'https://nas.test' });
  await auth.resolveProvider();
  assert.equal(calls[0].url, 'https://web.test/nas/api/v1/auth-config');
  assert.equal(calls[0].init.credentials, 'omit');
  await auth.startSocial('google');
  assert.equal(new URL(location.assigned).origin, 'https://nas.test');
  const pending = JSON.parse(context.sessionStorage.getItem('withj.oauth.pending.v1'));
  location.hash = '#social_ticket=encrypted-ticket&social_state=' + pending.challenge;
  await auth.completeSocial();
  assert.equal(calls.at(-1).url, 'https://web.test/nas/api/auth/social/exchange');
  assert.equal(calls.at(-1).init.credentials, 'omit');
});
