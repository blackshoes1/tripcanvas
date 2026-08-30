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

// ── Offer Matching Engine — "같은 상품인가"를 가격보다 먼저 판단 ──

test('matchQuality — EXACT / EQUIVALENT / SIMILAR / UNMATCHED 판정', () => {
  const b = {price:1350000, refundable:true, breakfast:true, roomName:'Deluxe Double'};
  // EXACT: 객실·환불·조식이 양쪽 모두 알려져 있고 전부 일치 (표기 차이는 정규화)
  assert.equal(P.matchQuality(b, {seller:'Expedia', price:1180000, refundable:true, breakfast:true, roomName:'deluxe double'}), 'EXACT');
  // EQUIVALENT: 선언된 조건이 오퍼에서 일치 확인 (객실명은 오퍼에 없음 → 다른 선언 조건만으로)
  assert.equal(P.matchQuality({price:1, refundable:true}, {seller:'X', price:1, refundable:true}), 'EQUIVALENT');
  // 환불 조건 불일치 → EXACT/EQUIVALENT 금지 (§45)
  assert.equal(P.matchQuality({price:1, refundable:true}, {seller:'X', price:1, refundable:false}), 'SIMILAR');
  // 객실 등급 불일치 (디럭스 → 스탠다드) → 확정 금지 (§45)
  assert.equal(P.matchQuality(b, {seller:'X', price:1, refundable:true, breakfast:true, roomName:'Standard Twin'}), 'SIMILAR');
  // 선언한 조건을 오퍼에서 확인 불가 → SIMILAR (조건 확인 필요)
  assert.equal(P.matchQuality({price:1, breakfast:true}, {seller:'X', price:1}), 'SIMILAR');
  // 아무 조건도 선언 안 함 → 동등성 확인 불가 → SIMILAR
  assert.equal(P.matchQuality({price:1}, {seller:'X', price:1, refundable:true}), 'SIMILAR');
  // 통화 불일치·가격 없음 → UNMATCHED (비교 자체 불가)
  assert.equal(P.matchQuality({price:1, cur:'KRW'}, {seller:'X', price:1, cur:'USD'}), 'UNMATCHED');
  assert.equal(P.matchQuality({price:1}, {seller:'X', price:0}), 'UNMATCHED');
});

test('offerPrice — 총액 우선, 없으면 1박가', () => {
  assert.equal(P.offerPrice({price:100000, total:230000}), 230000);
  assert.equal(P.offerPrice({price:100000}), 100000);
  assert.equal(P.offerPrice({}), 0);
});

test('decideSaving — 확정(동일 조건)과 잠재(SIMILAR)를 섞지 않는다', () => {
  const b = {price:1350000, refundable:true};
  const today = '2026-08-25';
  // 동일 조건 + 가격 하락 → 확정 170,000 (§45)
  const d1 = P.decideSaving(b, [{seller:'Expedia', price:1180000, refundable:true}], {today});
  assert.equal(d1.confirmed.saving, 170000);
  assert.equal(d1.potential, null);
  // Metasearch만 존재(조건 미확인) → 잠재로만, 확정 금지 (§45)
  const d2 = P.decideSaving(b, [{seller:'Agoda', price:1160000}], {today});
  assert.equal(d2.confirmed, null);
  assert.equal(d2.potential.delta, 190000);
  // 혼합(§21 예): Expedia 1,180,000 동일 조건 + Agoda 1,160,000 미확인 → 확정 170,000 & 잠재 190,000 병기
  const d3 = P.decideSaving(b, [
    {seller:'Expedia', price:1180000, refundable:true},
    {seller:'Agoda', price:1160000},
    {seller:'Booking.com', price:1240000, refundable:true}
  ], {today});
  assert.equal(d3.confirmed.offer.seller, 'Expedia');
  assert.equal(d3.confirmed.saving, 170000);
  assert.equal(d3.potential.offer.seller, 'Agoda');
  assert.equal(d3.potential.delta, 190000);
  // 잠재가 확정 최저가보다 비싸면 표기 의미 없음 → null
  const d4 = P.decideSaving(b, [{seller:'E', price:1180000, refundable:true}, {seller:'A', price:1200000}], {today});
  assert.equal(d4.potential, null);
  // 취소 수수료는 '확정'에만 반영: 1,350,000−1,180,000−100,000 = 70,000
  const d5 = P.decideSaving({price:1350000, refundable:false, cancelFee:100000}, [{seller:'E', price:1180000, refundable:false}], {today});
  assert.equal(d5.confirmed.saving, 70000);
  // 무료취소 기한 안이면 수수료 0
  const d6 = P.decideSaving({price:1350000, refundable:true, cancelFee:100000, freeCancelUntil:'2026-10-20'},
    [{seller:'E', price:1180000, refundable:true}], {today});
  assert.equal(d6.confirmed.saving, 170000);
  // 가격 상승만 있으면 확정·잠재 모두 없음
  const d7 = P.decideSaving(b, [{seller:'E', price:1420000, refundable:true}, {seller:'A', price:1400000}], {today});
  assert.equal(d7.confirmed, null);
  assert.equal(d7.potential, null);
});

test('decideSaving — §20 신뢰 사다리: 검증 오퍼가 미검증 오퍼보다 우선', () => {
  const b = {price:1000000, refundable:true};
  // 검증 EQUIVALENT(900k)가 미검증 EXACT(880k)보다 우선 — 같은 등급끼리만 저가 비교
  const d = P.decideSaving(b, [
    {seller:'cheap-meta', price:880000, refundable:true, breakfast:true, roomName:'A', quality:'EXACT'},
    {seller:'verified-ota', price:900000, refundable:true, verified:true, quality:'EQUIVALENT'}
  ], {});
  assert.equal(d.confirmed.offer.seller, 'verified-ota');
  assert.equal(P.offerRank('EXACT', true), 0);
  assert.equal(P.offerRank('EQUIVALENT', true), 1);
  assert.equal(P.offerRank('EXACT', false), 2);
  assert.equal(P.offerRank('EQUIVALENT', false), 3);
  assert.equal(P.offerRank('SIMILAR', false), 4);
});

test('hotelTrackState — 상태 전이와 실패 처리 (§32·36·45)', () => {
  const b = {price:1000000, track:true, refundable:true};
  const opts = {today:'2026-08-25'};
  // 확정 절약(threshold 충족) → SAVING_AVAILABLE
  assert.equal(P.hotelTrackState(b, {offers:[{seller:'E', price:900000, refundable:true}], at:'x'}, opts).state, 'SAVING_AVAILABLE');
  // 확정이지만 threshold 미달(5만·7% 미충족) → WATCHING
  assert.equal(P.hotelTrackState(b, {offers:[{seller:'E', price:960000, refundable:true}], at:'x'}, opts).state, 'WATCHING');
  // 미검증 저가만 존재 → CHEAPER_UNVERIFIED (확정이라고 말하지 않음)
  assert.equal(P.hotelTrackState(b, {offers:[{seller:'A', price:880000}], at:'x'}, opts).state, 'CHEAPER_UNVERIFIED');
  // 모든 소스 실패(성공 이력 없음) → ERROR — 기존 가격을 최신인 척 하지 않는다
  const err = P.hotelTrackState(b, {offers:[], obs:[], at:null, err:{code:'AUTH_REQUIRED', at:'x'}}, opts);
  assert.equal(err.state, 'ERROR');
  // 성공 이력이 있으면 실패가 있어도 마지막 성공 데이터로 상태 유지 (UI가 '오래됨'을 별도 표기)
  const keep = P.hotelTrackState(b, {offers:[{seller:'E', price:900000, refundable:true}], at:'2026-08-24T00:00:00Z', err:{code:'NETWORK_ERROR', at:'x'}}, opts);
  assert.equal(keep.state, 'SAVING_AVAILABLE');
  // 추적 꺼짐 → null
  assert.equal(P.hotelTrackState({price:1, track:false}, {offers:[]}, opts), null);
});

test('identityScore — placeId 일치 우선, 이름+좌표 조합 점수', () => {
  // placeId가 양쪽에 있으면 그 일치가 전부
  assert.equal(P.identityScore({placeId:'A', name:'x'}, {placeId:'A', name:'전혀다름'}), 1);
  assert.equal(P.identityScore({placeId:'A'}, {placeId:'B', name:'x'}), 0);
  // 같은 이름 + 300m 이내 → 만점권
  const near = P.identityScore({name:'Cap Rocat', lat:39.4699, lng:2.7166}, {name:'Cap Rocat', lat:39.4700, lng:2.7167});
  assert.ok(near > 0.95, `got ${near}`);
  // 관용어(Hotel 등) 차이는 흡수
  assert.ok(P.identityScore({name:'Cap Rocat'}, {name:'Hotel Cap Rocat'}) > 0.9);
  // 다른 이름 + 3km 밖 → 낮음 (자동 확정 금지 수준)
  const far = P.identityScore({name:'Cap Rocat', lat:39.4699, lng:2.7166}, {name:'Playa Hotel', lat:39.60, lng:2.65});
  assert.ok(far < 0.4, `got ${far}`);
  assert.equal(P.identityScore(null, {}), 0);
});

test('tripHotelSummary — 확정·잠재(조건 확인 필요)·실제 절약을 절대 섞지 않는다 (§31)', () => {
  const bookings = [
    {id:'h1', type:'hotel', price:1350000, track:true, refundable:true, saved:120000},   // 확정 170,000 + 과거 실제 절약 120,000
    {id:'h2', type:'hotel', price:800000,  track:true},                                  // 잠재 100,000 (미확인)
    {id:'h3', type:'hotel', price:500000,  track:false}                                  // 추적 꺼짐 → 총액만
  ];
  const recs = {
    h1:{offers:[{seller:'Expedia', price:1180000, refundable:true}], at:'x'},
    h2:{offers:[{seller:'Agoda', price:700000}], at:'x'}
  };
  const s = P.tripHotelSummary(bookings, recs, {today:'2026-08-25'});
  assert.equal(s.booked, 1350000+800000+500000);
  assert.equal(s.confirmed, 170000);
  assert.equal(s.potential, 100000);
  assert.equal(s.actual, 120000);
  assert.equal(s.count, 1);
  // 빈 목록 안전
  assert.deepEqual(P.tripHotelSummary([], {}), {booked:0, confirmed:0, potential:0, actual:0, count:0});
});

test('identityScore — 같은 건물 수준(150m)이면 표기가 달라도 매칭 가능', () => {
  // 판매처마다 표기가 다른 실제 사례: 일정엔 "Lotte Hotel Seoul", 결과는 "The Grand Lotte Seoul"
  const s = P.identityScore(
    { name: 'Lotte Hotel Seoul', lat: 37.5651, lng: 126.9814 },
    { name: '더그랜드롯데 서울', lat: 37.5652, lng: 126.9815 });
  assert.ok(s >= 0.6, '150m 이내는 최소 0.6 보장, got ' + s);
  // 멀면 보정하지 않는다 — 이름이 달라도 가깝다는 이유만으로 붙이면 오매칭이 된다
  const far = P.identityScore(
    { name: 'Lotte Hotel Seoul', lat: 37.5651, lng: 126.9814 },
    { name: '전혀 다른 호텔', lat: 37.60, lng: 127.05 });
  assert.ok(far < 0.55, '먼 곳은 보정 없음, got ' + far);
});

test('carMatchQuality — 동일 조건 대안은 확정 절약 후보 (스펙 시나리오: €320→€258)', () => {
  const b={type:'car',price:320,cur:'EUR',carPickupCode:'PMI',carClass:'compact',transmission:'automatic',mileage:'UNLIMITED',refundable:true};
  const sixt={seller:'Sixt',price:258,total:258,cur:'EUR',pickupCode:'PMI',vehicleClass:'compact',transmission:'automatic',mileage:'UNLIMITED',refundable:true};
  const q=P.carMatchQuality(b,sixt);
  assert.ok(q==='EXACT'||q==='EQUIVALENT', 'got '+q);
  const d=P.decideSaving(b,[{...sixt,quality:q}],{today:'2026-08-26'});
  assert.equal(d.confirmed.saving, 62, '€320-€258=€62 확정 절약');
});

test('carMatchQuality — 변속기·차급·보험·주행거리·취소 조건 차이는 확정 금지 (SIMILAR)', () => {
  const b={type:'car',price:320,cur:'EUR',carPickupCode:'PMI',carClass:'compact',transmission:'automatic',mileage:'UNLIMITED',insurance:'FULL',refundable:true};
  const base={seller:'X',price:247,total:247,cur:'EUR',pickupCode:'PMI',vehicleClass:'compact',transmission:'automatic',mileage:'UNLIMITED',insurance:'FULL',refundable:true};
  assert.equal(P.carMatchQuality(b,{...base,transmission:'manual'}), 'SIMILAR', 'auto↔manual');
  assert.equal(P.carMatchQuality(b,{...base,vehicleClass:'mini'}), 'SIMILAR', '차급 하락(compact→mini)');
  assert.equal(P.carMatchQuality(b,{...base,insurance:'BASIC'}), 'SIMILAR', '보험 하락(FULL→BASIC)');
  assert.equal(P.carMatchQuality(b,{...base,mileage:'LIMITED'}), 'SIMILAR', '무제한→제한');
  assert.equal(P.carMatchQuality(b,{...base,refundable:false}), 'SIMILAR', '환불→비환불');
  const d=P.decideSaving(b,[{...base,transmission:'manual',quality:'SIMILAR'}],{today:'2026-08-26'});
  assert.equal(d.confirmed, null, '€73 차이는 확정 절약에 포함하지 않는다');
  assert.equal(d.potential.delta, 73, '잠재(조건 확인 필요)로만');
});

test('carMatchQuality — 픽업 다르면 UNMATCHED, 차급 상승은 EQUIVALENT(EXACT 아님)', () => {
  const b={type:'car',price:320,cur:'EUR',carPickupCode:'PMI',carClass:'compact',transmission:'automatic'};
  assert.equal(P.carMatchQuality(b,{seller:'X',price:200,cur:'EUR',pickupCode:'MAD',vehicleClass:'compact',transmission:'automatic'}), 'UNMATCHED', '다른 공항');
  assert.equal(P.carMatchQuality(b,{seller:'X',price:200,cur:'USD',pickupCode:'PMI'}), 'UNMATCHED', '통화 불일치');
  const up=P.carMatchQuality(b,{seller:'X',price:300,total:300,cur:'EUR',pickupCode:'PMI',vehicleClass:'intermediate',transmission:'automatic'});
  assert.equal(up, 'EQUIVALENT', '차급 상승은 동등 취급, EXACT는 아님');
  assert.equal(P.carMatchQuality({type:'car',price:320,cur:'EUR'},{seller:'X',price:250,cur:'EUR'}), 'SIMILAR', '조건 미확인은 확정 금지');
});

test('carMatchQuality — 가격 상승이면 절약 기회 없음', () => {
  const b={type:'car',price:320,cur:'EUR',carPickupCode:'PMI',carClass:'compact',transmission:'automatic'};
  const o={seller:'X',price:350,total:350,cur:'EUR',pickupCode:'PMI',vehicleClass:'compact',transmission:'automatic'};
  const d=P.decideSaving(b,[{...o,quality:P.carMatchQuality(b,o)}],{today:'2026-08-26'});
  assert.equal(d.confirmed, null);
  assert.equal(d.potential, null);
});

test('car 조건 정규화 — 표기 차이 흡수', () => {
  assert.equal(P.normTransmission('Auto'), 'automatic');
  assert.equal(P.normTransmission('MANUAL'), 'manual');
  assert.equal(P.normMileage('Unlimited km'), 'UNLIMITED');
  assert.equal(P.normMileage('300 km/day'), 'LIMITED');
  assert.equal(P.normInsurance('Full coverage'), 'FULL');
  assert.equal(P.normInsurance('CDW included'), 'CDW');
  assert.equal(P.normCarClass('Compact SUV'), 'compact');
  assert.equal(P.normCarClass('준중형'), 'compact');
});

// ── P0-1: 비교 기준(basis) — 다객실 예약에 1실 시세로 확정 절약을 만들지 않는다 ──
test('P0-1: qualityWithBasis — 객실 수 불일치면 어떤 등급도 UNSUPPORTED_BASIS로 강등', () => {
  const b2 = { rooms: 2 }, b1 = { rooms: 1 }, basis1 = { rooms: 1 };
  assert.equal(P.qualityWithBasis('EXACT', b2, basis1), 'UNSUPPORTED_BASIS', 'EXACT 확정 금지');
  assert.equal(P.qualityWithBasis('EQUIVALENT', b2, basis1), 'UNSUPPORTED_BASIS');
  assert.equal(P.qualityWithBasis('SIMILAR', b2, basis1), 'UNSUPPORTED_BASIS', '잠재(최대 차액)도 기준이 달라 성립 안 함');
  assert.equal(P.qualityWithBasis('UNMATCHED', b2, basis1), 'UNMATCHED');
  assert.equal(P.qualityWithBasis('EXACT', b1, basis1), 'EXACT', '기준 일치 → 유지');
  assert.equal(P.qualityWithBasis('EXACT', {}, basis1), 'EXACT', 'rooms 미지정 = 1실');
  assert.equal(P.qualityWithBasis('EXACT', b2, null), 'EXACT', 'basis 미제공(구 기록) → 판단 근거 없음, 유지');
  assert.equal(P.basisMismatch(b2, basis1), true);
  assert.equal(P.basisMismatch(b1, basis1), false);
});

test('P0-1: UNSUPPORTED_BASIS 오퍼는 확정도 잠재도 만들지 않는다 (임의 곱셈 금지)', () => {
  const b = { price: 1400000, rooms: 2, cur: 'KRW', refundable: true };
  const basis = { rooms: 1 };
  // 1실 기준 700,000 — 2실 예약가 1,400,000보다 "싸 보이지만" 기준이 다르다
  const offers = [{ seller: 'Expedia', price: 700000, refundable: true }]
    .map(o => ({ ...o, quality: P.qualityWithBasis(P.matchQuality(b, o), b, basis) }));
  assert.equal(offers[0].quality, 'UNSUPPORTED_BASIS');
  const d = P.decideSaving(b, offers, { today: '2026-08-25' });
  assert.equal(d.confirmed, null, '확정 절약 금지');
  assert.equal(d.potential, null, "잠재('최대 차액')도 금지");
  assert.equal(P.offerRank('UNSUPPORTED_BASIS', false), 9, '신뢰 사다리 밖');
});

test('P0-1: hotelTrackState — basis 불일치는 basisLimited로 알리고 상태는 WATCHING에 머문다', () => {
  const b = { price: 1400000, rooms: 2, cur: 'KRW', track: true };
  const rec = { at: '2026-08-25T09:00:00Z', basis: { rooms: 1, requestedRooms: 2 },
    offers: [{ seller: 'Expedia', price: 700000, quality: 'UNSUPPORTED_BASIS' }],
    obs: [{ price: 700000, at: '2026-08-25T09:00:00Z', quality: 'UNSUPPORTED_BASIS' }] };
  const st = P.hotelTrackState(b, rec, { today: '2026-08-25' });
  assert.equal(st.state, 'WATCHING', '절약 가능으로 단정하지 않는다');
  assert.equal(st.basisLimited, true, 'UI가 "1객실 기준만 확인 가능"을 설명할 근거');
  // 기준 일치 기록이면 플래그 없음
  const ok = P.hotelTrackState({ ...b, rooms: 1 }, { ...rec, basis: { rooms: 1 } }, { today: '2026-08-25' });
  assert.equal(ok.basisLimited, false);
});

test('P0-1: bookingPriceStatus — 기준이 다른 관측으로는 절약/좋은가격을 판정하지 않는다', () => {
  const b = { price: 1400000, rooms: 2, track: true };
  const mk = q => [
    { price: 720000, at: '2026-08-23T09:00:00Z', quality: q },
    { price: 710000, at: '2026-08-24T09:00:00Z', quality: q },
    { price: 700000, at: '2026-08-25T09:00:00Z', quality: q }
  ];
  const st = P.bookingPriceStatus(b, mk('UNSUPPORTED_BASIS'), { today: '2026-08-25' });
  assert.equal(st.state, 'WATCHING', '1실 기준 관측 → 2실 예약가와 비교 금지');
  // 같은 수치라도 기준이 맞으면 기존 판정 그대로 (회귀 방지)
  const st2 = P.bookingPriceStatus({ price: 1400000, track: true }, mk('EXACT'), { today: '2026-08-25' });
  assert.equal(st2.state, 'SAVING_AVAILABLE');
});

// ── P0-3: MatchQuality(같은 상품인가)와 VerificationStatus(판매처가 확인했는가)는 다른 축 ──
test('P0-3: verificationStatus — 매칭 등급과 무관하게 검증 축만 답한다', () => {
  assert.equal(P.verificationStatus({ verified: true }), 'VERIFIED');
  assert.equal(P.verificationStatus({ verified: false }), 'METASEARCH_ONLY', '메타서치 표시가 — 판매처 검증 필요');
  assert.equal(P.verificationStatus({}), 'METASEARCH_ONLY');
  assert.equal(P.verificationStatus({ manual: 1 }), 'UNKNOWN', '수동 관측 — 자동 소스 검증 아님');
  // EXACT + METASEARCH_ONLY 조합이 가능해야 한다 (등급이 검증을 함의하지 않는다)
  const b = { price: 100, cur: 'KRW', refundable: true };
  const o = { seller: 'E', price: 90, refundable: true, verified: false };
  assert.equal(P.matchQuality(b, o), 'EQUIVALENT');
  assert.equal(P.verificationStatus(o), 'METASEARCH_ONLY');
});
