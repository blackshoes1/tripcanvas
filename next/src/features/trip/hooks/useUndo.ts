'use client';
// 되돌리기 배선 — 버튼 활성 상태와 Ctrl/Cmd+Z를 잇는다. 판단은 domain, 되쓰기는 services.
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import { undoLastChange, type UndoResult } from '../services/localTripStore';
import { getUndoDepth, getUndoServerDepth, subscribeUndo } from '../services/undoStore';

const MSG: Record<UndoResult, string> = {
  ok: '실행취소됨',
  empty: '되돌릴 작업이 없습니다',
  // 레거시 앱을 같이 열어 두는 게 병행 운영의 전제다. 되돌리면 저쪽 편집까지 흔적 없이 사라진다.
  stale: '다른 탭에서 여행이 바뀌었어요 — 그 편집까지 사라져서 되돌리지 않았습니다',
  invalid: '그 시점의 기록이 손상돼 되돌리지 못했어요',
  failed: '저장에 실패했어요 — 저장 공간을 확인해주세요'
};

/**
 * @param enabled 읽기전용(공유 링크 보기)에서는 끈다 — 저장소를 쓰지 않는 화면이다
 * @param onUndone 되돌린 뒤 화면 상태를 되돌릴 자리 — 선택한 장소·펼친 일자가
 *                 사라진 것을 가리킬 수 있다 (레거시도 activeDay를 0으로 되돌린다)
 */
export function useUndo(enabled: boolean, onNotice: (msg: string) => void, onUndone?: () => void) {
  const depth = useSyncExternalStore(subscribeUndo, getUndoDepth, getUndoServerDepth);

  // 콜백은 최신 값을 봐야 하지만 참조는 안정적이어야 한다 — 매 렌더 keydown을 다시 걸지 않게
  const noticeRef = useRef(onNotice);
  const undoneRef = useRef(onUndone);
  useEffect(() => {
    noticeRef.current = onNotice;
    undoneRef.current = onUndone;
  });

  const undo = useCallback(() => {
    if (!enabled) return;
    const result = undoLastChange();
    noticeRef.current(MSG[result]);
    if (result === 'ok') undoneRef.current?.();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
      // 입력 중엔 브라우저 기본 동작(글자 되돌리기)을 뺏지 않는다
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && (t.isContentEditable || t.closest('input,textarea,select'))) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, undo]);

  return { canUndo: depth > 0, undo };
}
