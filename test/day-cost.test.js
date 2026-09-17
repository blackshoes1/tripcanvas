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
