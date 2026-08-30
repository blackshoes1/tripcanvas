// 되돌리기 배선 — 순수 규칙(undoHistory)이 실제 저장소 되쓰기와 맞물리는지 본다.
import { beforeEach, describe, expect, it } from 'vitest';

import { newTrip } from '../domain/tripEditor';
import type { Trip } from '../domain/types';

// 이 워크스페이스에는 jsdom이 없다 — 모듈이 쓰는 만큼만 세운다 (localStorage + 리스너 등록).
const mem = new Map<string, string>();
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    localStorage: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => { mem.set(k, v); },
      removeItem: (k: string) => { mem.delete(k); }
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  }
});

const {
  addTrip, getTripStoreSnapshot, removeTrip, saveTrip, undoLastChange
} = await import('./localTripStore');
const REJECTED_KEY = 'tripcanvas_rejected_backup_v1';
const { recordWrite, getUndoDepth, resetUndoForTest } = await import('./undoStore');

const LS_KEY = 'tripcanvas_v1';
const raw = () => mem.get(LS_KEY) ?? null;
const named = (name: string, id: string): Trip => newTrip(name, '2026-11-05', id);
const nameOf = (id: string) => getTripStoreSnapshot()?.trips.find(t => t.id === id)?.name;

beforeEach(() => {
  mem.clear();
  resetUndoForTest();
  addTrip(named('원본', 't1'));   // 첫 저장 — 돌아갈 곳이 없어 히스토리는 비어 있다
});

describe('undoLastChange', () => {
  it('첫 저장 뒤엔 되돌릴 게 없다', () => {
    expect(getUndoDepth()).toBe(0);
    expect(undoLastChange()).toBe('empty');
  });

  it('편집을 되돌리면 직전 내용이 돌아온다', () => {
    saveTrip(named('바뀐 이름', 't1'));
    expect(nameOf('t1')).toBe('바뀐 이름');

    expect(undoLastChange()).toBe('ok');
    expect(nameOf('t1')).toBe('원본');
  });

  // 되돌리기가 히스토리에 쌓이면 Ctrl+Z를 아무리 눌러도 같은 두 자리를 오간다 (레거시 histLock)
  it('두 번 되돌리면 두 단계 뒤로 간다', () => {
    saveTrip(named('두번째', 't1'));
    saveTrip(named('세번째', 't1'));

    expect(undoLastChange()).toBe('ok');
    expect(nameOf('t1')).toBe('두번째');
    expect(undoLastChange()).toBe('ok');
    expect(nameOf('t1')).toBe('원본');
    expect(undoLastChange()).toBe('empty');
  });

  it('삭제한 여행이 되살아난다', () => {
    addTrip(named('둘째 여행', 't2'));
    expect(removeTrip('t2')).toBe(true);
    expect(getTripStoreSnapshot()?.trips).toHaveLength(1);

    expect(undoLastChange()).toBe('ok');
    expect(getTripStoreSnapshot()?.trips.map(t => t.id)).toEqual(['t1', 't2']);
  });

  // 레거시 앱을 같이 열어 두는 게 병행 운영의 전제다. 되돌리면 저쪽 편집이 흔적 없이 사라진다.
  it('다른 탭이 저장소를 바꿨으면 되돌리지 않고 그대로 둔다', () => {
    saveTrip(named('내 편집', 't1'));
    const foreign = JSON.stringify({ trips: [named('레거시가 쓴 여행', 't1')], activeId: 't1' });
    mem.set(LS_KEY, foreign);

    expect(undoLastChange()).toBe('stale');
    expect(raw()).toBe(foreign);          // 저쪽 편집이 그대로 남아 있다
    expect(getUndoDepth()).toBe(1);       // 칸을 버리지도 않는다
  });

  it('이 앱이 다시 쓰고 나면 되돌리기가 풀린다', () => {
    saveTrip(named('내 편집', 't1'));
    mem.set(LS_KEY, JSON.stringify({ trips: [named('레거시', 't1')], activeId: 't1' }));
    expect(undoLastChange()).toBe('stale');

    saveTrip(named('다시 내 편집', 't1'));
    expect(undoLastChange()).toBe('ok');
    expect(nameOf('t1')).toBe('레거시');   // 이 앱이 마지막으로 덮기 직전 상태
  });

  it('손상된 스냅샷은 되살리지 않고 그 칸을 버린다', () => {
    const before = raw()!;
    recordWrite('{"trips": 이건 JSON이 아니다}', before);

    expect(undoLastChange()).toBe('invalid');
    expect(raw()).toBe(before);
    expect(getUndoDepth()).toBe(0);
  });
});

// 원문이 깨졌거나 더 새로운 스키마라 못 읽으면 화면은 '여행이 없어요'로 떨어진다.
// 거기서 새 여행을 만드는 순간 원문이 사라지는 게 없으면 조용한 유실이다 (레거시 load()와 같은 방어).
describe('검증에 걸린 저장소 보존', () => {
  it('못 읽는 원문을 덮어쓰기 전에 남긴다', () => {
    const broken = '{"trips": [{"id": 그런데 이건 JSON이 아니다}]}';
    mem.set(LS_KEY, broken);
    resetUndoForTest();

    expect(getTripStoreSnapshot()).toBeNull();       // 화면에는 여행이 없다
    expect(addTrip(named('새로 만든 여행', 'n1'))).toBe(true);

    expect(mem.get(REJECTED_KEY)).toBe(broken);      // 원문은 남아 있다
    expect(getTripStoreSnapshot()?.trips.map(t => t.id)).toEqual(['n1']);
  });

  it('멀쩡한 원문은 백업하지 않는다', () => {
    mem.delete(REJECTED_KEY);
    saveTrip(named('그냥 편집', 't1'));
    expect(mem.has(REJECTED_KEY)).toBe(false);
  });

  it('저장소가 비어 있으면 백업할 것도 없다', () => {
    mem.clear();
    resetUndoForTest();
    addTrip(named('첫 여행', 't1'));
    expect(mem.has(REJECTED_KEY)).toBe(false);
  });
});
