import { describe, expect, it } from 'vitest';

import { dropUndo, peekUndo, pushUndo, undoVerdict, UNDO_LIMIT } from './undoHistory';

describe('pushUndo', () => {
  it('바꾸기 직전 상태를 쌓는다', () => {
    expect(pushUndo([], 'a', 'b')).toEqual(['a']);
    expect(pushUndo(['a'], 'b', 'c')).toEqual(['a', 'b']);
  });

  // 저장소가 처음 생기는 순간 — 돌아갈 곳이 없다
  it('직전 상태가 없으면 쌓지 않는다', () => {
    const stack: readonly string[] = [];
    expect(pushUndo(stack, null, 'a')).toBe(stack);
  });

  // 되돌려도 아무것도 안 바뀌는 칸이 30칸을 밀어내면 정작 되돌릴 편집이 사라진다
  it('내용이 같으면 쌓지 않고 받은 배열을 그대로 돌려준다', () => {
    const stack: readonly string[] = ['a'];
    expect(pushUndo(stack, 'b', 'b')).toBe(stack);
  });

  it(`${UNDO_LIMIT}칸을 넘으면 가장 오래된 것부터 버린다`, () => {
    let stack: readonly string[] = [];
    for (let i = 0; i < UNDO_LIMIT + 5; i++) stack = pushUndo(stack, `s${i}`, `s${i + 1}`);
    expect(stack).toHaveLength(UNDO_LIMIT);
    expect(stack[0]).toBe('s5');
    expect(stack[UNDO_LIMIT - 1]).toBe(`s${UNDO_LIMIT + 4}`);
  });
});

describe('undoVerdict', () => {
  it('내가 쓴 그대로면 되돌릴 수 있다', () => {
    expect(undoVerdict(['a'], 'b', 'b')).toBe('ok');
  });

  it('쌓인 게 없으면 empty', () => {
    expect(undoVerdict([], 'b', 'b')).toBe('empty');
    // 되돌릴 게 없다는 판정이 먼저다 — 빈 히스토리는 stale일 수도 없다
    expect(undoVerdict([], 'x', 'b')).toBe('empty');
  });

  // 레거시 앱과 Next를 동시에 열어 두는 것이 병행 운영의 전제다.
  // 저쪽 편집을 흔적 없이 지우느니 되돌리지 않는다.
  it('다른 탭이 저장소를 바꿨으면 stale', () => {
    expect(undoVerdict(['a'], '레거시가-쓴-값', 'b')).toBe('stale');
  });

  it('이 앱이 아직 쓴 적 없으면 stale', () => {
    expect(undoVerdict(['a'], 'b', null)).toBe('stale');
  });

  // 지워진 저장소(초기화)도 내가 쓴 값과 다르다
  it('저장소가 비었는데 쓴 기록이 있으면 stale', () => {
    expect(undoVerdict(['a'], null, 'b')).toBe('stale');
  });
});

describe('peekUndo · dropUndo', () => {
  it('가장 최근 것을 보여주고, 버리면 그 앞이 나온다', () => {
    const stack = ['a', 'b', 'c'];
    expect(peekUndo(stack)).toBe('c');
    const after = dropUndo(stack);
    expect(peekUndo(after)).toBe('b');
    // 원본은 그대로 (불변)
    expect(stack).toEqual(['a', 'b', 'c']);
  });

  it('빈 히스토리는 null이고 버려도 그대로다', () => {
    const stack: readonly string[] = [];
    expect(peekUndo(stack)).toBeNull();
    expect(dropUndo(stack)).toBe(stack);
  });
});
