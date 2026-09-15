export interface CostDetails {
  items: {
    source: 'SPOT' | 'EXTRA' | 'BOOKING' | 'TRANSPORT';
    key: string;
    title: string;
    kind: string;
    amount: number | null;
    currency: string;
    basis: 'ENTERED' | 'TOTAL' | 'PER_PERSON';
    people: number;
    totalKRW: number | null;
    state: 'UNKNOWN' | 'PARTIAL' | 'FREE' | 'KNOWN' | 'BOOKING';
  }[];
  budget: {
    amount: number;
    currency: string;
    basis: 'ENTERED' | 'TOTAL' | 'PER_PERSON';
    people: number;
    totalKRW: number;
    differenceKRW: number;
  } | null;
  unknownCount: number;
  transportUnpriced: boolean;
  undatedBookings: number;
  hasForeignCurrency: boolean;
  fxRates: Record<string, number>;
  fxSource: string;
  fxAsOf: string | null;
}

export interface DayCostSummary {
  total: number;
  parts: { label: string; amount: number }[];
  /** Optional while older API servers and cached responses remain in use. */
  details?: CostDetails;
}
