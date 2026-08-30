'use client';
// 일정(Itinerary) 읽기 뷰 — 레거시 사이드바 일자 카드와 같은 데이터(tripcanvas_v1·tripcanvas_legs_v4)를
// 같은 규칙(anchor/carry·타임라인·렌터카 연결·비용 배분)으로 보여주는 병행 화면.
// 편집·지도·경로 조회는 아직 레거시 담당 (Phase 5·6에서 이관).
import { useMemo } from 'react';

import { DayCard } from '@/features/itinerary/components/DayCard';
import { buildDayView, tripCostBreakdownOf } from '@/features/itinerary/domain/dayView';
import { useLegCache } from '@/features/itinerary/hooks/useLegCache';
import { useTripStore } from '@/features/trip/hooks/useTripStore';
import { fmtMoney } from '@/lib/currency/format';
import './itinerary.css';

export default function ItineraryPage() {
  const { activeTrip } = useTripStore();
  const legCache = useLegCache();

  const views = useMemo(
    () => (activeTrip ? activeTrip.days.map((_, di) => buildDayView(activeTrip, legCache, di)) : []),
    [activeTrip, legCache]
  );
  const cost = useMemo(
    () => (activeTrip ? tripCostBreakdownOf(activeTrip, legCache) : null),
    [activeTrip, legCache]
  );

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
      {views.map(v => <DayCard key={v.di} view={v} />)}
      <p className="hint">
        읽기 뷰입니다 — 장소 편집·드래그·지도는 기존 앱에서 계속 할 수 있어요. 이동 시간은 기존 앱이
        저장한 경로 캐시를 쓰고, 캐시가 없는 구간은 직선거리 기반 추정입니다.
      </p>
    </main>
  );
}
