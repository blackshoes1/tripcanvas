'use client';
// 붙여넣기 초안 — 자유로운 글이나 정해진 형식을 붙여넣어 일정을 만든다.
// 판정은 domain(pasteDraft), 네트워크는 services(aiParse·geocodeDraft)가 한다 (§27).
import { useState } from 'react';

import { useCfg } from '@/features/settings/hooks/useCfg';
import type { Trip } from '@/features/trip/domain/types';
import {
  applyDraft, draftFromAi, draftFromText, noLocCount, spotsNeedingCoords, type DraftTarget
} from '../domain/pasteDraft';
import { fillCoords } from '../services/geocodeDraft';
import { parseWithAi } from '../services/aiParse';

const DIRECT_PLACEHOLDER = `여행이름: 다롄 2박3일
시작일: 2026-07-15

[Day 1] 다롄 도착
이동: ✈️ 인천 → 다롄
- @13:00 성해광장 | 다롄 | 점심 후 도착
- (선택) 러시아 거리 | 다롄 | 입장 ¥500

[Day 2] 시내
- 여순 감옥 | 다롄 | 25000원`;

const AI_PLACEHOLDER =
  '예) 다다음주 다롄 2박3일 갈 거야. 첫날 오후 인천서 출발해서 성해광장이랑 러시아거리 야경 보고, '
  + '둘째날은 여순감옥이랑 노호탄공원, 셋째날 오전에 시장 구경하고 귀국.';

const MODELS = ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5-20251001'];

export function PasteModal({ current, onApply, onClose, ids }: {
  current: Trip | null;
  /** 만들어진 여행을 저장소에 넣는다 — 실패하면 false. noLoc은 좌표를 못 찾은 장소 수 */
  onApply: (trip: Trip, target: DraftTarget, noLoc: number) => boolean;
  onClose: () => void;
  ids: { newId: () => string; today: () => string };
}) {
  const { cfg, setCfg } = useCfg();
  const [text, setText] = useState('');
  const [target, setTarget] = useState<DraftTarget>('new');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    setBusy(cfg.aiParse ? 'AI가 일정을 정리하는 중…' : '읽는 중…');
    try {
      let draft;
      if (cfg.aiParse) {
        const ai = await parseWithAi(text, cfg);
        if (!ai.ok) { setError(ai.error); return; }
        draft = draftFromAi(ai.value);
      } else {
        draft = draftFromText(text);
      }
      if (!draft.ok) { setError(draft.error); return; }

      // 좌표 없는 장소는 찾아서 채우되, 못 찾아도 버리지 않는다 ('위치 미지정'으로 남는다)
      const need = spotsNeedingCoords(draft.draft.days);
      if (need.length) {
        await fillCoords(need, (i, n, name) => setBusy(`좌표 찾는 중… (${i}/${n}) ${name}`));
      }
      const noloc = noLocCount(draft.draft.days);

      const applied = applyDraft(current, draft.draft, target, { newId: ids.newId(), today: ids.today() });
      if (!applied.ok) { setError(applied.error); return; }
      if (!onApply(applied.trip, target, noloc)) {
        setError('저장에 실패했어요 — 저장 공간을 확인해주세요');
        return;
      }
      onClose();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="itEditorBg" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="itEditor itPaste" role="dialog" aria-modal="true" aria-label="붙여넣기로 초안 만들기">
        <h2>붙여넣기로 초안 만들기</h2>

        <label className="itEditChk">
          <input type="checkbox" checked={cfg.aiParse} onChange={e => setCfg({ aiParse: e.target.checked })} />
          AI로 자연어 해석하기
        </label>
        <p className="hint">
          {cfg.aiParse
            ? '자연어로 자유롭게 붙여넣으면 AI가 날짜·도시·장소·좌표를 정리해줍니다.'
            : '아래 형식으로 붙여넣으면 AI 없이 즉시 만듭니다. 좌표는 자동으로 찾습니다(국내 카카오·해외 구글).'}
        </p>

        {cfg.aiParse ? (
          <div className="itEditAdv">
            <div className="itEditRow2">
              <label>API 키
                <input type="password" value={cfg.apiKey} placeholder="sk-ant-…"
                  autoComplete="off" spellCheck={false}
                  onChange={e => setCfg({ apiKey: e.target.value.trim() })} />
              </label>
              <label>모델
                <select value={cfg.model} onChange={e => setCfg({ model: e.target.value })}>
                  {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            </div>
            <p className="hint">키는 이 브라우저에만 저장되고, 요청은 Anthropic API로만 갑니다.</p>
          </div>
        ) : (
          <button type="button" className="itPasteFmt" onClick={() => setText(DIRECT_PLACEHOLDER)}>
            형식 예시 넣기
          </button>
        )}

        <label>붙여넣기
          <textarea value={text} onChange={e => setText(e.target.value)} rows={10}
            placeholder={cfg.aiParse ? AI_PLACEHOLDER : DIRECT_PLACEHOLDER} />
        </label>

        <label>어디에 넣을까요
          <select value={target} onChange={e => setTarget(e.target.value as DraftTarget)}>
            <option value="new">새 여행으로</option>
            <option value="append" disabled={!current}>지금 여행 뒤에 덧붙이기</option>
            <option value="overwrite" disabled={!current}>지금 여행의 일정을 바꾸기</option>
          </select>
        </label>

        {busy && <div className="itPasteBusy" role="status">{busy}</div>}
        {error && <div className="itEditErr" role="alert">{error}</div>}
        <div className="itEditBtns">
          <button type="button" onClick={onClose} disabled={!!busy}>취소</button>
          <button type="button" className="itEditSave" onClick={() => void run()} disabled={!!busy || !text.trim()}>
            초안 만들기
          </button>
        </div>
      </div>
    </div>
  );
}
