import lib from '@legacy/lib.js';
import { dayCostPartsOf, isoDateOf } from '@/features/itinerary/domain/dayView';
import type { LegCache } from '@/features/itinerary/domain/types';
import type { Trip } from '@/features/trip/domain/types';
import { FX_FALLBACK_SNAPSHOT, type FxSnapshot } from '@/features/currency/domain/fx';
import type { TripDoc } from './todayView';
import { CONTRACT_SCHEMA_VERSION, type TripCostsResponse } from './contract';

/**
 * 환율은 **받은 것**을 쓴다(`serverFx`). 안 넘기면 근사값이고 응답이 그렇게 말한다 —
 * 출처(`fxSource`)와 기준일(`fxAsOf`)이 하루치 상세와 전체에 같이 실린다.
 * `todayISO`는 결제일이 있는 항목의 상태를 정하는 오늘이다 — 하루치와 가계부 줄이 **같은 오늘**을 쓴다.
 */
export function buildTripCosts(trip: TripDoc, legCache: LegCache, revision: number,
                               fx: FxSnapshot = FX_FALLBACK_SNAPSHOT, todayISO?: string): TripCostsResponse {
  const document = trip as unknown as Trip;
  const days = document.days.map((day, index) => {
    const cost = dayCostPartsOf(document, legCache, index, fx.rates, todayISO);
    if (cost.details) { cost.details.fxSource = fx.source; cost.details.fxAsOf = fx.asOf; }
    return { index, title: day.title || '', date: isoDateOf(document, index), cost };
  });
  return { schemaVersion: CONTRACT_SCHEMA_VERSION, revision, days,
    ...lib.tripCostSummary(trip, days, fx.rates, todayISO),
    fxRates: { ...fx.rates }, fxSource: fx.source, fxAsOf: fx.asOf };
}
