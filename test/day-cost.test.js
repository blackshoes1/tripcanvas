const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib.js');
const rates = { KRW: 1, USD: 1380, EUR: 1500, JPY: 9.1, CNY: 192 };
const summary = (trip, di = 0, extra = {}) => L.dayCostSummary(trip, di, {
  date: `2026-10-0${di + 1}`, rates, taxi: null, transportUnpriced: false, ...extra
});

test('하루 비용은 무료·미정·부분 확인과 예산 미설정·0을 구분한다', () => {
  const trip = { days: [{ spots: [{ name: '무료', cost: 0 }, { name: '미정' }, { name: '식사', cost: 10000, costPartial: true }] }] };
  let result = summary(trip);
  assert.equal(result.total, 10000);
  assert.deepEqual(result.details.items.map(i => i.state), ['FREE', 'UNKNOWN', 'PARTIAL']);
  assert.equal(result.details.unknownCount, 2);
  assert.equal(result.details.budget, null);
  trip.days[0].budget = { amount: 0 };
  result = summary(trip);
  assert.equal(result.details.budget.amount, 0);
  assert.equal(result.details.budget.differenceKRW, -10000);
});

test('명시적 1인 금액만 곱하고 전체/기존 금액의 인원수를 추정하지 않는다', () => {
  const trip = { days: [{ spots: [
    { cost: 10.25, cur: 'USD', costBasis: 'PER_PERSON', costPeople: 3 },
    { cost: 20, cur: 'USD', costBasis: 'TOTAL', costPeople: 3 },
    { cost: 5, cur: 'USD', costPeople: 3 }
  ], budget: { amount: 25.5, cur: 'USD', costBasis: 'PER_PERSON', costPeople: 3 } }] };
  const result = summary(trip);
  assert.equal(result.total, (30.75 + 20 + 5) * 1380);
  assert.equal(result.details.budget.totalKRW, 76.5 * 1380);
  assert.equal(result.details.items[0].amount, 10.25);
  assert.equal(result.details.fxSource, 'PROVIDED');
  assert.equal(result.details.fxAsOf, null);
});

test('외화 소수와 0 예산·알 수 없는 필드를 웹 정규화 왕복에서 보존한다', () => {
  const raw = { name: '비용', days: [{ spots: [{ name: '입장권', cost: 12.55, cur: 'EUR', who: [], custom: 'keep' }],
    budget: { amount: 0, cur: 'KRW', extra: true }, costItems: [{ id: 'bus', title: '버스', kind: 'TRANSPORT', amount: 2.25, cur: 'USD' }] }] };
  const once = L.normalizeTrip(raw), twice = L.normalizeTrip(JSON.parse(JSON.stringify(once)));
  assert.equal(twice.days[0].spots[0].cost, 12.55);
  assert.equal(twice.days[0].spots[0].custom, 'keep');
  assert.equal(twice.days[0].budget.amount, 0);
  assert.equal(twice.days[0].budget.extra, true);
  assert.equal(twice.days[0].costItems[0].amount, 2.25);
  assert.equal(L.validateTripPayload({ days: [{ spots: [], budget: { amount: -1 } }] }).ok, false);
  assert.equal(L.validateTripPayload({ days: [{ spots: [{ cost: 1, costPeople: 0 }] }] }).ok, false);
});

test('숙박 연결 중복을 막고 예약을 센트 단위로 정확히 배분한다', () => {
  const booking = { id: 'hotel', type: 'hotel', title: '숙박', start: '2026-10-01', end: '2026-10-04', price: 100.01, cur: 'USD' };
  const trip = { days: [{ spots: [{ name: '호텔', bookingId: 'hotel' }] }, { spots: [] }, { spots: [] }], bookings: [booking] };
  const shares = [0, 1, 2].map(i => summary(trip, i).details.items.find(item => item.source === 'BOOKING').amount);
  assert.deepEqual(shares, [33.34, 33.34, 33.33]);
  assert.equal(summary(trip).details.unknownCount, 0);
  trip.days[0].spots[0].cost = 100;
  trip.days[0].spots[0].cur = 'USD';
  assert.equal(summary(trip).total, 138000);
  assert.equal(summary(trip, 1).total, 0);
});

test('수동 교통비는 자동 추정과 중복하지 않으며 미정 교통도 무료로 보이지 않는다', () => {
  const trip = { days: [{ spots: [], costItems: [{ id: 'taxi', title: '하루 교통', kind: 'TRANSPORT' }] }] };
  let result = summary(trip, 0, { taxi: 15000, transportUnpriced: true });
  assert.equal(result.total, 0);
  assert.equal(result.details.unknownCount, 1);
  trip.days[0].costItems[0].amount = 12000;
  result = summary(trip, 0, { taxi: 15000 });
  assert.equal(result.total, 12000);
  assert.equal(L.dayEnteredCost(trip.days[0], rates), 12000);
});

test('장소 이동·삭제·인원·통화 변경 후 일별/여행 비용이 다시 계산된다', () => {
  const trip = { days: [{ spots: [{ name: '입장', cost: 10.5, cur: 'USD', costBasis: 'PER_PERSON', costPeople: 2 }] }, { spots: [] }] };
  assert.equal(summary(trip).total, 28980);
  trip.days[1].spots.push(trip.days[0].spots.pop());
  assert.equal(summary(trip).total, 0);
  assert.equal(summary(trip, 1).total, 28980);
  trip.days[1].spots[0].costPeople = 3;
  trip.days[1].spots[0].cur = 'EUR';
  assert.equal(summary(trip, 1).total, 47250);
  assert.equal(trip.days.reduce((sum, day) => sum + L.dayEnteredCost(day, rates), 0), 47250);
  trip.days[1].spots = [];
  assert.equal(summary(trip, 1).total, 0);
});

test('비용 입력에서 소수점·0·잘못된 문자가 다른 뜻으로 바뀌지 않는다', () => {
  assert.equal(L.parseCostAmount('12.55', 'EUR'), 12.55);
  assert.equal(L.parseCostAmount('12.55', 'KRW'), null);
  assert.equal(L.parseCostAmount('12.555', 'USD'), null);
  assert.equal(L.parseCostAmount('12,000원', 'KRW'), 12000);
  assert.equal(L.parseCostAmount('0', 'KRW'), 0);
  assert.equal(L.parseCostAmount(''), null);
  assert.equal(L.parseCostAmount('-10'), null);
  assert.equal(L.parseCostAmount('10abc'), null);
});

test('여행 비용은 날짜별·분류별 합계와 미배분 예약을 함께 보존한다', () => {
  const trip = { days: [
    { spots: [{ name: '식사', cat: 'food', cost: 10000 }, { name: '쇼핑', cat: 'shop', cost: 0 }],
      costItems: [{ id: 'bus', kind: 'TRANSIT', amount: 2000 }] },
    { spots: [{ name: '관람', cat: 'sight', cost: 12000 }], costItems: [{ id: 'rent', kind: 'RENT', amount: 30000 }] }
  ], bookings: [
    { id: 'stay', type: 'hotel', price: 90000, start: '2026-10-01', end: '2026-10-04', cur: 'KRW' },
    { id: 'flight', type: 'flight', price: 200000, cur: 'KRW' }
  ] };
  const days = trip.days.map((_, index) => ({ index, cost: summary(trip, index) }));
  const result = L.tripCostSummary(trip, days, rates);
  assert.equal(result.totalKRW, 344000);
  assert.equal(result.averagePerDayKRW, 172000);
  assert.equal(result.categories.find(c => c.kind === 'STAY').totalKRW, 90000);
  assert.equal(result.categories.find(c => c.kind === 'TRANSIT').totalKRW, 2000);
  assert.equal(result.categories.find(c => c.kind === 'SHOPPING').items[0].state, 'FREE');
  assert.equal(result.unallocated.reduce((s, i) => s + i.totalKRW, 0), 230000);
  assert.equal(result.totalKRW, days.reduce((s, d) => s + d.cost.total, 0) + 230000);
});

test('새 비용 분류·장소 수동 분류는 정규화와 외화·인원 변경에도 보존한다', () => {
  const trip = L.normalizeTrip({ days: [{ spots: [{ name: '식당', cat: 'food', costKind: 'SHOPPING', cost: 1.25, cur: 'USD', costBasis: 'PER_PERSON', costPeople: 2 }],
    costItems: ['FLIGHT', 'RENT', 'TRANSIT', 'SHOPPING'].map((kind, i) => ({ id: 'cost-' + i, title: kind, kind, amount: 0 })) }] });
  assert.deepEqual(trip.days[0].costItems.map(x => x.kind), ['FLIGHT', 'RENT', 'TRANSIT', 'SHOPPING']);
  const result = L.tripCostSummary(trip, [{ index: 0, cost: summary(trip) }], rates);
  assert.equal(result.categories.find(c => c.kind === 'SHOPPING').totalKRW, 3450);
  assert.equal(result.categories.find(c => c.kind === 'FOOD').totalKRW, 0);
  assert.equal(result.hasForeignCurrency, true);
});

test('연결된 숙박 금액은 중복하지 않고 빈 여행 평균·미정 비용은 0과 구분한다', () => {
  const trip = { days: [{ spots: [{ name: '숙소', stay: true, bookingId: 'stay', cost: 90000 }, { name: '미정' }] }],
    bookings: [{ id: 'stay', type: 'hotel', price: 90000, start: '2026-10-01', end: '2026-10-02' }, { id: 'unknown', type: 'flight' }] };
  const result = L.tripCostSummary(trip, [{ index: 0, cost: summary(trip) }], rates);
  assert.equal(result.totalKRW, 90000);
  assert.equal(result.unknownCount, 2);
  assert.equal(result.unallocated.length, 1);
  assert.equal(result.unallocated[0].totalKRW, null);
  assert.equal(L.tripCostSummary({ days: [] }, [], rates).averagePerDayKRW, null);
});

// ── 예약·결제 구분(결제 상태) ──
// 분류(무엇에 쓴 돈)와 결제 상태(냈는가)는 다른 축이다. 상태별 합계를 더하면 전체와 맞아야 한다.

test('결제 상태는 예약·결제·미구분으로 갈리고 상태별 합계가 전체와 맞는다', () => {
  const trip = {
    bookings: [{ id: 'h1', type: 'hotel', title: '호텔', price: 200000, cur: 'KRW', start: '2026-10-01', end: '2026-10-03' }],
    days: [{ spots: [{ name: '입장료', cost: 12000, payState: 'PAID' }, { name: '미정 식사' }],
      costItems: [{ id: 'c1', title: '기차표', kind: 'TRANSIT', amount: 30000, payState: 'RESERVED' },
        { id: 'c2', title: '간식', kind: 'FOOD', amount: 4000 }] }, { spots: [] }, { spots: [] }]
  };
  const cost = summary(trip);
  assert.equal(cost.payTotals.PAID, 12000, '장소에 적은 결제 완료');
  assert.equal(cost.payTotals.RESERVED, 130000, '기차표 + 숙박 하루치 10만원');
  assert.equal(cost.payTotals.NONE, 4000, '고르지 않은 것은 미구분으로 남는다');
  assert.equal(cost.payTotals.PAID + cost.payTotals.RESERVED + cost.payTotals.NONE, cost.total,
    '상태별 합계의 합은 하루 합계와 같다');
  const train = cost.details.items.find(i => i.key === 'c1');
  assert.equal(train.payState, 'RESERVED');
  assert.equal(cost.details.items.find(i => i.source === 'BOOKING').payState, 'RESERVED',
    '예약에서 파생된 하루치는 언제나 예약이다');
});

test('결제 상태를 고르지 않은 비용을 결제나 예약으로 밀어 넣지 않는다', () => {
  const trip = { days: [{ spots: [{ name: '카페', cost: 5000 }] }] };
  const cost = summary(trip);
  assert.equal(cost.payTotals.NONE, 5000);
  assert.equal(cost.payTotals.PAID, 0);
  assert.equal(cost.payTotals.RESERVED, 0);
});

test('금액을 모르는 비용은 어느 상태 합계도 늘리지 않는다', () => {
  const trip = { days: [{ spots: [{ name: '미정', payState: 'PAID' }], costItems: [{ id: 'x', kind: 'FOOD', payState: 'RESERVED' }] }] };
  const cost = summary(trip);
  assert.deepEqual(cost.payTotals, { RESERVED: 0, PAID: 0, NONE: 0 });
  assert.equal(cost.details.unknownCount, 2, '미정은 미정으로 센다');
});

test('여행 전체 비용도 결제 상태별로 나뉘고 미배분 예약은 예약으로 남는다', () => {
  const trip = {
    bookings: [{ id: 'f1', type: 'flight', title: '항공', price: 500000, cur: 'KRW' }],   // 날짜 없음 → 미배분
    days: [{ spots: [{ name: '저녁', cost: 20000, payState: 'PAID' }] }]
  };
  const days = [{ index: 0, cost: summary(trip) }];
  const result = L.tripCostSummary(trip, days, rates);
  assert.equal(result.payTotals.PAID, 20000);
  assert.equal(result.payTotals.RESERVED, 500000, '날짜 없는 예약도 예약 상태로 전체에 남는다');
  assert.equal(result.payTotals.PAID + result.payTotals.RESERVED + result.payTotals.NONE, result.totalKRW);
});

test('알 수 없는 결제 상태는 정규화에서 떨어지고 미구분이 된다', () => {
  const trip = L.normalizeTrip({ name: 'x', start: '2026-10-01',
    days: [{ spots: [{ name: '장소', cost: 1000, payState: 'DONE' }], costItems: [{ id: 'c1', kind: 'FOOD', amount: 2000, payState: 'PAID' }] }] });
  assert.equal(trip.days[0].spots[0].payState, undefined, '모르는 값은 남기지 않는다');
  assert.equal(trip.days[0].costItems[0].payState, 'PAID', '아는 값은 왕복에서 살아남는다');
  const cost = summary(trip);
  assert.equal(cost.payTotals.NONE, 1000);
  assert.equal(cost.payTotals.PAID, 2000);
});

// ── 비용 항목 사진(영수증·품목) ──

test('비용 사진은 참조만 싣고 개수·길이를 제한한다 — 원본 이미지는 문서에 넣지 않는다', () => {
  const many = Array.from({ length: 14 }, (_, i) => 'ref-' + i);
  const trip = L.normalizeTrip({ name: 'x', start: '2026-10-01', days: [{ spots: [],
    costItems: [{ id: 'c1', kind: 'FOOD', amount: 9000, photos: many },
      { id: 'c2', kind: 'FOOD', amount: 1000, photos: ['ok', '', '   ', 42, 'x'.repeat(500)] },
      { id: 'c3', kind: 'FOOD', amount: 1000, photos: [] }] }] });
  const [a, b, c] = trip.days[0].costItems;
  assert.equal(a.photos.length, 10, '10장을 넘기지 않는다');
  assert.deepEqual(b.photos, ['ok'], '빈 값·숫자·지나치게 긴 참조는 버린다');
  assert.equal(c.photos, undefined, '빈 목록은 필드째 생략한다');
  assert.deepEqual(summary(trip).details.items.find(i => i.key === 'c2').photos, ['ok'],
    '계산 결과가 사진 참조를 그대로 실어 화면이 다시 읽지 않게 한다');
});

// ── 준비한 비용 / 가서 쓰는 비용 (2026-09-17) ──────────────────────────────────────

test('예약은 결제했다고 표시한 것만 결제이고, 하루치·잔액·가계부 줄이 같은 상태를 말한다', () => {
  const trip = L.normalizeTrip({ days: [{ spots: [] }, { spots: [] }, { spots: [] }], start: '2026-10-01', bookings: [
    { id: 'stay', type: 'hotel', title: '호텔', price: 90000, start: '2026-10-01', end: '2026-10-04' },
    { id: 'fly', type: 'flight', title: '항공', price: 200000, payState: 'PAID' },
    { id: 'car', type: 'car', title: '렌터카', price: 60000, start: '2026-10-01', end: '2026-10-02', payState: 'DONE' }
  ] });
  assert.equal(trip.bookings[1].payState, 'PAID', '아는 값은 살아남는다');
  assert.equal(trip.bookings[2].payState, undefined, '모르는 값은 남기지 않는다 — 예약으로 센다');
  const days = trip.days.map((_, index) => ({ index, cost: summary(trip, index) }));
  const share = days[0].cost.details.items.find(i => i.source === 'BOOKING' && i.key === 'stay');
  assert.equal(share.payState, 'RESERVED', '현장 결제 호텔의 하루치는 예약');
  assert.equal(days[0].cost.details.items.find(i => i.key === 'car').payState, 'RESERVED');
  const result = L.tripCostSummary(trip, days, rates);
  assert.equal(result.unallocated.find(i => i.key === 'fly').payState, 'PAID', '결제한 항공의 잔액 줄은 결제');
  assert.deepEqual(result.payTotals, { RESERVED: 150000, PAID: 200000, NONE: 0 });
  assert.deepEqual(result.prep.items.map(i => [i.key, i.payState, i.totalKRW]),
    [['stay', 'RESERVED', 90000], ['fly', 'PAID', 200000], ['car', 'RESERVED', 60000]], '가계부는 예약을 전액 한 줄로');
  assert.deepEqual(result.prep.payTotals, { RESERVED: 150000, PAID: 200000, NONE: 0 });
});

test('여행 단위 준비 비용(trip.costItems)은 하루 항목과 같은 규칙으로 정규화되고 어느 날에도 속하지 않는다', () => {
  const trip = L.normalizeTrip({ days: [{ spots: [{ name: '점심', cat: 'food', cost: 15000, payState: 'PAID' }] }], costItems: [
    { id: 'ins', title: '여행자보험', kind: 'OTHER', amount: 30000, payState: 'PAID', paidOn: '2026-09-10' },
    { id: 'sim', title: '유심', kind: 'BOGUS', amount: 12.5, cur: 'USD', paidOn: '어제' },
    { id: 'bad id', title: '버림', amount: 1 },
    { title: 'id 없음', amount: 1 }
  ] });
  assert.deepEqual(trip.costItems.map(i => i.id), ['ins', 'sim'], '불량 항목은 버린다');
  assert.equal(trip.costItems[1].kind, 'OTHER', '모르는 분류는 기타');
  assert.equal(trip.costItems[0].paidOn, '2026-09-10');
  assert.equal(trip.costItems[1].paidOn, undefined, '날짜 모양이 아니면 버린다');
  const twice = L.normalizeTrip(JSON.parse(JSON.stringify(trip)));
  assert.deepEqual(twice.costItems, trip.costItems, '왕복에서 그대로다');
  assert.equal(L.normalizeTrip({ days: [{}], costItems: [] }).costItems, undefined, '비면 필드째 생략');

  const day = summary(trip);
  assert.equal(day.total, 15000, '여행 단위 항목은 하루 합계에 들어가지 않는다');
  const result = L.tripCostSummary(trip, [{ index: 0, cost: day }], rates);
  const usd = Math.round(12.5 * rates.USD);
  assert.equal(result.totalKRW, 15000 + 30000 + usd);
  assert.equal(result.categories.find(c => c.kind === 'OTHER').totalKRW, 30000 + usd, '분류별에도 들어간다');
  const lines = result.prep.items;
  assert.deepEqual(lines.map(i => [i.source, i.key, i.dayIndex]), [['TRIP', 'ins', null], ['TRIP', 'sim', null]]);
  assert.equal(result.prep.totalKRW, 30000 + usd);
  assert.deepEqual(result.prep.payTotals, { RESERVED: 0, PAID: 30000, NONE: usd });
  assert.equal(result.hasForeignCurrency, true);
});

test('준비한 비용과 가서 쓰는 비용을 더하면 전체와 같고, 현지 지출에는 예약 하루치가 없다', () => {
  const trip = L.normalizeTrip({ start: '2026-10-01', days: [
    { spots: [{ name: '입장료', cost: 12000, payState: 'PAID' }], costItems: [{ id: 'bus', kind: 'TRANSIT', amount: 3000 }] },
    { spots: [{ name: '저녁', cost: 40000 }] }
  ], bookings: [
    { id: 'stay', type: 'hotel', title: '호텔', price: 100000, start: '2026-10-01', end: '2026-10-02', payState: 'PAID' },
    { id: 'fly', type: 'flight', title: '항공', price: 300000, payState: 'PAID' }
  ], costItems: [{ id: 'ins', title: '보험', kind: 'OTHER', amount: 20000, payState: 'PAID' }] });
  const days = trip.days.map((_, index) => ({ index, cost: summary(trip, index, { taxi: index === 1 ? 7000 : null }) }));
  assert.equal(days[0].cost.total, 12000 + 3000 + 100000, '하루 합계에는 숙박 하루치가 있다');
  assert.equal(days[0].cost.onSiteKRW, 12000 + 3000, '현지 지출에는 없다');
  assert.equal(days[1].cost.onSiteKRW, 40000 + 7000, '자동 교통비 추정은 현지 지출이다');
  const result = L.tripCostSummary(trip, days, rates);
  assert.equal(result.prep.totalKRW, 100000 + 300000 + 20000);
  assert.equal(result.onSite.totalKRW, 15000 + 47000);
  assert.equal(result.prep.totalKRW + result.onSite.totalKRW, result.totalKRW, '둘을 더하면 전체');
  assert.deepEqual(result.onSite.payTotals, { RESERVED: 0, PAID: 12000, NONE: 3000 + 47000 });
  assert.deepEqual(result.prep.payTotals, { RESERVED: 0, PAID: 420000, NONE: 0 });
  // 결제 상태별 합계도 여전히 전체와 맞는다
  const pt = result.payTotals;
  assert.equal(pt.RESERVED + pt.PAID + pt.NONE, result.totalKRW);
});

test('금액을 넣지 않은 예약은 가계부에서 미정으로 남고 합계를 흔들지 않는다', () => {
  const trip = L.normalizeTrip({ days: [{ spots: [] }], bookings: [{ id: 'later', type: 'hotel', title: '아직', price: 0 }] });
  const result = L.tripCostSummary(trip, [{ index: 0, cost: summary(trip) }], rates);
  assert.deepEqual(result.prep.items.map(i => [i.key, i.amount, i.state, i.totalKRW]), [['later', null, 'UNKNOWN', null]]);
  assert.equal(result.prep.totalKRW, 0);
  assert.equal(result.totalKRW, 0);
});

// ── 결제일이 상태를 정한다 (2026-09-18) ────────────────────────────────────────────

test('결제일이 있으면 날짜가 상태를 정한다 — 오늘이거나 지났으면 결제, 아직이면 예약', () => {
  const trip = L.normalizeTrip({ start: '2026-10-01', days: [
    { spots: [{ name: '입장권', cat: 'sight', cost: 12000, paidOn: '2026-10-05', payState: 'PAID' }],
      costItems: [{ id: 'bus', kind: 'TRANSIT', amount: 3000, paidOn: '2026-09-01' }] }
  ], bookings: [
    { id: 'stay', type: 'hotel', title: '현장 결제 호텔', price: 100000, start: '2026-10-01', end: '2026-10-02', paidOn: '2026-10-01' },
    { id: 'fly', type: 'flight', title: '항공', price: 300000, paidOn: '2026-08-20' },
    { id: 'car', type: 'car', title: '렌터카', price: 60000, start: '2026-10-01', end: '2026-10-01', payState: 'PAID', paidOn: '2026-12-31' }
  ], costItems: [{ id: 'ins', title: '보험', kind: 'OTHER', amount: 20000, payState: 'RESERVED', paidOn: '2026-09-18' }] });
  assert.equal(trip.bookings[0].paidOn, '2026-10-01', '예약의 결제일이 정규화에서 살아남는다');

  // 오늘 = 2026-09-18: 항공(8/20)·보험(9/18)·버스(9/1)는 낸 돈, 호텔(10/1)·입장권(10/5)·렌터카(12/31)는 아직
  const today = '2026-09-18';
  const day = summary(trip, 0, { today });
  const byKey = Object.fromEntries(day.details.items.map(i => [i.key, i.payState]));
  assert.equal(byKey['0'], 'RESERVED', '손으로 결제라고 해도 결제일이 아직이면 예약이다 — 날짜가 이긴다');
  assert.equal(byKey.bus, 'PAID');
  assert.equal(byKey.stay, 'RESERVED', '하루치도 같은 규칙');
  assert.equal(byKey.car, 'RESERVED', '결제함 표시보다 결제일(12/31)이 먼저다');
  const result = L.tripCostSummary(trip, [{ index: 0, cost: day }], rates, today);
  assert.deepEqual(result.prep.items.map(i => [i.key, i.payState, i.paidOn]),
    [['stay', 'RESERVED', '2026-10-01'], ['fly', 'PAID', '2026-08-20'], ['car', 'RESERVED', '2026-12-31'], ['ins', 'PAID', '2026-09-18']],
    '가계부 줄이 결제일을 싣고 같은 오늘로 상태를 말한다');
  assert.equal(result.unallocated.find(i => i.key === 'fly').payState, 'PAID');

  // 오늘 = 2026-10-05: 호텔·입장권은 결제함이 됐고 렌터카는 여전히 아직
  const later = summary(trip, 0, { today: '2026-10-05' });
  const laterByKey = Object.fromEntries(later.details.items.map(i => [i.key, i.payState]));
  assert.equal(laterByKey['0'], 'PAID', '결제일 당일부터 결제함');
  assert.equal(laterByKey.stay, 'PAID');
  assert.equal(laterByKey.car, 'RESERVED');
  const laterResult = L.tripCostSummary(trip, [{ index: 0, cost: later }], rates, '2026-10-05');
  assert.equal(laterResult.prep.items.find(i => i.key === 'stay').payState, 'PAID', '예약 한 줄과 하루치가 같은 상태');
  assert.deepEqual(laterResult.prep.payTotals, { RESERVED: 60000, PAID: 100000 + 300000 + 20000, NONE: 0 });
});

test('오늘을 모르면 결제일을 판정하지 않고 손으로 고른 상태로 돌아간다', () => {
  assert.equal(L.costPayStateOf({ paidOn: '2026-01-01', payState: 'RESERVED' }, 'TRIP'), 'RESERVED');
  assert.equal(L.costPayStateOf({ paidOn: '2026-01-01' }, 'BOOKING'), 'RESERVED', '예약은 표시 없으면 예약');
  assert.equal(L.costPayStateOf({ paidOn: '2026-01-01', payState: 'PAID' }, 'BOOKING'), 'PAID');
  assert.equal(L.costPayStateOf({ paidOn: '2026-01-01' }, 'EXTRA'), 'NONE', '그 밖의 항목은 미구분');
  assert.equal(L.costPayStateOf({ paidOn: '2026-01-01' }, 'EXTRA', '2026-01-01'), 'PAID');
  assert.equal(L.costPayStateOf({ paidOn: '2026-01-02' }, 'EXTRA', '2026-01-01'), 'RESERVED');
  assert.equal(L.costPayStateOf({ paidOn: '언젠가', payState: 'PAID' }, 'EXTRA', '2026-01-01'), 'PAID', '날짜 모양이 아니면 없는 것');
  assert.equal(L.costPayStateOf({ payState: 'PAID' }, 'EXTRA', '2026-01-01'), 'PAID', '결제일이 없으면 손으로 고른 상태');
  // 하루치 항목은 결제일을 싣는다(없으면 null) — 화면이 문서를 다시 읽지 않게
  const day = summary({ days: [{ spots: [{ name: 'a', cost: 100, paidOn: '2026-10-01' }, { name: 'b', cost: 100 }] }] });
  assert.deepEqual(day.details.items.map(i => i.paidOn), ['2026-10-01', null]);
});

test('예약의 결제일과 사진 참조는 비용 항목과 같은 규칙으로 정규화된다', () => {
  const trip = L.normalizeTrip({ days: [{}], bookings: [
    { id: 'a', type: 'hotel', title: '호텔', price: 1, paidOn: '2026-10-01', photos: ['r1', '', 3, 'x'.repeat(201), 'r2'] },
    { id: 'b', type: 'flight', title: '항공', price: 1, paidOn: '내일', photos: [] }
  ] });
  assert.equal(trip.bookings[0].paidOn, '2026-10-01');
  assert.deepEqual(trip.bookings[0].photos, ['r1', 'r2'], '빈 값·숫자·긴 참조는 버린다');
  assert.equal(trip.bookings[1].paidOn, undefined, '날짜 모양이 아니면 버린다');
  assert.equal(trip.bookings[1].photos, undefined, '빈 목록은 필드째 생략');
  const twice = L.normalizeTrip(JSON.parse(JSON.stringify(trip)));
  assert.deepEqual(twice.bookings, trip.bookings, '왕복에서 그대로다');
  const result = L.tripCostSummary(trip, [{ index: 0, cost: summary(trip) }], rates);
  assert.deepEqual(result.prep.items.find(i => i.key === 'a').photos, ['r1', 'r2'], '가계부 줄이 사진 참조를 싣는다');
});

// ── 숙소(장소) 비용은 숙박일 수로 나눈다 (2026-09-18) ────────────────────────────────────

test('연박 숙소의 비용은 체크인 날부터 nights일에 하루치로 나뉘고 합은 총액과 같다', () => {
  const trip = L.normalizeTrip({ start: '2026-10-01', days: [
    { spots: [{ name: '호텔', cat: 'stay', stay: true, nights: 3, cost: 100000 }, { name: '점심', cat: 'food', cost: 12000 }] },
    { spots: [{ name: '카페', cat: 'cafe', cost: 5000 }] },
    { spots: [] },
    { spots: [{ name: '다음 호텔', stay: true, nights: 2, cost: 90, cur: 'EUR' }] },
    { spots: [] }
  ] });
  const days = trip.days.map((_, index) => ({ index, cost: summary(trip, index) }));
  const items = (i) => days[i].cost.details.items.map(x => [x.source, x.key, x.title, x.amount]);
  assert.deepEqual(items(0), [['SPOT', '0', '호텔 (1/3박)', 33334], ['SPOT', '1', '점심', 12000]], '체크인 날은 첫 밤 몫 — 나머지 원이 앞날에 붙는다');
  assert.deepEqual(items(1), [['SPOT', '0', '카페', 5000], ['STAY', '0.0', '호텔 (2/3박)', 33333]], '다음 날은 이월 몫이 STAY 줄로');
  assert.deepEqual(items(2), [['STAY', '0.0', '호텔 (3/3박)', 33333]]);
  assert.equal(days[0].cost.total + days[1].cost.total + days[2].cost.total, 100000 + 12000 + 5000, '세 날의 합이 총액');
  assert.deepEqual(days[0].cost.parts, [{ label: '장소', amount: 33334 + 12000 }], '이월 몫도 장소 묶음이다');
  assert.equal(days[1].cost.onSiteKRW, 5000 + 33333, '이월 숙박은 가서 쓰는 돈이다');
  // 외화는 소수 둘째 자리까지 나눈다
  assert.deepEqual(items(3), [['SPOT', '0', '다음 호텔 (1/2박)', 45]]);
  assert.deepEqual(items(4), [['STAY', '3.0', '다음 호텔 (2/2박)', 45]]);
  // 일자 카드의 하루치 합계(dayEnteredCostOn)와 전체(dayEnteredCost)는 다른 질문에 답한다
  assert.equal(L.dayEnteredCostOn(trip.days, 0, rates), 33334 + 12000);
  assert.equal(L.dayEnteredCostOn(trip.days, 2, rates), 33333);
  assert.equal(L.dayEnteredCost(trip.days[0], rates), 112000, '전체 합계는 전액');
  const result = L.tripCostSummary(trip, days, rates);
  assert.equal(result.categories.find(c => c.kind === 'STAY').totalKRW, 100000 + Math.round(45 * rates.EUR) * 2, '분류별에는 하루치들이 모여 총액이 된다');
});

test('1박이거나 숙소가 아니거나 금액이 없으면 나누지 않고, 인원 기준 금액은 한 번만 곱한다', () => {
  const trip = L.normalizeTrip({ days: [
    { spots: [{ name: '1박', stay: true, cost: 50000 }, { name: '연박이지만 숙소 아님', nights: 3, cost: 9000 }, { name: '금액 미정', stay: true, nights: 2 },
              { name: '2인 2박', stay: true, nights: 2, cost: 10000, costBasis: 'PER_PERSON', costPeople: 2 }] },
    { spots: [] }
  ] });
  const d0 = summary(trip, 0), d1 = summary(trip, 1);
  assert.deepEqual(d0.details.items.map(x => [x.title, x.amount, x.state]),
    [['1박', 50000, 'KNOWN'], ['연박이지만 숙소 아님', 9000, 'KNOWN'], ['금액 미정', null, 'UNKNOWN'], ['2인 2박 (1/2박)', 10000, 'KNOWN']]);
  assert.deepEqual(d1.details.items.map(x => [x.source, x.title, x.amount]), [['STAY', '2인 2박 (2/2박)', 10000]], '2인 × 1만 = 2만을 반씩');
  assert.equal(d0.total + d1.total, 50000 + 9000 + 20000);
  assert.deepEqual(L.splitAcrossNights(100, 3, 'KRW'), [34, 33, 33]);
  assert.deepEqual(L.splitAcrossNights(10, 3, 'USD'), [3.34, 3.33, 3.33]);
  assert.deepEqual(L.stayCostShares(trip.days, 5), { own: {}, carried: [] }, '연박 범위를 지나면 아무것도 없다');
});
