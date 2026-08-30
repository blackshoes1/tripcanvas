'use client';
// 장소 편집·추가 폼 — 검증·배치 규칙은 domain(spotEditor)이, 검색 라우팅은 domain(routeSearch)이
// 판단하고 폼은 표현만 한다 (§27).
// 좌표는 폼 칸이 아니라 초안(draft)에 담긴다: 사람이 숫자를 치는 값이 아니라 검색으로 고르는 값이고,
// 위치 없는 장소(lat:null)가 빈 입력칸을 거쳐 (0,0)으로 둔갑하는 길을 아예 만들지 않기 위해서다.
import { useEffect, useRef, useState } from 'react';

import legacyLib from '@legacy/lib.js';

import type { ReverseResult } from '@/features/map/services/reverseSpot';
import { cityAnchorOf, searchPlaces } from '@/features/search/services/placeSearch';
import type { PlaceResult, SearchError } from '@/features/search/domain/types';
import type { CurrencyCode, Day, Spot, SpotCategory, TransportMode } from '@/features/trip/domain/types';
import {
  applyPlaceToForm, formFromSpot, spotFromForm, type SpotForm, type SpotFormError
} from '../domain/spotEditor';

const ERR_MSG: Record<SpotFormError, string> = {
  NAME_REQUIRED: '장소 이름을 입력하세요',
  LOCATION_REQUIRED: '위치를 지정하세요 — 검색 결과를 고르거나 지도를 탭하면 됩니다'
};

// 실패 원인별 안내 — 레거시 SEARCH_ERR_MSG와 같은 문구 (상세 코드는 콘솔에만)
const SEARCH_ERR_MSG: Record<SearchError, string> = {
  auth: '검색 키 인증·권한 문제예요 — 관리자 확인이 필요합니다',
  quota: '검색 사용량 한도를 넘었어요 — 잠시 후 다시 시도해주세요',
  network: '네트워크 오류예요 — 연결을 확인하고 다시 시도해주세요',
  error: '검색에 실패했어요 — 다시 시도하거나 지도를 탭해 지정해주세요'
};

const LEG_MODES: { value: TransportMode | ''; label: string }[] = [
  { value: '', label: '일정 기본' },
  { value: 'car', label: '🚗 자차' }, { value: 'taxi', label: '🚕 택시' },
  { value: 'transit', label: '🚌 대중교통' }, { value: 'train', label: '🚆 기차' },
  { value: 'walk', label: '🚶 도보' }, { value: 'bike', label: '🚴 자전거' },
  { value: 'flight', label: '✈️ 비행기' }
];

const CURRENCIES: CurrencyCode[] = ['KRW', 'USD', 'EUR', 'JPY', 'CNY'];

export function SpotEditor({ spot, di, days, isNew = false, identity = null, onSave, onDelete, onCancel }: {
  /** 편집 대상, 또는 추가할 새 장소의 초안 */
  spot: Spot;
  /** 편집기를 연 일자 */
  di: number;
  /** 일자 이동 선택지 */
  days: Day[];
  isNew?: boolean;
  /**
   * 지도에서 담은 좌표의 신원(이름·도시) — 늦게 도착한다. 사용자가 이미 손댔으면 덮어쓰지 않는다.
   * 한 번만 반영한다(레거시 fillSpotFromCoords가 모달을 열 때 한 번 부르는 것과 같다).
   */
  identity?: ReverseResult | null;
  onSave: (next: Spot, targetDi: number) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  // 폼 밖의 값(좌표·placeId·영업시간·예약 연결)을 들고 있는 원본. 검색 결과를 고르면 여기가 갱신된다.
  const [draft, setDraft] = useState<Spot>(spot);
  const [form, setForm] = useState<SpotForm>(() => formFromSpot(spot, di));
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(
    () => !!(spot.legMode || spot.cost || spot.bookAt || spot.bookUrl || spot.opt || spot.stay)
  );

  // 우리가 자동으로 채운 마지막 값 — 사용자가 직접 친 값과 구분해 덮어쓸지 판단한다
  const autoName = useRef('');
  const autoCity = useRef(spot.city ?? '');
  const identityDone = useRef(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);

  const set = (patch: Partial<SpotForm>) => setForm(prev => ({ ...prev, ...patch }));
  const located = draft.lat != null && draft.lng != null;

  useEffect(() => {
    if (!identity || identityDone.current) return;
    identityDone.current = true;
    const untouched = (cur: string, auto: string) => !cur.trim() || cur.trim() === auto.trim();
    setForm(prev => ({
      ...prev,
      name: identity.name && untouched(prev.name, autoName.current) ? identity.name : prev.name,
      city: identity.city && untouched(prev.city, autoCity.current) ? identity.city : prev.city
    }));
    if (identity.name) autoName.current = identity.name;
    if (identity.city) autoCity.current = identity.city;
  }, [identity]);

  const runSearch = async () => {
    const q = query.trim();
    if (!q || searching) return;   // 진행 중 재호출 차단 (연타 방지 — 레거시와 동일)
    setSearching(true);
    setResults([]);
    setSearchMsg('검색 중…');
    try {
      // 편집 중인 도시를 앵커로 — 있으면 그 주변을 우선하고, 국내/해외 라우팅 판단에도 쓰인다
      const city = form.city.trim();
      const near = city ? await cityAnchorOf(city) : null;
      const out = await searchPlaces(q, { near, cityKey: city });
      setResults(out.results);
      setSearchMsg(out.results.length ? null
        : out.error ? SEARCH_ERR_MSG[out.error]
        : '결과 없음 — 다른 키워드로 찾아보세요');
    } catch (e) {
      const code = legacyLib.classifySearchErr(e);
      console.warn('검색 실패[' + code + ']:', e instanceof Error ? e.message : e);
      setSearchMsg(SEARCH_ERR_MSG[code]);
    } finally {
      setSearching(false);
    }
  };

  const pick = (p: PlaceResult) => {
    const r = applyPlaceToForm(form, draft, p);
    identityDone.current = true;   // 명시적 선택이 늦게 오는 역추적에 덮이지 않게
    setForm(r.form);
    setDraft(r.draft);
    setResults([]);
    setSearchMsg(null);
    setError(null);
  };

  const submit = () => {
    const res = spotFromForm(form, draft, { requireLocation: isNew });
    if (!res.ok) { setError(ERR_MSG[res.error]); return; }
    onSave(res.spot, form.targetDi);
  };

  return (
    <div className="itEditor" role="dialog" aria-modal="true" aria-label={isNew ? '장소 추가' : '장소 편집'}>
      <h2>{isNew ? '장소 추가' : '장소 편집'}</h2>

      <label>장소 검색
        <div className="itEditSearch">
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void runSearch(); } }}
            placeholder="장소 이름으로 찾기" aria-label="장소 검색어" autoFocus={isNew}
          />
          <button type="button" onClick={() => void runSearch()} disabled={searching}>검색</button>
        </div>
      </label>
      <div className={`itEditCoord${located ? ' ok' : ''}`}>
        {located
          ? `📍 ${draft.lat!.toFixed(4)}, ${draft.lng!.toFixed(4)}${draft.hours ? ' · 영업시간 반영됨' : ''}`
          : '📍 위치 미지정 — 검색 결과를 고르거나 지도를 탭하면 지정됩니다'}
      </div>
      {searchMsg && <div className="itEditSearchMsg" role="status">{searchMsg}</div>}
      {results.length > 0 && (
        <ul className="itEditResults">
          {results.map((r, i) => (
            <li key={`${r.placeId ?? r.name}-${i}`}>
              <button type="button" onClick={() => pick(r)}>
                <span className="itEditResName">{r.name}</span>
                {r.addr && <span className="itEditResAddr">{r.addr}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <label>장소 이름
        <input value={form.name} onChange={e => set({ name: e.target.value })} autoFocus={!isNew} />
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
        {onDelete && <button type="button" className="itEditDel" onClick={onDelete}>삭제</button>}
        <button type="button" onClick={onCancel}>취소</button>
        <button type="button" className="itEditSave" onClick={submit}>저장</button>
      </div>
    </div>
  );
}
