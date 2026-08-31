// intake.js — 밖에서 들어오는 정보를 받아들이는 계층.
//
// 여기서 지켜야 하는 것: 확인 없이 저장하지 않는다 / 모호하면 추측하지 않는다 /
// 못 읽어도 버리지 않는다 / 중복을 함부로 단정하지 않는다.
// 실제 개인 예약 데이터는 픽스처로 쓰지 않는다(§68) — 전부 지어낸 값이다.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const I = require('../intake.js');

// ── 1. 무엇이 들어왔는가 ──

test('classifyShare: 도메인으로 먼저 판단하고, 모든 공유를 예약으로 가정하지 않는다', () => {
  assert.equal(I.classifyShare({ url: 'https://www.booking.com/hotel/es/cap-rocat.html' }).kind, 'BOOKING');
  assert.equal(I.classifyShare({ url: 'https://www.koreanair.com/booking/detail' }).kind, 'TRANSPORT');
  assert.equal(I.classifyShare({ url: 'https://maps.apple.com/?ll=39.57,2.65&q=Sa%20Calobra' }).kind, 'PLACE');
  assert.equal(I.classifyShare({ text: '여기 저녁에 다시 오자' }).kind, 'NOTE');
  assert.equal(I.classifyShare({}).kind, 'UNKNOWN');
  assert.ok(I.classifyShare({ url: 'https://www.agoda.com/x' }).reasons.length > 0, '왜 그렇게 봤는지 말할 수 있어야 한다');
});

test('classifyShare: 도메인을 몰라도 본문 단서로 짚는다', () => {
  const booking = I.classifyShare({ text: '예약 번호: ABC12345\n체크인 2026-10-30\n체크아웃 2026-11-01' });
  assert.equal(booking.kind, 'BOOKING');
  const transport = I.classifyShare({ text: 'KE 901 예약번호 PNR7Q2\n인천 → 마드리드' });
  assert.equal(transport.kind, 'TRANSPORT');
  const train = I.classifyShare({ text: 'KTX 서울 → 부산 10:30' });
  assert.equal(train.kind, 'TRANSPORT');
});

// ── 2. 정규화 — 모호하면 추측하지 않는다 ──

test('normalizeDate: 형식을 두루 읽되, 애매한 것은 애매하다고 말한다', () => {
  assert.equal(I.normalizeDate('2026-10-30').iso, '2026-10-30');
  assert.equal(I.normalizeDate('2026.10.30').iso, '2026-10-30');
  assert.equal(I.normalizeDate('30 Oct 2026').iso, '2026-10-30');
  assert.equal(I.normalizeDate('Oct 30, 2026').iso, '2026-10-30');
  assert.equal(I.normalizeDate('10월 30일', { year: 2026 }).iso, '2026-10-30');

  // 25는 월이 될 수 없으니 하나로 정해진다
  const clear = I.normalizeDate('25/10/2026');
  assert.equal(clear.iso, '2026-10-25');
  assert.equal(clear.ambiguous, false);

  // 둘 다 말이 되면 고르되 반드시 '애매했다'고 남긴다
  const both = I.normalizeDate('10/03/2026');
  assert.equal(both.ambiguous, true);
  assert.equal(both.iso, '2026-03-10', '기본은 일/월 순');
  assert.equal(both.alternative, '2026-10-03');
  assert.equal(I.normalizeDate('10/03/2026', { locale: 'en-US' }).iso, '2026-10-03');

  assert.equal(I.normalizeDate('2026-02-30').iso, null, '없는 날짜는 만들어내지 않는다');
  assert.equal(I.normalizeDate('').iso, null);
  assert.equal(I.normalizeDate('내일').iso, null);
});

test('normalizeCurrency: 기호만 보고 나라를 단정하지 않는다', () => {
  assert.deepEqual(I.normalizeCurrency('총액 EUR 1,420'), { code: 'EUR', ambiguous: false });
  assert.deepEqual(I.normalizeCurrency('₩120,000'), { code: 'KRW', ambiguous: false });
  assert.deepEqual(I.normalizeCurrency('€1,420'), { code: 'EUR', ambiguous: false });
  // $는 USD·AUD·CAD·SGD 전부 가능하다
  const dollar = I.normalizeCurrency('$1,420');
  assert.equal(dollar.code, 'USD');
  assert.equal(dollar.ambiguous, true, '어느 나라 달러인지 확실하지 않다');
  assert.deepEqual(I.normalizeCurrency('$1,420', { hint: 'AUD' }), { code: 'AUD', ambiguous: false });
  assert.deepEqual(I.normalizeCurrency('가격 미정'), { code: null, ambiguous: false });
});

test('normalizeAmount: 천 단위·소수점을 함께 읽는다', () => {
  assert.equal(I.normalizeAmount('총액 €1,420'), 1420);
  assert.equal(I.normalizeAmount('1 420 000원'), 1420000);
  assert.equal(I.normalizeAmount('12.50 EUR'), 12.5);
  assert.equal(I.normalizeAmount('무료'), null);
});

// ── 3. 예약 후보 ──

const HOTEL_SHARE = {
  url: 'https://www.booking.com/hotel/es/cap-rocat.html',
  title: 'Cap Rocat | Booking.com',
  text: [
    '예약 번호: ABC12345',
    '체크인 2026-10-30',
    '체크아웃 2026-11-01',
    '주소: Ctra. d\'enfilada, Mallorca',
    '총액 EUR 1,420'
  ].join('\n'),
  receivedAt: '2026-08-31T10:00:00Z'
};

test('parseBookingCandidate: 알려진 제공자면 자동으로 채울 만큼 읽어낸다', () => {
  const c = I.parseBookingCandidate(HOTEL_SHARE);
  assert.equal(c.type, 'HOTEL');
  assert.equal(c.provider, 'Booking.com');
  assert.equal(c.title, 'Cap Rocat', '사이트 이름 꼬리는 떼어낸다');
  assert.equal(c.confirmationNumber, 'ABC12345');
  assert.equal(c.startAt, '2026-10-30');
  assert.equal(c.endAt, '2026-11-01');
  assert.equal(c.currency, 'EUR');
  assert.equal(c.amount, 1420);
  assert.deepEqual(c.missingFields, []);
  assert.ok(c.confidence >= 0.9, 'confidence=' + c.confidence);
  assert.equal(I.candidateDisposition(c), 'AUTO');
});

test('parseBookingCandidate: 못 읽은 것을 숨기지 않는다', () => {
  const c = I.parseBookingCandidate({ url: 'https://www.agoda.com/some-hotel', title: 'Some Hotel' });
  assert.equal(c.type, 'HOTEL');
  assert.ok(c.missingFields.includes('startAt'), '날짜가 없으면 없다고 말한다');
  assert.ok(c.confidence < 0.9);
  assert.equal(I.candidateDisposition(c), 'REVIEW');
  assert.equal(c.sourceUrl, 'https://www.agoda.com/some-hotel', 'URL은 무슨 일이 있어도 보존한다');
});

test('parseBookingCandidate: 애매한 날짜가 있으면 자동으로 넘기지 않는다', () => {
  const c = I.parseBookingCandidate({
    url: 'https://www.booking.com/hotel/x',
    title: 'Hotel X',
    text: '예약번호: ZZ99887\n체크인 10/03/2026\n체크아웃 10/07/2026\n총액 EUR 500'
  });
  assert.ok(c.ambiguities.length > 0);
  assert.notEqual(I.candidateDisposition(c), 'AUTO', '애매한 값이 있으면 확인을 받는다');
});

test('parseBookingCandidate: 종류별로 다르게 읽는다', () => {
  const flight = I.parseBookingCandidate({ url: 'https://www.koreanair.com/x', title: 'KE901', text: 'PNR: QW3RT5\n2026-10-29' });
  assert.equal(flight.type, 'FLIGHT');
  const train = I.parseBookingCandidate({ url: 'https://www.letskorail.com/x', title: 'KTX 서울-부산' });
  assert.equal(train.type, 'TRAIN');
  const car = I.parseBookingCandidate({ url: 'https://www.sixt.com/x', title: 'Sixt Palma' });
  assert.equal(car.type, 'CAR');
  const table = I.parseBookingCandidate({ url: 'https://www.catchtable.co.kr/x', title: '스시 오마카세' });
  assert.equal(table.type, 'RESTAURANT');
  // 도메인을 몰라도 본문으로 짚는다
  const byText = I.parseBookingCandidate({ text: '렌터카 픽업 장소: 팔마 공항\n2026-10-30' });
  assert.equal(byText.type, 'CAR');
});

test('parseBookingCandidate: 제공자 파서가 실패해도 URL·제목은 남는다', () => {
  const c = I.parseBookingCandidate({ url: 'https://unknown-provider.example/booking/1', title: '어떤 예약' });
  assert.equal(c.sourceUrl, 'https://unknown-provider.example/booking/1');
  assert.equal(c.title, '어떤 예약');
  assert.equal(I.candidateDisposition(c), 'MANUAL', '읽은 게 적으면 직접 입력을 권한다');
});

test('candidateToBooking: 모르는 값을 빈칸으로 채워 넣지 않는다', () => {
  const b = I.candidateToBooking(I.parseBookingCandidate(HOTEL_SHARE), 'bk_new1');
  assert.equal(b.id, 'bk_new1');
  assert.equal(b.type, 'hotel');
  assert.equal(b.title, 'Cap Rocat');
  assert.equal(b.start, '2026-10-30');
  assert.equal(b.price, 1420);
  assert.equal(b.cur, 'EUR');
  assert.equal(b.confirmation, 'ABC12345');

  const thin = I.candidateToBooking(I.parseBookingCandidate({ title: '메모' }), 'bk_new2');
  assert.equal('start' in thin, false, '모르는 날짜를 빈 문자열로 넣지 않는다');
  assert.equal('price' in thin, false);
});

// ── 4. 중복 · 여행 매칭 ──

const EXISTING = [
  { id: 'bk1', type: 'hotel', title: 'Cap Rocat', provider: 'Booking.com', start: '2026-10-30', end: '2026-11-01', confirmation: 'ABC12345' },
  { id: 'bk2', type: 'hotel', title: '다른 호텔', provider: 'Agoda', start: '2026-11-05', end: '2026-11-07' }
];

test('findDuplicateBooking: 예약번호가 같으면 중복이다', () => {
  const dup = I.findDuplicateBooking(I.parseBookingCandidate(HOTEL_SHARE), EXISTING);
  assert.ok(dup);
  assert.equal(dup.booking.id, 'bk1');
  assert.ok(dup.reasons.some((r) => /예약번호/.test(r)));
});

test('findDuplicateBooking: 확신이 없으면 중복이라 하지 않는다 (정상적인 두 번째 예약을 막지 않게)', () => {
  const other = I.parseBookingCandidate({
    url: 'https://www.booking.com/hotel/es/other.html', title: 'Another Hotel',
    text: '예약 번호: ZZ00011\n체크인 2026-12-24\n체크아웃 2026-12-26'
  });
  assert.equal(I.findDuplicateBooking(other, EXISTING), null);

  // 이름만 비슷하고 날짜가 멀면 중복으로 보지 않는다
  const sameName = I.parseBookingCandidate({ url: 'https://www.booking.com/x', title: 'Cap Rocat', text: '체크인 2027-05-01' });
  assert.equal(I.findDuplicateBooking(sameName, EXISTING), null);
});

const TRIPS = [
  { id: 't1', name: '스페인 신혼여행', start: '2026-10-29', days: [{ spots: [{ city: 'Mallorca' }] }, { spots: [{ city: 'Mallorca' }] }, { spots: [{ city: 'Madrid' }] }, { spots: [] }, { spots: [] }] },
  { id: 't2', name: '제주', start: '2027-03-01', days: [{ spots: [{ city: '제주' }] }] }
];

test('matchTripForBooking: 어느 여행인지 단정하지 않고 후보와 이유를 준다', () => {
  const matches = I.matchTripForBooking(I.parseBookingCandidate(HOTEL_SHARE), TRIPS);
  assert.ok(matches.length >= 1);
  assert.equal(matches[0].tripId, 't1');
  assert.ok(matches[0].reasons.some((r) => /겹칩니다/.test(r)));
  assert.ok(matches[0].score > 0.5);
  assert.equal(matches.filter((m) => m.tripId === 't2').length, 0, '기간이 전혀 다른 여행은 후보가 아니다');
});

test('matchTripForBooking: 도착 전날 호텔도 그 여행으로 본다', () => {
  const nightBefore = I.parseBookingCandidate({ url: 'https://www.booking.com/x', title: '공항 호텔', text: '체크인 2026-10-28' });
  const matches = I.matchTripForBooking(nightBefore, TRIPS);
  assert.equal(matches[0]?.tripId, 't1');
});

test('matchTripForBooking: 후보가 없으면 빈 배열 — 아무 여행에나 붙이지 않는다', () => {
  const unrelated = I.parseBookingCandidate({ title: '무엇인가', text: '체크인 2030-01-01' });
  assert.deepEqual(I.matchTripForBooking(unrelated, TRIPS), []);
});

// ── 5. 공유 대기열 ──

test('shareIdempotencyKey: 같은 내용을 두 번 공유해도 한 번만 처리된다', () => {
  const a = I.shareIdempotencyKey(HOTEL_SHARE);
  const b = I.shareIdempotencyKey(Object.assign({}, HOTEL_SHARE, { receivedAt: '2026-08-31T11:00:00Z' }));
  assert.equal(a, b, '받은 시각이 달라도 내용이 같으면 같은 공유다');
  assert.notEqual(a, I.shareIdempotencyKey({ url: 'https://other.example' }));
});

test('shareQueueNext: 네트워크가 없어도 원본은 남고 나중에 다시 시도한다', () => {
  assert.equal(I.shareQueueNext('PENDING', 'start'), 'PROCESSING');
  assert.equal(I.shareQueueNext('PROCESSING', 'parsed'), 'PARSED');
  assert.equal(I.shareQueueNext('PROCESSING', 'fail'), 'FAILED');
  assert.equal(I.shareQueueNext('FAILED', 'retry'), 'PROCESSING', '실패해도 버리지 않는다');
  assert.equal(I.shareQueueNext('PARSED', 'save'), 'SAVED');
  assert.equal(I.shareQueueNext('NEEDS_REVIEW', 'save'), 'SAVED');
  assert.equal(I.shareQueueNext('SAVED', 'retry'), 'SAVED', '끝난 것은 되돌아가지 않는다');
  assert.equal(I.shareQueueNext('PENDING', '이상한값'), 'PENDING');
  assert.equal(I.shareQueueNext('없는상태', 'start'), 'PROCESSING');
});

// ── 6. 여행 기록 ──

const ACTIVITIES = [
  { id: 'd0s0', name: 'Sóller', startMinutes: 620, endMinutes: 710, location: { lat: 39.766, lng: 2.715 } },
  { id: 'd0s1', name: 'Port de Sóller', startMinutes: 790, endMinutes: 850, location: { lat: 39.795, lng: 2.692 } },
  { id: 'd0s2', name: 'Deià', startMinutes: 960, endMinutes: 1050, location: { lat: 39.748, lng: 2.648 } }
];

test('associateMemory: 시각으로 일정을 자동 연결한다 — 어디였는지 다시 묻지 않는다', () => {
  const r = I.associateMemory({ atMinutes: 660 }, ACTIVITIES);
  assert.equal(r.activityId, 'd0s0');
  assert.match(r.reason, /시간/);
});

test('associateMemory: 시간대가 겹치면 위치로 고른다', () => {
  const overlapping = [
    { id: 'a', name: 'A', startMinutes: 600, endMinutes: 900, location: { lat: 39.766, lng: 2.715 } },
    { id: 'b', name: 'B', startMinutes: 600, endMinutes: 900, location: { lat: 39.795, lng: 2.692 } }
  ];
  const r = I.associateMemory({ atMinutes: 700, location: { lat: 39.7952, lng: 2.6921 } }, overlapping);
  assert.equal(r.activityId, 'b');
});

test('associateMemory: 확실하지 않으면 억지로 고르지 않고 날짜에만 남긴다', () => {
  const r = I.associateMemory({ atMinutes: 1300 }, ACTIVITIES);
  assert.equal(r.activityId, null);
  assert.match(r.reason, /날짜/);
  assert.equal(I.associateMemory({ atMinutes: 600 }, []).activityId, null);
});

test('associateMemory: 시간이 안 맞아도 바로 근처면 그 일정으로 본다', () => {
  const r = I.associateMemory({ atMinutes: 1300, location: { lat: 39.7481, lng: 2.6481 } }, ACTIVITIES);
  assert.equal(r.activityId, 'd0s2');
  assert.match(r.reason, /근처/);
});

test('memoryTimeline: 일정표와 실제 흔적이 나란히 보인다', () => {
  const events = [
    { id: 'e1', type: 'PHOTO', activityId: 'd0s0', assetRefs: ['a', 'b', 'c'] },
    { id: 'e2', type: 'PHOTO', activityId: 'd0s2', assetRefs: ['d'] },
    { id: 'e3', type: 'NOTE', activityId: 'd0s0', caption: '여기 저녁에 다시 오자' },
    { id: 'e4', type: 'PHOTO', activityId: null, atMinutes: 1200, assetRefs: ['e'] }
  ];
  const timeline = I.memoryTimeline(events, ACTIVITIES);
  assert.equal(timeline.length, 3);
  assert.equal(timeline[0].title, 'Sóller');
  assert.equal(timeline[0].photos, 3);
  assert.equal(timeline[0].notes, 1);
  const loose = timeline.filter((g) => g.activityId === null)[0];
  assert.ok(loose, '일정과 연결되지 않은 기록도 버리지 않는다');
});

test('plannedVsActual: 계획과 실제를 나란히 놓는 데이터만 만든다 (판단은 하지 않는다)', () => {
  const events = [{ type: 'PHOTO', activityId: 'd0s0' }, { type: 'PHOTO', activityId: null }];
  const diff = I.plannedVsActual(ACTIVITIES, events);
  assert.deepEqual(diff.planned, ['Sóller', 'Port de Sóller', 'Deià']);
  assert.deepEqual(diff.visited, ['Sóller']);
  assert.deepEqual(diff.missed, ['Port de Sóller', 'Deià']);
  assert.equal(diff.unplanned, 1);
});

test('providerFor: 어댑터는 힌트일 뿐, 모르면 null', () => {
  assert.equal(I.providerFor('https://www.booking.com/x').id, 'booking.com');
  assert.equal(I.providerFor('https://www.srail.co.kr/x').type, 'TRAIN');
  assert.equal(I.providerFor('https://unknown.example/x'), null);
  assert.equal(I.providerFor(''), null);
});
