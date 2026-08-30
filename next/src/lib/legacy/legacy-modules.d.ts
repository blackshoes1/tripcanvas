// 레거시 UMD 모듈(../../price.js 등)의 앰비언트 선언 — 구현은 저장소 루트의 단일 소스를 그대로 쓴다.
// 여기 선언은 engine.ts가 좁혀서 노출하는 타입의 최소 계약만 담는다.
declare module '@legacy/price.js' {
  const api: {
    PRICE_CFG: Readonly<Record<string, number>>;
    cancelFeeNow(b: unknown, today?: string): number;
    calcSaving(b: unknown, current: number, today?: string): { saving: number; rate: number; fee: number };
    savingWorth(sv: { saving: number; rate: number }, krwRate?: number, cfg?: unknown): boolean;
    bookingPriceStatus(b: unknown, obs: unknown[], opts?: unknown):
      { state: string; current: number; saving: number; rate: number; fee: number } | null;
    offerPrice(o: unknown): number;
    matchQuality(b: unknown, o: unknown): string;
    basisMismatch(b: unknown, basis: unknown): boolean;
    qualityWithBasis(q: string, b: unknown, basis: unknown): string;
    verificationStatus(o: unknown): string;
    offerRank(q: string, verified: boolean): number;
    decideSaving(b: unknown, offers: unknown[], opts?: unknown): {
      confirmed: { offer: unknown; saving: number; rate: number } | null;
      potential: { offer: unknown; delta: number } | null;
      fee: number;
    };
    hotelTrackState(b: unknown, rec: unknown, opts?: unknown): Record<string, unknown> | null;
    identityScore(idn: unknown, prop: unknown): number;
    tripHotelSummary(bookings: unknown[], recById: Record<string, unknown>, opts?: unknown):
      { booked: number; confirmed: number; potential: number; actual: number; count: number };
    carMatchQuality(b: unknown, o: unknown): string;
    normTransmission(v: unknown): string;
    normMileage(v: unknown): string;
    normInsurance(v: unknown): string;
    normCarClass(v: unknown): string;
  };
  export = api;
}

declare module '@legacy/lib.js' {
  const api: {
    parseStorePayload(text: string | null): { ok: true; value: unknown } | { ok: false; error: string };
    normalizeTrip(t: unknown): unknown | null;
    normalizeBooking(b: unknown): unknown | null;
    carReturnPoint(b: unknown): { place: string; code: string };
    bookingShareOn(bookings: unknown[], iso: string): { id: string; type: string; title: string; amount: number; cur?: string }[];
    parseHM(t: string): number;
    TC_LIMITS: Readonly<Record<string, number>>;
    TC_SCHEMA: number;
  };
  export = api;
}

declare module '@legacy/api/hotel-offers.js' {
  import type { LegacyNodeHandler } from '@/lib/legacy/nodeHandler';
  interface HandlerDeps {
    fetchImpl?: (url: string, init?: unknown) => Promise<unknown>;
    env?: Record<string, string | undefined>;
    now?: () => number;
    verifiers?: unknown[];
  }
  const handler: LegacyNodeHandler & {
    createHandler(deps?: HandlerDeps): LegacyNodeHandler;
    runSearch(deps: HandlerDeps, request: unknown): Promise<unknown>;
    providerHealth(env: Record<string, string | undefined>): { id: string; role: string; status: string }[];
    _private: { buckets: Map<string, unknown>; resetProviderMemory(): void } & Record<string, unknown>;
  };
  export = handler;
}

declare module '@legacy/api/car-offers.js' {
  import type { LegacyNodeHandler } from '@/lib/legacy/nodeHandler';
  interface CarAdapter {
    id: string;
    status(): string;
    search(q: unknown): Promise<{ offers: unknown[] }>;
  }
  interface HandlerDeps {
    env?: Record<string, string | undefined>;
    adapters?: CarAdapter[];
    now?: () => number;
  }
  const handler: LegacyNodeHandler & {
    createHandler(deps?: HandlerDeps): LegacyNodeHandler;
    _private: { buckets: Map<string, unknown> } & Record<string, unknown>;
  };
  export = handler;
}

declare module '@legacy/api/track-hotel-prices.js' {
  import type { LegacyNodeHandler } from '@/lib/legacy/nodeHandler';
  interface HandlerDeps {
    fetchImpl?: (url: string, init?: unknown) => Promise<unknown>;
    env?: Record<string, string | undefined>;
  }
  const handler: LegacyNodeHandler & {
    createHandler(deps?: HandlerDeps): LegacyNodeHandler;
    _private: Record<string, unknown>;
  };
  export = handler;
}
