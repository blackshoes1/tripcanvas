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
    /** 여행 파일·공유 링크 본문 → 검증·정규화된 여행 (크기·모양이 어긋나면 이유를 돌려준다) */
    parseTripPayload(text: string): { ok: true; value: unknown } | { ok: false; error: string };
    /** 여행 문서 검증 — 모양이 틀리면 통째로 거절한다 */
    validateTripPayload(value: unknown, options?: { maxBytes?: number }):
      { ok: true; value: unknown } | { ok: false; error: string };
    /** 붙여넣기 직접 형식 → 구조화 */
    parseDirect(text: string): { name: string; start: string; days: unknown[] };
    /** 자유로운 초안의 days를 여행 스키마 모양으로 눕힌다 (AI 응답·직접 형식 공통) */
    normalizeDraftDays(days: unknown): unknown[];
    /** 모델 응답에서 JSON 본문만 떼어낸다 (인사말·코드펜스 제거) */
    extractJson(text: string | undefined): string;
    /** 검색 질의를 좁히는 이름 단순화 ('~ 앞바다' 같은 꼬리 제거) */
    simplifyName(name: string): string;
    /** 외부 지도 링크 — 국내는 카카오맵, 해외는 구글 */
    extMapLink(s: { name: string; lat: number | string; lng: number | string }): { href: string; label: string };
    normalizeTrip(t: unknown): unknown | null;
    /** 첫 방문에 심어 주는 샘플 여행 — 부를 때마다 새 객체 */
    sampleTrip(): unknown;
    normalizeBooking(b: unknown): unknown | null;
    carReturnPoint(b: unknown): { place: string; code: string };
    bookingShareOn(bookings: unknown[], iso: string): { id: string; type: string; title: string; amount: number; cur?: string }[];
    /**
     * 예산에 넣을 예약만 — 일정 장소가 이미 그 금액을 들고 있으면(연결된 숙박에 비용 입력) 뺀다.
     * 기준은 일정 카드에 입력한 금액이고, 장소에 비용이 없을 때만 예약 금액을 쓴다.
     */
    budgetBookings<T>(bookings: T[], days: unknown[]): T[];
    parseHM(t: string | undefined): number;
    hm(min: number): string;
    /** 사람이 친 시각 입력 → HH:MM (범위 밖·빈 값이면 '') */
    normHM(v: string | number | undefined): string;
    /** 그 날 장소를 도착시각 순으로 제자리 정렬 — 순서가 바뀌면 true */
    sortDayByTime(day: unknown): boolean;
    toISO(d: Date): string;
    haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number;
    legKey(a: { lat: number; lng: number }, b: { lat: number; lng: number }, mode?: string): string;
    decodePolyline(str: string | null | undefined): { lat: number; lng: number }[];
    encodePolyline(points: { lat: number; lng: number }[]): string;
    ringPts(p: { lat: number; lng: number }, r: number): { lat: number; lng: number }[];
    zonedMinutesToISOString(isoDate: string, minutes: number, timeZone: string): string | null;
    inKorea(p: { lat: number; lng: number } | null | undefined): boolean;
    stayNights(s: unknown): number;
    localMode(mode: unknown): string;
    isOpenAt(periods: unknown, weekday: number, min: number): boolean | null;
    dayAnchor(day: unknown): unknown;
    dayStartAnchor(days: unknown[], di: number): unknown;
    dayReturnStay(days: unknown[], di: number): unknown;
    computeTimeline(
      day: unknown,
      opts: { legMin: (a: unknown, b: unknown, context: { depart: number }) => number; startAnchor?: unknown }
    ): { eta: number; fixed: boolean; conflict: boolean; natural: number; wait: number }[];
    carSpotLinks(days: unknown[]): {
      pickup: Record<string, { di: number; si: number }>;
      return: Record<string, { di: number; si: number }>;
    };
    carEventsOn(bookings: unknown[], iso: string):
      { kind: 'pickup' | 'return'; id: string; title: string; place: string; code: string; time: string }[];
    spotCatOf(s: unknown): { id: string; icon: string; name: string } | null;
    catFromKakao(groupCode: unknown): string | null;
    catFromGoogle(types: unknown, primaryType?: unknown): string | null;
    /** 카카오 주소 → 도시명 (검색 결과용) */
    cityFromKoreanAddr(addr: string | undefined): string;
    /** 카카오 지번주소 → 도시명 (POI 칩용 — cityFromKoreanAddr와 규칙이 다르다) */
    cityFromKakaoAddress(addr: string | undefined): string;
    /** 구글 Place → 표시 이름 (displayName 형태 차이·빈값 방어, 주소 폴백) */
    placeName(p: unknown): string;
    /** 구글 addressComponents → 도시명 */
    cityFromGoogle(comps: unknown): string;
    /** 구글 regularOpeningHours → {d,o,c}[] (상시영업 d:-1) */
    normHours(oh: unknown): { d: number; o: number; c: number }[] | null;
    /** 검색 실패 원인 분류 */
    classifySearchErr(e: unknown): 'network' | 'quota' | 'auth' | 'error';
    /** 국내 검색인지 — 앵커가 있으면 좌표로, 없으면 질의의 한글 여부로 */
    isKoreanSearch(q: string, near?: { lat: number; lng: number } | null): boolean;
    /** IANA 시간대 문자열인지 (Asia/Tokyo 등) */
    validTimeZone(value: unknown): boolean;
    SPOT_CATS: readonly { id: string; icon: string; name: string }[];
    TC_LIMITS: Readonly<Record<string, number>>;
    TC_SCHEMA: number;
  };
  export = api;
}

declare module '@legacy/sync.js' {
  interface SyncEntryShape {
    revision: number | null;
    status: string;
    op: string;
    hash: string;
  }
  interface RemoteRow {
    client_id: string;
    data: unknown;
    revision: number | string;
    deleted_at: string | null;
  }
  interface MergeConflict {
    kind: 'remote-missing' | 'remote-deleted' | 'changed-both';
    local: unknown;
    remote: unknown;
    revision: number | null;
    deleted_at: string | null;
  }
  const api: {
    /** 저장된 메타 문자열 + v1 id 배열 → 정규화된 meta */
    loadMeta(raw: string | null, legacyIds: string[]): Record<string, SyncEntryShape>;
    sameData(a: unknown, b: unknown): boolean;
    /** 마지막으로 올린 내용의 지문 — revision만으로는 '로컬이 그 revision 그대로인지'를 알 수 없다 */
    hashTrip(value: unknown): string;
    /** 로그인 병합 — 원격이 더 새롭거나 tombstone이면 덮어쓰지 않고 conflict로 보존한다 */
    mergeForLogin(
      localTrips: unknown[], remoteRows: RemoteRow[], currentMeta: Record<string, SyncEntryShape>
    ): {
      trips: unknown[];
      actions: { kind: 'upload'; trip: { id: string } & Record<string, unknown>; force: boolean }[];
      conflicts: MergeConflict[];
      meta: Record<string, SyncEntryShape>;
    };
    beginDelete(meta: Record<string, SyncEntryShape>, id: string, op: string): SyncEntryShape;
    /** 부활한 여행은 반드시 재업로드된다 */
    undoDelete(meta: Record<string, SyncEntryShape>, id: string): SyncEntryShape;
    finishDelete(
      meta: Record<string, SyncEntryShape>, id: string, op: string, revision: number
    ): { resync: boolean; entry: SyncEntryShape };
  };
  export = api;
}

declare module '@legacy/routing.js' {
  type RoutePoint = { lat: number | string; lng: number | string };
  interface RouteResult {
    sec: number; m: number; path: string | null;
    mode?: string; est?: number; snapped?: number; taxi?: number;
  }
  const api: {
    createRoutingClient(deps: {
      fetchImpl: typeof fetch;
      googleKey: string;
      encodePolyline: (points: { lat: number; lng: number }[]) => string;
      ringPts: (p: { lat: number; lng: number }, r: number) => { lat: number; lng: number }[];
      haversine: (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => number;
      inKorea: (p: { lat: number; lng: number }) => boolean;
    }): {
      fetchLeg(a: RoutePoint, b: RoutePoint, mode: string, when?: string | null): Promise<RouteResult | null>;
    };
  };
  export = api;
}

declare module '@legacy/api/kakao-directions.js' {
  import type { LegacyNodeHandler } from '@/lib/legacy/nodeHandler';
  interface HandlerDeps {
    fetchImpl?: (url: string, init?: unknown) => Promise<unknown>;
    env?: Record<string, string | undefined>;
    now?: () => number;
  }
  const handler: LegacyNodeHandler & {
    createHandler(deps?: HandlerDeps): LegacyNodeHandler;
    _private: { buckets: Map<string, unknown> } & Record<string, unknown>;
  };
  export = handler;
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
