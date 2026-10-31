import { describe, expect, it } from 'vitest';
import { resolveArrivedActivityId, type ArrivalEvidence } from './arrivalEvidence';
import type { TripDoc } from './todayView';

const trip = (): TripDoc => ({ id: 'early', start: '2026-10-30', timeZone: 'Europe/Madrid',
  days: [{ startAt: '09:00', spots: [{ name: '예약', bookAt: '12:00', stayMin: 60, lat: 40.4, lng: -3.7 }] }] });
const arrival = (): ArrivalEvidence => ({ target: { dayIndex: 0, activityId: 'd0s0', revision: 7 },
  arrived: true, observedAtISO: '2026-10-30T09:30:00Z' });
const resolve = (overrides: Partial<Parameters<typeof resolveArrivedActivityId>[0]> = {}) =>
  resolveArrivedActivityId({ trip: trip(), revision: 7, todayISO: '2026-10-30', nowMinutes: 630,
    arrival: arrival(), ...overrides });

describe('잠금 중 도착 근거의 수명은 해당 일정에 한정한다', () => {
  it('미리 도착한 근거는 예약까지 기다리는 동안 유지한다', () => {
    expect(resolve()).toBe('d0s0');
    expect(resolve({ nowMinutes: 750 })).toBe('d0s0');
  });
  it('예정 종료 뒤에도 실제 머무름의 근거는 남고 exit·리비전 변경·다른 날은 제거한다', () => {
    expect(resolve({ arrival: { ...arrival(), arrived: false } })).toBeNull();
    expect(resolve({ revision: 8 })).toBeNull();
    expect(resolve({ todayISO: '2026-10-31' })).toBeNull();
    expect(resolve({ nowMinutes: 780 })).toBe('d0s0');
  });
  it.each(['COMPLETED', 'SKIPPED', 'CANCELLED'])('%s된 장소는 되살리지 않는다', status => {
    const document = trip();
    document.days![0].spots![0].status = status;
    expect(resolve({ trip: document })).toBeNull();
  });
  it('다른 날·다른 장소·미래나 잘못된 시각의 관측은 무시한다', () => {
    for (const evidence of [
      { ...arrival(), target: { ...arrival().target, dayIndex: 1 } },
      { ...arrival(), target: { ...arrival().target, activityId: 'd1s0' } },
      { ...arrival(), observedAtISO: '2026-10-30T12:00:00Z' },
      { ...arrival(), observedAtISO: '2026-10-29T09:30:00Z' },
      { ...arrival(), observedAtISO: 'invalid' }
    ]) expect(resolve({ arrival: evidence })).toBeNull();
  });
});
