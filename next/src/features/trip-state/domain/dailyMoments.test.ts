import { describe, expect, it } from 'vitest';
import { buildDailyMomentRows, dailyMomentImpacts, dailyMomentOptions } from './dailyMoments';

const cafe = { name: '카페', lat: 37, lng: 127, at: '10:00' }, sunset = { name: '노을', placeId: 'sunset' };
const trip = (spots = [cafe, sunset]) => ({ start: '2026-10-15', days: [{ title: '첫날', spots }] });

describe('개인의 오늘 하나', () => {
  it('순서와 시각을 바꿔도 고른 장소를 따라가고 이름을 바꾸면 확인을 요구한다', () => {
    const before = dailyMomentOptions(trip(), 0)!;
    const saved = [{ userId: 'a', label: '영희', spotKey: before.options[0].key, spotName: '카페' }];
    const reorder = dailyMomentOptions(trip([sunset, { ...cafe, at: '11:00' }]), 0)!;
    expect(buildDailyMomentRows(saved, reorder.options, 'a')[0]).toMatchObject({ activityId: 'd0s1', status: 'ACTIVE', mine: true });
    const renamed = dailyMomentOptions(trip([{ ...cafe, name: '다른 카페' }, sunset]), 0)!;
    expect(buildDailyMomentRows(saved, renamed.options, 'a')[0]).toMatchObject({ activityId: null, status: 'UNAVAILABLE' });
  });

  it('같은 장소의 여러 방문을 잘못 연결하지 않고 날짜 변경도 다른 하루로 다룬다', () => {
    const duplicated = dailyMomentOptions(trip([cafe, { ...cafe, at: '15:00' }]), 0)!;
    expect(duplicated.options.every(row => !row.selectable)).toBe(true);
    expect(dailyMomentOptions(trip(), -1)).toBeNull();
    expect(dailyMomentOptions(trip(), 1)).toBeNull();
    expect(dailyMomentOptions({ ...trip(), start: '2026-10-16' }, 0)!.dayKey).not.toBe(dailyMomentOptions(trip(), 0)!.dayKey);
  });

  it('개별 바람에 대한 유지·변경·빠짐·확인 필요를 구분한다', () => {
    const options = dailyMomentOptions(trip(), 0)!.options;
    const rows = buildDailyMomentRows([{ userId: 'a', label: '영희', spotKey: options[0].key, spotName: '카페' }], options, 'b');
    expect(dailyMomentImpacts(rows, [])[0].status).toBe('KEPT');
    expect(dailyMomentImpacts(rows, [{ activityId: 'd0s0', kind: 'SHIFT' }])[0].status).toBe('CHANGED');
    expect(dailyMomentImpacts(rows, [{ activityId: 'd0s0', kind: 'REMOVE' }])[0].status).toBe('REMOVED');
    expect(dailyMomentImpacts([{ ...rows[0], activityId: null, status: 'UNAVAILABLE' }], [])[0].status).toBe('UNAVAILABLE');
    expect(rows[0].mine).toBe(false);
  });

  it('아직 고르지 않은 두 곳은 바람으로 확정하지 않고 선택 후에만 허용한다', () => {
    const make = (state: string) => ({ days: [{ spots: [{ ...cafe, choice: { version: 1, state, alternative: sunset } }] }] });
    const pending = dailyMomentOptions(make('PENDING'), 0)!;
    expect(pending.options[0].selectable).toBe(false);
    expect(pending.options[0].disabledReason).toContain('먼저');
    const selected = dailyMomentOptions(make('SELECTED'), 0)!;
    expect(selected.options[0].selectable).toBe(true);
    expect(selected.options[0].key).toBe(pending.options[0].key);
  });
});
