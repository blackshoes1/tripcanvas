const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, runSearch, _private } = require('../api/hotel-offers.js');

function response() {
  return { headers: {}, statusCode: 0, body: '', setHeader(k, v) { this.headers[k] = v; }, end(value) { this.body = value; } };
}

const BODY = { name: 'Cap Rocat', lat: 39.4699, lng: 2.7166, checkIn: '2026-10-30', checkOut: '2026-11-01', adults: 2, rooms: 1, currency: 'KRW' };

async function invoke(handler, overrides = {}) {
  const req = { method: 'POST', headers: {}, url: '/api/hotel-offers', body: { ...BODY }, socket: { remoteAddress: `t-${Math.random()}` }, ...overrides };
  const res = response();
  await handler(req, res);
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

// serpapi 형태의 목 응답 — 실제 필드명 기준 (list → property detail 2단계)
const LIST = { properties: [
  { name: 'Cap Rocat', property_token: 'tok_cap', gps_coordinates: { latitude: 39.4699, longitude: 2.7166 } },
  { name: 'Playa Esperanza', property_token: 'tok_other', gps_coordinates: { latitude: 39.8, longitude: 3.1 } }
] };
const DETAIL = {
  name: 'Cap Rocat',
  featured_prices: [
    { source: 'Expedia', link: 'https://www.expedia.com/x', rooms: [
      { name: 'Deluxe Double', link: 'https://www.expedia.com/x/room', rate_per_night: { extracted_lowest: 590000 }, total_rate: { extracted_lowest: 1180000 } }
    ] }
  ],
  prices: [
    { source: 'Booking.com', link: 'https://www.booking.com/y', free_cancellation: true, rate_per_night: { extracted_lowest: 620000 }, total_rate: { extracted_lowest: 1240000 } },
    { source: 'Agoda', link: 'http://insecure.example.com', rate_per_night: { extracted_lowest: 580000 }, total_rate: { extracted_lowest: 1160000 } },
    { source: 'ZeroPrice', rate_per_night: { extracted_lowest: 0 } }
  ]
};
const fetchOK = async url => ({ ok: true, text: async () => JSON.stringify(String(url).includes('property_token') ? DETAIL : LIST) });

test.beforeEach(() => _private.buckets.clear());

test('hotel-offers: 검증 — 메서드·요청 필드·키 없음(AUTH_REQUIRED)', async () => {
  const withKey = createHandler({ env: { HOTEL_METASEARCH_API_KEY: 'k' }, fetchImpl: fetchOK });
  assert.equal((await invoke(withKey, { method: 'PUT' })).status, 405);
  assert.equal((await invoke(withKey, { body: { ...BODY, checkIn: '10/30' } })).status, 400);
  assert.equal((await invoke(withKey, { body: { ...BODY, checkIn: '2026-11-02' } })).status, 400);   // checkIn >= checkOut
  assert.equal((await invoke(withKey, { body: { ...BODY, name: undefined } })).status, 400);
  // 키 없음 → 앱을 깨지 않고 미연결 상태 그대로 반환
  const noKey = await invoke(createHandler({ env: {}, fetchImpl: fetchOK }));
  assert.equal(noKey.status, 503);
  assert.equal(noKey.json.error, 'AUTH_REQUIRED');
});

test('hotel-offers: 정규화 — 판매처별 오퍼, https 링크만, 0원 제거, 키 미노출', async () => {
  const handler = createHandler({ env: { HOTEL_METASEARCH_API_KEY: 'sekrit-key' }, fetchImpl: fetchOK });
  const out = await invoke(handler);
  assert.equal(out.status, 200);
  assert.equal(out.json.status, 'OK');
  assert.equal(out.json.property.token, 'tok_cap');
  assert.ok(out.json.property.confidence > 0.9, '이름+좌표 일치 → 높은 신뢰도');
  const sellers = out.json.offers.map(o => o.seller);
  assert.ok(sellers.includes('Expedia') && sellers.includes('Booking.com') && sellers.includes('Agoda'));
  assert.ok(!sellers.includes('ZeroPrice'), '가격 없는 항목 제거');
  const exp = out.json.offers.find(o => o.seller === 'Expedia');
  assert.equal(exp.total, 1180000);
  assert.equal(exp.roomName, 'Deluxe Double');
  const booking = out.json.offers.find(o => o.seller === 'Booking.com');
  assert.equal(booking.refundable, true, 'free_cancellation 플래그 → refundable');
  const agoda = out.json.offers.find(o => o.seller === 'Agoda');
  assert.equal(agoda.link, undefined, 'http(비보안) 딥링크 제거');
  assert.doesNotMatch(JSON.stringify(out.json), /sekrit/, 'API 키가 응답에 새지 않는다');
});

test('hotel-offers: 낮은 identity 신뢰도 → 자동 확정하지 않고 후보 반환 (§22)', async () => {
  const listOnly = { properties: [{ name: '전혀 다른 호텔', property_token: 'tok_x', gps_coordinates: { latitude: 41.0, longitude: 2.0 } }] };
  const handler = createHandler({
    env: { HOTEL_METASEARCH_API_KEY: 'k' },
    fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify(listOnly) })
  });
  const out = await invoke(handler);
  assert.equal(out.status, 200);
  assert.equal(out.json.status, 'UNMATCHED');
  assert.equal(out.json.candidates[0].token, 'tok_x');
});

test('hotel-offers: ptoken이 있으면 검색 1단계를 건너뛴다 (매핑 캐시·비용 절감)', async () => {
  let calls = 0;
  const handler = createHandler({ env: { HOTEL_METASEARCH_API_KEY: 'k' }, fetchImpl: async url => { calls += 1; assert.match(String(url), /property_token=tok_cap/); return { ok: true, text: async () => JSON.stringify(DETAIL) }; } });
  const out = await invoke(handler, { body: { ...BODY, ptoken: 'tok_cap' } });
  assert.equal(out.status, 200);
  assert.equal(calls, 1, '상세 조회 1회만');
});

test('hotel-offers: 특정 호텔명 정확 매칭 → 목록 대신 상세 직접 반환도 처리 (호출 1회)', async () => {
  // 구글 호텔은 단일 호텔로 정확히 매칭되면 properties 배열 없이 property 상세를 바로 반환한다
  const DIRECT = { name: 'Cap Rocat', property_token: 'tok_direct',
    gps_coordinates: { latitude: 39.4699, longitude: 2.7166 }, ...{ featured_prices: DETAIL.featured_prices, prices: DETAIL.prices } };
  let calls = 0;
  const handler = createHandler({ env: { HOTEL_METASEARCH_API_KEY: 'k' },
    fetchImpl: async () => { calls += 1; return { ok: true, text: async () => JSON.stringify(DIRECT) }; } });
  const out = await invoke(handler);
  assert.equal(out.status, 200);
  assert.equal(out.json.status, 'OK');
  assert.equal(out.json.property.token, 'tok_direct');
  assert.equal(calls, 1, '상세 재조회 없이 1회로 완료');
  assert.ok(out.json.offers.length >= 3);
  // 이름·좌표가 전혀 다른 상세가 오면 자동 확정하지 않고 후보로만
  const WRONG = { ...DIRECT, name: '전혀 다른 호텔', gps_coordinates: { latitude: 48.85, longitude: 2.35 } };
  const out2 = await invoke(createHandler({ env: { HOTEL_METASEARCH_API_KEY: 'k' },
    fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify(WRONG) }) }));
  assert.equal(out2.json.status, 'UNMATCHED');
  assert.equal(out2.json.candidates[0].token, 'tok_direct');
});

test('hotel-offers: 본문 error 문자열 분류 — 쿼터 소진→RATE_LIMIT, 무결과→PROPERTY_NOT_FOUND', async () => {
  const env = { HOTEL_METASEARCH_API_KEY: 'k' };
  const quota = await invoke(createHandler({ env, fetchImpl: async () => ({ ok: true, text: async () => '{"error":"Your account has run out of searches."}' }) }));
  assert.equal(quota.status, 429);
  assert.equal(quota.json.error, 'RATE_LIMIT');
  const none = await invoke(createHandler({ env, fetchImpl: async () => ({ ok: true, text: async () => `{"error":"Google Hotels hasn't returned any results for this query."}` }) }));
  assert.equal(none.json.error, 'PROPERTY_NOT_FOUND');
});

test('hotel-offers: upstream 오류 분류 — 401→AUTH_ERROR, 429→RATE_LIMIT, 무결과→PROPERTY_NOT_FOUND', async () => {
  const env = { HOTEL_METASEARCH_API_KEY: 'k' };
  const auth = await invoke(createHandler({ env, fetchImpl: async () => ({ ok: false, status: 401 }) }));
  assert.equal(auth.json.error, 'AUTH_ERROR');
  const rate = await invoke(createHandler({ env, fetchImpl: async () => ({ ok: false, status: 429 }) }));
  assert.equal(rate.status, 429);
  assert.equal(rate.json.error, 'RATE_LIMIT');
  const none = await invoke(createHandler({ env, fetchImpl: async () => ({ ok: true, text: async () => '{"properties":[]}' }) }));
  assert.equal(none.status, 404);
  assert.equal(none.json.error, 'PROPERTY_NOT_FOUND');
  const badJson = await invoke(createHandler({ env, fetchImpl: async () => ({ ok: true, text: async () => 'not-json' }) }));
  assert.equal(badJson.json.error, 'INVALID_RESPONSE');
});

test('hotel-offers: health — Provider 상태를 키 노출 없이 보고 (§34)', async () => {
  const handler = createHandler({ env: { HOTEL_METASEARCH_API_KEY: 'k', EXPEDIA_API_KEY: 'e' } });
  const req = { method: 'GET', url: '/api/hotel-offers?health=1', headers: {}, socket: {} };
  const res = response();
  await handler(req, res);
  const json = JSON.parse(res.body);
  const by = Object.fromEntries(json.providers.map(p => [p.id, p.status]));
  assert.equal(by['google-hotels (serpapi)'], 'CONNECTED');
  assert.equal(by['expedia'], 'CONNECTED');
  assert.equal(by['booking.com'], 'AUTH_REQUIRED');
  assert.equal(by['agoda'], 'AUTH_REQUIRED');
});

test('hotel-offers: Verification Provider가 연결되면 오퍼에 verified 표시 — 실패해도 미검증으로 유지 (§36)', async () => {
  const verifiers = [
    { id: 'expedia', role: 'verification', match: s => /expedia/i.test(s), status: () => 'CONNECTED',
      verify: async offer => ({ refundable: true, verifiedPrice: offer.price }) },
    { id: 'booking.com', role: 'verification', match: s => /booking/i.test(s), status: () => 'CONNECTED',
      verify: async () => { throw new Error('down'); } }
  ];
  const result = await runSearch({ env: { HOTEL_METASEARCH_API_KEY: 'k' }, fetchImpl: fetchOK, verifiers }, {
    name: 'Cap Rocat', lat: 39.4699, lng: 2.7166, checkIn: '2026-10-30', checkOut: '2026-11-01', adults: 2, rooms: 1, currency: 'KRW', gl: 'kr', hl: 'ko'
  });
  const exp = result.offers.find(o => o.seller === 'Expedia');
  assert.equal(exp.verified, true);
  assert.equal(exp.verifiedBy, 'expedia');
  const bk = result.offers.find(o => o.seller === 'Booking.com');
  assert.equal(bk.verified, false, '검증 실패는 미검증으로 유지 — 전체 흐름은 계속');
});

test('hotel-offers: safeLink — https·공인 호스트만 통과 (SSRF·스킴 주입 차단)', () => {
  const { safeLink } = _private;
  assert.equal(safeLink('https://www.expedia.com/a?b=1'), 'https://www.expedia.com/a?b=1');
  assert.equal(safeLink('http://www.expedia.com/a'), undefined);
  assert.equal(safeLink('javascript:alert(1)'), undefined);
  assert.equal(safeLink('https://127.0.0.1/x'), undefined);
  assert.equal(safeLink('https://192.168.0.10/x'), undefined);
  assert.equal(safeLink('https://internal/x'), undefined);
});

test('validRequest — 지난 체크인은 upstream을 호출하지 않고 거부한다', () => {
  const V = _private.validRequest;
  const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  const base = { name: 'Cap Rocat', adults: 2, currency: 'KRW' };
  // 지난 날짜: 시세 소스가 조회할 수 없어 PROVIDER_ERROR로 뭉뚱그려지던 케이스
  assert.equal(V({ ...base, checkIn: day(-10), checkOut: day(-8) }).past, true);
  assert.equal(V({ ...base, checkIn: day(-5), checkOut: day(3) }).past, true, '투숙 중(체크인만 과거)도 거부');
  // 오늘·미래는 정상 통과 (시간대 차를 감안해 하루 여유)
  assert.equal(V({ ...base, checkIn: day(1), checkOut: day(3) }).past, undefined);
  assert.equal(V({ ...base, checkIn: day(30), checkOut: day(32) }).past, undefined);
});
