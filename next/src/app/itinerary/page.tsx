'use client';
// 일정(Itinerary) — 레거시 사이드바+지도와 같은 데이터(tripcanvas_v1·tripcanvas_legs_v4)를
// 같은 규칙(anchor/carry·타임라인·렌터카 연결·비용 배분·지도 장면)으로 보여주고 편집하는 병행 화면.
// Phase 6 이관 완료 — 읽기·편집·추가·검색·지도 담기·드래그·재생이 모두 여기서 돈다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DayCard } from '@/features/itinerary/components/DayCard';
import { SpotEditor } from '@/features/itinerary/components/SpotEditor';
import { AuthBar } from '@/features/cloud/components/AuthBar';
import { ConflictModal } from '@/features/cloud/components/ConflictModal';
import { useCloudSync } from '@/features/cloud/hooks/useCloudSync';
import { useFxRates } from '@/features/currency/hooks/useFxRates';
import { buildDayView, tripCostBreakdownOf } from '@/features/itinerary/domain/dayView';
import {
  applySpotAdd, applySpotEdit, moveDay, moveSpot, moveSpotTo, newSpotDraft, removeSpot
} from '@/features/itinerary/domain/spotEditor';
import { useDragReorder, type SpotDrop } from '@/features/itinerary/hooks/useDragReorder';
import { useLegCache } from '@/features/itinerary/hooks/useLegCache';
import { MapView, type MapHandle } from '@/features/map/components/MapView';
import type { TapPoint } from '@/features/map/domain/mapPick';
import { buildMapScene, dayColor, entryFitOf, fitTargetOf } from '@/features/map/domain/scene';
import { reverseSpot, type ReverseResult } from '@/features/map/services/reverseSpot';
import type { PoiPick } from '@/features/map/services/kakaoPoiLayer';
import { PlayDayCard, PlayHud } from '@/features/playback/components/PlayHud';
import { usePlayback } from '@/features/playback/hooks/usePlayback';
import { ensureTripLegs } from '@/features/routing/services/ensureTripLegs';
import { TripCard, CARD_WIDTH } from '@/features/export/components/TripCard';
import { buildTripCard, type TripCard as CardModel } from '@/features/export/domain/tripCard';
import { captureNode } from '@/features/export/services/imageExport';
import { PasteModal } from '@/features/paste/components/PasteModal';
import type { DraftTarget } from '@/features/paste/domain/pasteDraft';
import { ReadOnlyBar } from '@/features/share/components/ReadOnlyBar';
import { downloadDataUrl } from '@/features/share/services/fileTransfer';
import { exportFilename } from '@/features/share/domain/tripFile';
import { TripFileBar } from '@/features/share/components/TripFileBar';
import { useSharedTrip } from '@/features/share/hooks/useSharedTrip';
import { DayEditor } from '@/features/trip/components/DayEditor';
import { TripBar } from '@/features/trip/components/TripBar';
import { addDay, duplicateDay, newTrip, newTripId, removeDay } from '@/features/trip/domain/tripEditor';
import { useTripStore } from '@/features/trip/hooks/useTripStore';
import { useUndo } from '@/features/trip/hooks/useUndo';
import { useOnboarding } from '@/features/trip/hooks/useOnboarding';
import { Onboarding } from '@/features/trip/components/Onboarding';
import { SAMPLE_TRIP_ID } from '@/features/cloud/domain/syncDecisions';
import legacyLib from '@legacy/lib.js';
import type { Spot, Trip } from '@/features/trip/domain/types';
import { todayISO } from '@/lib/date/today';
import { fmtMoney } from '@/lib/currency/format';
import './itinerary.css';

const SAVE_FAILED = '저장에 실패했어요 — 저장 공간을 확인해주세요';

export default function ItineraryPage() {
  const { activeTrip, updateActiveTrip, trips, addTrip, switchTrip, removeTrip, replaceTrips } = useTripStore();
  const legCache = useLegCache();
  // 환율은 하루 한 번 갱신된다. 뷰 계산에 **인자로 넣어** 값이 바뀌면 환산액이 다시 그려지게 한다
  // (모듈 전역에서 몰래 읽으면 memo가 바뀐 줄 몰라 옛 금액이 그대로 남는다)
  const fx = useFxRates();
  // 남의 공유 링크(#v=)로 열렸으면 그 여행을 **저장소에 넣지 않고** 보여준다
  const { shared, claim, dismiss } = useSharedTrip();
  const readOnly = shared.kind === 'view';
  /** 화면에 그리는 여행 — 읽기전용일 땐 공유받은 것, 아니면 내 활성 여행 */
  const shownTrip: Trip | null = shared.kind === 'view' ? shared.trip : activeTrip;

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
  /** 편집 중인 일자 — 열려 있는 동안만 */
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [pasting, setPasting] = useState(false);
  /** 로그인 창 — 첫 방문 소개에서도 열 수 있어야 해서 여기서 들고 있는다 */
  const [signInOpen, setSignInOpen] = useState(false);
  // 클라우드 동기화 — 로그인하면 이 기기 밖에도 저장된다 (읽기전용 보기에서는 쓰지 않는다)
  const cloud = useCloudSync(trips, activeTrip?.id ?? null, replaceTrips, setNotice);
  // 되돌리면 선택·펼친 일자가 사라진 장소를 가리킬 수 있다 (레거시도 activeDay를 0으로 되돌린다)
  const onboarding = useOnboarding(trips, !readOnly);
  const undoable = useUndo(!readOnly, setNotice, () => {
    setActiveDay(0); setSel(null); setDidEntry(false); setEditingDay(null); setEditing(null); setAdding(null);
  });
  /** 이미지로 찍는 중인 카드 — 화면 밖에 그려 두고 캡처한다 */
  const [card, setCard] = useState<CardModel | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const mapHandle = useRef<MapHandle | null>(null);

  const views = useMemo(
    () => (shownTrip ? shownTrip.days.map((_, di) => buildDayView(shownTrip, legCache, di, fx)) : []),
    [shownTrip, legCache, fx]
  );
  const cost = useMemo(
    () => (shownTrip ? tripCostBreakdownOf(shownTrip, legCache, fx) : null),
    [shownTrip, legCache, fx]
  );
  const scene = useMemo(
    () => (shownTrip ? buildMapScene(shownTrip, legCache, activeDay) : null),
    [shownTrip, legCache, activeDay]
  );
  const fit = useMemo(
    () => (shownTrip ? (didEntry ? fitTargetOf(shownTrip, activeDay) : entryFitOf(shownTrip)) : null),
    [shownTrip, activeDay, didEntry]
  );

  // ── 여행·일자 관리 ──
  const saveTripMeta = (next: Trip) => {
    setNotice(updateActiveTrip(() => next) ? '저장됨' : SAVE_FAILED);
  };
  const createTrip = () => {
    const t = newTrip('새 여행', todayISO(), newTripId());
    if (!addTrip(t)) { setNotice(SAVE_FAILED); return; }
    setActiveDay(0); setSel(null); setDidEntry(false);
    setNotice('새 여행을 만들었어요 — 여행 정보에서 이름·날짜를 정해주세요');
  };
  /**
   * 샘플 둘러보기 — 레거시가 첫 방문에 심어 주는 여행을 Next에서는 **눌렀을 때만** 넣는다.
   * (자동으로 심으면 만든 적 없는 여행이 목록에 생긴다. 클라우드에는 올리지 않는다 — uploadable)
   */
  const browseSample = () => {
    if (trips.some(t => t.id === SAMPLE_TRIP_ID)) { onSwitchTrip(SAMPLE_TRIP_ID); return; }
    if (!addTrip(legacyLib.sampleTrip() as Trip)) { setNotice(SAVE_FAILED); return; }
    setActiveDay(0); setSel(null); setDidEntry(false);
    setNotice('샘플 여행이에요 — 마음껏 고쳐 보고, 필요 없으면 지워도 됩니다');
  };
  const deleteActiveTrip = () => {
    if (!activeTrip) return;
    if (!window.confirm(`"${activeTrip.name}" 여행을 삭제할까요? (↩️ 실행취소로 되돌릴 수 있어요)`)) return;
    const doomed = activeTrip;
    if (!removeTrip(activeTrip.id)) { setNotice('여행이 하나뿐이라 지울 수 없어요'); return; }
    // 클라우드에도 지웠다고 알린다 — 안 하면 다음 로그인 병합이 이 여행을 되살린다
    cloud.deleteFromCloud(doomed.id, doomed);
    setActiveDay(0); setSel(null); setDidEntry(false);
    setNotice('여행 삭제됨');
  };
  /** 붙여넣기 초안 적용 — 새 여행이면 넣고, 기존 여행이면 갈아끼운다 */
  const applyPasted = (t: Trip, target: DraftTarget, noLoc: number): boolean => {
    const ok = target === 'new' ? addTrip(t) : updateActiveTrip(() => t);
    if (!ok) return false;
    setActiveDay(0); setSel(null); setDidEntry(false); setEditingDay(null);
    setNotice(`초안 생성 완료${noLoc ? ` · ${noLoc}곳은 위치 미지정 (카드에서 ✏️로 지정)` : ''}`);
    return true;
  };

  const onSwitchTrip = (id: string) => {
    if (!switchTrip(id)) { setNotice(SAVE_FAILED); return; }
    setActiveDay(0); setSel(null); setDidEntry(false); setNotice(null);
  };

  const appendDay = () => {
    let di = -1;
    const ok = updateActiveTrip(trip => { const r = addDay(trip); di = r.di; return r.trip; });
    if (!ok) { setNotice(SAVE_FAILED); return; }
    setNotice('일자 추가됨');
    setEditingDay(di);                       // 바로 날짜·제목을 정하도록 편집기를 연다
  };
  const copyDay = (di: number) => {
    const ok = updateActiveTrip(trip => duplicateDay(trip, di) ?? trip);
    setEditingDay(null);
    setNotice(ok ? '일자를 복사했어요' : SAVE_FAILED);
  };
  const deleteDay = (di: number) => {
    const day = activeTrip?.days[di];
    if (!day) return;
    if (activeTrip!.days.length <= 1) { setNotice('여행에는 일자가 하나 이상 필요합니다'); return; }
    if (day.spots.length && !window.confirm('이 일자의 장소도 함께 삭제됩니다. 계속할까요?')) return;
    let failed: string | null = null;
    const ok = updateActiveTrip(trip => {
      const r = removeDay(trip, di);
      if (!r.ok) { failed = '여행에는 일자가 하나 이상 필요합니다'; return trip; }
      return r.trip;
    });
    setEditingDay(null);
    setActiveDay(0);                          // 일자 번호의 의미가 바뀐다
    setSel(null);
    setNotice(failed ?? (ok ? '일자 삭제됨' : SAVE_FAILED));
  };

  // 재생이 끝나면 카메라를 원래 프레임으로 되돌린다 (일자 재생이면 그 일자, 전체면 전체)
  const refit = useCallback(() => setDidEntry(v => !v || v), []);
  const play = usePlayback({
    trip: shownTrip, legCache, activeDay, map: mapHandle,
    onNotice: setNotice, onEnd: refit
  });

  // 전체 재생 중 날짜가 바뀌면 카드를 잠깐 띄운다 (일자 재생 중엔 바뀔 일이 없다).
  // 상태·타이머 없이 파생값 + key 리마운트로 — CSS 애니메이션이 스스로 사라진다
  // (레거시가 reflow로 애니메이션을 재시작하던 것과 같은 효과).
  const playDi = play.status.playing && !activeDay ? play.status.at?.di ?? null : null;
  const dayCardLabel = (() => {
    if (playDi == null) return null;
    const day = shownTrip?.days[playDi];
    if (!day) return null;
    const sub = day.title || day.spots.find(s => s.lat != null)?.city || '';
    return `Day ${playDi + 1}${sub ? ` · ${sub}` : ''}`;
  })();

  // 공유 링크 처리 결과 — 읽기전용은 배너가 말하므로 여기서는 알리지 않는다
  const shareNotice =
    shared.kind === 'error' ? `공유 링크를 열 수 없습니다 — ${shared.message}`
      : shared.kind === 'claimed' ? `"${shared.name || '공유된 여행'}"을(를) 내 여행으로 저장했습니다`
        : null;

  const selectDay = (d: number) => { setDidEntry(true); setActiveDay(d); };
  const onPinClick = useCallback((di: number, si: number) => setSel({ di, si }), []);

  const editingSpot = editing ? activeTrip?.days[editing.di]?.spots[editing.si] ?? null : null;

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

  // 읽기전용에서는 드래그를 끈다 — 핸들러가 '내 활성 여행'을 고치므로,
  // 남의 여행을 보다가 끌면 엉뚱하게 내 여행이 바뀐다
  useDragReorder({ deps: views, enabled: !readOnly, onSpotDrop, onDayDrop });

  // 빠진 구간 백그라운드 조회 (Phase 6a) — 결과가 캐시에 쓰이면 legCache 구독으로 ETA·경로선이 갱신되고,
  // 그 갱신으로 출발시각이 바뀐 대중교통 구간은 재수집된다 (fetcher의 그룹 댐핑이 진동을 차단)
  useEffect(() => { if (shownTrip) ensureTripLegs(shownTrip); }, [shownTrip, legCache]);
  useEffect(() => {
    if (sel) document.getElementById(`it-d${sel.di}-s${sel.si}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [sel]);

  // 카드가 화면 밖에 그려진 다음에 캡처한다 (렌더 전에 찍으면 빈 이미지가 나온다)
  useEffect(() => {
    if (!card || !cardRef.current) return;
    let alive = true;
    void (async () => {
      const shot = await captureNode(cardRef.current!, '#141b33');
      if (!alive) return;
      if (shot.ok) downloadDataUrl(shot.dataUrl, exportFilename(card.name, 'png'));
      setNotice(shot.ok ? '이미지가 저장되었습니다' : shot.error);
      setCard(null);
    })();
    return () => { alive = false; };
  }, [card]);


  // 첫 방문 소개 — 어느 갈래를 골라도 소개를 닫고 곧바로 그 일을 시작한다
  if (onboarding.show) {
    return (
      <Onboarding
        canSignIn={cloud.available}
        onPaste={() => { onboarding.dismiss(); setPasting(true); }}
        onNew={() => { onboarding.dismiss(); createTrip(); }}
        onSample={() => { onboarding.dismiss(); browseSample(); }}
        onSignIn={() => { onboarding.dismiss(); setSignInOpen(true); }}
      />
    );
  }

  if (!shownTrip) {
    return (
      <main className="itPage">
        <h1>일정</h1>
        {(shareNotice || notice) && <div className="hint" role="status">{shareNotice ?? notice}</div>}
        <p className="hint">
          이 브라우저에 저장된 여행이 없어요. 새로 만들거나, 기존 앱에서 만든 여행을 여기서 이어서 볼 수 있습니다.
        </p>
        <button type="button" className="itAddDay" onClick={createTrip}>＋ 새 여행 만들기</button>
        <button type="button" className="itAddDay" onClick={() => setPasting(true)}>
          📋 붙여넣기로 초안 만들기
        </button>
        {pasting && (
          <PasteModal
            current={null} onApply={applyPasted} onClose={() => setPasting(false)}
            ids={{ newId: newTripId, today: todayISO }}
          />
        )}
      </main>
    );
  }

  const costParts = cost
    ? ([['장소', cost.spots], ['택시', cost.taxi], ['숙박', cost.hotel], ['렌터카', cost.car], ['항공', cost.flight]] as const)
        .filter(([, v]) => v > 0)
    : [];

  return (
    <main className="itPage">
      <h1>일정</h1>
      {readOnly ? (
        <ReadOnlyBar
          name={shownTrip.name}
          onClaim={() => setNotice(claim() ? '내 여행으로 저장되었습니다' : SAVE_FAILED)}
          onDismiss={dismiss}
        />
      ) : activeTrip && (
        <>
          <TripBar
            trips={trips} activeTrip={activeTrip}
            onSwitch={onSwitchTrip} onNew={createTrip} onSave={saveTripMeta} onDelete={deleteActiveTrip}
            signedIn={!!cloud.user}
            canUndo={undoable.canUndo} onUndo={undoable.undo}
            onRestore={t => {
              // 되돌린 여행은 지금 여행을 대체한다 (id가 같으므로 제자리 교체)
              setNotice(updateActiveTrip(() => t) ? '그 시점으로 되돌렸어요' : SAVE_FAILED);
              setActiveDay(0); setSel(null); setDidEntry(false); setEditingDay(null);
            }}
          />
          <AuthBar
            user={cloud.user} available={cloud.available} statusLabel={cloud.statusLabel}
            onSignIn={cloud.signIn} onSignOut={() => { void cloud.signOut(); setNotice('로그아웃됐어요'); }}
            open={signInOpen} onOpenChange={setSignInOpen}
          />
          <TripFileBar
            trip={activeTrip} newId={newTripId} onNotice={setNotice}
            onImport={t => { const ok = addTrip(t); if (ok) { setActiveDay(0); setSel(null); setDidEntry(false); } return ok; }}
            onPaste={() => setPasting(true)}
            onImage={() => {
              setNotice('이미지 만드는 중…');
              setCard(buildTripCard(activeTrip, views, dayColor));
            }}
          />
        </>
      )}
      {(shareNotice || notice) && <div className="hint" role="status">{shareNotice ?? notice}</div>}
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
        <button type="button" className="itPlayBtn" onClick={play.toggle}
          title={activeDay ? `Day ${activeDay} 동선을 따라 재생` : '전체 동선을 따라 재생'}>
          {play.status.playing ? '⏹ 정지' : '▶️ 재생'}
        </button>
      </div>
      {!readOnly && (
        <p className="hint">
          여행 중이라면 <a href="/travel">여행 모드</a>에서 지금 있어야 할 곳과 다음 장소를 크게 볼 수 있어요.
        </p>
      )}
      <div className="itLayout">
        {scene && (
          <MapView
            scene={scene} fit={play.status.playing ? null : fit} handleRef={mapHandle}
            onPinClick={onPinClick}
            onMapTap={readOnly ? undefined : onMapTap}
            onPoiPick={readOnly ? undefined : onPoiPick}
          />
        )}
        <div className="itCards">
          {views.map(v => (
            <DayCard
              key={v.di} view={v}
              dim={activeDay !== 0 && activeDay !== v.dayNo}
              selectedSi={sel?.di === v.di ? sel.si : null}
              onHeaderClick={() => selectDay(activeDay === v.dayNo ? 0 : v.dayNo)}
              onEditSpot={readOnly ? undefined : si => { setNotice(null); setEditing({ di: v.di, si }); }}
              onMoveSpot={readOnly ? undefined : (si, delta) => move(v.di, si, delta)}
              onAddSpot={readOnly ? undefined : after => openAdd(v.di, after, newSpotDraft(shownTrip.days[v.di]))}
              onEditDay={readOnly ? undefined : () => { setNotice(null); setEditingDay(v.di); }}
            />
          ))}
          {!readOnly && (
            <button type="button" className="itAddDay" onClick={appendDay}>＋ 일자 추가</button>
          )}
        </div>
      </div>
      <p className="hint">
        {readOnly
          ? '남이 공유한 여행을 읽기전용으로 보는 중입니다 — 지도·재생은 그대로 쓸 수 있고, 고치려면 내 여행으로 저장하세요.'
          : '지도를 탭하거나 검색해서 장소를 담고, 편집·드래그 정렬·삭제까지 여기서 할 수 있어요. '
            + '장소는 다른 일자로도 끌어 옮길 수 있고, 카드 헤더를 잡으면 일자 순서가 바뀝니다. '
            + '여행·일자는 위의 여행 정보와 각 카드의 ✎로 고칩니다. 이동 시간·경로선은 자동으로 조회해 채웁니다 (조회 전에는 직선 추정).'}
      </p>
      {play.status.playing && (
        <>
          {dayCardLabel && <PlayDayCard key={playDi} label={dayCardLabel} />}
          <PlayHud
            status={play.status} speed={play.speed} onSpeed={play.setSpeed}
            onToggle={() => (play.status.paused ? play.resume() : play.pause())}
            onPrev={play.prevSeg} onNext={play.nextSeg} onStop={play.stop}
            onSeekPreview={play.seekPreview} onSeekCommit={play.seekCommit}
            onPause={play.pause} onResume={play.resume}
          />
        </>
      )}
      {cloud.conflict && (
        <ConflictModal
          conflict={cloud.conflict} remaining={cloud.remainingConflicts} onChoose={cloud.resolve}
        />
      )}
      {card && (
        <div style={{ position: 'fixed', left: -10000, top: 0, width: CARD_WIDTH }} aria-hidden="true">
          <TripCard card={card} innerRef={cardRef} />
        </div>
      )}
      {!readOnly && pasting && (
        <PasteModal
          current={activeTrip} onApply={applyPasted} onClose={() => setPasting(false)}
          ids={{ newId: newTripId, today: todayISO }}
        />
      )}
      {!readOnly && activeTrip && editingDay != null && activeTrip.days[editingDay] && (
        <DayEditor
          trip={activeTrip} di={editingDay}
          onSave={next => { saveTripMeta(next); setEditingDay(null); }}
          onDuplicate={() => copyDay(editingDay)}
          onDelete={() => deleteDay(editingDay)}
          onCancel={() => setEditingDay(null)}
        />
      )}
      {!readOnly && activeTrip && editing && editingSpot && (
        <div className="itEditorBg" onClick={e => { if (e.target === e.currentTarget) setEditing(null); }}>
          <SpotEditor
            spot={editingSpot} di={editing.di} days={activeTrip.days}
            onSave={saveSpot} onDelete={deleteSpot} onCancel={() => setEditing(null)}
          />
        </div>
      )}
      {!readOnly && activeTrip && adding && (
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
