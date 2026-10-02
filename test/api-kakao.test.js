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

// ── rate limit 키 — 누가 보낸 요청인가 ──
// NAS(Tailscale Funnel → Next)에서는 `x-vercel-forwarded-for`를 아무나 써 보낼 수 있다. 그 값을 키로 믿으면
// 요청마다 값을 바꾸는 것만으로 분당 상한이 사라진다. Vercel 엣지가 덮어쓰는 Vercel 위에서만 믿는다.
const limited = (out) => out.status === 429;

test('Kakao proxy: Vercel 밖에서는 전달 헤더를 바꿔도 같은 사람으로 센다', async () => {
  const handler = createHandler({ env: {} });
  const spoof = () => ({ 'x-vercel-forwarded-for': `198.51.100.${Math.floor(Math.random() * 250)}`, 'x-forwarded-for': `t-${Math.random()}` });
  const outs = [];
  for (let i = 0; i < 31; i++) outs.push(await invoke(handler, { headers: spoof(), socket: { remoteAddress: '203.0.113.7' } }));
  assert.equal(outs.slice(0, 30).some(limited), false);
  assert.equal(limited(outs[30]), true, '31번째는 막힌다 — 헤더로 새 버킷을 만들 수 없다');
});

test('Kakao proxy: Vercel 위에서는 엣지가 붙인 주소로 사람을 가른다', async () => {
  const handler = createHandler({ env: { VERCEL: '1' } });
  const from = ip => ({ headers: { 'x-vercel-forwarded-for': ip }, socket: { remoteAddress: '10.0.0.1' } });
  let last;
  for (let i = 0; i < 31; i++) last = await invoke(handler, from('198.51.100.1'));
  assert.equal(limited(last), true);
  assert.equal(limited(await invoke(handler, from('198.51.100.2'))), false, '다른 사람은 막히지 않는다');
});

test('Kakao proxy: 창이 지난 버킷은 지우고 표는 상한을 넘지 않는다', async () => {
  let clock = 0;
  const handler = createHandler({ env: {}, now: () => clock });
  for (let i = 0; i < 50; i++) await invoke(handler, { socket: { remoteAddress: `old-${i}` } });
  assert.equal(_private.buckets.size, 50);
  clock = 60_000;
  await invoke(handler, { socket: { remoteAddress: 'new' } });
  assert.equal(_private.buckets.size, 1, '1분 지난 50개는 새 요청이 올 때 정리된다');

  for (let i = 0; i <= _private.RATE_MAX_KEYS; i++) await invoke(handler, { socket: { remoteAddress: `flood-${i}` } });
  assert.ok(_private.buckets.size <= _private.RATE_MAX_KEYS, `상한 ${_private.RATE_MAX_KEYS} 이하`);
});

test('Kakao proxy: 서버 안에서 부르는 경로 조회는 밖의 요청과 같은 버킷을 쓰지 않는다', async () => {
  const outside = createHandler({ env: {} });
  const inside = createHandler({ env: {}, rateKey: 'internal:server-routing' });
  // 주소 없는 요청('unknown')과 내부 키를 흉내 낸 주소로 밖의 버킷을 다 채워도
  for (const remoteAddress of [undefined, 'internal:server-routing']) {
    for (let i = 0; i < 31; i++) await invoke(outside, { socket: { remoteAddress } });
  }
  assert.equal(limited(await invoke(outside, { socket: {} })), true);
  assert.equal(limited(await invoke(inside, { socket: {} })), false, '안의 조회는 제 버킷을 쓴다');
});
