import { describe, expect, it } from 'vitest';

import {
  SNAPSHOT_INTERVAL_MS, SNAPSHOT_KEEP, shouldSnapshot, snapshotLabel, staleSnapshotIds
} from './snapshots';

describe('shouldSnapshot', () => {
  const T = 1_700_000_000_000;
  it('처음이면 남긴다', () => {
    expect(shouldSnapshot(undefined, T)).toBe(true);
  });
  it('10분이 지나면 남긴다', () => {
    expect(shouldSnapshot(T, T + SNAPSHOT_INTERVAL_MS)).toBe(true);
    expect(shouldSnapshot(T, T + SNAPSHOT_INTERVAL_MS + 1)).toBe(true);
  });
  // 편집할 때마다 쌓으면 목록이 1분 단위로 채워져 정작 어제 상태를 못 찾는다
  it('10분 안이면 남기지 않는다', () => {
    expect(shouldSnapshot(T, T + 1)).toBe(false);
    expect(shouldSnapshot(T, T + SNAPSHOT_INTERVAL_MS - 1)).toBe(false);
  });
});

describe('staleSnapshotIds', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    // i가 클수록 최신
    created_at: `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z`
  }));

  it('15개 이하면 지울 게 없다', () => {
    expect(staleSnapshotIds(rows(15))).toEqual([]);
    expect(staleSnapshotIds(rows(1))).toEqual([]);
    expect(staleSnapshotIds([])).toEqual([]);
  });

  it('최신 15개를 남기고 나머지를 지운다', () => {
    const r = staleSnapshotIds(rows(18));
    expect(r).toHaveLength(3);
    expect(r.sort((a, b) => a - b)).toEqual([1, 2, 3]);   // 가장 오래된 셋
  });

  it('입력 순서가 뒤죽박죽이어도 최신 기준으로 고른다 — 서버 정렬에 기대지 않는다', () => {
    const shuffled = [...rows(17)].reverse();
    const r = staleSnapshotIds(shuffled);
    expect(r.sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('남길 개수를 바꿀 수 있다', () => {
    expect(staleSnapshotIds(rows(5), 2)).toHaveLength(3);
    expect(SNAPSHOT_KEEP).toBe(15);
  });

  it('id가 없는 행은 건너뛴다', () => {
    const bad = [...rows(16), { id: null as unknown as number, created_at: '2026-01-01T00:00:00Z' }];
    expect(staleSnapshotIds(bad).every(id => id != null)).toBe(true);
  });
});

describe('snapshotLabel', () => {
  it('월/일 시:분으로 보여준다', () => {
    const d = new Date(2026, 9, 1, 14, 5);
    expect(snapshotLabel(d.toISOString())).toBe('10/1 14:05');
  });
  it('시각을 못 읽으면 빈 문자열', () => {
    expect(snapshotLabel('아무거나')).toBe('');
    expect(snapshotLabel('')).toBe('');
  });
});
