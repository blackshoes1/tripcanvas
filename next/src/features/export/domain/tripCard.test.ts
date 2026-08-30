import { describe, expect, it } from 'vitest';

import { buildDayView } from '@/features/itinerary/domain/dayView';
import type { LegCache } from '@/features/itinerary/domain/types';
import type { Booking } from '@/features/booking/domain/types';
import type { Day, Spot, Trip } from '@/features/trip/domain/types';
import { buildTripCard } from './tripCard';

const NONE: LegCache = {};
const color = (di: number) => ['#a', '#b', '#c'][di] ?? '#z';

const spot = (name: string, lat: number | null, lng: number | null, extra: Partial<Spot> = {}): Spot =>
  ({ name, city: '제주', desc: '', lat, lng, ...extra });
const day = (spots: Spot[], extra: Partial<Day> = {}): Day =>
  ({ title: '', drive: '', note: '', mode: 'car', spots, ...extra });
const trip = (days: Day[], extra: Partial<Trip> = {}): Trip =>
  ({ id: 't1', name: '제주 여행', start: '2026-10-01', days, ...extra });

const cardOf = (t: Trip) =>
  buildTripCard(t, t.days.map((_, di) => buildDayView(t, NONE, di)), color);

describe('buildTripCard', () => {
  it('여행 이름과 기간을 머리말로', () => {
    const c = cardOf(trip([day([]), day([])]));
    expect(c.name).toBe('제주 여행');
    expect(c.subtitle).toBe('2026-10-01 출발 · 2일');
  });

  it('시작일이 없으면 날수만', () => {
    expect(cardOf(trip([day([])], { start: '' })).subtitle).toBe('1일');
  });

  it('장소는 순번·이름·도착 예상 시각으로 — 화면과 같은 값', () => {
    const t = trip([day([
      spot('제주공항', 33.5104, 126.4914),
      spot('성산일출봉', 33.4587, 126.9425)
    ], { startAt: '09:00' })]);
    const view = buildDayView(t, NONE, 0);
    const c = cardOf(t);
    expect(c.days[0].lines[0].text).toContain('1.');
    expect(c.days[0].lines[0].text).toContain('제주공항');
    // ETA는 화면 뷰에서 그대로 가져온다 — 다시 계산하면 화면과 어긋난다
    expect(c.days[0].lines[0].time).toBe(view.spots[0].etaText);
    expect(c.days[0].lines[1].time).toBe(view.spots[1].etaText);
  });

  it('선택 코스를 표시한다', () => {
    const c = cardOf(trip([day([spot('감포 바다', 33.5, 126.5, { opt: true })])]));
    expect(c.days[0].lines[0].text).toContain('(선택)');
  });

  it('일자 제목·날짜·이동 메모·메모를 담는다', () => {
    const c = cardOf(trip([day([], { title: '도착', drive: '✈️ 김포 → 제주', note: '오후 도착' })]));
    expect(c.days[0].title).toBe('도착');
    expect(c.days[0].date).toBe('10/1 (목)');
    expect(c.days[0].drive).toBe('✈️ 김포 → 제주');
    expect(c.days[0].note).toBe('오후 도착');
  });

  it('일자 색을 받아 쓴다', () => {
    const c = cardOf(trip([day([]), day([])]));
    expect(c.days.map(d => d.color)).toEqual(['#a', '#b']);
  });

  it('숙소 복귀를 화면과 같은 기준으로 마지막에 붙인다', () => {
    const t = trip([day([
      spot('제주공항', 33.5104, 126.4914),
      spot('제주호텔', 33.4996, 126.5312, { stay: true }),
      spot('성산일출봉', 33.4587, 126.9425)
    ])]);
    const c = cardOf(t);
    const last = c.days[0].lines[c.days[0].lines.length - 1];
    expect(last.kind).toBe('stay');
    expect(last.text).toContain('제주호텔');
    expect(last.text).toContain('숙소 복귀');
  });

  // 당일 대여(픽업일=반납일)는 정상이다 — 같은 날이면 시각이 앞뒤를 가른다
  it('렌터카 픽업은 앞, 반납은 뒤 — 화면 순서 그대로', () => {
    const bookings: Booking[] = [{
      id: 'b1', type: 'car', title: '렌터카', price: 90000, track: true,
      start: '2026-10-01', end: '2026-10-01',
      carPickupPlace: '제주공항점', carPickupCode: 'CJU', carPickupTime: '10:00',
      carReturnPlace: '제주공항점', carReturnCode: 'CJU', carReturnTime: '18:00'
    } as Booking];
    const t = trip([day([spot('성산일출봉', 33.4587, 126.9425)])], { bookings });
    const c = cardOf(t);
    const kinds = c.days[0].lines.map(l => l.kind);
    expect(kinds[0]).toBe('car');                       // 픽업이 맨 앞
    expect(kinds).toContain('spot');
    expect(c.days[0].lines[0].text).toContain('🚗');
    expect(kinds[kinds.length - 1]).toBe('car');        // 반납이 맨 뒤
  });

  it('빈 일자도 카드에 남는다 — 이동일·자유 일정', () => {
    const c = cardOf(trip([day([]), day([spot('A', 33.5, 126.5)])]));
    expect(c.days).toHaveLength(2);
    expect(c.days[0].lines).toHaveLength(0);
  });

  it('카드는 뷰에서만 파생된다 — 여행 일자 수와 카드 일자 수가 같다', () => {
    const t = trip([day([]), day([]), day([])]);
    expect(cardOf(t).days.map(d => d.no)).toEqual([1, 2, 3]);
  });
});
