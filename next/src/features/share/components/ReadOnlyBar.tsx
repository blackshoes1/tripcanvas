'use client';
// 읽기전용 보기 배너 — 남의 공유 링크(#v=)로 열었을 때. 저장소에는 아직 아무것도 들어가지 않았다.
export function ReadOnlyBar({ name, onClaim, onDismiss }: {
  name: string;
  onClaim: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="itRoBar" role="status">
      <span>👀 <b>{name}</b> — 읽기전용으로 보는 중입니다. 편집하려면 내 여행으로 저장하세요.</span>
      <button type="button" className="itRoSave" onClick={onClaim}>내 여행으로 저장</button>
      <button type="button" onClick={onDismiss} title="저장하지 않고 내 여행으로 돌아가기">닫기</button>
    </div>
  );
}
