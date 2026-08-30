import { describe, expect, it } from 'vitest';

import { buildDayView } from '@/features/itinerary/domain/dayView';
import type { LegCache } from '@/features/itinerary/domain/types';
import type { Day, Spot, Trip } from '@/features/trip/domain/types';
import { buildTravelView, currentIndexAt, todayDayIndex } from './travelView';

const NONE: LegCache = {};
const spot = (name: string, lat: number | null, lng: number | null, extra: Partial<Spot> = {}): Spot =>
  ({ name, city: '제주', desc: '', lat, lng, ...extra });
const day = (spots: Spot[], extra: Partial<Day> = {}): Day =>
  ({ title: '', drive: '', note: '', mode: 'car', spots, ...extra });
const trip = (days: Day[], extra: Partial<Trip> = {}): Trip =>
  ({ id: 't1', name: '제주 여행', start: '2026-10-01', days, ...extra });

const airport = () => spot('제주공항', 33.5104, 126.4914);
const seongsan = () => spot('성산일출봉', 33.4587, 126.9425);
const hotel = (e: Partial<Spot> = {}) => spot('제주호텔', 33.4996, 126.5312, { stay: true, ...e });

const viewOf = (t: Trip, di: number, nowMin: number, today: string) =>
  buildTravelView(t, buildDayView(t, NONE, di), nowMin, today);

describe('currentIndexAt', () => {
  const etas = [540, 660, 780];   // 09:00 / 11:00 / 13:00

  it('지금보다 이르거나 같은 마지막 장소를 짚는다', () => {
    expect(currentIndexAt(etas, 540, true)).toBe(0);
    expect(currentIndexAt(etas, 600, true)).toBe(0);
    expect(currentIndexAt(etas, 660, true)).toBe(1);
    expect(currentIndexAt(etas, 700, true)).toBe(1);
    expect(currentIndexAt(etas, 1200, true)).toBe(2);
  });

  it('첫 장소보다 이르면 첫 장소', () => {
    expect(currentIndexAt(etas, 400, true)).toBe(0);
  });

  it('오늘이 아니면 항상 첫 장소 — 내일 일정을 보는데 마지막을 짚으면 이상하다', () => {
    expect(currentIndexAt(etas, 1200, false)).toBe(0);
    expect(currentIndexAt(etas, 0, false)).toBe(0);
  });

  it('장소가 없으면 0', () => {
    expect(currentIndexAt([], 600, true)).toBe(0);
  });
});

describe('buildTravelView', () => {
  const T = trip([day([airport(), seongsan()], { startAt: '09:00' })]);

  it('제목·부제에 일자와 날짜·이동·메모를 담는다', () => {
    const t = trip([day([airport()], { title: '도착', drive: '✈️ 김포 → 제주', note: '오후 도착' })]);
    const v = viewOf(t, 0, 600, '2026-10-01');
    expect(v.title).toBe('Day 1 · 도착');
    expect(v.subtitle).toContain('10/1');
    expect(v.subtitle).toContain('✈️ 김포 → 제주');
    expect(v.subtitle).toContain('오후 도착');
  });

  it('오늘이면 시각으로 현재 장소를 짚는다', () => {
    const early = viewOf(T, 0, 9 * 60 + 30, '2026-10-01');
    expect(early.isToday).toBe(true);
    expect(early.current?.name).toBe('제주공항');
    const late = viewOf(T, 0, 23 * 60, '2026-10-01');
    expect(late.current?.name).toBe('성산일출봉');
  });

  it('오늘이 아니면 그 날의 시작 장소', () => {
    const v = viewOf(T, 0, 23 * 60, '2026-09-20');
    expect(v.isToday).toBe(false);
    expect(v.current?.name).toBe('제주공항');
  });

  it('현재 장소에 도착 예상·예약·체류를 보여준다', () => {
    const t = trip([day([spot('식당', 33.5, 126.5, { bookAt: '12:00', stayMin: 90 })], { startAt: '11:00' })]);
    const v = viewOf(t, 0, 11 * 60, '2026-10-01');
    expect(v.current?.facts.some(f => f.includes('도착 예상'))).toBe(true);
    expect(v.current?.facts).toContain('예약 12:00');
    expect(v.current?.facts).toContain('체류 90분');
  });

  it('예약이 없으면 없다고 말한다', () => {
    expect(viewOf(T, 0, 600, '2026-10-01').current?.facts).toContain('예약 없음');
  });

  it('다음 장소와 그리로 가는 구간을 보여준다', () => {
    const v = viewOf(T, 0, 9 * 60, '2026-10-01');
    expect(v.next?.name).toBe('성산일출봉');
    expect(v.next?.isBackToStay).toBe(false);
    expect(v.next?.eta).toMatch(/^\d{1,2}:\d{2}$/);
  });

  it('마지막 장소 다음은 숙소 복귀', () => {
    const t = trip([day([hotel(), airport(), seongsan()], { startAt: '09:00' })]);
    const v = viewOf(t, 0, 23 * 60, '2026-10-01');
    expect(v.next?.isBackToStay).toBe(true);
    expect(v.next?.name).toBe('제주호텔');
    expect(v.next?.note).toContain('숙소 복귀');
  });

  it('숙소도 없고 다음도 없으면 오늘 일정 완료', () => {
    const v = viewOf(T, 0, 23 * 60, '2026-10-01');
    expect(v.next).toBeNull();
  });

  it('국내는 카카오맵, 해외는 구글 링크', () => {
    const v = viewOf(T, 0, 600, '2026-10-01');
    expect(v.current?.mapLink?.href).toContain('map.kakao.com');
    const jp = trip([day([spot('도쿄타워', 35.6586, 139.7454)])]);
    expect(viewOf(jp, 0, 600, '2026-10-01').current?.mapLink?.href).toContain('google.com/maps');
  });

  it('좌표가 없으면 길찾기를 걸지 않는다 — 엉뚱한 곳으로 보내지 않게', () => {
    const t = trip([day([spot('미정 식당', null, null)])]);
    expect(viewOf(t, 0, 600, '2026-10-01').current?.mapLink).toBeNull();
  });

  it('장소가 없으면 자유 일정으로 표시한다', () => {
    const v = viewOf(trip([day([])]), 0, 600, '2026-10-01');
    expect(v.empty).toBe(true);
    expect(v.current).toBeNull();
    expect(v.stops).toHaveLength(0);
  });

  it('전날 숙소 이월을 표시한다 (오늘 데이터에 복제하지 않는다)', () => {
    const t = trip([day([hotel()]), day([seongsan()], { startAt: '09:00' })]);
    const v = viewOf(t, 1, 600, '2026-10-02');
    expect(v.carry?.name).toBe('제주호텔');
    expect(v.stops.map(s => s.name)).toEqual(['성산일출봉']);   // 이월은 목록에 섞이지 않는다
  });

  it('ETA는 화면 뷰에서 그대로 가져온다 — 현장에서 보는 시각이 사이드바와 달라지면 안 된다', () => {
    const dv = buildDayView(T, NONE, 0);
    const v = viewOf(T, 0, 600, '2026-10-01');
    expect(v.stops.map(s => s.eta)).toEqual(dv.spots.map(s => s.etaText));
  });
});

describe('todayDayIndex', () => {
  const T = trip([day([]), day([]), day([])], { start: '2026-10-01' });

  it('여행 중이면 그 날', () => {
    expect(todayDayIndex(T, '2026-10-01')).toBe(0);
    expect(todayDayIndex(T, '2026-10-02')).toBe(1);
    expect(todayDayIndex(T, '2026-10-03')).toBe(2);
  });
  it('여행 전이면 첫날, 여행 뒤면 마지막 날', () => {
    expect(todayDayIndex(T, '2026-09-01')).toBe(0);
    expect(todayDayIndex(T, '2026-12-01')).toBe(2);
  });
  it('시작일이 없으면 첫날', () => {
    expect(todayDayIndex(trip([day([])], { start: '' }), '2026-10-01')).toBe(0);
  });
});
