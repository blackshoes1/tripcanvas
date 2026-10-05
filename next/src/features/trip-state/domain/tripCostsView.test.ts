import { expect, it } from 'vitest';
import path from 'node:path';
import { writeFixture } from './parityFiles';

import { tripCostBreakdownOf } from '@/features/itinerary/domain/dayView';
import type { Trip } from '@/features/trip/domain/types';
import { buildTripCosts } from './tripCostsView';
import type { TripDoc } from './todayView';

// 앱 비용 화면(`/costs`)과 웹 필터바는 같은 총액을 말해야 한다. 연박이 일정 밖으로 넘치면 그 밤의 몫은
// 어느 날에도 없는데, 2026-10-02 전에는 그 몫이 앱 총액에서만 사라졌다(웹은 장소 비용 전액을 센다).
const place = (name: string, extra: Record<string, unknown> = {}) => ({ name, city: '', desc: '', lat: null, lng: null, ...extra });
const doc = {
  id: 't1', name: '넘치는 연박', start: '2026-10-01', days: [
    { title: '', drive: '', note: '', mode: 'walk', spots: [place('점심', { cost: 12000 })] },
    { title: '', drive: '', note: '', mode: 'walk', spots: [place('호텔', { stay: true, nights: 3, cost: 300000 })] }
  ]
};

it('연박이 일정 밖으로 넘쳐도 앱 비용 화면의 총액이 웹 필터바(전액)와 같다', () => {
  const body = buildTripCosts(doc as unknown as TripDoc, {}, 1);
  expect(body.totalKRW).toBe(12000 + 300000);
  expect(body.totalKRW).toBe(tripCostBreakdownOf(doc as unknown as Trip, {}).total);
  expect(body.prep.totalKRW + body.onSite.totalKRW).toBe(body.totalKRW);
  expect(body.onSite.totalKRW).toBe(12000 + 300000);
});

it('일자 줄은 하루치 그대로이고, 넘친 밤은 날짜 없는 STAY 줄 하나로 실린다', () => {
  const body = buildTripCosts(doc as unknown as TripDoc, {}, 1);
  expect(body.days.map(d => d.cost.total)).toEqual([12000, 100000]);
  expect(body.unallocated).toMatchObject([{ source: 'STAY', key: '1.0', kind: 'STAY', amount: 200000, totalKRW: 200000, dayIndex: null }]);
  expect(body.categories.find(c => c.kind === 'STAY')?.totalKRW).toBe(300000);
});

it('예약·결제 금액은 날짜가 있으면 일정에도 보이고 전체에는 한 번만 잡힌다', () => {
  const trip = { id: 't1', name: '예약 연결', start: '2026-10-01', bookings: [
    { id: 'flight', type: 'flight', title: '항공', price: 90000, start: '2026-10-01', end: '2026-10-02' }
  ], costItems: [
    { id: 'ticket', title: '입장권', kind: 'TICKET', amount: 30000, scheduledOn: '2026-10-02' }
  ], days: [{ mode: 'walk', spots: [] }, { mode: 'walk', spots: [] }] };
  const body = buildTripCosts(trip as unknown as TripDoc, {}, 1);
  expect(body.days.map(d => d.cost.total)).toEqual([90000, 30000]);
  expect(body.totalKRW).toBe(120000);
  expect(body.prep.totalKRW).toBe(120000);
  expect(body.onSite.totalKRW).toBe(0);
  expect(body.overview.items.filter(r => r.line.key === 'ticket')).toHaveLength(1);
});

// 비용 입력 정리 C-1(2026-10-05): 여행 총예산은 예약과 현지 지출을 모두 센 전체 비용에서 뺀다 — 웹 필터바와 같은 함수(`tripBudgetStatus`).
it('총예산이 있으면 남은 예산을 싣고, 없으면 null이다', () => {
  const withBudget = { ...doc, budget: { amount: 400000 } };
  const body = buildTripCosts(withBudget as unknown as TripDoc, {}, 1);
  expect(body.budget).toEqual({ amount: 400000, currency: 'KRW', totalKRW: 400000, costKRW: body.totalKRW,
    remainingKRW: 400000 - body.totalKRW, perDayKRW: 200000 });
  expect(buildTripCosts(doc as unknown as TripDoc, {}, 1).budget).toBeNull();
});

it('전체 목록은 예약·연박 전액 한 줄과 원본 편집 대상을 싣고 기존 합계와 같다', () => {
  const trip = { id: 't1', name: '전체', start: '2026-10-01', bookings: [
    { id: 'hotel', type: 'hotel', title: '호텔 예약', price: 300, cur: 'EUR', start: '2026-10-01', end: '2026-10-04' },
    { id: 'flight', type: 'flight', title: '항공 금액 미정', price: 0 }
  ], costItems: [{ id: 'sim', title: '유심', amount: 10000 }], days: [
    { spots: [place('호텔', { stay: true, nights: 3, bookingId: 'hotel', cost: 999 }),
      place('예약한 미술관', { cost: 15, cur: 'EUR', admission: { source: 'USER', personalStatus: 'BOOKED' } }),
      place('무료 공원', { cost: 0 }), place('일부 식비', { cost: 20000, costPartial: true })],
      costItems: [{ id: 'bus', title: '버스', amount: 5000 }], mode: 'walk' },
    { spots: [place('별도 연박', { stay: true, nights: 3, cost: 30000 })], mode: 'walk' }
  ] };
  const body = buildTripCosts(trip as unknown as TripDoc, {}, 1);
  const rows = body.overview.items;
  expect(rows.filter(r => r.bookingId === 'hotel')).toHaveLength(1);
  expect(rows.find(r => r.id === 'BOOKING:hotel')).toMatchObject({ amountSource: 'BOOKING', line: { amount: 300, kind: 'STAY' } });
  expect(rows.find(r => r.id === 'BOOKING:flight')).toMatchObject({ line: { state: 'UNKNOWN', amount: null } });
  expect(rows.find(r => r.line.title === '별도 연박')).toMatchObject({ spotIndex: 0, line: { dayIndex: 1, amount: 30000, totalKRW: 30000 } });
  expect(rows.find(r => r.line.title === '예약한 미술관')).toMatchObject({ reservation: 'BOOKED', line: { source: 'SPOT' } });
  expect(rows.find(r => r.line.title === '무료 공원')?.line.state).toBe('FREE');
  expect(rows.find(r => r.line.title === '일부 식비')?.line.state).toBe('PARTIAL');
  expect(rows.some(r => r.line.key === 'bus' && r.line.source === 'EXTRA')).toBe(true);
  expect(rows.some(r => r.line.key === 'sim' && r.line.source === 'TRIP')).toBe(true);
  expect(body.overview.unknownCount).toBe(2);
  expect(rows.reduce((sum, r) => sum + (r.line.totalKRW ?? 0), 0)).toBe(body.totalKRW);
  // 기존 Next 일정 요약은 여행 단위 비용을 제외한다. 비용 응답에는 유심도 포함된다.
  expect(body.totalKRW).toBe(tripCostBreakdownOf(trip as unknown as Trip, {}).total + 10000);
  writeFixture(path.join(__dirname, '../../../../../ios/TripCanvasTests/Fixtures/cost-overview.json'),
    JSON.stringify({ document: { ...trip, budget: { amount: 700000 } }, costs: buildTripCosts({ ...trip, budget: { amount: 700000 } } as unknown as TripDoc, {}, 1) }, null, 2) + '\n');
});

it('예약 금액 미정이면 연결 장소 금액을 한 줄로 쓰고 편집 대상은 장소를 가리킨다', () => {
  const trip = { id: 't1', name: '폴백', start: '2026-10-01', bookings: [
    { id: 'hotel', type: 'hotel', title: '호텔 예약', price: 0, start: '2026-10-01', end: '2026-10-04' }
  ], days: [{ mode: 'walk', spots: [place('호텔', { stay: true, nights: 3, bookingId: 'hotel', cost: 300, cur: 'EUR' })] }] };
  const body = buildTripCosts(trip as unknown as TripDoc, {}, 1);
  expect(body.overview.items).toHaveLength(1);
  expect(body.overview.items[0]).toMatchObject({ id: 'BOOKING:hotel', bookingId: 'hotel', spotIndex: 0,
    amountSource: 'PLACE', reservation: 'LINKED', line: { source: 'SPOT', amount: 300, dayIndex: 0 } });
  expect(body.overview.items[0].line.totalKRW).toBe(body.totalKRW);
  const unknownTrip = { ...trip, days: [{ ...trip.days[0], spots: [place('호텔', { stay: true, nights: 3, bookingId: 'hotel' })] }] };
  const unknown = buildTripCosts(unknownTrip as unknown as TripDoc, {}, 1);
  expect(unknown.overview.items).toHaveLength(1);
  expect(unknown.overview.items[0].line.state).toBe('UNKNOWN');
});
