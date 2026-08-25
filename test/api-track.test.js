const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, _private } = require('../api/track-hotel-prices.js');

function response() {
  return { headers: {}, statusCode: 0, body: '', setHeader(k, v) { this.headers[k] = v; }, end(value) { this.body = value; } };
}
async function invoke(handler, overrides = {}) {
  const req = { method: 'GET', headers: {}, ...overrides };
  const res = response();
  await handler(req, res);
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

test('track cron: env 미설정이면 조용히 skip — 앱·크론을 깨지 않는다', async () => {
  const out = await invoke(createHandler({ env: {} }));
  assert.equal(out.status, 200);
  assert.deepEqual(out.json, { skipped: true, reason: 'not_configured' });
  // CRON_SECRET만 있고 나머지 키가 없어도 skip (인증은 통과해야)
  const out2 = await invoke(createHandler({ env: { CRON_SECRET: 's' } }), { headers: { authorization: 'Bearer s' } });
  assert.deepEqual(out2.json, { skipped: true, reason: 'not_configured' });
});

test('track cron: CRON_SECRET 인증 없이는 실행 금지 (공개 호출로 API 비용 소진 방지)', async () => {
  const handler = createHandler({ env: { CRON_SECRET: 's', SUPABASE_SERVICE_ROLE_KEY: 'x', HOTEL_METASEARCH_API_KEY: 'y' } });
  assert.equal((await invoke(handler)).status, 401);
  assert.equal((await invoke(handler, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await invoke(handler, { method: 'POST' })).status, 405);
});

test('track cron: dueBookings — 추적 중·기간 있음·숙박 시작 전 호텔만 대상', () => {
  const today = '2026-08-25';
  const rows = [{ user_id: 'u1', client_id: 't1', data: { days: [{ spots: [{ name: 'Cap Rocat', bookingId: 'h1', placeId: 'P1', lat: 1, lng: 2 }] }], bookings: [
    { id: 'h1', type: 'hotel', title: 'Cap Rocat', price: 1, track: true, start: '2026-10-30', end: '2026-11-01' },   // 대상
    { id: 'h2', type: 'hotel', title: 'NoDates', price: 1, track: true },                                            // 기간 없음
    { id: 'h3', type: 'hotel', title: 'Past', price: 1, track: true, start: '2026-08-01', end: '2026-08-03' },       // 지난 숙박
    { id: 'h4', type: 'hotel', title: 'Started', price: 1, track: true, start: '2026-08-24', end: '2026-08-27' },    // 이미 시작
    { id: 'h5', type: 'hotel', title: 'Off', price: 1, track: false, start: '2026-10-01', end: '2026-10-02' },       // 추적 꺼짐
    { id: 'c1', type: 'car', title: 'Car', price: 1, track: true, start: '2026-10-01', end: '2026-10-02' }           // 호텔 아님
  ] } }];
  const jobs = _private.dueBookings(rows, today);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].booking.id, 'h1');
  // identity는 연결된 스팟의 이름·placeId·좌표를 쓴다
  assert.deepEqual(jobs[0].identity, { name: 'Cap Rocat', placeId: 'P1', lat: 1, lng: 2 });
  assert.deepEqual(_private.identityOf({}, { id: 'x', title: '독립 예약' }), { name: '독립 예약' });
});
