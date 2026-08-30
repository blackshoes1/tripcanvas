// 되돌리기 히스토리 (순수) — 저장소 전체의 직렬화 스냅샷을 쌓는다.
// 레거시 app.js의 histStack과 같은 규칙: 30칸, 내용이 바뀔 때만 쌓고, 되돌리기 자체는 쌓지 않는다.

/** 쌓아 두는 스냅샷 수 (레거시와 동일) */
export const UNDO_LIMIT = 30;

/** 되돌리기를 시도했을 때의 판정 */
export type UndoVerdict =
  /** 되돌릴 수 있다 */
  | 'ok'
  /** 되돌릴 작업이 없다 */
  | 'empty'
  /** 다른 탭이 저장소를 바꿨다 — 되돌리면 그 편집이 조용히 사라진다 */
  | 'stale';

/**
 * 바꾸기 **직전** 상태를 쌓는다.
 *
 * - `prev`가 없으면(저장소가 처음 생기는 순간) 돌아갈 곳이 없으므로 쌓지 않는다.
 * - 내용이 같으면 쌓지 않는다 — 되돌려도 아무것도 안 바뀌는 칸이 30칸을 밀어내면
 *   정작 되돌리고 싶은 편집이 히스토리 밖으로 빠진다.
 * - 바뀐 게 없으면 **받은 배열을 그대로** 돌려준다(참조 안정성 — 헛렌더 방지).
 */
export function pushUndo(
  stack: readonly string[], prev: string | null, next: string
): readonly string[] {
  if (prev == null || prev === next) return stack;
  const grown = [...stack, prev];
  return grown.length > UNDO_LIMIT ? grown.slice(grown.length - UNDO_LIMIT) : grown;
}

/**
 * 되돌려도 되는지 판단한다.
 *
 * ⚠️ `stale`이 이 판정의 핵심이다. 레거시 앱과 Next를 **동시에 열어 두는 것이 병행 운영의 전제**라,
 * 저쪽에서 편집한 뒤 이쪽에서 Ctrl+Z를 누르면 내 편집만이 아니라 **저쪽 편집까지 함께 사라진다**
 * (히스토리에 쌓인 스냅샷은 저쪽 편집을 모르기 때문). 흔적 없는 유실이라 되돌리지 않고 알린다.
 *
 * @param stack 쌓인 스냅샷
 * @param currentRaw 지금 저장소에 들어 있는 값
 * @param lastWritten 이 앱이 마지막으로 쓴 값 (아직 쓴 적 없으면 null)
 */
export function undoVerdict(
  stack: readonly string[], currentRaw: string | null, lastWritten: string | null
): UndoVerdict {
  if (!stack.length) return 'empty';
  if (lastWritten == null || currentRaw !== lastWritten) return 'stale';
  return 'ok';
}

/** 가장 최근 스냅샷 (되돌릴 게 없으면 null) — 꺼내지는 않는다 */
export function peekUndo(stack: readonly string[]): string | null {
  return stack.length ? stack[stack.length - 1] : null;
}

/**
 * 가장 최근 스냅샷을 버린다. 되돌리기가 **성공한 뒤에만** 부른다 —
 * 복원에 실패했는데 먼저 버리면 그 편집으로 다시는 못 돌아간다.
 */
export function dropUndo(stack: readonly string[]): readonly string[] {
  return stack.length ? stack.slice(0, -1) : stack;
}
