import { describe, expect, it } from 'vitest';
import adapt from '@legacy/adaptive.js';
import { buildToday, type TodayInput } from './todayView';

const state = (extra = {}) => ({ live: true, currentDay: 0, todayIndex: 0, dayCount: 2, nowMin: 600,
  nextItem: { status: 'PLANNED', location: { lat: 37, lng: 127 } }, items: [],
  currentLocation: { lat: 37, lng: 127 }, ...extra }) as unknown as Parameters<typeof adapt.calmMoment>[0];
const options = { routed: true, needsReplan: false, departure: { leaveMin: 630, level: 'EARLY' } };

describe('calm travel boundaries', () => {
  it('only reassures for known routes and at least 15 minutes before departure', () => {
    expect(adapt.calmMoment(state(), options)).toMatchObject({ state: 'RELAX' });
    expect(adapt.calmMoment(state(), { ...options, departure: { leaveMin: 614, level: 'EARLY' } })).toBeNull();
    expect(adapt.calmMoment(state(), { ...options, departure: { leaveMin: 615, level: 'EARLY' } })).toMatchObject({ state: 'RELAX' });
  });
  it('never presents estimates, missing position or missing destination as an assurance', () => {
    expect(adapt.calmMoment(state(), { ...options, routed: false })).toMatchObject({ state: 'CHECK' });
    expect(adapt.calmMoment(state({ currentLocation: null }), options)).toMatchObject({ state: 'CHECK' });
    expect(adapt.calmMoment(state({ nextItem: { status: 'PLANNED', location: null } }), options)).toMatchObject({ state: 'CHECK' });
  });
  it('stays quiet for pending choices, replans, outside-trip previews and departure time', () => {
    expect(adapt.calmMoment(state({ items: [{ spot: { choice: { state: 'PENDING' } } }] }), options)).toBeNull();
    expect(adapt.calmMoment(state({ live: false }), options)).toBeNull();
    expect(adapt.calmMoment(state(), { ...options, needsReplan: true })).toBeNull();
    expect(adapt.calmMoment(state(), { ...options, departure: { leaveMin: 630, level: 'LATE' } })).toBeNull();
  });
  it('offers tomorrow only after 18:00 on the actual current day and never on the final day', () => {
    expect(adapt.eveningBriefDay(state())).toBeNull();
    expect(adapt.eveningBriefDay(state({ nowMin: 1080 }))).toBe(1);
    for (const extra of [{ live: false }, { currentDay: 1 }, { dayCount: 1 }])
      expect(adapt.eveningBriefDay(state({ nowMin: 1200, ...extra }))).toBeNull();
  });
});

const input: TodayInput = { tripId: 'calm', revision: 4, updatedAt: '', todayISO: '2026-10-16', nowMinutes: 1200,
  generatedAt: '2026-10-16T11:00:00Z', trip: { name: '서울', start: '2026-10-16', timeZone: 'Asia/Seoul',
    days: [{ spots: [] }, { startAt: '09:00', spots: [{ name: '내일 카페', at: '10:00', bookAt: '10:00', lat: 37, lng: 127 }],
      flight: { code: 'TEST', dep: 'ICN', arr: 'NRT', depAt: '13:00', arrAt: '15:00' } }],
    bookings: [{ id: 'hotel', type: 'hotel', title: '내일 체크아웃 숙소', start: '2026-10-15', end: '2026-10-17' }] } };

describe('tomorrow brief projects saved facts', () => {
  it('uses the trip date and keeps checkout and reservation facts without booking numbers', () => {
    const brief = buildToday(input).tomorrowBrief;
    expect(brief).toMatchObject({ dayIndex: 1, date: '2026-10-17', firstPlace: '내일 카페', travelTimeSource: 'STRAIGHT_LINE_ESTIMATE' });
    expect(brief?.checkouts).toContain('내일 체크아웃 숙소');
    expect(brief?.reservations.some(line => line.includes('내일 카페'))).toBe(true);
    expect(JSON.stringify(brief)).not.toContain('confirmation');
  });
  it('does not compute a fictitious next day for undated, upcoming or ended travel', () => {
    expect(buildToday({ ...input, todayISO: '2026-10-18' }).tomorrowBrief).toBeNull();
    expect(buildToday({ ...input, todayISO: '2026-10-15' }).tomorrowBrief).toBeNull();
    expect(buildToday({ ...input, trip: { ...input.trip, start: '' } }).tomorrowBrief).toBeNull();
  });
});
