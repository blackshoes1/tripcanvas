// buildDayPlanView — 계약이 **값**을 싣는지, 그리고 그 값이 웹과 같은 규칙에서 나오는지.
//
// 여기서 지키는 것 셋:
//   1. 라벨이 아니라 값이다 — 앱이 서버가 만든 한국어를 그리지 않는다
//   2. 이동시간이 추정이면 추정이라고 말한다(travelTimeSource)
//   3. 배선 실수가 잦은 곳(anchor/carry · 마지막 날 복귀 · 렌터카 연결)이 계약에도 그대로 반영된다
import { describe, expect, it } from 'vitest';

import type { Booking } from '@/features/booking/domain/types';
import type { Day, Spot, Trip } from '@/features/trip/domain/types';

import type { TripSummary } from './contract';
import { buildDayPlanView } from './dayPlanView';

const spot = (name: string, lat: number | null, lng: number | null, extra: Partial<Spot> = {}): Spot =>
  ({ name, city: '제주', desc: '', lat, lng, ...extra });
const day = (spots: Spot[], extra: Partial<Day> = {}): Day =>
  ({ title: '', drive: '', note: '', mode: 'car', spots, ...extra });
const trip = (days: Day[], extra: Partial<Trip> = {}): Trip =>
  ({ id: 't1', name: '테스트 여행', start: '2026-10-01', days, ...extra });

const airport = () => spot('제주공항', 33.5104, 126.4914);
const seongsan = () => spot('성산일출봉', 33.4587, 126.9425);
const hotel = (extra: Partial<Spot> = {}) => spot('제주호텔', 33.4996, 126.5312, { stay: true, ...extra });

const summary: TripSummary = {
  id: 't1', name: '테스트 여행', start: '2026-10-01', dayCount: 2, revision: 3,
  updatedAt: '2026-09-06T00:00:00Z', timeZone: 'Asia/Seoul', cities: ['제주'],
  todayIndex: -1, role: 'OWNER', memberCount: 1
};

const build = (t: Trip, di: number) =>
  buildDayPlanView({ trip: t, di, summary, generatedAt: '2026-09-06T00:00:00Z' });

describe('buildDayPlanView', () => {
  it('없는 일자는 null이다 — 지어내지 않는다', () => {
    const t = trip([day([airport()])]);
    expect(build(t, 1)).toBeNull();
    expect(build(t, -1)).toBeNull();
    expect(build(t, 1.5)).toBeNull();
  });

  it('라벨이 아니라 값을 싣는다 — 앱이 서버가 만든 문장을 그리지 않는다', () => {
    const t = trip([day([airport(), seongsan()]), day([])]);
    const v = build(t, 0)!;
    const leg = v.day.spots[1].incomingLeg!;

    expect(typeof leg.minutes).toBe('number');
    expect(typeof leg.distanceKm).toBe('number');
    expect(leg.distanceKm).toBeGreaterThan(30);       // 공항→성산 직선 약 42km
    // 계약 어디에도 완성된 문장이 없어야 한다
    expect(JSON.stringify(v)).not.toMatch(/📏|하루 동선|약 .*km ·/);
  });

  it('서버에는 구간 캐시가 없다 — 추정임을 말한다', () => {
    const v = build(trip([day([airport(), seongsan()]), day([])]), 0)!;
    expect(v.travelTimeSource).toBe('STRAIGHT_LINE_ESTIMATE');
    expect(v.day.spots[1].incomingLeg!.source).toBe('STRAIGHT_LINE_ESTIMATE');
  });

  it('시각 3종을 구분해 싣는다 — 예상 도착 · 도착 고정 · 상대가 정한 약속', () => {
    const t = trip([day([
      airport(),
      spot('식당', 33.49, 126.53, { at: '12:00' }),
      spot('공연', 33.48, 126.52, { bookAt: '19:00' })
    ]), day([])]);
    const v = build(t, 0)!;

    expect(v.day.spots[0].fixed).toBe(false);                 // 계산된 예상 도착
    expect(v.day.spots[1].fixed).toBe(true);                  // 📌 내가 정한 도착
    expect(v.day.spots[2].bookedAtMinutes).toBe(19 * 60);     // 상대가 정한 약속
    expect(v.day.spots[2].waitMinutes).toBeGreaterThan(0);    // 일찍 도착하면 기다린다
  });

  it('anchor와 carry를 섞지 않는다 — 🏠 표시는 숙소일 때만', () => {
    const carried = trip([day([airport(), hotel()]), day([seongsan()]), day([])]);
    expect(build(carried, 1)!.day.carriedStay?.name).toBe('제주호텔');

    // 전날이 숙소로 끝나지 않으면 이월 표시는 없다(ETA는 그래도 그 지점에서 출발한다)
    const noStay = trip([day([airport(), seongsan()]), day([hotel()]), day([])]);
    expect(build(noStay, 1)!.day.carriedStay).toBeNull();
    expect(build(noStay, 1)!.day.spots[0].incomingLeg).not.toBeNull();
  });

  it('숙소 복귀는 붙지만, 일정의 마지막 날에는 없다', () => {
    const t = trip([day([hotel(), seongsan()]), day([seongsan()])]);
    expect(build(t, 0)!.day.back?.name).toBe('제주호텔');

    // 마지막 날은 돌아가는 날이 아니라 떠나는 날이다
    const last = trip([day([hotel(), seongsan()])]);
    expect(build(last, 0)!.day.back).toBeNull();
  });

  it('좌표 없는 장소는 구간에서 빠지고, 몇 개인지 말한다', () => {
    const t = trip([day([airport(), spot('미정', null, null), seongsan()]), day([])]);
    const v = build(t, 0)!;
    expect(v.day.spotsWithoutLocation).toBe(1);
    expect(v.day.spots[1].incomingLeg).toBeNull();
    expect(v.day.spots[1].location).toBeNull();
    // 좌표 없는 장소를 건너뛰고 이어진다 — 동선이 끊기지 않는다
    expect(v.day.spots[2].incomingLeg).not.toBeNull();
  });

  it('하루 합계는 이동과 비용을 값으로 준다', () => {
    const t = trip([day([airport(), spot('식당', 33.49, 126.53, { cost: 30000, cur: 'KRW' })]), day([])]);
    const v = build(t, 0)!;
    expect(v.day.totals.distanceKm).toBeGreaterThan(0);
    expect(v.day.totals.travelMinutes).toBeGreaterThan(0);
    expect(v.day.totals.endMinutes).not.toBeNull();
    expect(v.day.totals.cost.total).toBe(30000);
    expect(v.day.totals.cost.parts).toEqual([{ label: '장소', amount: 30000 }]);
  });

  // 타임라인은 분을 소수로 들고 있다. 그대로 보내면 Swift가 Int로 디코딩하다 죽는데,
  // 그 사고는 앱 빌드까지 아무도 모른다. 계약 단계에서 잡는다.
  it("'분'은 전부 정수다 — 소수를 보내면 앱이 디코딩에서 죽는다", () => {
    const t = trip([day([
      airport(),
      spot('식당', 33.49, 126.53, { stayMin: 90 }),
      spot('공연', 33.48, 126.52, { bookAt: '19:00' })
    ]), day([])]);
    const v = build(t, 0)!;

    const minutes = [
      v.day.startMinutes, v.day.totals.travelMinutes, v.day.totals.endMinutes,
      ...v.day.spots.flatMap((s) => [s.etaMinutes, s.waitMinutes, s.bookedAtMinutes, s.stayMinutes]),
      ...v.day.spots.map((s) => s.incomingLeg?.minutes),
      v.day.back?.leg.minutes
    ].filter((n): n is number => typeof n === 'number');

    expect(minutes.length).toBeGreaterThan(4);
    for (const m of minutes) expect(Number.isInteger(m), `정수가 아닌 분: ${m}`).toBe(true);
  });

  it('일정의 장소와 연결된 렌터카는 독립 행으로 중복되지 않는다', () => {
    const booking = {
      id: 'b1', type: 'car', title: '렌터카', start: '2026-10-01', end: '2026-10-02',
      amount: 0, cur: 'KRW', carPickup: '제주공항점', carPickupCode: 'CJU', carPickupTime: '10:00',
      carReturnTime: '18:00'
    } as unknown as Booking;

    const linked = trip([day([spot('제주공항', 33.5104, 126.4914, { carPickupId: 'b1' })]), day([])],
                        { bookings: [booking] });
    expect(build(linked, 0)!.day.carPickups).toEqual([]);   // 그 장소 행에 붙는다

    const unlinked = trip([day([airport()]), day([])], { bookings: [booking] });
    const pickups = build(unlinked, 0)!.day.carPickups;
    expect(pickups).toHaveLength(1);
    expect(pickups[0].kind).toBe('PICKUP');
    expect(pickups[0].place).toBe('제주공항점 (CJU)');
    expect(pickups[0].atMinutes).toBe(10 * 60);
  });
});
