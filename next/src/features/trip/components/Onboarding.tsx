'use client';
// 첫 방문 소개 — 레거시 index.html의 #onboarding과 같은 네 갈래를 준다.
// 어느 갈래든 소개를 닫고 곧바로 그 일을 시작한다 (닫기만 하는 버튼은 두지 않는다).
import { useEffect, useRef } from 'react';

export function Onboarding({ onPaste, onNew, onSample, onSignIn, canSignIn }: {
  onPaste: () => void;
  onNew: () => void;
  onSample: () => void;
  onSignIn: () => void;
  /** 로그인 설정이 없으면(키 미설정) 안내를 걸어두지 않는다 */
  canSignIn?: boolean;
}) {
  const firstRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { firstRef.current?.focus(); }, []);

  return (
    <div className="itOnboardBg" role="dialog" aria-modal="true" aria-labelledby="itOnboardTitle">
      <div className="itOnboard">
        <div className="itOnboardMark" aria-hidden="true">▣</div>
        <p className="itOnboardEyebrow">TRIP CANVAS</p>
        <h1 id="itOnboardTitle">여행을<br />더 쉽게 계획하세요</h1>
        <p className="itOnboardLead">대화로 입력하고, 지도에서 동선을 한눈에 확인하세요.</p>
        <div className="itOnboardActions">
          <button type="button" ref={firstRef} className="itOnboardPrimary" onClick={onPaste}>
            ▧ 일정 붙여넣기로 시작
          </button>
          <button type="button" onClick={onNew}>＋ 새 여행 만들기</button>
          <button type="button" className="itOnboardGhost" onClick={onSample}>⌁ 샘플 둘러보기</button>
        </div>
        {canSignIn && (
          <button type="button" className="itOnboardLogin" onClick={onSignIn}>
            이미 계정이 있으신가요? <u>로그인</u>
          </button>
        )}
      </div>
    </div>
  );
}
