'use client';
// 재생 HUD — 레거시 #playHud와 같은 구성(현재 구간 · 진행바 · 이전/일시정지/다음 · 구간수 · 배속).
// 판정은 전부 usePlayback이 하고 여기는 표시와 입력만 받는다.
import { useRef } from 'react';

import { MODE_ICON, fmtDur } from '@/features/itinerary/domain/dayView';
import type { PlaySpeed, PlayStatus } from '../hooks/usePlayback';

const SPEEDS: PlaySpeed[] = [0.5, 1, 2];

export function PlayHud({ status, speed, onSpeed, onToggle, onPrev, onNext, onStop, onSeekPreview, onSeekCommit, onPause, onResume }: {
  status: PlayStatus;
  speed: PlaySpeed;
  onSpeed: (s: PlaySpeed) => void;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onStop: () => void;
  onSeekPreview: (frac: number) => void;
  onSeekCommit: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const wasPlaying = useRef(false);

  const fracOf = (clientX: number) => {
    const r = bar.current?.getBoundingClientRect();
    return r ? (clientX - r.left) / (r.width || 1) : 0;
  };

  const legLabel = status.at
    ? `${status.at.from} → ${status.at.to}`
      + (status.at.sec != null ? ` · ${MODE_ICON[status.at.mode]} ${fmtDur(status.at.sec)}` : '')
    : '';

  return (
    <div className="itPlayHud" role="group" aria-label="재생 제어">
      <div className="itPlayLeg">{legLabel}</div>
      <div
        ref={bar} className="itPlayBar" title="드래그·클릭으로 구간 탐색"
        role="slider" aria-label="재생 위치" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(status.progress * 100)}
        onPointerDown={e => {
          dragging.current = true;
          try { bar.current?.setPointerCapture(e.pointerId); } catch { /* 캡처 미지원 */ }
          wasPlaying.current = !status.paused;
          if (wasPlaying.current) onPause();
          onSeekPreview(fracOf(e.clientX));
          e.preventDefault();
        }}
        onPointerMove={e => { if (dragging.current) onSeekPreview(fracOf(e.clientX)); }}
        onPointerUp={() => {
          if (!dragging.current) return;
          dragging.current = false;
          onSeekCommit();
          if (wasPlaying.current) onResume();
        }}
        onPointerCancel={() => { dragging.current = false; }}
      >
        <div className="itPlayBarFill" style={{ width: `${(status.progress * 100).toFixed(1)}%` }} />
      </div>
      <div className="itPlayCtl">
        <button type="button" title="이전 구간" aria-label="이전 구간" onClick={onPrev}>⏮</button>
        <button type="button" title="일시정지 / 이어보기" aria-label={status.paused ? '이어보기' : '일시정지'}
          onClick={onToggle}>{status.paused ? '▶' : '⏸'}</button>
        <button type="button" title="다음 구간" aria-label="다음 구간" onClick={onNext}>⏭</button>
        <span className="itPlaySeg">{status.legIndex + 1} / {status.legCount}</span>
        <span className="itPlaySpeeds">
          {SPEEDS.map(s => (
            <button key={s} type="button" className={s === speed ? 'on' : ''}
              aria-pressed={s === speed} onClick={() => onSpeed(s)}>{s}×</button>
          ))}
        </span>
        <button type="button" className="itPlayStop" title="정지" onClick={onStop}>⏹</button>
      </div>
    </div>
  );
}

/**
 * 전체 재생 중 날짜가 바뀔 때 잠깐 뜨는 카드 (레거시 #playDayCard).
 * 사라지는 건 CSS 애니메이션이 맡는다 — 호출측이 key를 바꿔 리마운트하면 다시 재생된다.
 */
export function PlayDayCard({ label }: { label: string }) {
  return <div className="itPlayDayCard" role="status">{label}</div>;
}
