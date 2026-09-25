import { describe, expect, it } from 'vitest';
import lib from '@legacy/lib.js';
import { dayEndMinOf, dayLegs } from '@/features/itinerary/domain/dayView';
import type { LegCache } from '@/features/itinerary/domain/types';
import type { Spot, Trip } from '@/features/trip/domain/types';
import { buildToday, summarizeTrip, type TodayInput } from './todayView';
import { buildTravelState } from './travelState';
import { buildDayPlanView } from './dayPlanView';
import { collectLegRequests } from '@/features/routing/domain/collect';
import { legRequestsFor } from '@/server/routing/legFiller';
import { buildTripRoutes } from './tripRoutesView';
import { buildMapScene } from '@/features/map/domain/scene';

const spot = (name: string, lat: number, extra: Partial<Omit<Spot, 'lat' | 'lng'>> = {}): Spot & { lat: number; lng: number } =>
  ({ name, city: '', desc: '', lat, lng: 127, ...extra });
const tripOf = (spots: Spot[]): Trip => ({
  id: 'journey', name: '여행', start: '2026-09-25', timeZone: 'Asia/Seoul',
  days: [{ title: '', note: '', drive: '', mode: 'car', startAt: '09:00', spots }]
});
const inputOf = (trip: Trip, legCache: LegCache = {}): TodayInput => ({
  tripId: trip.id, trip, revision: 1, updatedAt: '2026-09-25T00:00:00Z',
  todayISO: '2026-09-25', nowMinutes: 540, legCache
});

describe('화면·출발 안내가 같은 구간을 사용한다', () => {
  it('추정 캐시의 수치는 재사용하되 하루·전체 지도 모두 추정으로 표시한다', () => {
    const from = spot('출발', 37);
    const to = spot('도착', 38, { legMode: 'flight' });
    const trip = tripOf([from, to]);
    const cache: LegCache = { [lib.legKey(from, to, 'flight')]: { sec: 600, m: 50000, est: true } };
    const input = inputOf(trip, cache);
    const summary = summarizeTrip({ client_id: trip.id, data: trip, revision: 1, updated_at: input.updatedAt }, input.todayISO);
    const plan = buildDayPlanView({ trip, di: 0, legCache: cache, generatedAt: input.updatedAt, summary })!;
    expect(plan.day.spots[1].incomingLeg).toMatchObject({ minutes: 10, distanceKm: 50, source: 'STRAIGHT_LINE_ESTIMATE' });
    expect(plan.day.routes[0].source).toBe('STRAIGHT_LINE_ESTIMATE');
    expect(buildTripRoutes({ trip, summary, generatedAt: input.updatedAt, legCache: cache }).days[0].legs).toEqual(plan.day.routes);
    expect(plan.travelTimeSource).toBe('STRAIGHT_LINE_ESTIMATE');
  });

  it('기본 자동차일의 도보 구간 캐시를 Today·출발 계획·위젯이 함께 쓴다', () => {
    const from = spot('숙소', 37, { status: 'COMPLETED' });
    const to = spot('예약', 37.045, { legMode: 'walk', bookAt: '12:00', stayMin: 60 });
    const trip = tripOf([from, to]);
    const cache = { [lib.legKey(from, to, 'walk')]: { sec: 5400, m: 6000 } };
    const input = { ...inputOf(trip, cache), currentLocation: { lat: 37, lng: 127 } };
    const today = buildToday(input);
    const state = buildTravelState(input);
    expect(today.nextAction?.travelMinutes).toBe(90);
    expect(state.departure?.travelMinutes).toBe(90);
    expect(state.widget.nextTravelMinutes).toBe(90);
    expect(state.liveActivity.travelMinutes).toBe(90);
  });

  it('현재 위치가 저장 구간과 다르면 직선 추정이고 실제 경로라고 표시하지 않는다', () => {
    const from = spot('숙소', 37, { status: 'COMPLETED' });
    const to = spot('예약', 37.045, { legMode: 'walk', bookAt: '12:00', stayMin: 60 });
    const cache = { [lib.legKey(from, to, 'walk')]: { sec: 5400, m: 6000 } };
    const input = { ...inputOf(tripOf([from, to]), cache), currentLocation: { lat: 37.04, lng: 127 } };
    const state = buildTravelState(input);
    expect(state.today.travelTimeSource).toBe('STRAIGHT_LINE_ESTIMATE');
    expect(state.departure?.travelMinutes).toBe(state.today.nextAction?.travelMinutes);
    expect(state.departure!.travelMinutes).toBeLessThan(90);
  });
});

describe('분리 일정의 하루 합계와 경로', () => {
  it('합성 복귀에는 숙소의 최초 고정시각·예약 대기·체류를 다시 적용하지 않는다', () => {
    const hotel = spot('숙소', 37, { stay: true, at: '09:00', bookAt: '09:30', stayMin: 30 });
    const a = spot('A', 37.1, { stayMin: 60, split: 's1', who: ['a'] });
    const b = spot('B', 37.2, { stayMin: 30, split: 's1', who: ['b'] });
    const journey = lib.computeDayJourney({ startAt: '09:00', spots: [hotel, a, b] }, {
      legMin: () => 10, endAnchor: hotel
    });
    expect(journey.endMinutes).toBe(680);
    expect(journey.timeline).toHaveLength(3);
    expect(journey.legs.filter(l => l.returning)).toHaveLength(2);
  });

  it('모든 가지가 숙소로 돌아오며 캐시가 바뀌어도 조회할 구간 집합은 같다', () => {
    const hotel = spot('숙소', 37, { stay: true });
    const a = spot('A', 37.1, { stayMin: 60, split: 's1', who: ['a'] });
    const b = spot('B', 37.2, { stayMin: 30, split: 's1', who: ['b'] });
    const trip = tripOf([hotel, a, b]);
    trip.days.push({ ...trip.days[0], spots: [], startPolicy: 'none' });
    const cache: LegCache = {
      [lib.legKey(hotel, a, 'car')]: { sec: 600, m: 5000 },
      [lib.legKey(hotel, b, 'car')]: { sec: 600, m: 5000 },
      [lib.legKey(a, hotel, 'car')]: { sec: 300, m: 5000 },
      [lib.legKey(b, hotel, 'car')]: { sec: 7200, m: 50000 }
    };
    const keys = Object.keys(cache).sort();
    expect(dayLegs(trip, 0, cache).map(l => l.key).sort()).toEqual(keys);
    expect(legRequestsFor(trip, 0).map(l => l.key).sort()).toEqual(keys);
    expect(collectLegRequests(trip, cache, Date.now()).map(l => l.base).sort()).toEqual(keys);
    expect(dayEndMinOf(trip, cache, 0)).toBe(700);
    const input = inputOf(trip, cache);
    const summary = summarizeTrip({ client_id: trip.id, data: trip, revision: 1, updated_at: input.updatedAt }, input.todayISO);
    const plan = buildDayPlanView({ trip, di: 0, legCache: cache, generatedAt: input.updatedAt, summary })!;
    expect(plan.day.totals.travelMinutes).toBe(145);
    expect(plan.day.totals.endMinutes).toBe(700);
    expect(plan.day.back?.leg.from).toEqual({ lat: b.lat, lng: b.lng });
    expect(plan.day.routes).toHaveLength(4);
    const scene = buildMapScene(trip, cache, 1);
    expect(scene.lines).toHaveLength(4);
    expect(scene.lines.filter(l => l.dashed)).toHaveLength(2);
    expect(buildTripRoutes({ trip, summary, generatedAt: input.updatedAt, legCache: cache }).days[0].legs).toHaveLength(4);
  });

  it('마지막 배열 항목이 숙소여도 다른 가지의 복귀를 빠뜨리지 않는다', () => {
    const start = spot('출발', 37);
    const a = spot('A', 37.1, { stayMin: 60, split: 's1', who: ['a'] });
    const hotel = spot('숙소', 37.2, { stay: true, split: 's1', who: ['b'] });
    const trip = tripOf([start, a, hotel]);
    trip.days.push({ ...trip.days[0], spots: [], startPolicy: 'none' });
    expect(dayLegs(trip, 0).map(l => [l.from.name, l.to.name])).toEqual([
      ['출발', 'A'], ['출발', '숙소'], ['A', '숙소']
    ]);
  });

  it('좌표 없는 메모를 사이에 두어도 각 가지에서 합류점으로 이동한다', () => {
    const trip = tripOf([
      spot('출발', 37),
      spot('A', 37.1, { stayMin: 60, split: 's1', who: ['a'] }),
      spot('B', 37.2, { stayMin: 30, split: 's1', who: ['b'] }),
      { name: '메모', city: '', desc: '', lat: null, lng: null },
      spot('합류', 37.3)
    ]);
    const expected = [['출발', 'A'], ['출발', 'B'], ['B', '합류'], ['A', '합류']];
    expect(dayLegs(trip, 0).map(l => [l.from.name, l.to.name])).toEqual(expected);
    const keys = dayLegs(trip, 0).map(l => l.key).sort();
    expect(collectLegRequests(trip, {}, Date.now()).map(l => l.base).sort()).toEqual(keys);
    const cache = Object.fromEntries(keys.map(key => [key, { fail: true }]));
    expect(buildMapScene(trip, cache, 1).lines).toHaveLength(4);
  });

  const splitTrip = () => tripOf([
    spot('출발', 37),
    spot('긴 가지', 37.1, { stayMin: 120, split: 's1', who: ['a'] }),
    spot('짧은 가지', 37.2, { stayMin: 30, split: 's1', who: ['b'] })
  ]);

  it('따로 움직이는 가지끼리 이동 구간을 만들지 않는다', () => {
    const trip = splitTrip();
    expect(dayLegs(trip, 0).map(l => [l.from.name, l.to.name])).toEqual([
      ['출발', '긴 가지'], ['출발', '짧은 가지']
    ]);
    const input = inputOf(trip);
    const legCache = { [lib.legKey({ lat: 37, lng: 127 }, { lat: 37.2, lng: 127 }, 'car')]: { sec: 3600, m: 6000, path: 'branch-b' } };
    const plan = buildDayPlanView({ trip, di: 0, legCache, generatedAt: input.updatedAt,
      summary: summarizeTrip({ client_id: trip.id, data: trip, revision: 1, updated_at: input.updatedAt }, input.todayISO) })!;
    expect(plan.day.spots[2].incomingLeg).toMatchObject({ from: { lat: 37, lng: 127 }, minutes: 60, path: 'branch-b' });
  });

  it('마지막 배열 항목이 먼저 끝나도 가장 늦은 가지에서 하루를 끝낸다', () => {
    const trip = splitTrip();
    trip.days[0].spots.forEach(s => { s.lat = 37; });
    expect(dayEndMinOf(trip, {}, 0)).toBe(660);
  });
});
