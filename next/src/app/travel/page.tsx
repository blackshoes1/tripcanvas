'use client';
// 여행 모드 (/travel) — 여행 중에 보는 화면. 오늘이 며칠째인지 스스로 짚고,
// 지금 시각으로 현재 장소를 정한다. 값은 전부 buildDayView가 만든 화면 뷰에서 나온다
// (사이드바·이미지·재생과 같은 ETA·구간 기준을 쓰기 위해서).
import { useEffect, useMemo, useState } from 'react';

import { useFxRates } from '@/features/currency/hooks/useFxRates';
import { buildDayView } from '@/features/itinerary/domain/dayView';
import { useLegCache } from '@/features/itinerary/hooks/useLegCache';
import { ensureTripLegs } from '@/features/routing/services/ensureTripLegs';
import { TravelView } from '@/features/travel/components/TravelView';
import { buildTravelView, todayDayIndex } from '@/features/travel/domain/travelView';
import { useTripStore } from '@/features/trip/hooks/useTripStore';
import { todayISO } from '@/lib/date/today';
import './travel.css';

/** 현재 장소가 시각에 따라 넘어가도록 1분마다 다시 그린다 */
function useMinuteTick(): number {
  const [min, setMin] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    const id = window.setInterval(() => {
      const d = new Date();
      setMin(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);
  return min;
}

export default function TravelPage() {
  const { activeTrip } = useTripStore();
  const legCache = useLegCache();
  const fx = useFxRates();
  const nowMin = useMinuteTick();
  const today = todayISO();
  /** 보고 있는 일자 — 처음엔 오늘, 화살표로 옮긴다 */
  const [di, setDi] = useState<number | null>(null);

  useEffect(() => { if (activeTrip) ensureTripLegs(activeTrip); }, [activeTrip, legCache]);

  const at = activeTrip ? Math.min(di ?? todayDayIndex(activeTrip, today), activeTrip.days.length - 1) : 0;
  const view = useMemo(
    () => (activeTrip ? buildDayView(activeTrip, legCache, at, fx) : null),
    [activeTrip, legCache, at, fx]
  );
  const travel = useMemo(
    () => (activeTrip && view ? buildTravelView(activeTrip, view, nowMin, today) : null),
    [activeTrip, view, nowMin, today]
  );

  if (!activeTrip || !travel) {
    return (
      <main className="tvMain">
        <h1>여행 모드</h1>
        <p className="hint">
          이 브라우저에 저장된 여행이 없어요. <a href="/itinerary">일정</a>에서 여행을 만들면 여기서 볼 수 있습니다.
        </p>
      </main>
    );
  }

  const last = activeTrip.days.length - 1;
  return (
    <main className="tvMain">
      <div className="tvNav">
        <button type="button" onClick={() => setDi(Math.max(0, at - 1))} disabled={at === 0}
          aria-label="이전 일자">←</button>
        <select value={at} onChange={e => setDi(+e.target.value)} aria-label="일자 선택">
          {activeTrip.days.map((d, i) => (
            <option key={i} value={i}>Day {i + 1}{d.title ? ` · ${d.title}` : ''}</option>
          ))}
        </select>
        <button type="button" onClick={() => setDi(Math.min(last, at + 1))} disabled={at === last}
          aria-label="다음 일자">→</button>
        {!travel.isToday && (
          <button type="button" className="tvToday" onClick={() => setDi(todayDayIndex(activeTrip, today))}>
            오늘로
          </button>
        )}
        <a className="tvLink" href="/itinerary">일정 편집 →</a>
      </div>
      <TravelView view={travel} />
    </main>
  );
}
