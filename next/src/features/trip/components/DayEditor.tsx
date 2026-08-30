'use client';
// 일자 편집 — 레거시 일자 모달과 같은 항목(날짜·출발시각·시간대·이월·수단·항공·제목·메모).
// 판정은 domain(updateDay)이 하고 폼은 표현만 한다 (§27).
import { useState } from 'react';

import { MODE_ICON, MODE_NAME } from '@/features/itinerary/domain/dayView';
import type { DayFlight, TransportMode, Trip } from '../domain/types';
import { isoDateOf, updateDay, type DayPatch, type TripEditError } from '../domain/tripEditor';

const ERR_MSG: Record<TripEditError, string> = {
  BAD_TIMEZONE: '시간대는 Asia/Tokyo 같은 IANA 형식으로 입력해 주세요',
  LAST_DAY: '여행에는 일자가 하나 이상 필요합니다',
  NO_SUCH_DAY: '그 일자를 찾지 못했어요'
};

const MODES: TransportMode[] = ['car', 'taxi', 'transit', 'train', 'walk', 'bike', 'flight'];

export function DayEditor({ trip, di, onSave, onDuplicate, onDelete, onCancel }: {
  trip: Trip;
  di: number;
  onSave: (next: Trip) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const day = trip.days[di];
  const [form, setForm] = useState<DayPatch>(() => ({
    title: day.title ?? '',
    drive: day.drive ?? '',
    note: day.note ?? '',
    mode: day.mode ?? 'car',
    startAt: day.startAt ?? '09:00',
    timeZone: day.timeZone ?? '',
    carry: day.startPolicy !== 'none',
    isoDate: isoDateOf(trip, di),
    flight: day.flight ?? null
  }));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<DayPatch>) => setForm(prev => ({ ...prev, ...patch }));
  const setFlight = (patch: Partial<DayFlight>) =>
    setForm(prev => ({ ...prev, flight: { code: '', dep: '', arr: '', ...prev.flight, ...patch } }));

  const submit = () => {
    const r = updateDay(trip, di, form);
    if (!r.ok) { setError(ERR_MSG[r.error]); return; }
    onSave(r.trip);
  };

  return (
    <div className="itEditorBg" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="itEditor" role="dialog" aria-modal="true" aria-label={`Day ${di + 1} 편집`}>
        <h2>Day {di + 1} 편집</h2>
        <label>제목
          <input value={form.title} onChange={e => set({ title: e.target.value })}
            placeholder="예: 도착 · 시내 구경" autoFocus />
        </label>
        <div className="itEditRow2">
          <label>날짜
            <input type="date" value={form.isoDate} onChange={e => set({ isoDate: e.target.value })} />
          </label>
          <label>출발 시각
            <input value={form.startAt} onChange={e => set({ startAt: e.target.value })}
              inputMode="numeric" maxLength={5} placeholder="09:00" />
          </label>
        </div>
        <p className="hint">날짜를 바꾸면 이 날이 그 날짜가 되도록 여행 전체가 함께 움직입니다.</p>
        <div className="itEditRow2">
          <label>이동수단 (이 날 기본)
            <select value={form.mode} onChange={e => set({ mode: e.target.value as TransportMode })}>
              {MODES.map(m => <option key={m} value={m}>{MODE_ICON[m]} {MODE_NAME[m]}</option>)}
            </select>
          </label>
          <label>시간대
            <input value={form.timeZone} onChange={e => set({ timeZone: e.target.value })} placeholder="Asia/Seoul" />
          </label>
        </div>
        <label className="itEditChk">
          <input type="checkbox" checked={form.carry} onChange={e => set({ carry: e.target.checked })} />
          전날 위치에서 이어서 출발
        </label>
        <p className="hint">공항 이동일·야간열차처럼 전날과 이어지지 않는 날은 꺼 주세요.</p>

        {form.mode === 'flight' && (
          <div className="itEditAdv">
            <div className="itEditRow2">
              <label>편명
                <input value={form.flight?.code ?? ''} onChange={e => setFlight({ code: e.target.value })} placeholder="KE1234" />
              </label>
              <label>출발 공항
                <input value={form.flight?.dep ?? ''} onChange={e => setFlight({ dep: e.target.value })} placeholder="ICN" />
              </label>
            </div>
            <div className="itEditRow2">
              <label>도착 공항
                <input value={form.flight?.arr ?? ''} onChange={e => setFlight({ arr: e.target.value })} placeholder="CJU" />
              </label>
              <label>출발 시각
                <input value={form.flight?.depAt ?? ''} onChange={e => setFlight({ depAt: e.target.value })}
                  inputMode="numeric" maxLength={5} placeholder="10:20" />
              </label>
            </div>
          </div>
        )}

        <label>이동 메모
          <input value={form.drive} onChange={e => set({ drive: e.target.value })} placeholder="예: 렌터카 픽업 후 출발" />
        </label>
        <label>메모
          <textarea value={form.note} onChange={e => set({ note: e.target.value })} rows={2} />
        </label>

        {error && <div className="itEditErr" role="alert">{error}</div>}
        <div className="itEditBtns">
          <button type="button" className="itEditDel" onClick={onDelete}>삭제</button>
          <button type="button" onClick={onDuplicate}>복사</button>
          <button type="button" onClick={onCancel}>취소</button>
          <button type="button" className="itEditSave" onClick={submit}>저장</button>
        </div>
      </div>
    </div>
  );
}
