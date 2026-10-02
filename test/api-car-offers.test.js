// 렌터카 시장가 프록시 — Provider 레지스트리·검증·failover. mock adapter는 테스트에서만 주입한다.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, _private } = require('../api/car-offers.js');

function response() {
  return { headers: {}, statusCode: 0, body: '', setHeader(k, v) { this.headers[k] = v; }, end(value) { this.body = value; } };
}
const day = d => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const BODY = { pickup: 'Palma Airport', pickupCode: 'PMI', return: 'Palma Airport', returnCode: 'PMI',
  pickupAt: day(30) + 'T10:00', returnAt: day(34) + 'T10:00', driverAge: 35, currency: 'EUR' };

async function invoke(handler, body) {
  const res = response();
  await handler({ method: 'POST', headers: {}, socket: {}, body: JSON.stringify(body || BODY) }, res);
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

test('car-offers: 연결된 Provider가 없으면 AUTH_REQUIRED를 그대로 알린다 (가짜 가격 금지)', async () => {
  const handler = createHandler({ env: {} });
  // health — 미연결 상태 표시
  const res = response();
  await handler({ method: 'GET', url: '/api/car-offers?health', headers: {}, socket: {} }, res);
  assert.equal(JSON.parse(res.body).providers[0].status, 'UNCONFIGURED', 'P0-2: 키도 adapter도 없음 → UNCONFIGURED');
  // 검색 — 503 AUTH_REQUIRED (mock 대체 없음)
  const r = await invoke(handler);
  assert.equal(r.status, 503);
  assert.equal(r.json.error, 'AUTH_REQUIRED');
});

test('car-offers: 요청 검증은 거부 사유를 구분한다', async () => {
  const V = _private.validRequest;
  assert.equal(V({ ...BODY, pickup: undefined, pickupCode: 'ZZZZ' }).invalid, 'LOCATION_NOT_FOUND');
  assert.equal(V({ ...BODY, pickupAt: '2027/01/01 10:00' }).invalid, 'INVALID_DATES');
  assert.equal(V({ ...BODY, returnAt: BODY.pickupAt }).invalid, 'INVALID_DATE_ORDER');
  assert.equal(V({ ...BODY, pickupAt: '2020-01-01T10:00', returnAt: '2020-01-03T10:00' }).past, true, '지난 픽업은 조회하지 않는다');
  assert.equal(V(BODY).invalid, undefined);
});

test('car-offers: 정규화 — 판매처·총액 없는 오퍼 제거, deep link 위생, 총액 오름차순', () => {
  const out = _private.normalizeOffers([
    { sellerName: 'Sixt', totalPrice: 258, vehicleClass: 'compact', transmission: 'automatic', mileagePolicy: 'UNLIMITED', deepLink: 'https://sixt.example.com/x' },
    { sellerName: 'Europcar', totalPrice: 247, vehicleClass: 'economy', transmission: 'manual', deepLink: 'http://insecure.example.com/x' },
    { sellerName: '', totalPrice: 100 },            // 판매처 없음 → 제거
    { sellerName: 'NoPrice' },                       // 가격 없음 → 제거
    { sellerName: 'Bad', totalPrice: 300, deepLink: 'https://192.168.0.1/x' }   // 내부망 링크 → 링크만 제거
  ], 'EUR');
  assert.equal(out.length, 3);
  assert.equal(out[0].seller, 'Europcar');           // 247 < 258 < 300
  assert.equal(out[0].link, undefined, 'http 링크는 버린다');
  assert.equal(out[1].link, 'https://sixt.example.com/x');
  assert.equal(out[2].link, undefined, '내부망 호스트는 버린다');
  assert.equal(out[1].cur, 'EUR');
});

test('car-offers: failover — 한 Provider 실패가 전체를 막지 않는다', async () => {
  const failing = { id: 'a', status: () => 'CONNECTED', async search() { throw Object.assign(new Error('x'), { code: 'NETWORK_ERROR' }); } };
  const working = { id: 'b', status: () => 'CONNECTED', async search() { return { offers: [{ sellerName: 'Sixt', totalPrice: 258 }] }; } };
  const handler = createHandler({ env: {}, adapters: [failing, working] });
  const r = await invoke(handler);
  assert.equal(r.status, 200);
  assert.equal(r.json.offers.length, 1, '성공한 Provider 결과 사용');
  // 모든 Provider 실패 → 마지막 오류 전파 (오래된 가격을 최신처럼 만들지 않는다)
  const handler2 = createHandler({ env: {}, adapters: [failing] });
  const r2 = await invoke(handler2);
  assert.equal(r2.status, 504);
  assert.equal(r2.json.error, 'NETWORK_ERROR');
});

test('car-offers: health가 자격증명 등록 여부를 구분해 알린다 (키 값은 노출 금지)', async () => {
  const call = async (env) => {
    const res = response();
    await createHandler({ env })({ method: 'GET', url: '/api/car-offers?health', headers: {}, socket: {} }, res);
    return JSON.parse(res.body).providers[0];
  };
  const none = await call({});
  assert.equal(none.status, 'UNCONFIGURED');
  assert.equal(none.credentials, 'MISSING', '키 없음');

  const withKey = await call({ CAR_DISCOVERY_API_KEY: 'tp_secret_value', CAR_DISCOVERY_MARKER: '566775' });
  assert.equal(withKey.status, 'CREDENTIAL_READY', 'P0-2: adapter가 없으면 키가 있어도 CONNECTED 금지 — 자격증명 준비 상태만');
  assert.equal(withKey.credentials, 'PRESENT', '키 등록됨을 확인할 수 있어야 원인 구분이 된다');
  assert.deepEqual(withKey.envKeys, ['CAR_DISCOVERY_API_KEY']);
  assert.equal(withKey.marker, true);
  assert.ok(!JSON.stringify(withKey).includes('tp_secret_value'), '키 값 자체는 절대 응답에 넣지 않는다');
});

// rate limit 키 — NAS(Funnel → Next)에서는 `x-vercel-forwarded-for`를 아무나 써 보낼 수 있다(kakao 프록시와 같은 규칙)
async function invokeFrom(handler, { headers = {}, remoteAddress } = {}) {
  const res = response();
  await handler({ method: 'POST', headers, socket: { remoteAddress }, body: JSON.stringify(BODY) }, res);
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

test('car-offers: Vercel 밖에서는 전달 헤더를 바꿔도 같은 사람으로 센다', async () => {
  _private.buckets.clear();
  const handler = createHandler({ env: {} });
  let last;
  for (let i = 0; i < 11; i++) {
    last = await invokeFrom(handler, { headers: { 'x-vercel-forwarded-for': `v-${Math.random()}`, 'x-forwarded-for': `f-${Math.random()}` }, remoteAddress: '203.0.113.7' });
  }
  assert.equal(last.status, 429);
  assert.equal(last.json.error, 'RATE_LIMIT');
});

test('car-offers: Vercel 위에서는 엣지가 붙인 주소로 사람을 가른다', async () => {
  _private.buckets.clear();
  const handler = createHandler({ env: { VERCEL: '1' } });
  const from = ip => ({ headers: { 'x-vercel-forwarded-for': ip }, remoteAddress: '10.0.0.1' });
  let last;
  for (let i = 0; i < 11; i++) last = await invokeFrom(handler, from('198.51.100.1'));
  assert.equal(last.status, 429);
  assert.notEqual((await invokeFrom(handler, from('198.51.100.2'))).status, 429);
});

test('car-offers: Vercel 엣지 헤더가 보이는데 VERCEL이 없으면 한 번 경고하고, 키는 여전히 소켓 주소다', async (t) => {
  _private.buckets.clear();
  const warned = [];
  t.mock.method(console, 'warn', (...args) => { warned.push(args.join(' ')); });
  const handler = createHandler({ env: {} });
  const edge = ip => ({ headers: { 'x-vercel-id': 'icn1::abc', 'x-vercel-forwarded-for': ip }, remoteAddress: '169.254.100.6' });
  let last;
  for (let i = 0; i < 11; i++) last = await invokeFrom(handler, edge(`198.51.100.${i}`));
  assert.equal(warned.length, 1, '인스턴스마다 한 번');
  assert.match(warned[0], /VERCEL/);
  assert.equal(last.status, 429, '헤더는 여전히 키가 아니다');
  _private.buckets.clear();
});

test('car-offers: 창이 지난 버킷은 지우고 표는 상한을 넘지 않는다', async () => {
  _private.buckets.clear();
  let clock = 0;
  const handler = createHandler({ env: {}, now: () => clock });
  for (let i = 0; i < 20; i++) await invokeFrom(handler, { remoteAddress: `old-${i}` });
  assert.equal(_private.buckets.size, 20);
  clock = 60_000;
  await invokeFrom(handler, { remoteAddress: 'new' });
  assert.equal(_private.buckets.size, 1);
  for (let i = 0; i <= _private.RATE_MAX_KEYS; i++) await invokeFrom(handler, { remoteAddress: `flood-${i}` });
  assert.ok(_private.buckets.size <= _private.RATE_MAX_KEYS);
  _private.buckets.clear();
});
