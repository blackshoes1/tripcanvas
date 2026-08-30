'use client';
// 일정(Itinerary) — 레거시 사이드바+지도와 같은 데이터(tripcanvas_v1·tripcanvas_legs_v4)를
// 같은 규칙(anchor/carry·타임라인·렌터카 연결·비용 배분·지도 장면)으로 보여주고 편집하는 병행 화면.
// 재생(여행 모드)만 아직 레거시 담당.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DayCard } from '@/features/itinerary/components/DayCard';
import { SpotEditor } from '@/features/itinerary/components/SpotEditor';
import { buildDayView, tripCostBreakdownOf } from '@/features/itinerary/domain/dayView';
import {
  applySpotAdd, applySpotEdit, moveDay, moveSpot, moveSpotTo, newSpotDraft, removeSpot
} from '@/features/itinerary/domain/spotEditor';
import { useDragReorder, type SpotDrop } from '@/features/itinerary/hooks/useDragReorder';
import { useLegCache } from '@/features/itinerary/hooks/useLegCache';
import { MapView } from '@/features/map/components/MapView';
import type { TapPoint } from '@/features/map/domain/mapPick';
import { buildMapScene, dayColor, entryFitOf, fitTargetOf } from '@/features/map/domain/scene';
import { reverseSpot, type ReverseResult } from '@/features/map/services/reverseSpot';
import type { PoiPick } from '@/features/map/services/kakaoPoiLayer';
import { ensureTripLegs } from '@/features/routing/services/ensureTripLegs';
import { useTripStore } from '@/features/trip/hooks/useTripStore';
import type { Spot } from '@/features/trip/domain/types';
import { fmtMoney } from '@/lib/currency/format';
import './itinerary.css';

export default function ItineraryPage() {
  const { activeTrip, updateActiveTrip } = useTripStore();
  const legCache = useLegCache();

  /** 1-based 일자 필터, 0=전체 (레거시 activeDay와 동일 의미) */
  const [activeDay, setActiveDay] = useState(0);
  /** 첫 조작 전에는 진입 프레이밍(위치 있는 첫 일자)을 유지 */
  const [didEntry, setDidEntry] = useState(false);
  const [sel, setSel] = useState<{ di: number; si: number } | null>(null);
  /** 편집 중인 장소 위치 — 열려 있는 동안만 */
  const [editing, setEditing] = useState<{ di: number; si: number } | null>(null);
  /** 추가 중인 자리 — after는 편집기를 '열 때' 확정한다 (레거시 editing.after와 같은 의미) */
  const [adding, setAdding] = useState<{ di: number; after: number | null; draft: Spot } | null>(null);
  /** 지도에서 담은 좌표의 신원 — 늦게 도착해 편집기에 흘려 넣는다 */
  const [identity, setIdentity] = useState<ReverseResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const views = useMemo(
    () => (activeTrip ? activeTrip.days.map((_, di) => buildDayView(activeTrip, legCache, di)) : []),
    [activeTrip, legCache]
  );
  const cost = useMemo(
    () => (activeTrip ? tripCostBreakdownOf(activeTrip, legCache) : null),
    [activeTrip, legCache]
  );
  const scene = useMemo(
    () => (activeTrip ? buildMapScene(activeTrip, legCache, activeDay) : null),
    [activeTrip, legCache, activeDay]
  );
  const fit = useMemo(
    () => (activeTrip ? (didEntry ? fitTargetOf(activeTrip, activeDay) : entryFitOf(activeTrip)) : null),
    [activeTrip, activeDay, didEntry]
  );

  const selectDay = (d: number) => { setDidEntry(true); setActiveDay(d); };
  const onPinClick = useCallback((di: number, si: number) => setSel({ di, si }), []);

  const editingSpot = editing ? activeTrip?.days[editing.di]?.spots[editing.si] ?? null : null;
  const SAVE_FAILED = '저장에 실패했어요 — 저장 공간을 확인해주세요';

  /** 지도로 담을 때의 대상 일자·삽입 위치 — 레거시 addSpotAt과 같다(필터 중인 일자, 선택한 장소 뒤) */
  const mapTarget = () => {
    const di = activeDay ? activeDay - 1 : 0;
    const after = sel && sel.di === di && activeTrip?.days[di]?.spots[sel.si] ? sel.si : null;
    return { di, after };
  };
  const openAdd = (di: number, after: number | null, draft: Spot) => {
    setNotice(null);
    setIdentity(null);
    setAdding({ di, after, draft });
  };

  // 지도 콜백은 안정적이어야 한다(바뀌면 오버레이를 다시 그린다) → 최신 상태는 ref로 본다
  const mapTargetRef = useRef(mapTarget);
  const openAddRef = useRef(openAdd);
  const tripRef = useRef(activeTrip);
  useEffect(() => {
    mapTargetRef.current = mapTarget;
    openAddRef.current = openAdd;
    tripRef.current = activeTrip;
  });

  // 빈 자리·해외 POI 탭 — 좌표는 확실하지만 신원은 되짚어야 한다(추측이므로 늦게, 조심스럽게)
  const onMapTap = useCallback((p: TapPoint) => {
    const { di, after } = mapTargetRef.current();
    const base = newSpotDraft(tripRef.current?.days[di]);
    const draft: Spot = { ...base, lat: p.lat, lng: p.lng };
    if (p.placeId) draft.placeId = p.placeId;
    openAddRef.current(di, after, draft);
    reverseSpot(p.lat, p.lng, p.placeId).then(setIdentity).catch(() => {});
  }, []);

  // 국내 POI 칩 — 우리가 깔았으니 무엇을 눌렀는지 안다. 역추적(추측)을 건너뛴다
  const onPoiPick = useCallback((p: PoiPick) => {
    const { di, after } = mapTargetRef.current();
    const base = newSpotDraft(tripRef.current?.days[di]);
    openAddRef.current(di, after, { ...base, name: p.name, city: p.city || base.city, lat: p.lat, lng: p.lng });
  }, []);

  // updateActiveTrip은 mutate를 동기로 부른다 — 정렬 여부를 그때 받아 안내 문구를 고른다
  const saveSpot = (next: Spot, targetDi: number) => {
    if (!editing) return;
    let sorted = false;
    const ok = updateActiveTrip(trip => {
      const r = applySpotEdit(trip, editing, next, targetDi);
      sorted = r.sorted;
      return r.trip;
    });
    setEditing(null);
    setSel(null);   // 일자 이동·재정렬로 자리가 바뀔 수 있어 선택은 놓는다
    setNotice(ok ? (sorted ? '저장됨 · 시간순 정렬' : '저장됨') : SAVE_FAILED);
  };

  // 넣은 장소를 선택해 둔다 — 연달아 추가하면 계속 그 뒤로 붙는다 (레거시와 같은 흐름)
  const addSpot = (next: Spot, targetDi: number) => {
    if (!adding) return;
    let sorted = false;
    let placed = -1;
    const ok = updateActiveTrip(trip => {
      const r = applySpotAdd(trip, next, { openedDi: adding.di, targetDi, after: adding.after });
      sorted = r.sorted;
      placed = r.si;
      return r.trip;
    });
    setAdding(null);
    if (ok && placed >= 0) setSel({ di: targetDi, si: placed });
    setNotice(ok ? (sorted ? '추가됨 · 시간순 정렬' : '추가됨') : SAVE_FAILED);
  };

  const deleteSpot = () => {
    if (!editing || !editingSpot) return;
    if (!window.confirm(`"${editingSpot.name}"을(를) 일정에서 뺄까요?`)) return;
    const ok = updateActiveTrip(trip => removeSpot(trip, editing.di, editing.si));
    setEditing(null);
    setSel(null);
    setNotice(ok ? '장소 삭제됨' : SAVE_FAILED);
  };

  // 끝에서는 버튼이 비활성이라 moveSpot이 null을 줄 일은 없지만, 도메인 가드를 그대로 존중한다
  const move = (di: number, si: number, delta: number) => {
    const ok = updateActiveTrip(trip => moveSpot(trip, di, si, delta) ?? trip);
    if (ok) { setSel({ di, si: si + delta }); setNotice(null); }
    else setNotice(SAVE_FAILED);
  };

  // 드래그 정렬 (Phase 6e). 콜백은 안정적이어야 Sortable 인스턴스가 매 렌더 재생성되지 않는데,
  // updateActiveTrip과 setNotice는 이미 렌더 간 동일한 참조라 그대로 쓰면 된다.
  const onSpotDrop = useCallback((d: SpotDrop) => {
    let sorted = false;
    let placed = -1;
    let moved = false;
    const ok = updateActiveTrip(trip => {
      const r = moveSpotTo(trip, d.from, d.to);
      if (!r) return trip;
      moved = true; sorted = r.sorted; placed = r.si;
      return r.trip;
    });
    if (!moved) return;                       // 제자리 드롭 — 알릴 것도 없다
    if (!ok) { setNotice(SAVE_FAILED); return; }
    setSel({ di: d.to.di, si: placed });
    setNotice(
      d.from.di !== d.to.di ? `Day ${d.to.di + 1}(으)로 이동${sorted ? ' · 시간순 정렬' : ''}`
        : sorted ? '시간순으로 정렬됨' : null
    );
  }, [updateActiveTrip]);

  const onDayDrop = useCallback((from: number, to: number) => {
    let moved = false;
    const ok = updateActiveTrip(trip => {
      const next = moveDay(trip, from, to);
      if (!next) return trip;
      moved = true;
      return next;
    });
    if (!moved) return;
    if (!ok) { setNotice(SAVE_FAILED); return; }
    setActiveDay(0);         // 일자 번호의 의미가 바뀌었으니 필터는 푼다 (레거시 onDayDrop과 동일)
    setSel(null);
    setNotice('일자 순서 변경됨');
  }, [updateActiveTrip]);

  useDragReorder({ deps: views, onSpotDrop, onDayDrop });

  // 빠진 구간 백그라운드 조회 (Phase 6a) — 결과가 캐시에 쓰이면 legCache 구독으로 ETA·경로선이 갱신되고,
  // 그 갱신으로 출발시각이 바뀐 대중교통 구간은 재수집된다 (fetcher의 그룹 댐핑이 진동을 차단)
  useEffect(() => { if (activeTrip) ensureTripLegs(activeTrip); }, [activeTrip, legCache]);
  useEffect(() => {
    if (sel) document.getElementById(`it-d${sel.di}-s${sel.si}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [sel]);

  if (!activeTrip) {
    return (
      <main className="itPage">
        <h1>일정</h1>
        <p className="hint">
          이 브라우저에 저장된 여행이 없어요. 기존 앱에서 여행을 만들면 같은 데이터를 여기서 볼 수 있습니다.
        </p>
      </main>
    );
  }

  const costParts = cost
    ? ([['장소', cost.spots], ['택시', cost.taxi], ['숙박', cost.hotel], ['렌터카', cost.car], ['항공', cost.flight]] as const)
        .filter(([, v]) => v > 0)
    : [];

  return (
    <main className="itPage">
      <h1>일정 <span className="opt">{activeTrip.name}</span></h1>
      {notice && <div className="hint" role="status">{notice}</div>}
      {cost && cost.total > 0 && (
        <div className="itTripCost" title="예약(숙박·렌터카·항공)은 전액 — 기간이 일정 밖으로 나가면 하루 합계보다 큽니다">
          💳 전체 비용 약 ₩{fmtMoney(cost.total)}
          {costParts.length > 1 && (
            <span className="itDim"> ({costParts.map(([k, v]) => `${k} ₩${fmtMoney(v)}`).join(' + ')})</span>
          )}
        </div>
      )}
      <div className="itDayChips" role="group" aria-label="지도에 표시할 일자">
        <button type="button" className={`itDayChip${activeDay === 0 ? ' on' : ''}`} onClick={() => selectDay(0)}>
          전체
        </button>
        {views.map(v => (
          <button
            key={v.di} type="button"
            className={`itDayChip${activeDay === v.dayNo ? ' on' : ''}`}
            onClick={() => selectDay(activeDay === v.dayNo ? 0 : v.dayNo)}
          >
            <i className="dot" style={{ background: dayColor(v.di) }} aria-hidden="true" />Day {v.dayNo}
          </button>
        ))}
        <span className="itLegendNote" aria-hidden="true">- - - 일자 간 이동</span>
      </div>
      <div className="itLayout">
        {scene && (
          <MapView scene={scene} fit={fit} onPinClick={onPinClick} onMapTap={onMapTap} onPoiPick={onPoiPick} />
        )}
        <div className="itCards">
          {views.map(v => (
            <DayCard
              key={v.di} view={v}
              dim={activeDay !== 0 && activeDay !== v.dayNo}
              selectedSi={sel?.di === v.di ? sel.si : null}
              onHeaderClick={() => selectDay(activeDay === v.dayNo ? 0 : v.dayNo)}
              onEditSpot={si => { setNotice(null); setEditing({ di: v.di, si }); }}
              onMoveSpot={(si, delta) => move(v.di, si, delta)}
              onAddSpot={after => openAdd(v.di, after, newSpotDraft(activeTrip.days[v.di]))}
            />
          ))}
        </div>
      </div>
      <p className="hint">
        지도를 탭하거나 검색해서 장소를 담고, 편집·드래그 정렬·삭제까지 여기서 할 수 있어요.
        장소는 다른 일자로도 끌어 옮길 수 있고, 카드 헤더를 잡으면 일자 순서가 바뀝니다.
        재생은 아직 기존 앱 담당입니다. 이동 시간·경로선은 자동으로 조회해 채웁니다 (조회 전에는 직선 추정).
      </p>
      {editing && editingSpot && (
        <div className="itEditorBg" onClick={e => { if (e.target === e.currentTarget) setEditing(null); }}>
          <SpotEditor
            spot={editingSpot} di={editing.di} days={activeTrip.days}
            onSave={saveSpot} onDelete={deleteSpot} onCancel={() => setEditing(null)}
          />
        </div>
      )}
      {adding && (
        <div className="itEditorBg" onClick={e => { if (e.target === e.currentTarget) setAdding(null); }}>
          <SpotEditor
            isNew spot={adding.draft} di={adding.di} days={activeTrip.days} identity={identity}
            onSave={addSpot} onCancel={() => setAdding(null)}
          />
        </div>
      )}
    </main>
  );
}
