// 되돌리기 스택 — 저장소 스냅샷을 **메모리에만** 쌓는다.
// localStorage에 두면 30칸 × 여행 전체가 쿼터를 잡아먹어 정작 저장이 실패한다.
// 새로고침하면 비워지는 것도 레거시와 같다 (histStack).
import { dropUndo, peekUndo, pushUndo, undoVerdict, type UndoVerdict } from '../domain/undoHistory';

let stack: readonly string[] = [];
/** 이 앱이 마지막으로 저장소에 쓴 값 — 다른 탭이 끼어들었는지 가리는 기준 */
let lastWritten: string | null = null;
const listeners = new Set<() => void>();

function emit() { listeners.forEach(l => l()); }

export function subscribeUndo(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** 되돌릴 수 있는 칸 수 — useSyncExternalStore 스냅샷(숫자라 참조 안정성 문제가 없다) */
export function getUndoDepth(): number { return stack.length; }
export function getUndoServerDepth(): number { return 0; }

/**
 * 저장에 **성공한 뒤** 부른다. 실패한 저장을 쌓으면 떠난 적 없는 상태로 '되돌아가게' 된다.
 * @param history 되돌리기 자신의 되쓰기는 false — 안 그러면 Ctrl+Z가 같은 자리를 오간다
 *                (레거시 histLock과 같은 뜻).
 */
export function recordWrite(prev: string | null, next: string, history = true): void {
  if (history) {
    const grown = pushUndo(stack, prev, next);
    if (grown !== stack) { stack = grown; emit(); }
  }
  lastWritten = next;
}

/** 되돌릴 대상과 그래도 되는지의 판정 */
export function readUndo(currentRaw: string | null): { verdict: UndoVerdict; snapshot: string | null } {
  return { verdict: undoVerdict(stack, currentRaw, lastWritten), snapshot: peekUndo(stack) };
}

/** 되돌리기가 끝난(또는 못 쓸 스냅샷이라 버리는) 칸을 뺀다 */
export function dropUndoTop(): void {
  const next = dropUndo(stack);
  if (next !== stack) { stack = next; emit(); }
}

/** 테스트 전용 — 모듈 전역이라 테스트끼리 상태가 새지 않게 비운다 */
export function resetUndoForTest(): void {
  stack = [];
  lastWritten = null;
  emit();
}
