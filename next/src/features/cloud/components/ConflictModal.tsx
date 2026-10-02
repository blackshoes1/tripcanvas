'use client';
// 동기화 충돌 — 어느 버전을 남길지 사용자가 고른다. 셋 다 로컬을 조용히 버리지 않는다.
import type { Conflict } from '../domain/conflictResolve';

const WHY: Record<Conflict['kind'], string> = {
  'changed-both': '이 기기와 다른 기기에서 모두 바뀌었어요.',
  'remote-deleted': '다른 기기에서 이 여행을 삭제했어요.',
  'remote-missing': '클라우드에서 이 여행을 찾지 못했어요.'
};

export function ConflictModal({ conflict, remaining, onChoose }: {
  conflict: Conflict;
  /** 이 건 말고 더 남은 충돌 수 */
  remaining: number;
  onChoose: (choice: 'cloud' | 'device' | 'both') => void;
}) {
  const name = conflict.local?.name || conflict.remote?.name || '여행';
  const hasRemote = !!conflict.remote && !conflict.deleted_at;
  return (
    <div className="itEditorBg">
      <div className="itEditor" role="dialog" aria-modal="true" aria-label="동기화 충돌">
        <h2>동기화 충돌</h2>
        <p>
          <b>“{name}”</b> — {conflict.reviveRefused
            // 이유 없이 같은 카드를 다시 띄우면 같은 버튼을 끝없이 누르게 된다
            ? '주최자가 지운 여행이라 주최자만 되살릴 수 있어요. 이 기기 버전은 복사본으로 남겨 주세요.'
            : `${WHY[conflict.kind]} 어느 버전을 남길지 골라주세요.`}
        </p>
        <p className="hint">
          어느 쪽을 고르든 이 기기의 내용은 사라지지 않아요 — “둘 다 보관”을 고르면 복사본으로 남아요.
          {remaining > 0 && ` (남은 충돌 ${remaining}건)`}
        </p>
        <div className="itConflictBtns">
          <button type="button" onClick={() => onChoose('device')} disabled={!!conflict.reviveRefused}>
            📱 이 기기 버전
            <small>다른 기기의 변경을 덮어써요</small>
          </button>
          <button type="button" onClick={() => onChoose('cloud')} disabled={!hasRemote && conflict.kind !== 'remote-deleted'}>
            ☁️ 클라우드 버전
            <small>{conflict.deleted_at ? '이 기기에서도 삭제해요' : '다른 기기의 내용을 받아요'}</small>
          </button>
          <button type="button" className="itEditSave" onClick={() => onChoose('both')}
            disabled={!conflict.local}>
            🧬 둘 다 보관
            <small>이 기기 버전을 복사본으로 남겨요</small>
          </button>
        </div>
      </div>
    </div>
  );
}
