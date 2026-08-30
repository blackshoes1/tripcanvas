import { describe, expect, it } from 'vitest';

import type { Trip } from '@/features/trip/domain/types';
import { resolveConflict, type Conflict } from './conflictResolve';

const trip = (id: string, name = '여행'): Trip => ({
  id, name, start: '2026-10-01',
  days: [{ title: '', drive: '', note: '', mode: 'car', spots: [] }]
});
const fresh = () => trip('tNEW', '새 여행');

const conflict = (over: Partial<Conflict> = {}): Conflict => ({
  kind: 'changed-both', local: trip('t1', '내 버전'), remote: trip('t1', '클라우드 버전'),
  revision: 5, deleted_at: null, ...over
});

describe('resolveConflict — 클라우드 선택', () => {
  it('클라우드 내용으로 갈아끼운다', () => {
    const r = resolveConflict([trip('t1', '내 버전')], conflict(), { choice: 'cloud' }, fresh);
    expect(r.error).toBeUndefined();
    expect(r.trips.map(t => t.name)).toEqual(['클라우드 버전']);
    expect(r.metaPatch.t1.status).toBe('clean');
    expect(r.metaPatch.t1.revision).toBe(5);
    expect(r.uploads).toEqual([]);
  });

  it('원격이 삭제였으면 로컬에서도 빠진다', () => {
    const c = conflict({ kind: 'remote-deleted', remote: null, deleted_at: '2026-08-30T00:00:00Z' });
    const r = resolveConflict([trip('t1'), trip('t2')], c, { choice: 'cloud' }, fresh);
    expect(r.trips.map(t => t.id)).toEqual(['t2']);
    expect(r.metaPatch.t1.status).toBe('tombstoned');
  });

  // 빈 저장소가 되면 양쪽 앱에서 복구 경로가 사라진다
  it('마지막 여행이 사라지면 새 여행을 채운다', () => {
    const c = conflict({ kind: 'remote-deleted', remote: null, deleted_at: '2026-08-30T00:00:00Z' });
    const r = resolveConflict([trip('t1')], c, { choice: 'cloud' }, fresh);
    expect(r.trips).toHaveLength(1);
    expect(r.trips[0].id).toBe('tNEW');
    expect(r.activeId).toBe('tNEW');
  });

  it('클라우드 데이터가 손상됐으면 아무것도 바꾸지 않는다', () => {
    const bad = { id: 't1', name: 'x', days: 'not an array' } as unknown as Trip;
    const before = [trip('t1', '내 버전')];
    const r = resolveConflict(before, conflict({ remote: bad }), { choice: 'cloud' }, fresh);
    expect(r.error).toMatch(/손상/);
    expect(r.trips).toBe(before);            // 원본 그대로
    expect(r.metaPatch).toEqual({});
  });
});

describe('resolveConflict — 이 기기 선택', () => {
  it('로컬을 그대로 두고 force로 올린다', () => {
    const before = [trip('t1', '내 버전')];
    const r = resolveConflict(before, conflict(), { choice: 'device' }, fresh);
    expect(r.trips).toBe(before);
    expect(r.uploads).toEqual([{ trip: conflict().local, force: true }]);
    expect(r.metaPatch).toEqual({});         // 메타는 업로드 결과가 정한다
  });

  it('이 기기에 버전이 없으면 이유를 말한다', () => {
    const r = resolveConflict([], conflict({ local: null }), { choice: 'device' }, fresh);
    expect(r.error).toMatch(/남은 버전/);
    expect(r.uploads).toEqual([]);
  });
});

describe('resolveConflict — 둘 다 보관', () => {
  it('클라우드를 받고 로컬은 복사본으로 남긴다', () => {
    const r = resolveConflict([trip('t1', '내 버전')], conflict(), { choice: 'both', copyId: 'tCOPY' }, fresh);
    expect(r.trips.map(t => t.name)).toEqual(['클라우드 버전', '내 버전 (충돌 복사본)']);
    expect(r.trips.map(t => t.id)).toEqual(['t1', 'tCOPY']);
    expect(r.uploads).toEqual([{ trip: r.trips[1], force: false }]);
    expect(r.activeId).toBe('tCOPY');        // 방금 만든 복사본으로 옮겨간다
  });

  it('복사본은 원본과 독립이다 (깊은 복사)', () => {
    const local = trip('t1', '내 버전');
    local.days[0].spots.push({ name: '장소', city: '서울', desc: '', lat: 37.5, lng: 127 });
    const r = resolveConflict([local], conflict({ local }), { choice: 'both', copyId: 'tCOPY' }, fresh);
    const copy = r.trips.find(t => t.id === 'tCOPY')!;
    copy.days[0].spots[0].name = '바뀜';
    expect(local.days[0].spots[0].name).toBe('장소');
  });

  it('원격이 삭제였어도 복사본은 남는다 — 로컬을 조용히 버리지 않는다', () => {
    const c = conflict({ kind: 'remote-deleted', remote: null, deleted_at: '2026-08-30T00:00:00Z' });
    const r = resolveConflict([trip('t1', '내 버전')], c, { choice: 'both', copyId: 'tCOPY' }, fresh);
    expect(r.trips.map(t => t.id)).toEqual(['tCOPY']);
    expect(r.trips[0].name).toContain('충돌 복사본');
  });
});

describe('resolveConflict — remote-missing (원격에서 사라짐)', () => {
  it('클라우드를 택하면 로컬에서도 빠지고, 마지막이면 새 여행이 채워진다', () => {
    const c = conflict({ kind: 'remote-missing', remote: null, deleted_at: null });
    const r = resolveConflict([trip('t1')], c, { choice: 'cloud' }, fresh);
    expect(r.trips[0].id).toBe('tNEW');
  });
  it('이 기기를 택하면 다시 올린다', () => {
    const c = conflict({ kind: 'remote-missing', remote: null });
    const r = resolveConflict([trip('t1')], c, { choice: 'device' }, fresh);
    expect(r.uploads[0].force).toBe(true);
  });
});
