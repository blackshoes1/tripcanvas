'use client';
// 여행 전환·생성·편집 — 레거시 헤더의 여행 선택 + 여행 모달과 같은 역할.
import { useState } from 'react';

import { SnapshotList } from '@/features/cloud/components/SnapshotList';
import type { Trip } from '../domain/types';
import { updateTripMeta, type TripEditError } from '../domain/tripEditor';

const ERR_MSG: Record<TripEditError, string> = {
  BAD_TIMEZONE: '시간대는 Asia/Tokyo 같은 IANA 형식으로 입력해 주세요',
  LAST_DAY: '여행에는 일자가 하나 이상 필요합니다',
  NO_SUCH_DAY: '그 일자를 찾지 못했어요'
};

export function TripBar({ trips, activeTrip, onSwitch, onNew, onSave, onDelete, signedIn, onRestore }: {
  trips: Trip[];
  activeTrip: Trip;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onSave: (next: Trip) => void;
  onDelete: () => void;
  /** 로그인 상태 — 버전 히스토리는 클라우드에 쌓인다 */
  signedIn?: boolean;
  /** 그 시점으로 되돌리기 */
  onRestore?: (trip: Trip) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(activeTrip.name);
  const [start, setStart] = useState(activeTrip.start);
  const [timeZone, setTimeZone] = useState(activeTrip.timeZone ?? '');
  const [error, setError] = useState<string | null>(null);

  const openEditor = () => {
    setName(activeTrip.name);
    setStart(activeTrip.start);
    setTimeZone(activeTrip.timeZone ?? '');
    setError(null);
    setOpen(true);
  };

  const submit = () => {
    const r = updateTripMeta(activeTrip, { name, start, timeZone });
    if (!r.ok) { setError(ERR_MSG[r.error]); return; }
    onSave(r.trip);
    setOpen(false);
  };

  return (
    <div className="itTripBar">
      {trips.length > 1 ? (
        <select className="itTripSel" value={activeTrip.id} aria-label="여행 선택"
          onChange={e => onSwitch(e.target.value)}>
          {trips.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      ) : (
        <span className="itTripName">{activeTrip.name}</span>
      )}
      <button type="button" onClick={openEditor} title="여행 이름·날짜·시간대">✎ 여행 정보</button>
      <button type="button" onClick={onNew} title="새 여행 만들기">＋ 새 여행</button>

      {open && (
        <div className="itEditorBg" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="itEditor" role="dialog" aria-modal="true" aria-label="여행 정보">
            <h2>여행 정보</h2>
            <label>여행 이름
              <input value={name} onChange={e => setName(e.target.value)} autoFocus />
            </label>
            <div className="itEditRow2">
              <label>시작일
                <input type="date" value={start} onChange={e => setStart(e.target.value)} />
              </label>
              <label>시간대
                <input value={timeZone} onChange={e => setTimeZone(e.target.value)} placeholder="Asia/Seoul" />
              </label>
            </div>
            <p className="hint">시작일을 바꾸면 모든 일자가 함께 움직입니다. 시간대는 대중교통 시각 계산에 쓰입니다.</p>
            {onRestore && (
              <details className="itSnapDetails">
                <summary>🕘 버전 기록</summary>
                <SnapshotList
                  clientId={activeTrip.id} signedIn={!!signedIn}
                  onRestore={t => { setOpen(false); onRestore(t); }}
                />
              </details>
            )}
            {error && <div className="itEditErr" role="alert">{error}</div>}
            <div className="itEditBtns">
              {trips.length > 1 && (
                <button type="button" className="itEditDel" onClick={() => { setOpen(false); onDelete(); }}>
                  여행 삭제
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)}>취소</button>
              <button type="button" className="itEditSave" onClick={submit}>저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
