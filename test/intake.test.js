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

// ── 6. 붙여넣은 일정 글 ──
//
// 여기서 지키는 것: 이름을 사람이 읽을 수 있게 남긴다 / 장소인지 아닌지 **단정하지 않는다** /
// 못 읽은 줄도 버리지 않는다 / 우리 기존 형식이 그대로 읽힌다.

// 실제로 붙여넣었다가 아무 장소도 못 찾았던 글이다(2026-09-07). 지어낸 값이 아니라 이 사고의 원문이다.
const PASTED = [
  '[day1] 7월 21일(수) — 가루이자와 도착·구시가지 산책',
  '',
  '* 오전~오후｜이동',
  '일본 도착 → 도쿄역 또는 우에노역 이동 → 신칸센으로 가루이자와역 → 숙소에 짐 맡기기.',
  '* 오후｜규카루이자와 긴자 거리',
  '늦은 점심을 먹고 상점·베이커리를 구경하며 가볍게 산책.',
  '',
  '첫날 도착이 늦으면 구시가지 산책을 3일 차 오후로 옮기세요.',
  '[day2] 7월 22일(목) — 쿠모바 연못·하루니레 테라스·온천',
  '',
  '* 08:00~09:00｜아침 식사',
  '* 09:00~10:00｜쿠모바 연못 산책',
  '연못 주변을 천천히 걸으며 여름 녹음 감상. [장소 안내](https://en.slow-style.com/spots/kumobaike/)',
  '* 12:00~15:00｜하루니레 테라스',
  '* 17:30 이후｜저녁 식사·숙소 복귀'
].join('\n');

test('붙여넣기: 시간 접두사를 떼어내 사람이 읽을 수 있는 이름을 남긴다', () => {
  const r = I.parseItinerary(PASTED, { year: 2026 });
  const names = r.days[1].items.map(i => i.name);
  assert.deepEqual(names, ['아침 식사', '쿠모바 연못 산책', '하루니레 테라스', '저녁 식사·숙소 복귀']);
  // 이름에 시각·구분자가 남으면 지도가 못 찾는다 — 이게 이 사고의 원인이었다
  assert.ok(!names.some(n => /\d{1,2}:\d{2}|[|｜]/.test(n)));
});

test('붙여넣기: 시각과 머무는 시간을 값으로 만든다', () => {
  const day2 = I.parseItinerary(PASTED, { year: 2026 }).days[1].items;
  assert.equal(day2[1].at, '09:00');
  assert.equal(day2[1].endAt, '10:00');
  assert.equal(day2[1].stayMin, 60);
  assert.equal(day2[2].stayMin, 180);
  // '17:30 이후'는 끝 시각이 없다 — 없는 값을 지어내지 않는다
  assert.equal(day2[3].at, '17:30');
  assert.equal(day2[3].endAt, null);
  assert.equal(day2[3].stayMin, null);
});

test('붙여넣기: 시간대를 가리키는 말은 시각으로 못박지 않는다', () => {
  const day1 = I.parseItinerary(PASTED, { year: 2026 }).days[0].items;
  assert.equal(day1[0].name, '이동');       // '오전~오후｜'는 떼어내되
  assert.equal(day1[0].at, null);           // 내가 정하지 않은 시각을 계획에 넣지 않는다
  assert.equal(day1[1].name, '규카루이자와 긴자 거리');
});

test('붙여넣기: 장소인지 아닌지는 힌트일 뿐이고 버리지 않는다', () => {
  const r = I.parseItinerary(PASTED, { year: 2026 });
  const kinds = r.days[1].items.map(i => i.kind);
  assert.deepEqual(kinds, ['ACTIVITY', 'PLACE', 'PLACE', 'STAY']);
  assert.equal(r.days[0].items[0].kind, 'MOVE');
  // 장소가 아니어 보이는 줄도 목록에 남는다 — 담을지는 사람이 고른다
  assert.equal(r.days[1].items.length, 4);
  assert.ok(r.days[1].items[0].reasons[0].includes('행동'));
});

test('붙여넣기: 낱말이 붙은 장소 이름은 장소로 본다 — 이름은 그대로 남긴다', () => {
  const r = I.parseItinerary('- 쿠모바 연못 산책\n- 가루이자와 프린스 쇼핑 플라자\n- 아침 식사\n- 체크아웃', {});
  assert.deepEqual(r.days[0].items.map(i => i.kind), ['PLACE', 'PLACE', 'ACTIVITY', 'STAY']);
  // '산책'·'쇼핑'을 지운 이름으로 검색하면 지도가 못 찾는다
  assert.equal(r.days[0].items[1].name, '가루이자와 프린스 쇼핑 플라자');
});

test('붙여넣기: 전각 세로줄도 같은 구분자다', () => {
  const wide = I.parseItinerary('- 성산일출봉｜제주｜해돋이', {});
  const ascii = I.parseItinerary('- 성산일출봉|제주|해돋이', {});
  const drop = (it) => Object.assign({}, it, { raw: null });   // raw는 원문이라 다른 게 맞다
  assert.deepEqual(drop(wide.days[0].items[0]), drop(ascii.days[0].items[0]));
  assert.equal(wide.days[0].items[0].city, '제주');
  assert.equal(wide.days[0].items[0].raw, '성산일출봉｜제주｜해돋이', '원문은 손대지 않는다');
});

test('붙여넣기: 다음 줄 설명은 그 장소의 것이지 일자 메모가 아니다', () => {
  const r = I.parseItinerary(PASTED, { year: 2026 });
  assert.ok(r.days[1].items[1].desc.includes('연못 주변을'));
  assert.ok(!r.days[1].note.includes('연못 주변을'));
  // 빈 줄 뒤 문단은 그 날의 메모다
  assert.ok(r.days[0].note.includes('첫날 도착이 늦으면'));
});

test('붙여넣기: 마크다운 링크는 주소로 옮기고 문법은 지운다', () => {
  const r = I.parseItinerary(PASTED, { year: 2026 });
  const spot = r.days[1].items[1];
  assert.equal(spot.url, 'https://en.slow-style.com/spots/kumobaike/');
  assert.ok(!/\[|\]\(/.test(spot.desc));
  assert.ok(spot.desc.includes('장소 안내'), '링크 문구는 남긴다');
});

test('붙여넣기: http(s)가 아닌 링크는 문서에 들이지 않는다', () => {
  const r = I.parseItinerary('- 어떤 곳\n[누르세요](javascript:alert(1))', {});
  assert.equal(r.days[0].items[0].url, null);
});

// ── 6-b. AI가 준 글 그대로 ──
//
// 사람들은 우리 형식으로 다시 쓰지 않는다 — ChatGPT·Claude가 뱉은 그대로 붙여넣는다.
// 2026-09-08에 실제로 붙여넣었더니 **하루가 통째로 비고**(표) 이름에 `**`와 이모지가 남아
// 지도가 한 곳도 못 찾았다. 아래는 그 글의 모양이다.
const AI_MD = [
  '# 가루이자와 3박 4일 여행 일정 ✨',
  '',
  '안녕하세요! 요청하신 일정을 짜 봤어요.',
  '',
  '## 📅 Day 1 (7월 21일, 월) – 도착',
  '',
  '- 🍱 **13:00** 점심: **에키벤야 마츠리** (도쿄역 1층) — 도시락이 많아요',
  '- 🏨 **16:30** 호텔 체크인: **가루이자와 프린스 호텔 웨스트**',
  '- **18:30** 저녁: 카와카미안 (수타 소바 맛집, 약 2,500엔)',
  '',
  '## 📅 Day 2 (7월 22일, 화)',
  '',
  '| 시간 | 장소 | 메모 |',
  '|------|------|------|',
  '| 08:00 | 조식 | 호텔 뷔페 |',
  '| 09:30 | 쿠모바 연못 | 산책 1시간 |',
  '| 14:00 | 가루이자와 프린스 쇼핑 플라자 | 아웃렛 |'
].join('\n');

test('AI 글: 마크다운 꾸밈과 이모지를 걷어야 그 뒤의 시각·이름이 읽힌다', () => {
  const day1 = I.parseItinerary(AI_MD, { year: 2026 }).days[0].items;
  assert.deepEqual(day1.map(i => i.name),
    ['에키벤야 마츠리 (도쿄역 1층)', '가루이자와 프린스 호텔 웨스트', '카와카미안']);
  assert.deepEqual(day1.map(i => i.at), ['13:00', '16:30', '18:30']);
  // `**`·이모지가 이름에 남으면 지도가 못 찾는다 — 이게 이 사고의 원인이었다
  assert.ok(!day1.some(i => /[*`]|\p{Extended_Pictographic}/u.test(i.name)));
});

test('AI 글: 앞에 붙은 라벨은 이름이 아니라 설명이다', () => {
  const day1 = I.parseItinerary(AI_MD, { year: 2026 }).days[0].items;
  assert.equal(day1[0].name, '에키벤야 마츠리 (도쿄역 1층)');
  assert.ok(day1[0].desc.includes('점심'), '떼어낸 라벨은 버리지 않고 설명으로 남긴다');
  assert.equal(day1[1].stay, true, "'체크인'이 라벨이면 그건 숙소다");
  // 금액은 값으로 빠지고, 남은 괄호가 이름을 더럽히지 않는다
  assert.equal(day1[2].cost, 2500);
  assert.equal(day1[2].name, '카와카미안');
});

test('AI 글: 마크다운 표도 하루의 일정이다 — 통째로 잃지 않는다', () => {
  const day2 = I.parseItinerary(AI_MD, { year: 2026 }).days[1].items;
  assert.deepEqual(day2.map(i => i.name), ['조식', '쿠모바 연못', '가루이자와 프린스 쇼핑 플라자']);
  assert.deepEqual(day2.map(i => i.at), ['08:00', '09:30', '14:00']);
  assert.equal(day2[1].desc, '산책 1시간', '메모 칸은 설명으로 간다');
});

test('AI 글: 구분선이 없으면 표가 아니다 — 세로줄이 든 문장을 표로 오해하지 않는다', () => {
  const r = I.parseItinerary('- 성산일출봉|제주|해돋이', {});
  assert.equal(r.days[0].items.length, 1);
  assert.equal(r.days[0].items[0].city, '제주');
});

test('AI 글: 맨 앞 제목과 인사말이 빈 1일차를 만들지 않는다', () => {
  const r = I.parseItinerary(AI_MD, { year: 2026 });
  assert.equal(r.days.length, 2, '일정이 하루씩 밀리면 안 된다');
  assert.equal(r.name, '가루이자와 3박 4일 여행 일정');
  assert.ok(r.days[0].note.includes('안녕하세요'), '인사말도 버리지 않는다 — 그 날 메모로 남는다');
  assert.equal(r.days[0].date, '2026-07-21');
});

test('AI 글: 사람이 쓰는 시각도 읽는다 — 오전/오후가 없으면 그렇게 말한다', () => {
  const r = I.parseItinerary([
    '- 오전 10시 간사이국제공항',
    '- 오후 3시 30분 · 신사이바시스지',
    '- 저녁 7시 이치란 라멘 본점',
    '- 7시 스타벅스'
  ].join('\n'), {});
  const it = r.days[0].items;
  assert.deepEqual(it.map(i => i.at), ['10:00', '15:30', '19:00', '07:00']);
  assert.deepEqual(it.map(i => i.name),
    ['간사이국제공항', '신사이바시스지', '이치란 라멘 본점', '스타벅스']);
  // 오전인지 오후인지 안 적힌 '7시'는 지어내지 않고 그대로 읽되, 그 사실을 말한다
  assert.ok(it[3].reasons.some(r2 => r2.includes('오전인지 오후인지')));
  assert.ok(!it[2].reasons.some(r2 => r2.includes('오전인지 오후인지')), "'저녁 7시'는 모호하지 않다");
});

test('AI 글: 괄호는 안이 설명일 때만 뗀다 — 다른 이름은 남긴다', () => {
  const r = I.parseItinerary('- 이시노쿄카이 (돌의 교회)\n- 시라이토 폭포 (도보 20분, 입장료 무료)', {});
  assert.equal(r.days[0].items[0].name, '이시노쿄카이 (돌의 교회)');
  assert.equal(r.days[0].items[1].name, '시라이토 폭포');
  assert.equal(r.days[0].items[1].desc, '도보 20분, 입장료 무료');
});

test('AI 글: (선택)·(숙소) 표시는 시각 뒤에 와도 읽는다', () => {
  const r = I.parseItinerary('- 15:00 (선택) 만페이 호텔\n- 20:00 (숙소) 프린스 호텔', {});
  assert.equal(r.days[0].items[0].opt, true);
  assert.equal(r.days[0].items[0].name, '만페이 호텔');
  assert.equal(r.days[0].items[1].stay, true);
});

test('붙여넣기: 날짜를 읽되 연도가 없으면 모호하다고 말한다', () => {
  const r = I.parseItinerary(PASTED, { year: 2026 });
  assert.equal(r.start, '2026-07-21');
  assert.equal(r.days[1].date, '2026-07-22');
  assert.equal(r.startAmbiguous, true, '연도를 우리가 정했다는 사실을 감추지 않는다');

  const withYear = I.parseItinerary('[day1] 2026-07-21 도착\n- 어떤 곳', {});
  assert.equal(withYear.start, '2026-07-21');
  assert.equal(withYear.startAmbiguous, false);
});

test('붙여넣기: 7/21 같은 표기도 읽는다', () => {
  const r = I.parseItinerary('[day1] 7/21 (화) 도착\n- 어떤 곳', { year: 2026 });
  assert.equal(r.days[0].date, '2026-07-21');
});

test('붙여넣기: 우리 기존 형식이 그대로 읽힌다 (기존 사용자를 다치게 하지 않는다)', () => {
  const r = I.parseItinerary([
    '여행 이름: 제주 한 바퀴',
    '시작일: 2026-10-01',
    '[day1] 도착',
    '이동: 렌터카',
    '- (숙소) 제주호텔 | 제주 | 바다뷰 | 33.5,126.5 @15:00',
    '- (선택) 성산일출봉 | 제주 | 해돋이',
    '메모: 공항에서 바로'
  ].join('\n'), {});
  assert.equal(r.name, '제주 한 바퀴');
  assert.equal(r.start, '2026-10-01');
  assert.equal(r.days[0].drive, '렌터카');
  assert.equal(r.days[0].note, '공항에서 바로');
  const [hotel, sunrise] = r.days[0].items;
  assert.equal(hotel.name, '제주호텔');
  assert.equal(hotel.city, '제주');
  assert.equal(hotel.desc, '바다뷰');
  assert.equal(hotel.stay, true);
  assert.equal(hotel.at, '15:00');
  assert.equal(hotel.lat, 33.5);
  assert.equal(hotel.lng, 126.5);
  assert.equal(sunrise.opt, true);
  assert.equal(sunrise.city, '제주');
});

test('붙여넣기: 여러 불릿 모양과 일자 머리글을 읽는다', () => {
  const r = I.parseItinerary([
    '## 1일차 도착',
    '1. 첫 곳',
    '• 둘째 곳',
    '· 셋째 곳',
    '### Day 2 — 이튿날',
    '- 넷째 곳'
  ].join('\n'), {});
  assert.equal(r.days.length, 2);
  assert.deepEqual(r.days[0].items.map(i => i.name), ['첫 곳', '둘째 곳', '셋째 곳']);
  assert.equal(r.days[1].title, '이튿날');
});

test('붙여넣기: 아무것도 못 읽어도 죽지 않고, 원문을 버리지 않는다', () => {
  assert.deepEqual(I.parseItinerary('', {}).days, []);
  const plain = I.parseItinerary('그냥 메모 한 줄', {});
  assert.equal(plain.days.length, 1);
  assert.equal(plain.days[0].note, '그냥 메모 한 줄');
  assert.equal(plain.start, null);
  const r = I.parseItinerary('- 어떤 곳 @25:99', {});
  assert.equal(r.days[0].items[0].at, null, '말이 안 되는 시각은 없는 값이다');
  assert.equal(r.days[0].items[0].raw, '어떤 곳 @25:99', '읽은 원문은 남긴다');
});
