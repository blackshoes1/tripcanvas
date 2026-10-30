import { describe, expect, it } from 'vitest';
import { buildToday, type TodayInput } from './todayView';
import { buildTravelState } from './travelState';

const input = (): TodayInput => ({
  tripId: 'early', revision: 7, updatedAt: '2026-10-30T08:00:00Z',
  todayISO: '2026-10-30', nowMinutes: 630,
  trip: { id: 'early', name: '여행', start: '2026-10-30', timeZone: 'Europe/Madrid',
    days: [{ startAt: '09:00', mode: 'walk', spots: [
      { name: '이전 장소', at: '10:00', stayMin: 90, lat: 40.41, lng: -3.71 },
      { name: '점심 예약', bookAt: '12:00', stayMin: 60, lat: 40.4, lng: -3.7 }
    ] }] }
});

describe('실제 도착은 예정 시각보다 먼저 반영한다', () => {
  it('이전 일정 시간이 남아 있어도 실제로 도착한 다음 예약을 고르고 완료는 바꾸지 않는다', () => {
    const source = input();
    const before = JSON.stringify(source.trip);
    const result = buildTravelState({ ...source, currentLocation: { lat: 40.4, lng: -3.7 } });
    expect(result.today.nextAction).toMatchObject({ activityId: 'd0s1', status: 'ARRIVED', travelMinutes: 0, departure: null });
    expect(result.liveActivity).toMatchObject({ nextTitle: '점심 예약', status: 'ARRIVED', departureText: null });
    expect(result.departure).toBeNull();
    expect(result.notifications.filter(n => n.kind === 'departureReminder' || n.kind === 'scheduleDelay')).toEqual([]);
    expect(result.today.currentState.completedActivityIds).toEqual([]);
    expect(JSON.stringify(source.trip)).toBe(before);
  });

  it('잠금 중 받은 도착 근거도 같은 상태와 지문으로 이어진다', () => {
    const source = input();
    const direct = buildTravelState({ ...source, currentLocation: { lat: 40.4, lng: -3.7 } });
    const background = buildTravelState({ ...source, arrivedActivityId: 'd0s1' });
    expect(background.liveActivity).toEqual(direct.liveActivity);
    expect(background.stateVersion).not.toBe(buildTravelState(source).stateVersion);
  });

  it('계획에서 추정한 현재 위치나 예약 전 대기 시간만으로 도착했다고 말하지 않는다', () => {
    const source = input();
    source.trip.days![0].spots![0].status = 'COMPLETED';
    const noPosition = buildToday({ ...source, nowMinutes: 690 });
    const far = buildToday({ ...source, nowMinutes: 690, currentLocation: { lat: 40.5, lng: -3.7 } });
    expect(noPosition.nextAction?.status).not.toBe('ARRIVED');
    expect(far.nextAction?.status).not.toBe('ARRIVED');
  });

  it.each(['COMPLETED', 'SKIPPED', 'CANCELLED'])('%s 장소는 도착 근거가 있어도 되살리지 않는다', status => {
    const source = input();
    source.trip.days![0].spots![1].status = status;
    expect(buildToday({ ...source, arrivedActivityId: 'd0s1' }).nextAction?.activityId).toBe('d0s0');
  });

  it('종료 시각이 지났거나 다른 날이면 도착 근거가 현재 일정을 붙잡지 않는다', () => {
    expect(buildToday({ ...input(), nowMinutes: 780, arrivedActivityId: 'd0s1' }).nextAction).toBeNull();
    expect(buildToday({ ...input(), todayISO: '2026-10-29', arrivedActivityId: 'd0s1' }).nextAction?.status).not.toBe('ARRIVED');
  });

  it('아직 결정하지 않은 장소와 좌표 없는 장소는 도착으로 확정하지 않는다', () => {
    const source = input();
    source.trip.days![0].spots![1].choice = { version: 1, state: 'PENDING', alternative: { name: '다른 식당' } };
    expect(buildToday({ ...source, arrivedActivityId: 'd0s1' }).nextAction?.status).not.toBe('ARRIVED');
    delete source.trip.days![0].spots![1].choice;
    delete source.trip.days![0].spots![1].lat;
    delete source.trip.days![0].spots![1].lng;
    expect(buildToday({ ...source, arrivedActivityId: 'd0s1' }).nextAction?.status).not.toBe('ARRIVED');
  });
});
