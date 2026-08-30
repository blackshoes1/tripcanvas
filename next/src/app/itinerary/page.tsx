'use client';
// 일정(Itinerary) 읽기 뷰 — 레거시 사이드바+지도와 같은 데이터(tripcanvas_v1·tripcanvas_legs_v4)를
// 같은 규칙(anchor/carry·타임라인·렌터카 연결·비용 배분·지도 장면)으로 보여주는 병행 화면.
// 편집·드래그·POI 담기·검색·재생·경로 조회는 아직 레거시 담당 (Phase 6에서 이관).
import { useCallback, useEffect, useMemo, useState } from 'react';

import { DayCard } from '@/features/itinerary/components/DayCard';
import { buildDayView, tripCostBreakdownOf } from '@/features/itinerary/domain/dayView';
import { useLegCache } from '@/features/itinerary/hooks/useLegCache';
import { MapView } from '@/features/map/components/MapView';
import { buildMapScene, dayColor, entryFitOf, fitTargetOf } from '@/features/map/domain/scene';
import { ensureTripLegs } from '@/features/routing/services/ensureTripLegs';
import { useTripStore } from '@/features/trip/hooks/useTripStore';
import { fmtMoney } from '@/lib/currency/format';
import './itinerary.css';

export default function ItineraryPage() {
  const { activeTrip } = useTripStore();
  const legCache = useLegCache();

  /** 1-based 일자 필터, 0=전체 (레거시 activeDay와 동일 의미) */
  const [activeDay, setActiveDay] = useState(0);
  /** 첫 조작 전에는 진입 프레이밍(위치 있는 첫 일자)을 유지 */
  const [didEntry, setDidEntry] = useState(false);
  const [sel, setSel] = useState<{ di: number; si: number } | null>(null);

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
        {scene && <MapView scene={scene} fit={fit} onPinClick={onPinClick} />}
        <div className="itCards">
          {views.map(v => (
            <DayCard
              key={v.di} view={v}
              dim={activeDay !== 0 && activeDay !== v.dayNo}
              selectedSi={sel?.di === v.di ? sel.si : null}
              onHeaderClick={() => selectDay(activeDay === v.dayNo ? 0 : v.dayNo)}
            />
          ))}
        </div>
      </div>
      <p className="hint">
        읽기 뷰입니다 — 장소 편집·드래그·지도에서 장소 담기·재생은 기존 앱에서 계속 할 수 있어요.
        이동 시간·경로선은 자동으로 조회해 채웁니다 (조회 전에는 직선 추정).
      </p>
    </main>
  );
}
