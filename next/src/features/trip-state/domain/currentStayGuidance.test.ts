import { describe, expect, it } from 'vitest';
import lib from '@legacy/lib.js';
import { buildTravelState } from './travelState';
import type { TodayInput } from './todayView';
import { resolveArrivedActivityId } from './arrivalEvidence';

const input = (): TodayInput => ({ tripId: 'stay', revision: 4, updatedAt: '',
  todayISO: '2026-10-31', nowMinutes: 660, arrivedActivityId: 'd0s0',
  trip: { id: 'stay', start: '2026-10-31', name: '여행', timeZone: 'Europe/Madrid', days: [{
    startAt: '09:00', mode: 'walk', spots: [
      { name: '카페', at: '09:00', stayMin: 60, lat: 40.4, lng: -3.7 },
      { name: '점심 예약', bookAt: '15:00', stayMin: 60, lat: 40.5, lng: -3.7 }
    ]
  }] },
  legCache: { [lib.legKey({ lat: 40.4, lng: -3.7 }, { lat: 40.5, lng: -3.7 }, 'walk')]: { sec: 1800, est: false } }
});

describe('현재 머무름과 시간표의 다음 행동을 분리한 표시 계약', () => {
  it('지난 카페는 머무름으로만 보존하고 기존 다음 일정/잠금 대상은 예약 그대로 둔다', () => {
    const source = input(), before = JSON.stringify(source.trip);
    const result = buildTravelState(source);
    expect(result.today.nextAction?.activityId).toBe('d0s1');
    expect(result.liveActivity.target?.activityId).toBe('d0s1');
    expect(result.liveActivity.nextTitle).toBe('점심 예약');
    expect(result.today.nowFocus).toMatchObject({ kind: 'CURRENT_STAY',
      currentStay: { target: { dayIndex: 0, activityId: 'd0s0', revision: 4 }, title: '카페', status: 'IN_PROGRESS', expiresAtISO: '2026-10-31T23:00:00Z' },
      next: { target: { activityId: 'd0s1' }, travelMinutes: 30, leaveAtISO: '2026-10-31T13:15:00Z' },
      switchAtISO: '2026-10-31T13:03:00Z' });
    expect(result.liveActivity.nowFocus).toEqual(result.today.nowFocus);
    expect(JSON.stringify(source.trip)).toBe(before);
  });

  it('정확한 준비 경계에 표시·지문을 바꾸고 아직 진행 중인 카페가 전환을 막지 않는다', () => {
    const source = input();
    source.trip.days![0].spots![0].stayMin = 360;
    const before = buildTravelState({ ...source, nowMinutes: 842 });
    const ready = buildTravelState({ ...source, nowMinutes: 843 });
    expect(before.today.nowFocus?.kind).toBe('CURRENT_STAY');
    expect(ready.today.nowFocus?.kind).toBe('DEPARTURE');
    expect(ready.today.nextAction?.activityId).toBe('d0s0');
    expect(ready.today.nowFocus?.next?.target.activityId).toBe('d0s1');
    expect(ready.stateVersion).not.toBe(before.stateVersion);
  });

  it('실제 위치가 없는 시간표상 진행 중 A는 기존 표시를 지키고 B 준비 때만 출발로 전환한다', () => {
    const source = input();
    source.arrivedActivityId = null;
    source.trip.days![0].spots![0].stayMin = 360;
    const before = buildTravelState({ ...source, nowMinutes: 842 });
    expect(before.today.nextAction).toMatchObject({ activityId: 'd0s0', title: '카페' });
    expect(before.liveActivity).toMatchObject({ nextTitle: '카페', target: { activityId: 'd0s0' } });
    expect(before.today.nowFocus).toMatchObject({ kind: 'SCHEDULE', currentStay: null, next: { target: { activityId: 'd0s1' } } });
    expect(buildTravelState({ ...source, nowMinutes: 843 }).today.nowFocus?.kind).toBe('DEPARTURE');
  });

  it('위치가 없으면 A를 추정하지 않고 여유 시간, 준비 시각에는 다음 출발을 표시한다', () => {
    const source = { ...input(), arrivedActivityId: null };
    expect(buildTravelState(source).today.nowFocus).toMatchObject({ kind: 'FREE_TIME', currentStay: null });
    expect(buildTravelState({ ...source, nowMinutes: 843 }).today.nowFocus?.kind).toBe('DEPARTURE');
  });

  it('표시 단계와 출발 시각이 같으면 분이 지나도 지문을 바꾸지 않는다', () => {
    const before = buildTravelState(input());
    const later = buildTravelState({ ...input(), nowMinutes: 665 });
    expect(later.stateVersion).toBe(before.stateVersion);
    const changedTravel = input();
    Object.values(changedTravel.legCache!)[0].sec = 3600;
    expect(buildTravelState(changedTravel).stateVersion).not.toBe(before.stateVersion);
  });

  it('준비·권장 출발·실제 늦음의 경계만 갱신하고 같은 단계의 분 변화는 무시한다', () => {
    const source = input();
    source.trip.days![0].spots![0].stayMin = 360;
    const [ready, same, leave, late] = [843, 844, 855, 871].map(nowMinutes => buildTravelState({ ...source, nowMinutes }));
    for (const result of [ready, same, leave, late]) {
      expect(result.today.nextAction?.activityId).toBe('d0s0');
      expect(result.today.nowFocus?.kind).toBe('DEPARTURE');
    }
    expect(same.stateVersion).toBe(ready.stateVersion);
    expect(leave.stateVersion).not.toBe(ready.stateVersion);
    expect(late.stateVersion).not.toBe(leave.stateVersion);
  });

  it('다음 장소가 지정한 이동 수단을 일자 기본값보다 먼저 쓴다', () => {
    const source = input();
    source.trip.days![0].mode = 'car';
    source.trip.days![0].spots![1].legMode = 'walk';
    expect(buildTravelState(source).today.nowFocus?.next?.travelMinutes).toBe(30);
  });

  it('기존 일정 구간이 실제 도로여도 새 현재 위치에서의 출발이 추정이면 출처를 추정으로 표시한다', () => {
    const source = input();
    source.nowMinutes = 570;
    source.trip.days![0].spots![0].stayMin = 120;
    const result = buildTravelState({ ...source, currentLocation: { lat: 40.4005, lng: -3.7 } });
    expect(result.today.nextAction).toMatchObject({ activityId: 'd0s0', travelMinutes: 0 });
    expect(result.today.nowFocus?.next?.target.activityId).toBe('d0s1');
    expect(result.today.travelTimeSource).toBe('STRAIGHT_LINE_ESTIMATE');
  });

  it('마지막 일정 종료는 머무름보다 우선하고 다른 날·완료·이탈도 머무름을 해제한다', () => {
    expect(buildTravelState({ ...input(), nowMinutes: 960 })).toMatchObject({ liveActivity: { shouldEnd: true, nowFocus: null } });
    expect(buildTravelState({ ...input(), todayISO: '2026-11-01' }).today.nowFocus).toBeNull();
    expect(buildTravelState({ ...input(), currentLocation: { lat: 41, lng: -3.7 } }).today.nowFocus?.currentStay).toBeNull();
    const source = input(); source.trip.days![0].spots![0].status = 'COMPLETED';
    expect(buildTravelState(source).today.nowFocus?.currentStay).toBeNull();
  });

  it('같은 날짜·리비전의 입장은 예정 종료 뒤에도 근거이며 exit/revision/자정은 해제한다', () => {
    const source = input();
    const arrival = { target: { dayIndex: 0, activityId: 'd0s0', revision: 4 }, arrived: true, observedAtISO: '2026-10-31T08:30:00Z' };
    const args = { trip: source.trip, revision: 4, todayISO: source.todayISO, nowMinutes: source.nowMinutes, arrival };
    expect(resolveArrivedActivityId(args)).toBe('d0s0');
    expect(resolveArrivedActivityId({ ...args, arrival: { ...arrival, arrived: false } })).toBeNull();
    expect(resolveArrivedActivityId({ ...args, revision: 5 })).toBeNull();
    expect(resolveArrivedActivityId({ ...args, todayISO: '2026-11-01' })).toBeNull();
  });
});
