// 예약 가격 추적 순수 로직 테스트 (price.js — Node 내장 test 러너, 의존성 0)
const test = require('node:test');
const assert = require('node:assert');
const P = require('../price.js');

test('calcSaving — 실질 절약액 = 예약가 − 현재가 − 취소수수료', () => {
  // 예약가 1,350,000 / 현재가 1,180,000 / 수수료 0 → 절약 170,000
  const a = P.calcSaving({price:1350000}, 1180000);
  assert.equal(a.saving, 170000);
  assert.ok(Math.abs(a.rate - 170000/1350000) < 1e-9);
  // 취소 수수료 100,000 → 실질 절약 70,000
  const b = P.calcSaving({price:1350000, cancelFee:100000}, 1180000);
  assert.equal(b.saving, 70000);
  assert.equal(b.fee, 100000);
  // 가격 상승 → 절약 음수 (기회 없음)
  assert.ok(P.calcSaving({price:1350000}, 1420000).saving < 0);
  // 예약가 0 방어 — rate 0
  assert.equal(P.calcSaving({price:0}, 100).rate, 0);
});

test('cancelFeeNow — 무료취소 기한 안이면 수수료 0, 지나면 적용', () => {
  const b = {price:1000000, cancelFee:100000, freeCancelUntil:'2026-10-20'};
  assert.equal(P.cancelFeeNow(b, '2026-10-20'), 0);          // 기한 당일 포함
  assert.equal(P.cancelFeeNow(b, '2026-10-01'), 0);
  assert.equal(P.cancelFeeNow(b, '2026-10-21'), 100000);     // 기한 지남
  assert.equal(P.cancelFeeNow({price:1}, '2026-01-01'), 0);  // 수수료 미설정
  // calcSaving에 그대로 반영
  assert.equal(P.calcSaving(b, 800000, '2026-10-01').saving, 200000);
  assert.equal(P.calcSaving(b, 800000, '2026-11-01').saving, 100000);
});

test('savingWorth — 금액(초과) 또는 비율(7%) threshold, cfg로 재정의 가능', () => {
  // 1,000,000 → 950,000: 5% 하락, 절약 50,000 = 기본 threshold 미충족
  assert.equal(P.savingWorth(P.calcSaving({price:1000000}, 950000)), false);
  // 1,000,000 → 920,000: 8% 하락 → 충족
  assert.equal(P.savingWorth(P.calcSaving({price:1000000}, 920000)), true);
  // 170,000 절약 → 금액 기준 충족
  assert.equal(P.savingWorth(P.calcSaving({price:1350000}, 1180000)), true);
  // 상승 → 미충족
  assert.equal(P.savingWorth(P.calcSaving({price:1000000}, 1100000)), false);
  // 외화: $50 절약(3.4%)이라도 ₩ 환산(×1380=69,000)이 금액 기준을 넘으면 충족
  assert.equal(P.savingWorth(P.calcSaving({price:1450}, 1400), 1380), true);
  assert.equal(P.savingWorth(P.calcSaving({price:1450}, 1400), 1), false);
  // threshold는 설정으로 교체 가능 (하드코딩 아님)
  const loose = Object.assign({}, P.PRICE_CFG, {minSaving:10000, minRate:0.03});
  assert.equal(P.savingWorth(P.calcSaving({price:1000000}, 960000), 1, loose), true);
});

test('bookingPriceStatus — SAVING_AVAILABLE / GOOD_PRICE / WATCHING / null', () => {
  const obs = (...prices) => prices.map((p,i)=>({price:p, at:`2026-08-2${i}T09:00:00Z`}));
  // 추적 꺼짐·관측 없음 → null (UI는 '첫 확인 대기'로 표시)
  assert.equal(P.bookingPriceStatus({price:1, track:false}, obs(1)), null);
  assert.equal(P.bookingPriceStatus({price:1, track:true}, []), null);
  // 의미 있는 하락 → SAVING_AVAILABLE (최신 관측가 기준)
  const s1 = P.bookingPriceStatus({price:1350000, track:true}, obs(1350000, 1320000, 1280000, 1180000));
  assert.equal(s1.state, 'SAVING_AVAILABLE');
  assert.equal(s1.current, 1180000);
  assert.equal(s1.saving, 170000);
  // 소폭 하락(threshold 미충족) + 관측 최저 수준 + 관측 3회 이상 → GOOD_PRICE
  const s2 = P.bookingPriceStatus({price:1000000, track:true}, obs(990000, 970000, 960000));
  assert.equal(s2.state, 'GOOD_PRICE');
  // 같은 상황이라도 관측이 부족하면 WATCHING (판단 보류)
  assert.equal(P.bookingPriceStatus({price:1000000, track:true}, obs(970000, 960000)).state, 'WATCHING');
  // 가격 상승 → WATCHING (절약 기회 없음)
  assert.equal(P.bookingPriceStatus({price:1350000, track:true}, obs(1350000, 1420000)).state, 'WATCHING');
  // 취소 수수료가 절약을 갉아먹으면 강등: 170,000 하락 - 150,000 수수료 = 20,000 → 미충족
  const s3 = P.bookingPriceStatus({price:1350000, cancelFee:150000, track:true}, obs(1180000), {today:'2026-08-25'});
  assert.equal(s3.state, 'WATCHING');
  assert.equal(s3.saving, 20000);
  // 무료취소 기한 안이면 수수료 무시 → 다시 SAVING_AVAILABLE
  const s4 = P.bookingPriceStatus({price:1350000, cancelFee:150000, freeCancelUntil:'2026-10-20', track:true},
    obs(1180000), {today:'2026-08-25'});
  assert.equal(s4.state, 'SAVING_AVAILABLE');
  assert.equal(s4.saving, 170000);
});

test('tripSavingSummary — 예약 총액·절약 가능 금액·종류별 합계 (₩ 환산)', () => {
  const bookings = [
    {id:'h1', type:'hotel',  price:1350000, track:true},              // 절약 170,000
    {id:'c1', type:'car',    price:500000,  track:true},              // 절약 없음(소폭)
    {id:'f1', type:'flight', price:1450,    cur:'USD', track:true},   // $50 절약 → ₩69,000
    {id:'x1', type:'hotel',  price:900000,  track:false}              // 추적 꺼짐 → 총액에만 포함
  ];
  const obsById = {
    h1:[{price:1180000, at:'2026-08-24T09:00:00Z'}],
    c1:[{price:495000,  at:'2026-08-24T09:00:00Z'}],
    f1:[{price:1400,    at:'2026-08-24T09:00:00Z'}]
  };
  const s = P.tripSavingSummary(bookings, obsById, {krwRateOf:c=>c==='USD'?1380:1});
  assert.equal(s.booked, 1350000+500000+Math.round(1450*1380)+900000);
  assert.equal(s.saving, 170000+69000);
  assert.equal(s.count, 2);
  assert.equal(s.byType.hotel, 170000);
  assert.equal(s.byType.flight, 69000);
  assert.equal(s.byType.car, 0);
  // 빈 목록·환율 미주입도 안전
  assert.deepEqual(P.tripSavingSummary([], {}), {booked:0, saving:0, count:0, byType:{hotel:0,car:0,flight:0}});
});

test('mockDailyPrice — 같은 (예약·판매처·날짜)는 같은 값, 예약가의 0.85~1.10배', () => {
  const p1 = P.mockDailyPrice('bk1', 'Agoda', '2026-08-25', 1000000);
  assert.equal(p1, P.mockDailyPrice('bk1', 'Agoda', '2026-08-25', 1000000));   // 결정적
  assert.ok(p1 >= 850000 && p1 <= 1100000, `범위: ${p1}`);
  assert.equal(p1 % 1000, 0, '10만 이상은 1,000원 단위로 정리');
  // 날짜·판매처가 다르면 (대체로) 다른 값 — 여러 입력 중 최소 하나는 달라야 함
  const others = [
    P.mockDailyPrice('bk1', 'Agoda', '2026-08-26', 1000000),
    P.mockDailyPrice('bk1', 'Booking.com', '2026-08-25', 1000000),
    P.mockDailyPrice('bk2', 'Agoda', '2026-08-25', 1000000)
  ];
  assert.ok(others.some(v => v !== p1), '입력이 다르면 값이 움직인다');
  others.forEach(v => assert.ok(v >= 850000 && v <= 1100000));
});
