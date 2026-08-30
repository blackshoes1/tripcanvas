'use client';
// 가져오기·내보내기·공유 버튼 — 판정은 domain, 브라우저 표면은 services가 한다(§9).
import { useRef, useState } from 'react';

import type { Trip } from '@/features/trip/domain/types';
import { buildShareUrl } from '../domain/shareLink';
import { IMPORT_MAX_BYTES, exportFilename, exportJson, importTrip } from '../domain/tripFile';
import { compressShare } from '../services/shareCodec';
import { copyText, downloadText, readTextFile } from '../services/fileTransfer';

export function TripFileBar({ trip, onImport, onNotice, newId, onPaste }: {
  trip: Trip;
  /** 가져온 여행을 저장소에 넣는다 — 실패하면 false */
  onImport: (t: Trip) => boolean;
  onNotice: (msg: string) => void;
  newId: () => string;
  /** 붙여넣기 초안 모달 열기 */
  onPaste?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  /** 클립보드가 막혔을 때 손으로 복사하도록 링크를 그대로 보여준다 */
  const [manualUrl, setManualUrl] = useState<string | null>(null);

  const doExport = () => {
    downloadText(exportJson(trip), exportFilename(trip.name));
    onNotice('내보내기 완료');
  };

  const doImport = async (file: File) => {
    const read = await readTextFile(file, IMPORT_MAX_BYTES);
    if (!read.ok) { onNotice(read.error); return; }
    const r = importTrip(read.text, newId());
    if (!r.ok) { onNotice(`안전하게 읽을 수 없는 여행 파일입니다 — ${r.error}`); return; }
    onNotice(onImport(r.trip) ? `"${r.trip.name}" 가져오기 완료` : '가져온 여행을 저장하지 못했어요');
  };

  const doShare = async () => {
    // 도메인은 압축기를 모른다 — 어댑터를 인자로 넘긴다
    const base = { origin: window.location.origin, pathname: window.location.pathname };
    const r = buildShareUrl(trip, base, compressShare);
    if (!r.ok) { onNotice(r.error); return; }
    if (await copyText(r.url)) { setManualUrl(null); onNotice('읽기전용 공유 링크가 복사되었습니다'); return; }
    setManualUrl(r.url);
    onNotice('클립보드를 쓸 수 없어 링크를 아래에 띄웠어요 — 직접 복사해 주세요');
  };

  return (
    <div className="itFileBar">
      <button type="button" onClick={doExport} title="이 여행을 JSON 파일로 저장">⬇ 내보내기</button>
      <button type="button" onClick={() => fileRef.current?.click()} title="JSON 파일에서 여행 가져오기">
        ⬆ 가져오기
      </button>
      <button type="button" onClick={doShare} title="읽기전용 보기 링크를 복사">🔗 공유</button>
      {onPaste && (
        <button type="button" onClick={onPaste} title="글을 붙여넣어 일정 초안 만들기">📋 붙여넣기</button>
      )}
      <input
        ref={fileRef} type="file" accept="application/json,.json" hidden
        aria-label="여행 파일 가져오기"
        onChange={e => {
          const f = e.target.files?.[0];
          e.target.value = '';                 // 같은 파일을 다시 골라도 change가 뜨도록
          if (f) void doImport(f);
        }}
      />
      {manualUrl && (
        <input className="itShareUrl" readOnly value={manualUrl} aria-label="공유 링크"
          onFocus={e => e.currentTarget.select()} />
      )}
    </div>
  );
}
