import { describe, expect, it } from 'vitest';

import { SAMPLE_TRIP_ID } from '@/features/cloud/domain/syncDecisions';
import { isFirstVisit } from './onboarding';

describe('isFirstVisit', () => {
  it('저장소가 비었으면 보여준다', () => {
    expect(isFirstVisit(false, null)).toBe(true);
    expect(isFirstVisit(false, [])).toBe(true);
  });

  // 레거시가 심어 준 데모를 가진 것만으로 여행을 만들었다고 볼 수 없다
  it('샘플만 있으면 아직 시작 안 한 것으로 본다', () => {
    expect(isFirstVisit(false, [{ id: SAMPLE_TRIP_ID }])).toBe(true);
  });

  it('내 여행이 하나라도 있으면 보여주지 않는다', () => {
    expect(isFirstVisit(false, [{ id: 't1' }])).toBe(false);
    expect(isFirstVisit(false, [{ id: SAMPLE_TRIP_ID }, { id: 't1' }])).toBe(false);
  });

  // 여행을 다 지운 사람에게 소개 화면이 되돌아오면 초기화된 것처럼 보인다
  it('한 번 닫았으면 저장소가 비어도 다시 띄우지 않는다', () => {
    expect(isFirstVisit(true, null)).toBe(false);
    expect(isFirstVisit(true, [])).toBe(false);
    expect(isFirstVisit(true, [{ id: SAMPLE_TRIP_ID }])).toBe(false);
  });
});
