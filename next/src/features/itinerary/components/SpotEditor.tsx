'use client';
// 장소 편집 폼 — 검증·배치 규칙은 domain(spotEditor)이 판단하고 폼은 표현만 한다 (§27).
// 좌표·검색 칸이 없는 건 의도다: 편집은 이미 있는 장소의 값을 고치는 일이고,
// 위치 지정(검색·지도 클릭)은 아직 레거시 담당이다.
import { useState } from 'react';

import legacyLib from '@legacy/lib.js';

import type { CurrencyCode, Day, Spot, SpotCategory, TransportMode } from '@/features/trip/domain/types';
import { formFromSpot, spotFromForm, type SpotForm, type SpotFormError } from '../domain/spotEditor';

const ERR_MSG: Record<SpotFormError, string> = {
  NAME_REQUIRED: '장소 이름을 입력하세요'
};

const LEG_MODES: { value: TransportMode | ''; label: string }[] = [
  { value: '', label: '일정 기본' },
  { value: 'car', label: '🚗 자차' }, { value: 'taxi', label: '🚕 택시' },
  { value: 'transit', label: '🚌 대중교통' }, { value: 'train', label: '🚆 기차' },
  { value: 'walk', label: '🚶 도보' }, { value: 'bike', label: '🚴 자전거' },
  { value: 'flight', label: '✈️ 비행기' }
];

const CURRENCIES: CurrencyCode[] = ['KRW', 'USD', 'EUR', 'JPY', 'CNY'];

export function SpotEditor({ spot, di, days, onSave, onDelete, onCancel }: {
  spot: Spot;
  /** 편집 중인 장소가 속한 일자 */
  di: number;
  /** 일자 이동 선택지 */
  days: Day[];
  onSave: (next: Spot, targetDi: number) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<SpotForm>(() => formFromSpot(spot, di));
  const [error, setError] = useState<string | null>(null);
  // 상세는 이미 값이 있을 때만 펼쳐 둔다 (레거시 spotAdvanced와 같은 조건)
  const [advanced, setAdvanced] = useState(
    () => !!(spot.legMode || spot.cost || spot.bookAt || spot.bookUrl || spot.opt || spot.stay)
  );
  const set = (patch: Partial<SpotForm>) => setForm(prev => ({ ...prev, ...patch }));

  const submit = () => {
    const res = spotFromForm(form, spot);
    if (!res.ok) { setError(ERR_MSG[res.error]); return; }
    onSave(res.spot, form.targetDi);
  };

  return (
    <div className="itEditor" role="dialog" aria-modal="true" aria-label="장소 편집">
      <h2>장소 편집</h2>
      {spot.lat == null && (
        <p className="hint">📍 위치가 없는 장소예요 — 위치 지정은 아직 기존 앱에서 해야 합니다.</p>
      )}
      <label>장소 이름
        <input value={form.name} onChange={e => set({ name: e.target.value })} autoFocus />
      </label>
      <div className="itEditRow2">
        <label>도시/그룹
          <input value={form.city} onChange={e => set({ city: e.target.value })} placeholder="기타" />
        </label>
        <label>카테고리
          <select value={form.cat} onChange={e => set({ cat: e.target.value as SpotCategory | '' })}>
            <option value="">자동 (이름으로 추론)</option>
            {legacyLib.SPOT_CATS.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </label>
      </div>
      <div className="itEditRow2">
        <label>일자
          <select value={form.targetDi} onChange={e => set({ targetDi: Number(e.target.value) })}>
            {days.map((d, i) => <option key={i} value={i}>Day {i + 1}{d.title ? ` · ${d.title}` : ''}</option>)}
          </select>
        </label>
        <label>도착 시각 (고정)
          <input value={form.at} onChange={e => set({ at: e.target.value })} inputMode="numeric"
            maxLength={5} placeholder="비우면 자동 계산" />
        </label>
      </div>
      <div className="itEditRow2">
        <label>체류 시간 (분)
          <input value={form.stayMin} onChange={e => set({ stayMin: e.target.value })} inputMode="numeric" />
        </label>
        <label className="itEditChk">
          <input type="checkbox" checked={form.opt} onChange={e => set({ opt: e.target.checked })} />
          선택 코스
        </label>
      </div>
      <label>메모
        <textarea value={form.desc} onChange={e => set({ desc: e.target.value })} rows={2}
          placeholder="운영시간, 예약, 팁 등" />
      </label>

      <button type="button" className="itEditMore" aria-expanded={advanced} onClick={() => setAdvanced(v => !v)}>
        {advanced ? '▾' : '▸'} 상세 설정
      </button>
      {advanced && (
        <div className="itEditAdv">
          <div className="itEditRow2">
            <label>이동수단 (이 구간만)
              <select value={form.legMode} onChange={e => set({ legMode: e.target.value as TransportMode | '' })}>
                {LEG_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </label>
            <label>예약·입장 시각
              <input value={form.bookAt} onChange={e => set({ bookAt: e.target.value })} inputMode="numeric"
                maxLength={5} placeholder="19:00" />
            </label>
          </div>
          <div className="itEditRow2">
            <label>예상 비용
              <input value={form.cost} onChange={e => set({ cost: e.target.value })} inputMode="numeric" placeholder="0" />
            </label>
            <label>통화
              <select value={form.cur} onChange={e => set({ cur: e.target.value as CurrencyCode })}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <label>예약 URL
            <input value={form.bookUrl} onChange={e => set({ bookUrl: e.target.value })} placeholder="https://..." />
          </label>
          <div className="itEditRow2">
            <label className="itEditChk">
              <input type="checkbox" checked={form.stay} onChange={e => set({ stay: e.target.checked })} />
              🏠 숙소
            </label>
            {form.stay && (
              <label>연박 (박)
                <input value={form.nights} onChange={e => set({ nights: e.target.value })} inputMode="numeric" />
              </label>
            )}
          </div>
        </div>
      )}

      {error && <div className="itEditErr" role="alert">{error}</div>}
      <div className="itEditBtns">
        <button type="button" className="itEditDel" onClick={onDelete}>삭제</button>
        <button type="button" onClick={onCancel}>취소</button>
        <button type="button" className="itEditSave" onClick={submit}>저장</button>
      </div>
    </div>
  );
}
