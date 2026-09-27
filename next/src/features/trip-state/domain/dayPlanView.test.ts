// buildDayPlanView — 계약이 **값**을 싣는지, 그리고 그 값이 웹과 같은 규칙에서 나오는지.
//
// 여기서 지키는 것 셋:
//   1. 라벨이 아니라 값이다 — 앱이 서버가 만든 한국어를 그리지 않는다
//   2. 이동시간이 추정이면 추정이라고 말한다(travelTimeSource)
//   3. 배선 실수가 잦은 곳(anchor/carry · 마지막 날 복귀 · 렌터카 연결)이 계약에도 그대로 반영된다
import { describe, expect, it } from 'vitest';

import lib from '@legacy/lib.js';

import type { Booking } from '@/features/booking/domain/types';
import type { Day, Spot, Trip } from '@/features/trip/domain/types';

import type { LegCache } from '@/features/itinerary/domain/types';

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
  todayIndex: -1, daysUntilStart: 12, role: 'OWNER', memberCount: 1
};

const build = (t: Trip, di: number, legCache?: LegCache) =>
  buildDayPlanView({ trip: t, di, summary, generatedAt: '2026-09-06T00:00:00Z', legCache });

describe('buildDayPlanView', () => {
  it('숙박은 체크아웃까지 표시하고 동선 앵커의 이월과 분리한다', () => {
    const t = trip([day([hotel({ nights: 2 })]), day([]), day([]), day([])]);
    expect(build(t, 0)!.day.lodging[0]).toMatchObject({ state: 'CHECK_IN', night: 1, nights: 2 });
    expect(build(t, 1)!.day.lodging[0]).toMatchObject({ state: 'STAY', night: 2, nights: 2 });
    expect(build(t, 2)!.day.lodging[0]).toMatchObject({ state: 'CHECK_OUT', night: null });
    expect(build(t, 3)!.day.lodging).toEqual([]);
  });

  it('복귀 전용 수단은 복귀 구간과 하루 합계에만 반영한다', () => {
    const base = trip([day([hotel(), seongsan()]), day([])]);
    const before = build(base, 0)!;
    const walking = build(trip([day([hotel(), seongsan()], {returnMode: 'walk'}), day([])]), 0)!;
    expect(walking.day.back!.leg.mode).toBe('walk');
    expect(walking.day.spots[1].incomingLeg).toEqual(before.day.spots[1].incomingLeg);
    expect(walking.day.back!.leg.minutes).toBeGreaterThan(before.day.back!.leg.minutes);
    expect(walking.day.totals.travelMinutes).toBeGreaterThan(before.day.totals.travelMinutes);
    expect(walking.day.totals.endMinutes!).toBeGreaterThan(before.day.totals.endMinutes!);
    expect(build(trip([day([hotel(), seongsan()], {returnMode: 'walk'})]), 0)!.day.back).toBeNull();
  });

  it('없는 일자는 null이다 — 지어내지 않는다', () => {
    const t = trip([day([airport()])]);
    expect(build(t, 1)).toBeNull();
    expect(build(t, -1)).toBeNull();
    expect(build(t, 1.5)).toBeNull();
  });

  // 앱이 `start + index`로 날짜를 더하면 규칙이 두 곳이 된다 — 서버가 정한 것을 그대로 준다.
  it('일자 스트립에 모든 날의 날짜를 함께 싣는다', () => {
    const t = trip([day([airport()]), day([seongsan()]), day([])]);
    const v = build(t, 1)!;
    expect(v.days.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(v.days.map((d) => d.spotCount)).toEqual([1, 1, 0]);
    expect(v.days).toHaveLength(v.dayCount);
  });

  it('시작일이 없으면 날짜 칸은 비어 있다 — 오늘로부터 지어내지 않는다', () => {
    const t = trip([day([airport()]), day([])], { start: '' });
    expect(build(t, 0)!.days.every((d) => d.date === '')).toBe(true);
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

  it.each([[0, null], [5, null], [5.1, 5], [60, 60]])('예약 지연 %s분은 기존 웹 경고 기준으로 값만 전달한다', (delay, expected) => {
    const t = trip([day([
      spot('첫 장소', null, null, { stayMin: 60 + delay! }),
      spot('예약', null, null, { bookAt: '10:00' }), spot('예약 없음', null, null)
    ], { startAt: '09:00' })]);
    const v = build(t, 0)!;
    expect(v.day.spots[1].bookingLateMinutes).toBe(expected);
    expect(v.day.spots[1].conflict).toBe(false); // at 충돌과 예약 지연은 다른 필드다.
    expect(v.day.spots[2].bookingLateMinutes).toBeNull();
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

  it('하루 예산과 소수 외화·미정의 근거를 API에 함께 싣는다', () => {
    const t = trip([day([
      spot('입장', null, null, { cost: 12.55, cur: 'EUR', costBasis: 'PER_PERSON', costPeople: 2 }),
      spot('무료', null, null, { cost: 0 }), spot('식사', null, null)
    ], { budget: { amount: 0, cur: 'KRW' }, costItems: [{ id: 'bus', title: '버스', kind: 'TRANSPORT', amount: 2.5, cur: 'USD' }] })]);
    const cost = build(t, 0)!.day.totals.cost;
    expect(cost.total).toBe(12.55 * 2 * 1500 + 2.5 * 1380);
    expect(cost.details?.budget?.differenceKRW).toBe(-cost.total);
    expect(cost.details?.unknownCount).toBe(1);
    expect(cost.details?.items.map(item => item.state)).toEqual(['KNOWN', 'FREE', 'UNKNOWN', 'KNOWN']);
    expect(cost.details?.items[0].amount).toBe(12.55);
    expect(cost.details?.fxSource).toBe('FALLBACK');
    expect(cost.details?.fxAsOf).toBeNull();
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

  // ⚠️ 위 테스트는 **정수를 먹여서** 정수가 나오는지만 본다. 정규화를 지나지 않은 문서가
  //    서버에 들어오면 소수가 그대로 나갈 수 있고, 그때 Swift의 `Int` 디코딩이 응답 전체를
  //    실패시켜 일정 화면이 통째로 빈다 — 앱 빌드까지 아무도 모른다. 그래서 소수를 직접 먹인다.
  it("정규화를 안 지난 소수가 들어와도 '분'은 정수로 나간다", () => {
    const t = trip([day([
      airport(),
      spot('식당', 33.49, 126.53, { stayMin: 90.4 } as Partial<Spot>),
      spot('전망대', 33.48, 126.52, { stayMin: 45.6 } as Partial<Spot>)
    ]), day([])]);
    const v = build(t, 0)!;

    const stays = v.day.spots
      .map((s) => s.stayMinutes)
      .filter((n): n is number => typeof n === 'number');

    expect(stays.length).toBe(2);
    for (const m of stays) expect(Number.isInteger(m), `정수가 아닌 체류 분: ${m}`).toBe(true);
    expect(stays).toEqual([90, 46]);
  });

  // 함께 움직이지 않는 시간(§25~§27). 가르는 규칙은 lib의 splitSegments 하나다 —
  // 타임라인도 같은 함수로 가르므로 여기서 따로 가르면 그림과 시각이 어긋난다.
  it('분리가 없으면 splits는 비어 있다 — 하루가 예전과 완전히 같다', () => {
    const v = build(trip([day([airport(), seongsan()]), day([])]), 0)!;
    expect(v.day.splits).toEqual([]);
    expect(v.day.spots.every((s) => s.participants.length === 0)).toBe(true);
    expect(v.day.spots.every((s) => s.reunion === false)).toBe(true);
  });

  it('참여자가 갈리면 가지로 묶고, 합류 지점을 표시한다', () => {
    const t = trip([day([
      spot('아침', 33.51, 126.49),
      spot('미술관', 33.50, 126.50, { split: 's1', who: ['u1'] }),
      spot('카페', 33.49, 126.51, { split: 's1', who: ['u1'] }),
      spot('시장', 33.48, 126.52, { split: 's1', who: ['u2'] }),
      spot('저녁', 33.47, 126.53, { reunion: true })
    ]), day([])]);
    const v = build(t, 0)!;

    expect(v.day.splits).toHaveLength(1);
    const [seg] = v.day.splits;
    expect([seg.from, seg.to]).toEqual([1, 4]);
    expect(seg.branches.map((b) => b.participants)).toEqual([['u1'], ['u2']]);
    expect(seg.branches.map((b) => b.spotIndexes)).toEqual([[1, 2], [3]]);

    // 참여자가 없는 장소는 '모두'다 — 기본값이라 저장되지 않는다
    expect(v.day.spots[0].participants).toEqual([]);
    expect(v.day.spots[1].participants).toEqual(['u1']);
    expect(v.day.spots[4].reunion).toBe(true);
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

// ── 구간 캐시 (서버가 실제 경로를 조회해 둔 뒤) ──
// 여기서 지키는 것: **조회된 것만 도로라고 말한다.** 하나라도 추정이면 맨 위는 추정이다.
describe('buildDayPlanView — 구간 캐시', () => {
  const key = (a: Spot, b: Spot, mode = 'car') =>
    lib.legKey({ lat: Number(a.lat), lng: Number(a.lng) }, { lat: Number(b.lat), lng: Number(b.lng) }, mode);

  it('조회된 구간은 도로 시간·도로 거리·경로를 그대로 싣는다', () => {
    const t = trip([day([airport(), seongsan()]), day([])]);
    const cache: LegCache = { [key(airport(), seongsan())]: { sec: 3600, m: 52_300, path: 'encoded' } };
    const leg = build(t, 0, cache)!.day.spots[1].incomingLeg!;
    expect(leg.source).toBe('ROUTED');
    expect(leg.minutes).toBe(60);
    expect(leg.distanceKm).toBe(52.3);
    expect(leg.path).toBe('encoded');
  });

  it('조회되지 않은 구간은 예전 그대로다 — 직선 추정이고 경로는 null이다', () => {
    const t = trip([day([airport(), seongsan()]), day([])]);
    const withCache = build(t, 0, {})!.day.spots[1].incomingLeg!;
    const without = build(t, 0)!.day.spots[1].incomingLeg!;
    expect(withCache).toEqual(without);
    expect(without.path).toBeNull();
    expect(without.source).toBe('STRAIGHT_LINE_ESTIMATE');
  });

  it('실패로 남은 구간은 조회된 것이 아니다 — 없는 경로를 그리게 두지 않는다', () => {
    const t = trip([day([airport(), seongsan()]), day([])]);
    const cache: LegCache = { [key(airport(), seongsan())]: { fail: true } };
    const leg = build(t, 0, cache)!.day.spots[1].incomingLeg!;
    expect(leg.source).toBe('STRAIGHT_LINE_ESTIMATE');
    expect(leg.path).toBeNull();
  });

  it('하나라도 추정이면 맨 위는 추정이라고 말한다', () => {
    const t = trip([day([airport(), seongsan(), hotel()]), day([])]);
    const partial: LegCache = { [key(airport(), seongsan())]: { sec: 3600, m: 52_300, path: 'a' } };
    expect(build(t, 0, partial)!.travelTimeSource).toBe('STRAIGHT_LINE_ESTIMATE');
  });

  it('숙소 복귀까지 전부 조회됐을 때만 ROUTED다', () => {
    // 마지막 날에는 복귀가 없으므로(#152) 이틀을 두고 첫날을 본다
    const t = trip([day([hotel(), airport(), seongsan()]), day([seongsan()])]);
    const full: LegCache = {
      [key(hotel(), airport())]: { sec: 600, m: 5_000, path: 'a' },
      [key(airport(), seongsan())]: { sec: 3600, m: 52_300, path: 'b' },
      [key(seongsan(), hotel())]: { sec: 1800, m: 40_000, path: 'c' }
    };
    const v = build(t, 0, full)!;
    expect(v.day.back?.leg.source).toBe('ROUTED');
    expect(v.day.back?.leg.path).toBe('c');
    expect(v.travelTimeSource).toBe('ROUTED');
    // 합계도 도로 값으로 — 97.3km · 100분
    expect(v.day.totals.distanceKm).toBe(97.3);
    expect(v.day.totals.travelMinutes).toBe(100);
  });
});

describe('buildDayPlanView — 항공편', () => {
  it('값만 싣고 문장은 만들지 않는다 — 시각은 자정 기준 분이다', () => {
    const t = trip([day([airport()], { flight: { code: 'KE703', dep: 'ICN', arr: 'NRT', depAt: '09:10', arrAt: '11:45' } } as Partial<Day>)]);
    expect(build(t, 0)?.day.flight).toEqual({ code: 'KE703', dep: 'ICN', arr: 'NRT', depMinutes: 550, arrMinutes: 705 });
  });

  it('적지 않은 시각은 null이고, 적은 것만 싣는다', () => {
    const t = trip([day([airport()], { flight: { code: 'KE703', dep: '', arr: '', depAt: '', arrAt: '' } } as Partial<Day>)]);
    expect(build(t, 0)?.day.flight).toEqual({ code: 'KE703', dep: '', arr: '', depMinutes: null, arrMinutes: null });
  });

  it('항공편이 없는 날은 null이다 — 빈 칸만 든 객체를 보내지 않는다', () => {
    expect(build(trip([day([airport()])]), 0)?.day.flight).toBeNull();
    const empty = trip([day([airport()], { flight: { code: '', dep: '', arr: '' } } as Partial<Day>)]);
    expect(build(empty, 0)?.day.flight).toBeNull();
  });

  /// 좌표가 없으므로 동선·ETA에 끼어들면 안 된다 — 렌터카 픽업·반납과 같은 규칙이다.
  it('동선과 이동시간에 끼어들지 않는다', () => {
    const plain = build(trip([day([airport(), seongsan()])]), 0);
    const withFlight = build(trip([day([airport(), seongsan()], { flight: { code: 'KE703', dep: 'ICN', arr: 'CJU', depAt: '09:10' } } as Partial<Day>)]), 0);
    expect(withFlight?.day.totals.distanceKm).toBe(plain?.day.totals.distanceKm);
    expect(withFlight?.day.totals.travelMinutes).toBe(plain?.day.totals.travelMinutes);
    expect(withFlight?.day.spots.map((s) => s.name)).toEqual(plain?.day.spots.map((s) => s.name));
  });
});
