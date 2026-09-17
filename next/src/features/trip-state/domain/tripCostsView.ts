import lib from '@legacy/lib.js';
import { dayCostPartsOf, isoDateOf } from '@/features/itinerary/domain/dayView';
import type { LegCache } from '@/features/itinerary/domain/types';
import type { Trip } from '@/features/trip/domain/types';
import { FALLBACK_FX, type FxSnapshot } from '@/features/currency/domain/fx';
import type { TripDoc } from './todayView';
import { CONTRACT_SCHEMA_VERSION, type TripCostsResponse } from './contract';

export function buildTripCosts(trip: TripDoc, legCache: LegCache, revision: number, fx: FxSnapshot = FALLBACK_FX): TripCostsResponse {
  const document = trip as unknown as Trip;
  const days = document.days.map((day, index) => {
    const cost = dayCostPartsOf(document, legCache, index, fx.rates);
    if (cost.details) { cost.details.fxSource = fx.source; cost.details.fxAsOf = fx.asOf; }
    return { index, title: day.title || '', date: isoDateOf(document, index), cost };
  });
  return { schemaVersion: CONTRACT_SCHEMA_VERSION, revision, days,
    ...lib.tripCostSummary(trip, days, fx.rates),
    fxRates: { ...fx.rates }, fxSource: fx.source, fxAsOf: fx.asOf };
}
