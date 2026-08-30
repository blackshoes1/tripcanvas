'use client';
// 버전 히스토리 — 클라우드에 쌓인 시점 목록에서 하나를 골라 되돌린다.
// 자동 기록은 여행이 올라갈 때 10분에 한 번(services/tripSnapshots).
import { useEffect, useState } from 'react';

import { snapshotLabel, type SnapshotRow } from '../domain/snapshots';
import { listSnapshots, loadSnapshot } from '../services/tripSnapshots';
import type { Trip } from '@/features/trip/domain/types';

type State =
  | { kind: 'off' }
  | { kind: 'loading' }
  | { kind: 'ready'; rows: SnapshotRow[] };

export function SnapshotList({ clientId, signedIn, onRestore }: {
  clientId: string;
  signedIn: boolean;
  /** 되돌릴 여행 — 실패하면 이유를 돌려준다 */
  onRestore: (trip: Trip) => void;
}) {
  // 초기 상태는 파생한다 — 이펙트 본문에서 동기로 setState하면 렌더가 한 번 더 돈다
  const [state, setState] = useState<State>(signedIn ? { kind: 'loading' } : { kind: 'off' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    void listSnapshots(clientId).then(rows => { if (alive) setState({ kind: 'ready', rows }); });
    return () => { alive = false; };
  }, [clientId, signedIn]);

  if (!signedIn) {
    return <p className="hint">로그인하면 자동으로 버전이 기록됩니다 (10분 간격, 최근 15개).</p>;
  }
  if (state.kind === 'loading') return <p className="hint">불러오는 중…</p>;
  if (state.kind === 'off' || !state.rows.length) {
    return <p className="hint">저장된 버전이 없습니다 — 클라우드에 올라갈 때 10분 간격으로 기록됩니다.</p>;
  }

  const restore = async (id: number) => {
    if (!window.confirm('이 시점으로 되돌릴까요? 지금 내용은 덮어씁니다.')) return;
    setBusy(true);
    setError(null);
    try {
      const r = await loadSnapshot(id);
      if (!r.ok) { setError(r.error); return; }
      onRestore(r.trip);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="itSnapList">
      {error && <div className="itEditErr" role="alert">{error}</div>}
      {state.rows.map(r => (
        <div key={r.id} className="itSnapRow">
          <span>{snapshotLabel(r.created_at)}</span>
          <button type="button" disabled={busy} onClick={() => void restore(r.id)}>되돌리기</button>
        </div>
      ))}
    </div>
  );
}
