import { expect, it } from 'vitest';

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

// 비용 입력 정리 C-1(2026-10-05): 여행 총예산은 예약과 현지 지출을 모두 센 전체 비용에서 뺀다 — 웹 필터바와 같은 함수(`tripBudgetStatus`).
it('총예산이 있으면 남은 예산을 싣고, 없으면 null이다', () => {
  const withBudget = { ...doc, budget: { amount: 400000 } };
  const body = buildTripCosts(withBudget as unknown as TripDoc, {}, 1);
  expect(body.budget).toEqual({ amount: 400000, currency: 'KRW', totalKRW: 400000, costKRW: body.totalKRW,
    remainingKRW: 400000 - body.totalKRW, perDayKRW: 200000 });
  expect(buildTripCosts(doc as unknown as TripDoc, {}, 1).budget).toBeNull();
});
