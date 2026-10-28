import { describe, expect, it } from 'vitest';
import { buildTravelState } from './travelState';

describe('잠금화면에 표시한 일정의 이동 대상', () => {
  const input = { tripId: 'target', revision: 7, updatedAt: '', todayISO: '2026-10-28', nowMinutes: 600,
    generatedAt: '2026-10-28T01:00:00Z', trip: { name: '여행', start: '2026-10-27', timeZone: 'Asia/Seoul',
      days: [{ spots: [] }, { startAt: '09:00', spots: [
        { name: '이미 지난 곳', at: '09:00', stayMin: 30 },
        { name: '표시 중인 곳', at: '10:00', stayMin: 60, bookUrl: 'https://private.test', placeId: 'private-place' }
      ] }] } };

  it('화면에 표시한 항목의 일자·위치·문서 버전만 담는다', () => {
    const state = buildTravelState(input);
    expect(state.liveActivity.nextTitle).toBe('표시 중인 곳');
    expect(state.liveActivity).toHaveProperty('target', { dayIndex: 1, activityId: 'd1s1', revision: 7 });
    expect(JSON.stringify(state.liveActivity)).not.toMatch(/private-place|private\.test|bookUrl|placeId/);
  });

  it('마지막 일정 시간이 지나 표시할 대상이 없으면 위치 링크를 남기지 않는다', () => {
    expect(buildTravelState({ ...input, nowMinutes: 900 }).liveActivity).not.toHaveProperty('target');
  });

  it('표시 문장이 같아도 새 문서 버전의 대상을 갱신한다', () => {
    const before = buildTravelState(input);
    const after = buildTravelState({ ...input, revision: 8 });
    expect(after.liveActivity).toHaveProperty('target.revision', 8);
    expect(after.stateVersion).not.toBe(before.stateVersion);
  });
});
