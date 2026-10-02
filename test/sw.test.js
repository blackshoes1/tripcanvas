// sw.js 앱 셸 — index.html이 부르는 로컬 파일을 **그 주소 그대로** 미리 담는가, 오프라인에서 그걸 돌려주는가.
// 첫 방문의 스크립트 요청은 SW를 거치지 않으므로(아직 설치 전) 오프라인에서 쓸 것은 설치 때 담은 셸뿐이다.
// 그 셸이 `lib.js`인데 페이지가 `lib.js?v=tc-v…`를 부르면 캐시를 못 찾아 빈 화면이 된다.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const ORIGIN = 'https://app.test';

/** index.html이 여는 로컬 파일 주소(쿼리 포함) — 스크립트·스타일·매니페스트·아이콘 */
function localAssets() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const urls = [...html.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)="([^"]+)"/gi)].map((m) => m[1])
    .filter((u) => !/^(?:[a-z]+:|\/\/|#)/i.test(u));
  return [...new Set(urls)].map((u) => new URL(u, ORIGIN + '/').href);
}

/** sw.js를 가짜 Cache Storage·네트워크 위에 올린다. 캐시는 브라우저처럼 쿼리까지 비교한다(ignoreSearch일 때만 뺀다). */
function loadWorker() {
  const listeners = {};
  const caches = new Map();
  const net = { online: true };
  const abs = (req) => new URL(typeof req === 'string' ? req : req.url, ORIGIN + '/sw.js').href;
  const bare = (u) => { const x = new URL(u); x.search = ''; return x.href; };
  const response = (url) => ({ status: 200, url, clone() { return this; } });
  const fetchImpl = async (req) => {
    if (!net.online) throw new TypeError('Failed to fetch');
    return response(abs(req));
  };
  const cacheOf = (name) => {
    if (!caches.has(name)) caches.set(name, new Map());
    const entries = caches.get(name);
    return {
      async addAll(urls) { for (const u of urls) entries.set(abs(u), await fetchImpl(u)); },
      async put(req, res) { entries.set(abs(req), res); }
    };
  };
  const cacheStorage = {
    async open(name) { return cacheOf(name); },
    async keys() { return [...caches.keys()]; },
    async delete(name) { return caches.delete(name); },
    async match(req, opts = {}) {
      const url = abs(req);
      for (const entries of caches.values()) {
        for (const [key, res] of entries) if (key === url || (opts.ignoreSearch && bare(key) === bare(url))) return res;
      }
      return undefined;
    }
  };
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'),
    { self, caches: cacheStorage, fetch: fetchImpl, location: new URL(ORIGIN + '/sw.js'), URL });
  const lifecycle = async (type) => { let done; listeners[type]({ waitUntil: (p) => { done = p; } }); await done; };
  return {
    net,
    cached: () => [...caches.values()].flatMap((entries) => [...entries.keys()]),
    install: () => lifecycle('install'),
    activate: () => lifecycle('activate'),
    /** @returns {Promise<any>|null} SW가 응답을 맡았으면 그 Promise, 손대지 않았으면 null */
    fetch(url, { method = 'GET', mode = 'no-cors' } = {}) {
      let responded = null;
      listeners.fetch({ request: { url: new URL(url, ORIGIN).href, method, mode }, respondWith: (p) => { responded = p; } });
      return responded;
    }
  };
}

test('앱 셸은 index.html이 부르는 로컬 파일을 그 주소(?v=…) 그대로 미리 담는다', async () => {
  const sw = loadWorker();
  await sw.install();
  const cached = new Set(sw.cached());
  const assets = localAssets();
  assert.ok(assets.some((u) => /\/app\.js\?v=tc-v\d+$/.test(u)), 'index.html에서 버전 붙은 app.js를 찾는다');
  for (const url of assets) assert.ok(cached.has(url), `셸에 없다: ${url}`);
});

test('첫 방문 직후 오프라인 새로고침 — 셸·스크립트·스타일을 캐시에서 돌려준다', async () => {
  const sw = loadWorker();
  await sw.install(); await sw.activate();
  sw.net.online = false;
  const page = await sw.fetch('/', { mode: 'navigate' });
  assert.equal(page.status, 200, '페이지 뼈대');
  for (const url of localAssets()) {
    const res = await sw.fetch(url).catch(() => null);
    assert.ok(res && res.status === 200, `오프라인에서 못 돌려준다: ${url}`);
  }
});

test('GET 외 요청과 /api/는 SW가 손대지 않는다', () => {
  const sw = loadWorker();
  assert.equal(sw.fetch('/api/hotel-offers', { method: 'POST' }), null);
  assert.equal(sw.fetch('/api/v1/me'), null);
  assert.equal(sw.fetch('/nas/api/v1/me'), null);
  assert.equal(sw.fetch('/index.html', { method: 'POST' }), null);
});
