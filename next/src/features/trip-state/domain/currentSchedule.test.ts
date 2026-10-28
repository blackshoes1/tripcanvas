import { describe, expect, it } from 'vitest';
import { buildToday, type SpotDoc, type TodayInput } from './todayView';
import { buildTravelState } from './travelState';

const inputOf = (spots: SpotDoc[], nowMinutes: number): TodayInput => ({
  tripId: 'clock', revision: 1, updatedAt: '2026-10-27T00:00:00Z',
  todayISO: '2026-10-27', nowMinutes,
  trip: { id: 'clock', name: '여행', start: '2026-10-27', timeZone: 'Europe/Madrid',
    days: [{ startAt: '09:00', mode: 'walk', spots }] }
});

const day = (): SpotDoc[] => [
  { name: '오전 장소', at: '09:00', stayMin: 60 },
  { name: '점심 장소', at: '11:00', stayMin: 60 }
];

describe('지금과 잠금화면은 방문 표시와 독립적으로 현재 시각의 일정을 고른다', () => {
  it('뒤에 있는 현재 일정이 앞에 있는 미래 일정보다 먼저다', () => {
    const input = inputOf([
      { name: '나중 장소', at: '15:00', stayMin: 60 },
      { name: '지금 장소', at: '11:00', stayMin: 60 }
    ], 690);
    const before = JSON.stringify(input.trip);
    const today = buildToday(input);
    const travel = buildTravelState(input);
    expect(today.nextAction).toMatchObject({ title: '지금 장소', status: 'IN_PROGRESS' });
    expect(travel.liveActivity).toMatchObject({ nextTitle: '지금 장소', status: 'IN_PROGRESS' });
    expect(travel.widget.nextActivity?.title).toBe('지금 장소');
    expect(JSON.stringify(input.trip)).toBe(before);
  });

  it('전부 지난 날은 오전으로 돌아가지 않으며 남은 방문 표시를 자동 완료하지 않는다', () => {
    const input = inputOf(day(), 780);
    const today = buildToday(input);
    const travel = buildTravelState(input);
    expect(today.nextAction).toBeNull();
    expect(today.activityState.status).toBe('COMPLETED');
    expect(travel.liveActivity).toMatchObject({ status: 'COMPLETED', nextTitle: '예정 시간 지남', scheduleElapsed: true });
    expect(travel.widget.nextActivity).toBeNull();
    expect(travel.departure).toBeNull();
    expect(today.activities.map(activity => activity.status)).toEqual(['PLANNED', 'PLANNED']);
    expect(today.currentState.completedActivityIds).toEqual([]);
    expect(today.remainingActivities.map(activity => activity.name)).toEqual(['오전 장소', '점심 장소']);
    expect(travel.pulse.code).toBe('ON_TRACK');
    expect(travel.pulse.text).toMatch(/시간.*지났/);
  });

  it('직접 완료한 날은 시간 경과 표시 대신 기존 완료 상태를 보존한다', () => {
    const travel = buildTravelState(inputOf(day().map(spot => ({ ...spot, status: 'COMPLETED' })), 780));
    expect(travel.liveActivity).toMatchObject({ status: 'COMPLETED', nextTitle: '오늘 남은 일정 없음' });
    expect(travel.liveActivity).not.toHaveProperty('scheduleElapsed');
  });

  it('완료를 누르지 않은 앞 장소가 있어도 지금 예약 중인 곳을 안내한다', () => {
    const input = inputOf([
      { name: '오전 장소', at: '09:00', stayMin: 60 },
      { name: '저녁 예약', bookAt: '19:00', stayMin: 90 }
    ], 1170);
    expect(buildToday(input).nextAction).toMatchObject({ title: '저녁 예약', status: 'IN_PROGRESS' });
    expect(buildTravelState(input).liveActivity).toMatchObject({ nextTitle: '저녁 예약', status: 'IN_PROGRESS' });
  });

  it('같은 PLANNED 표시라도 시간이 흘러 다음 장소가 바뀌면 잠금화면 지문이 바뀐다', () => {
    const early = buildTravelState(inputOf(day(), 480));
    const later = buildTravelState(inputOf(day(), 630));
    expect(early.today.activities.map(activity => activity.status)).toEqual(later.today.activities.map(activity => activity.status));
    expect(early.liveActivity.nextTitle).toBe('오전 장소');
    expect(later.liveActivity.nextTitle).toBe('점심 장소');
    expect(early.stateVersion).not.toBe(later.stateVersion);
  });

  it('장소 이름만 고친 응답도 잠금화면에 반영한다', () => {
    const input = inputOf(day(), 480);
    const before = buildTravelState(input);
    input.trip.days![0].spots![0].name = '바꾼 이름';
    const after = buildTravelState({ ...input, revision: 2 });
    expect(after.liveActivity.nextTitle).toBe('바꾼 이름');
    expect(after.stateVersion).not.toBe(before.stateVersion);
  });

  it('현재 위치로 이동시간이 바뀌면 같은 출발 단계여도 잠금화면에 반영한다', () => {
    const input = inputOf([{ name: '예약', bookAt: '19:00', stayMin: 60, lat: 40.4, lng: -3.7 }], 500);
    const near = buildTravelState({ ...input, currentLocation: { lat: 40.401, lng: -3.7 } });
    const far = buildTravelState({ ...input, currentLocation: { lat: 40.42, lng: -3.7 } });
    expect(near.departure?.stage).toBe(far.departure?.stage);
    expect(near.liveActivity.travelMinutes).not.toBe(far.liveActivity.travelMinutes);
    expect(near.stateVersion).not.toBe(far.stateVersion);
    const same = buildTravelState({ ...input, nowMinutes: 507, currentLocation: { lat: 40.401, lng: -3.7 } });
    expect(same.stateVersion).toBe(near.stateVersion);
  });
});


describe('잠금화면 종료는 현재·미래 일정 선택과 같은 서버 판정을 쓴다', () => {
  it('마지막 종료 시각 전에는 유지하고 종료 시각부터 과거 미처리 일정이 남아도 종료한다', () => {
    expect(buildTravelState(inputOf(day(), 719)).liveActivity.shouldEnd).not.toBe(true);
    const ended = buildTravelState(inputOf(day(), 720));
    expect(ended.liveActivity.shouldEnd).toBe(true);
    expect(ended.today.activities.every(activity => activity.status === 'PLANNED')).toBe(true);
  });
  it.each(['COMPLETED', 'SKIPPED', 'CANCELLED'])('모두 %s이면 예정 종료 전에도 종료한다', status => {
    expect(buildTravelState(inputOf(day().map(spot => ({ ...spot, status })), 570)).liveActivity.shouldEnd).toBe(true);
  });
  it('빈 날은 NO_PLAN 상태로 종료한다', () => {
    const state = buildTravelState(inputOf([], 600));
    expect(state.liveActivity.status).toBe('NO_PLAN');
    expect(state.liveActivity.shouldEnd).toBe(true);
  });
  it.each([480, 630])('첫 일정 전과 중간 공백에는 다음 일정을 유지한다: %s', now => {
    expect(buildTravelState(inputOf(day(), now)).liveActivity.shouldEnd).not.toBe(true);
  });
  it('여행 기간 밖 미리보기에는 종료하고 다음 날짜의 새 일정에는 안내할 수 있다', () => {
    const input = inputOf(day(), 480);
    expect(buildTravelState({ ...input, todayISO: '2026-10-26' }).liveActivity.shouldEnd).toBe(true);
    input.trip.days!.push({ startAt: '09:00', spots: [{ name: '내일 장소', at: '09:00', stayMin: 60 }] });
    const nextDay = buildTravelState({ ...input, todayISO: '2026-10-28' });
    expect(nextDay.liveActivity.shouldEnd).not.toBe(true);
    expect(nextDay.liveActivity.nextTitle).toBe('내일 장소');
  });
});
