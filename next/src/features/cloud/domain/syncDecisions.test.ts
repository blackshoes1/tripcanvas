import legacySync from '@legacy/sync.js';
import { describe, expect, it } from 'vitest';

import type { Trip } from '@/features/trip/domain/types';
import type { SyncEntry, SyncMeta } from '../services/syncMetaStore';
import {
  canUpload, isSettled, pendingDeletes, resurrectedIds, shouldMergeOnAuth, staleTrips, syncLabel
} from './syncDecisions';

const { hashTrip } = legacySync;

const trip = (id: string, name = '여행'): Trip => ({
  id, name, start: '2026-10-01',
  days: [{ title: '', drive: '', note: '', mode: 'car', spots: [] }]
});
const entry = (over: Partial<SyncEntry> = {}): SyncEntry =>
  ({ revision: 1, status: 'clean', op: '', hash: '', ...over });

describe('shouldMergeOnAuth', () => {
  it('로그인해서 계정이 생기면 병합한다', () => {
    expect(shouldMergeOnAuth(null, 'u1')).toBe(true);
  });
  it('다른 계정으로 바뀌면 병합한다', () => {
    expect(shouldMergeOnAuth('u1', 'u2')).toBe(true);
  });

  // 레거시가 겪은 실제 사고: 토큰 자동 갱신에도 병합을 돌려, 오래 열어둔 탭이 몇 시간 뒤
  // 제 로컬본을 다시 올려 다른 기기의 최신 편집을 덮어썼다.
  it('같은 계정이면 병합하지 않는다 — 토큰 갱신으로 옛 로컬본을 다시 올리지 않게', () => {
    expect(shouldMergeOnAuth('u1', 'u1')).toBe(false);
  });
  it('로그아웃은 병합하지 않는다', () => {
    expect(shouldMergeOnAuth('u1', null)).toBe(false);
    expect(shouldMergeOnAuth(null, null)).toBe(false);
  });
});

describe('staleTrips', () => {
  it('지문이 같으면 올리지 않는다', () => {
    const t = trip('t1');
    const meta: SyncMeta = { t1: entry({ hash: hashTrip(t) }) };
    expect(staleTrips([t], meta)).toEqual([]);
  });

  it('내용이 바뀌면 올린다', () => {
    const t = trip('t1');
    const meta: SyncMeta = { t1: entry({ hash: hashTrip(t) }) };
    const edited = { ...t, name: '이름 바뀜' };
    expect(staleTrips([edited], meta).map(x => x.id)).toEqual(['t1']);
  });

  it('메타가 없으면 올린다 (아직 한 번도 안 올린 여행)', () => {
    expect(staleTrips([trip('t9')], {}).map(x => x.id)).toEqual(['t9']);
  });

  // 활성 여행만 올리면, 편집 직후 다른 여행으로 전환했을 때 그 편집이 영영 안 올라간다
  it('활성 여행이 아니어도 밀렸으면 전부 고른다', () => {
    const a = trip('t1'), b = trip('t2'), c = trip('t3');
    const meta: SyncMeta = {
      t1: entry({ hash: hashTrip(a) }),
      t2: entry({ hash: 'old' }),
      t3: entry({ hash: 'old' })
    };
    expect(staleTrips([a, b, c], meta).map(x => x.id)).toEqual(['t2', 't3']);
  });
});

describe('canUpload', () => {
  it('미해결 충돌은 사용자가 고르기 전까지 올리지 않는다', () => {
    expect(canUpload(entry({ status: 'conflict' }), false)).toBe(false);
  });
  it('force면 충돌이어도 올린다 (사용자가 "이 기기 버전"을 골랐을 때)', () => {
    expect(canUpload(entry({ status: 'conflict' }), true)).toBe(true);
  });
  it('그 밖의 상태는 올린다', () => {
    for (const s of ['new', 'clean', 'dirty', 'error'] as const) {
      expect(canUpload(entry({ status: s }), false)).toBe(true);
    }
    expect(canUpload(undefined, false)).toBe(true);
  });
});

describe('pendingDeletes', () => {
  it('밀린 삭제만 고른다', () => {
    const meta: SyncMeta = {
      a: entry({ status: 'delete-pending', op: 'op1' }),
      b: entry({ status: 'delete-error', op: 'op2' }),
      c: entry({ status: 'clean' }),
      d: entry({ status: 'tombstoned' })      // 이미 끝난 삭제는 다시 밀지 않는다
    };
    expect(pendingDeletes(meta)).toEqual([{ id: 'a', op: 'op1' }, { id: 'b', op: 'op2' }]);
  });
  it('없으면 빈 배열', () => {
    expect(pendingDeletes({})).toEqual([]);
  });
});

describe('resurrectedIds', () => {
  // 삭제 표시가 남은 채 로컬에 여행이 있으면(되돌리기·다른 탭) 반드시 재업로드해야 한다 —
  // 안 그러면 다음 로그인 병합이 tombstone을 보고 로컬을 지운다.
  it('삭제 표시가 남았는데 로컬에 있으면 되살아난 것', () => {
    const meta: SyncMeta = {
      t1: entry({ status: 'tombstoned' }),
      t2: entry({ status: 'delete-pending' }),
      t3: entry({ status: 'clean' })
    };
    expect(resurrectedIds([trip('t1'), trip('t2'), trip('t3')], meta)).toEqual(['t1', 't2']);
  });
  it('로컬에 없으면 되살아난 게 아니다', () => {
    expect(resurrectedIds([], { t1: entry({ status: 'tombstoned' }) })).toEqual([]);
  });
});

describe('syncLabel / isSettled', () => {
  it('로그인 전에는 로그인을 권한다', () => {
    expect(syncLabel('clean', false)).toMatch(/로그인/);
  });
  it('상태마다 다른 말을 한다', () => {
    expect(syncLabel('clean', true)).toMatch(/저장됨/);
    expect(syncLabel('conflict', true)).toMatch(/충돌/);
    expect(syncLabel('error', true)).toMatch(/보존/);
    expect(syncLabel('delete-pending', true)).toMatch(/삭제/);
    expect(syncLabel(undefined, true)).toMatch(/아직/);
  });
  it('충돌·오류는 안전한 상태가 아니다', () => {
    expect(isSettled(entry({ status: 'clean' }))).toBe(true);
    expect(isSettled(entry({ status: 'tombstoned' }))).toBe(true);
    expect(isSettled(entry({ status: 'conflict' }))).toBe(false);
    expect(isSettled(entry({ status: 'error' }))).toBe(false);
    expect(isSettled(undefined)).toBe(false);
  });
});

// 병합 자체는 sync.js가 담당하지만, Next가 그 계약에 기대고 있으므로 핵심 규칙을 여기서도 고정한다.
describe('mergeForLogin 계약 (sync.js 공유)', () => {
  const remote = (id: string, data: unknown, revision = 2, deleted_at: string | null = null) =>
    ({ client_id: id, data, revision, deleted_at });

  it('원격이 tombstone이면 로컬을 자동 삭제하지 않고 충돌로 남긴다', () => {
    const local = trip('t1');
    const r = legacySync.mergeForLogin([local], [remote('t1', null, 3, '2026-08-30T00:00:00Z')], {});
    expect(r.conflicts.map(c => c.kind)).toEqual(['remote-deleted']);
    expect(r.trips).toHaveLength(1);       // 로컬은 살아 있다
  });

  it('양쪽이 달라졌으면 충돌 — 로컬 base revision을 stamp하지 않는다', () => {
    // stamp하면 다음 병합이 '안전한 업로드'로 착각해 원격본을 조용히 날린다
    const local = trip('t1', '내 이름');
    const meta = { t1: { revision: 1, status: 'clean', op: '', hash: '' } };
    const r = legacySync.mergeForLogin([local], [remote('t1', trip('t1', '남의 이름'), 5)], meta);
    expect(r.conflicts.map(c => c.kind)).toEqual(['changed-both']);
    expect(r.meta.t1.revision).toBe(1);    // 서버의 5가 아니라 로컬이 파생된 1
    expect(r.meta.t1.status).toBe('conflict');
  });

  it('로컬이 그 revision의 후손이면 안전한 업로드', () => {
    const local = trip('t1', '내가 고침');
    const meta = { t1: { revision: 2, status: 'clean', op: '', hash: '' } };
    const r = legacySync.mergeForLogin([local], [remote('t1', trip('t1', '옛것'), 2)], meta);
    expect(r.conflicts).toEqual([]);
    expect(r.actions.map(a => a.kind)).toEqual(['upload']);
  });

  it('원격에만 있는 여행은 받아온다', () => {
    const r = legacySync.mergeForLogin([], [remote('t9', trip('t9', '다른 기기'))], {});
    expect(r.trips).toHaveLength(1);
    expect(r.meta.t9.status).toBe('clean');
  });

  it('원격에만 있고 tombstone이면 받아오지 않는다', () => {
    const r = legacySync.mergeForLogin([], [remote('t9', trip('t9'), 4, '2026-08-30T00:00:00Z')], {});
    expect(r.trips).toEqual([]);
    expect(r.meta.t9.status).toBe('tombstoned');
  });

  it('올린 적 있는데 원격에서 사라졌으면 충돌 (조용히 다시 올리지 않는다)', () => {
    const meta = { t1: { revision: 3, status: 'clean', op: '', hash: '' } };
    const r = legacySync.mergeForLogin([trip('t1')], [], meta);
    expect(r.conflicts.map(c => c.kind)).toEqual(['remote-missing']);
    expect(r.actions).toEqual([]);
  });

  it('한 번도 안 올린 여행은 그냥 올린다', () => {
    const r = legacySync.mergeForLogin([trip('t1')], [], {});
    expect(r.conflicts).toEqual([]);
    expect(r.actions.map(a => a.kind)).toEqual(['upload']);
  });
});
