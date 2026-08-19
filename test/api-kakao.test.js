const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, _private } = require('../api/kakao-directions.js');

function response() {
  return { headers: {}, statusCode: 0, body: '', setHeader(k, v) { this.headers[k] = v; }, end(value) { this.body = value; } };
}

async function invoke(handler, overrides = {}) {
  const req = {
    method: 'POST', headers: {},
    body: { origin: { lat: 37.5, lng: 127 }, destination: { lat: 37.6, lng: 127.1 } },
    socket: { remoteAddress: `test-${Math.random()}` }, ...overrides
  };
  const res = response();
  await handler(req, res);
  return { status: res.statusCode, json: JSON.parse(res.body), headers: res.headers };
}

test.beforeEach(() => _private.buckets.clear());

test('Kakao proxy는 POST만 허용한다', async () => {
  const out = await invoke(createHandler(), { method: 'GET' });
  assert.equal(out.status, 405);
  assert.equal(out.headers.Allow, 'POST');
});

test('Kakao proxy는 좌표와 본문 크기를 검증한다', async () => {
  const handler = createHandler({ env: { KAKAO_REST_API_KEY: 'test' } });
  assert.equal((await invoke(handler, { body: { origin: { lat: 91, lng: 0 }, destination: { lat: 0, lng: 0 } } })).status, 400);
  assert.equal((await invoke(handler, { headers: { 'content-length': '2048' } })).status, 413);
});

test('Kakao proxy는 upstream 실패 원문을 숨긴다', async () => {
  const handler = createHandler({ env: { KAKAO_REST_API_KEY: 'test' }, fetchImpl: async () => ({ ok: false }) });
  const out = await invoke(handler);
  assert.equal(out.status, 502);
  assert.deepEqual(out.json, { error: 'upstream_failed' });
});

test('Kakao proxy는 timeout을 504로 정규화한다', async () => {
  const handler = createHandler({
    env: { KAKAO_REST_API_KEY: 'test' },
    fetchImpl: async (_url, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
  });
  const original = global.setTimeout;
  global.setTimeout = fn => { queueMicrotask(fn); return 1; };
  try {
    const out = await invoke(handler);
    assert.equal(out.status, 504);
    assert.deepEqual(out.json, { error: 'upstream_timeout' });
  } finally { global.setTimeout = original; }
});

test('Kakao proxy는 필요한 경로 필드만 반환한다', async () => {
  const route = { result_code: 0, summary: { duration: 60, distance: 1000, fare: { taxi: 5000 }, sensitive: 'drop' }, sections: [{ roads: [{ vertexes: [127, 37.5, 127.1, 37.6], name: 'drop' }] }] };
  const handler = createHandler({ env: { KAKAO_REST_API_KEY: 'test' }, fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify({ routes: [route], secret: 'drop' }) }) });
  const out = await invoke(handler);
  assert.equal(out.status, 200);
  assert.equal(out.json.route.summary.duration, 60);
  assert.doesNotMatch(JSON.stringify(out.json), /sensitive|secret|name/);
});
