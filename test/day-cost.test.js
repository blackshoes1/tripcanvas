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
