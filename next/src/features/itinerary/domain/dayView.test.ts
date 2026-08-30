// buildDayView 배선 검증 — 배선 실수가 잦은 곳(CLAUDE.md '핵심 개념')을 그대로 시나리오로 만든다:
// anchor/carry 혼동 · startPolicy · 연박 이월 · 구간 캐시/추정 폴백 · at/bookAt 3종 시각 ·
// 렌터카 연결 vs 독립 행 · 반납 (장소,코드) 쌍 규칙 · 하루치/전액 비용 구분.
import legacyLib from '@legacy/lib.js';
import { describe, expect, it } from 'vitest';

import type { Booking } from '@/features/booking/domain/types';
import type { Day, Spot, Trip } from '@/features/trip/domain/types';
import { buildDayView, dateLabelOf, isoDateOf, legMinutes, tripCostBreakdownOf } from './dayView';
import type { LegCache } from './types';

const { haversine, hm, legKey } = legacyLib;

const spot = (name: string, lat: number | null, lng: number | null, extra: Partial<Spot> = {}): Spot =>
  ({ name, city: '제주', desc: '', lat, lng, ...extra });
/** 좌표 확정 픽스처용 — haversine/legKey 인자 좁히기 */
const ll = (s: Spot): { lat: number; lng: number } => ({ lat: s.lat!, lng: s.lng! });
const day = (spots: Spot[], extra: Partial<Day> = {}): Day =>
  ({ title: '', drive: '', note: '', mode: 'car', spots, ...extra });
const trip = (days: Day[], extra: Partial<Trip> = {}): Trip =>
  ({ id: 't1', name: '테스트 여행', start: '2026-10-01', days, ...extra });

// 제주 실좌표 — 공항→성산 직선 약 42km (거리 기대값은 haversine으로 계산해 회귀에 강하게)
const airport = () => spot('제주공항', 33.5104, 126.4914);
const seongsan = () => spot('성산일출봉', 33.4587, 126.9425);
const hotel = (extra: Partial<Spot> = {}) => spot('제주호텔', 33.4996, 126.5312, { stay: true, ...extra });

const NONE: LegCache = {};

describe('anchor/carry — 이월 출발점', () => {
  it('전날 숙소는 carry(🏠 표시)이자 ETA 출발점(anchor)이다', () => {
    const stay = hotel();
    const t = trip([day([airport(), stay]), day([seongsan()])]);
    const v = buildDayView(t, NONE, 1);
    expect(v.carry).toEqual({ name: '제주호텔', startAt: '09:00' });
    expect(v.interDayLabel).toBeNull();   // 🏠 항목이 일자 간 안내를 대체
    // 첫 장소 ETA = 09:00 + 숙소→성산 자차 추정(40km/h)
    expect(v.spots[0].etaText).toBe(hm(540 + (haversine(ll(stay), ll(seongsan())) / 40) * 60));
    expect(v.spots[0].leg).not.toBeNull();
  });

  it('전날 마지막 장소가 숙소가 아니면 anchor는 되지만(ETA 반영) carry(🏠)는 아니다', () => {
    const t = trip([day([airport()]), day([seongsan()])]);
    const v = buildDayView(t, NONE, 1);
    expect(v.carry).toBeNull();
    expect(v.interDayLabel).toMatch(/^이전 일정에서 직선 /);
    expect(v.spots[0].etaText).toBe(hm(540 + (haversine(ll(airport()), ll(seongsan())) / 40) * 60));
  });

  it("startPolicy 'none'이면 이월이 없다 (공항 이동일·야간열차)", () => {
    const t = trip([day([hotel()]), day([seongsan()], { startPolicy: 'none' })]);
    const v = buildDayView(t, NONE, 1);
    expect(v.carry).toBeNull();
    expect(v.interDayLabel).toBeNull();
    expect(v.spots[0].leg).toBeNull();
    expect(v.spots[0].etaText).toBe('09:00');
  });

  it('연박(nights=2) 숙소는 중간에 숙소 없는 날을 지나 다음 날 아침까지 이월된다', () => {
    const stay = hotel({ nights: 2 });
    const t = trip([day([stay]), day([seongsan()]), day([airport()])]);
    expect(buildDayView(t, NONE, 2).carry?.name).toBe('제주호텔');
  });
});

describe('구간 시간 — 캐시 우선, 없으면 속도 기반 직선 추정', () => {
  const a = airport(), b = seongsan();

  it('캐시된 경로가 있으면 그 시간, 자차 2km 미만은 도보 대안(m/75분)', () => {
    const key = legKey({ lat: a.lat!, lng: a.lng! }, { lat: b.lat!, lng: b.lng! }, 'car');
    expect(legMinutes({ [key]: { sec: 3600, m: 40000 } }, a as never, b as never, 'car')).toBe(60);
    expect(legMinutes({ [key]: { sec: 600, m: 1500 } }, a as never, b as never, 'car')).toBe(20);   // 1500/75
    expect(legMinutes(NONE, a as never, b as never, 'car')).toBeCloseTo((haversine(ll(a), ll(b)) / 40) * 60, 6);
    expect(legMinutes(NONE, a as never, b as never, 'train')).toBeCloseTo((haversine(ll(a), ll(b)) / 160) * 60, 6);
  });

  it('구간 라벨 — 캐시: km·시간(2km 미만 자차는 🚶), 미캐시: 직선, 실패: ⚠️', () => {
    const key = legKey({ lat: a.lat!, lng: a.lng! }, { lat: b.lat!, lng: b.lng! }, 'car');
    const mk = (cache: LegCache) => buildDayView(trip([day([airport(), seongsan()])]), cache, 0).spots[1].leg!;
    expect(mk({ [key]: { sec: 3600, m: 40000 } }).label).toBe('↳40.0km · 1시간');
    expect(mk({ [key]: { sec: 600, m: 1500 } }).label).toBe('↳1.5km · 🚶20분');
    const miss = mk(NONE);
    expect(miss.cached).toBe(false);
    expect(miss.label).toBe(`↳${haversine(ll(a), ll(b)).toFixed(1)}km`);
    const failed = mk({ [key]: { fail: true } });
    expect(failed.failed).toBe(true);
    expect(failed.label).toMatch(/⚠️$/);
  });
});

describe('시간 3종 — 도착 예상 / at 고정 / bookAt 예약', () => {
  const key = () => legKey(
    { lat: airport().lat!, lng: airport().lng! }, { lat: seongsan().lat!, lng: seongsan().lng! }, 'car');
  // 09:00 공항 도착 + 기본 체류 60분 + 이동 60분(캐시) = 두 번째 장소 도착 11:00
  const cache: LegCache = { [key()]: { sec: 3600, m: 40000 } };

  it('at 고정이 이동상 불가능하면 ⚠️, 기차·비행기 구간(시간표)은 억제', () => {
    const fixedCar = trip([day([airport(), { ...seongsan(), at: '09:05' }])]);
    const vCar = buildDayView(fixedCar, cache, 0).spots[1];
    expect(vCar.fixed).toBe(true);
    expect(vCar.conflict).toBe(true);
    expect(vCar.etaText).toBe('09:05');

    const fixedTrain = trip([day([airport(), { ...seongsan(), at: '09:05', legMode: 'train' }])]);
    const vTrain = buildDayView(fixedTrain, NONE, 0).spots[1];
    expect(vTrain.fixed).toBe(true);
    expect(vTrain.conflict).toBe(false);   // 시간표 기준이므로 정상
  });

  it('bookAt이 도착보다 뒤면 대기(⏳)로, 5분 넘게 늦으면 경고로', () => {
    const waiting = buildDayView(trip([day([airport(), { ...seongsan(), bookAt: '12:00' }])]), cache, 0).spots[1];
    expect(waiting.etaText).toBe('11:00');
    expect(waiting.book).toMatchObject({ at: '12:00', warn: false, waitMin: 60 });

    const late = buildDayView(trip([day([airport(), { ...seongsan(), bookAt: '09:30' }])]), cache, 0).spots[1];
    expect(late.book?.warn).toBe(true);
    expect(late.book?.title).toContain('약 90분 늦어요');
  });
});

describe('렌터카 픽업·반납 — 연결되면 칩, 아니면 날짜 파생 독립 행', () => {
  const carBooking = (extra: Partial<Booking> = {}): Booking => ({
    id: 'car1', type: 'car', title: '허츠 제주', price: 90000, track: true,
    start: '2026-10-01', end: '2026-10-02',
    carPickup: '제주공항점', carPickupCode: 'CJU', carPickupTime: '10:00', carReturnTime: '18:00',
    ...extra
  } as Booking);

  it('장소와 연결된 픽업은 그 행의 칩으로 붙고 독립 행에서 빠진다', () => {
    const t = trip(
      [day([{ ...airport(), carPickupId: 'car1' }]), day([seongsan()])],
      { bookings: [carBooking()] }
    );
    const d0 = buildDayView(t, NONE, 0);
    expect(d0.spots[0].carChips).toEqual([
      { kind: 'pickup', bookingId: 'car1', label: '🚗 렌터카 픽업 10:00', title: '렌터카 픽업 10:00 · 허츠 제주' }
    ]);
    expect(d0.carPickups).toHaveLength(0);
    // 반납일(연결 안 됨)은 독립 행 — 반납 장소·코드 모두 비어 픽업 (장소, 코드) 쌍을 상속
    const d1 = buildDayView(t, NONE, 1);
    expect(d1.carReturns).toHaveLength(1);
    expect(d1.carReturns[0].placeLabel).toBe('제주공항점 (CJU)');
    expect(d1.carReturns[0].subLabel).toBe('렌터카 반납 · 18:00 · 예약');
  });

  it('반납 장소만 넣으면 픽업 공항코드를 물려받지 않는다 — (장소, 코드)는 한 쌍', () => {
    const t = trip(
      [day([airport()]), day([seongsan()])],
      { bookings: [carBooking({ carReturn: '서귀포점' })] }
    );
    expect(buildDayView(t, NONE, 1).carReturns[0].placeLabel).toBe('서귀포점');   // '서귀포점 (CJU)' 금지
  });

  it('픽업일의 독립 행은 장소 목록 앞(carPickups)으로 온다', () => {
    const t = trip([day([airport()])], { bookings: [carBooking()] });
    const v = buildDayView(t, NONE, 0);
    expect(v.carPickups).toHaveLength(1);
    expect(v.carPickups[0].placeLabel).toBe('제주공항점 (CJU)');
    expect(v.carReturns).toHaveLength(0);   // 반납일은 다음 날
  });
});

describe('비용 — 하루치(배분)와 전액을 구분한다', () => {
  const stayBooking: Booking = {
    id: 'h1', type: 'hotel', title: '호텔 2박', price: 200000, track: true,
    start: '2026-10-01', end: '2026-10-03'
  } as Booking;

  it('숙박 하루치는 [체크인, 체크아웃) — 체크아웃 날엔 숙박비가 없다', () => {
    const t = trip(
      [day([{ ...airport(), cost: 30000 }]), day([seongsan()]), day([hotel()])],
      { bookings: [stayBooking] }
    );
    expect(buildDayView(t, NONE, 0).cost).toEqual({
      total: 130000,
      parts: [{ label: '장소', amount: 30000 }, { label: '예약', amount: 100000 }]
    });
    expect(buildDayView(t, NONE, 1).cost.parts).toEqual([{ label: '예약', amount: 100000 }]);
    expect(buildDayView(t, NONE, 2).cost.parts).toEqual([]);   // 체크아웃
  });

  it('비KRW 장소 비용은 환산되고 원본·환산이 함께 표시된다 (폴백 환율)', () => {
    const t = trip([day([{ ...airport(), cost: 100, cur: 'USD' }])]);
    const v = buildDayView(t, NONE, 0);
    expect(v.spots[0].cost).toEqual({ label: '💳 $100', converted: '약 ₩138,000', title: '$100 ≈ ₩138,000' });
    expect(v.cost.parts).toEqual([{ label: '장소', amount: 138000 }]);
  });

  it('전체 비용은 예약 전액 — 기간이 일정 밖으로 나가면 하루치 합계보다 크다', () => {
    const outside: Booking = { ...stayBooking, end: '2026-10-06' };   // 5박, 여행은 2일
    const t = trip([day([airport()]), day([seongsan()])], { bookings: [outside] });
    const total = tripCostBreakdownOf(t, NONE);
    expect(total.hotel).toBe(200000);
    const dayShares = [0, 1].map(di => buildDayView(t, NONE, di).cost.total).reduce((a, x) => a + x, 0);
    expect(dayShares).toBe(80000);   // 5박 중 2박치만 일정 안
    expect(total.total).toBeGreaterThan(dayShares);
  });

  it('자차일 택시비는 모든 구간이 캐시됐을 때만 하루 비용에 들어간다', () => {
    const a = airport(), b = seongsan();
    const t = trip([day([a, b])]);
    const key = legKey({ lat: a.lat!, lng: a.lng! }, { lat: b.lat!, lng: b.lng! }, 'car');
    expect(buildDayView(t, NONE, 0).cost.parts).toEqual([]);   // 캐시 없음 — 부분 합계 금지
    const v = buildDayView(t, { [key]: { sec: 3600, m: 40000, taxi: 45000 } }, 0);
    expect(v.cost.parts).toEqual([{ label: '택시', amount: 45000 }]);
    expect(v.routeLabel).toBe('📏 하루 동선 약 40.0km · 🚗1시간 · 🚕약 45,000원 (도로 기준)');
  });
});

describe('하루의 끝 — 숙소 복귀·과밀 경고', () => {
  it('마지막 장소가 숙소가 아니면 숙소 복귀 자동 구간이 붙는다', () => {
    const t = trip([day([hotel(), seongsan()])]);
    const v = buildDayView(t, NONE, 0);
    expect(v.back?.name).toBe('제주호텔');
    expect(v.back?.leg.label).toMatch(/^↳/);
  });

  it('이미 숙소로 끝나면 복귀 구간이 없다', () => {
    const t = trip([day([seongsan(), hotel()])]);
    expect(buildDayView(t, NONE, 0).back).toBeNull();
  });

  it('예상 종료가 22시를 넘으면 과밀 경고, 24시를 넘으면 (익일)', () => {
    const t = trip([day([{ ...airport(), stayMin: 900 }])]);   // 09:00 + 15시간 = 24:00
    expect(buildDayView(t, NONE, 0).overloadLabel).toBe('⚠️ 일정 과밀 — 예상 종료 00:00 (익일)');
    expect(buildDayView(trip([day([airport()])]), NONE, 0).overloadLabel).toBeNull();
  });
});

describe('그 외 표시 배선', () => {
  it('isoDateOf/dateLabelOf — 시작일 기준 증가, 미지정이면 빈 문자열', () => {
    const t = trip([day([]), day([]), day([])]);
    expect(isoDateOf(t, 2)).toBe('2026-10-03');
    expect(dateLabelOf(t, 2)).toBe('10/3 (토)');
    const noStart = trip([day([])], { start: '' });
    expect(isoDateOf(noStart, 0)).toBe('');
    expect(buildDayView(noStart, NONE, 0).cost.parts).toEqual([]);   // 날짜 없음 → 예약 배분 없음
  });

  it('영업시간 밖 도착이면 🚫 경고 (2026-10-01은 목요일)', () => {
    const hours = [{ d: 4, o: 600, c: 1080 }];   // 목 10:00–18:00, 도착 예상 09:00
    const v = buildDayView(trip([day([{ ...airport(), hours }])]), NONE, 0);
    expect(v.spots[0].hoursWarn).toContain('목요일');
    const open = buildDayView(trip([day([{ ...airport(), hours, at: '11:00' }])]), NONE, 0);
    expect(open.spots[0].hoursWarn).toBeNull();
  });

  it('좌표 없는 장소 — 위치 미지정 표시, 구간·동선에서 제외되고 ETA 흐름은 유지', () => {
    const t = trip([day([airport(), spot('미정 식당', null, null), seongsan()])]);
    const v = buildDayView(t, NONE, 0);
    expect(v.spots[1].noLoc).toBe(true);
    expect(v.spots[1].leg).toBeNull();
    expect(v.spots[2].leg).not.toBeNull();   // 공항→성산으로 이어짐
  });

  // 환율은 하루 한 번 바뀐다. 뷰가 환율을 **인자로** 받지 않으면(모듈 전역에서 몰래 읽으면)
  // 환율이 갱신돼도 호출측 memo가 그 사실을 몰라 옛 환산액이 화면에 남는다.
  it('환율이 바뀌면 환산액도 바뀐다 — 환율은 뷰의 입력이다', () => {
    const t = trip([day([spot('파리 식당', 48.86, 2.35, { cost: 100, cur: 'EUR' })])]);
    const a = buildDayView(t, NONE, 0, { KRW: 1, EUR: 1500 });
    const b = buildDayView(t, NONE, 0, { KRW: 1, EUR: 1600 });
    expect(a.spots[0].cost?.converted).toBe('약 ₩150,000');
    expect(b.spots[0].cost?.converted).toBe('약 ₩160,000');
    // 원본 표기는 환율과 무관하다
    expect(a.spots[0].cost?.label).toBe(b.spots[0].cost?.label);
  });

  it('전체 비용도 환율을 인자로 받는다', () => {
    const t = trip([day([spot('파리 식당', 48.86, 2.35, { cost: 100, cur: 'EUR' })])], {
      bookings: [{ id: 'b1', type: 'hotel', title: '파리 호텔', price: 200, cur: 'EUR', track: true,
        start: '2026-10-01', end: '2026-10-02' }] as Booking[]
    });
    expect(tripCostBreakdownOf(t, NONE, { KRW: 1, EUR: 1500 }).total).toBe(100 * 1500 + 200 * 1500);
    expect(tripCostBreakdownOf(t, NONE, { KRW: 1, EUR: 1600 }).total).toBe(100 * 1600 + 200 * 1600);
  });

  it('모르는 통화는 1:1로 눕힌다 — 환산 못 해도 금액은 보여준다', () => {
    const t = trip([day([spot('런던 펍', 51.5, -0.12, { cost: 50, cur: 'GBP' as 'USD' })])]);
    const v = buildDayView(t, NONE, 0, { KRW: 1, EUR: 1500 });
    expect(v.spots[0].cost?.label).toBe('💳 ₩50');     // 기호를 모르면 원화 표기로 폴백
    expect(v.spots[0].cost?.converted).toBeNull();
  });

  // 사용자 제보: 숙소 금액이 일정 카드와 예약 추적 양쪽에 잡혀 예산이 두 배로 보였다.
  // 예약 편집기에서 장소를 고르면 spot.bookingId가 걸리므로, 연결된 둘은 같은 숙박이다.
  describe('숙박비 이중 계산', () => {
    const hotelBooking = (over: Partial<Booking> = {}): Booking => ({
      id: 'b1', type: 'hotel', title: '제주호텔', price: 200000, track: true,
      start: '2026-10-01', end: '2026-10-02', ...over
    } as Booking);

    const linked = (cost?: number) => trip(
      [day([hotel(cost != null ? { bookingId: 'b1', cost } : { bookingId: 'b1' })])],
      { bookings: [hotelBooking()] }
    );

    it('연결된 숙박은 일정 카드 금액만 센다 — 예약 금액을 더하지 않는다', () => {
      const t = linked(180000);
      expect(tripCostBreakdownOf(t, NONE).spots).toBe(180000);
      expect(tripCostBreakdownOf(t, NONE).hotel).toBe(0);
      expect(tripCostBreakdownOf(t, NONE).total).toBe(180000);   // 380000이 아니다
    });

    it('하루 비용에서도 두 번 잡히지 않는다', () => {
      const v = buildDayView(linked(180000), NONE, 0);
      expect(v.cost.total).toBe(180000);
      expect(v.cost.parts.map(p => p.label)).toEqual(['장소']);   // '예약' 몫이 없다
    });

    it('장소에 비용을 안 적었으면 예약 금액을 쓴다 — 돈이 사라지지 않게', () => {
      const t = linked();
      expect(tripCostBreakdownOf(t, NONE).hotel).toBe(200000);
      expect(tripCostBreakdownOf(t, NONE).total).toBe(200000);
      const v = buildDayView(t, NONE, 0);
      expect(v.cost.parts.map(p => p.label)).toEqual(['예약']);
    });

    it('연결 안 된 예약은 그대로 센다 — 일정에 대응하는 장소가 없다', () => {
      const t = trip([day([hotel({ cost: 180000 })])], { bookings: [hotelBooking()] });
      expect(tripCostBreakdownOf(t, NONE).spots).toBe(180000);
      expect(tripCostBreakdownOf(t, NONE).hotel).toBe(200000);
    });

    it('렌터카·항공은 영향받지 않는다', () => {
      const t = trip([day([hotel({ bookingId: 'b1', cost: 180000 })])], {
        bookings: [hotelBooking(), {
          id: 'b2', type: 'car', title: '렌터카', price: 90000, track: true,
          start: '2026-10-01', end: '2026-10-02'
        } as Booking]
      });
      const c = tripCostBreakdownOf(t, NONE);
      expect(c.hotel).toBe(0);
      expect(c.car).toBe(90000);
      expect(c.total).toBe(180000 + 90000);
    });
  });

  it('숙소 연박·항공편·빈 일자 표기', () => {
    const t = trip([day([hotel({ nights: 2 })], { flight: { code: 'KE1234', dep: 'GMP', arr: 'CJU', depAt: '07:30', arrAt: '08:40' } })]);
    const v = buildDayView(t, NONE, 0);
    // stay 플래그로 카테고리 아이콘이 이미 🏠 — 아이콘이 못 전달하는 연박 수만 라벨로 남는다
    expect(v.spots[0].catIcon).toBe('🏠');
    expect(v.spots[0].stayLabel).toBe('2박');
    expect(v.flightLabel).toBe('✈️ KE1234 · GMP 07:30 → CJU 08:40');
    expect(buildDayView(trip([day([])]), NONE, 0).spots).toHaveLength(0);
  });
});
