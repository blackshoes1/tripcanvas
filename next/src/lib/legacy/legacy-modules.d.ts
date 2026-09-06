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
    /** 외부 지도 링크 — 국내는 카카오맵, 해외는 구글. 찾는 기준은 kakaoId → 이름이고 좌표는 지도 선택용 */
    extMapLink(s: { name: string; city?: string; kakaoId?: string; lat: number | string; lng: number | string }): { href: string; label: string };
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
    /** 하루를 순차 구간과 분리 구간으로 나눈다 — **타임라인과 화면이 같은 함수로 갈라야** 한다 */
    splitSegments(day: unknown): Array<{
      split: string | null;
      from: number;
      to: number;
      branches: Array<{ key: string; who: string[]; idx: number[] }>;
    }>;
    /** 참여자 집합의 키. 비어 있으면 '*'(= 모든 여행자) */
    whoKey(spot: unknown): string;
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

declare module '@legacy/adaptive.js' {
  type Flexibility = 'FIXED' | 'SEMI_FIXED' | 'FLEXIBLE';
  type ActivityStatus = 'PLANNED' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED' | 'CANCELLED';
  type CommitmentType = 'FLIGHT' | 'TRAIN' | 'HOTEL' | 'RESTAURANT' | 'TOUR' | 'CAR' | 'OTHER';
  type PlanningMode = 'MANUAL' | 'ASSISTED' | 'DELEGATED';
  type EnergyLevel = 'LOW' | 'NORMAL' | 'HIGH';
  interface LatLng { lat: number; lng: number }
  interface TripItem {
    id: string; si: number; name: string; spot: Record<string, unknown>;
    eta: number; natural: number; travelIn: number; depart: number; end: number; stayMin: number;
    status: ActivityStatus; flexibility: Flexibility; type: CommitmentType; priority: number;
    location: LatLng | null; fixedAt: number | null; conflict: boolean;
  }
  interface FixedCommitment {
    id: string; itemId: string; type: CommitmentType; title: string;
    startMin: number; endMin: number; location: LatLng | null; flexibility: Flexibility;
  }
  interface FreeWindow {
    startMin: number; endMin: number; minutes: number; anchor: LatLng | null;
    afterId: string | null; beforeId: string | null; beforeFixed: boolean;
  }
  interface NextActionCandidate {
    type: string; id: string; targetId: string | null; title: string; score: number; reasons: string[];
    estimatedDuration: number; estimatedTravelTime: number; arriveMin: number; endMin: number;
    fromDay: number | null; si: number | null; spot: Record<string, unknown> | null;
  }
  interface SuggestionImpact {
    timeChangeMinutes?: number; travelTimeChangeMinutes?: number; costChange?: number;
    removedActivities?: string[]; addedActivities?: string[];
  }
  interface TripSuggestion {
    id: string; key: string; type: string; title: string; description: string; reasons: string[];
    impact: SuggestionImpact; status: string;
    action: { kind: string; si?: number | null; fromDay?: number | null; candidateId?: string; startMin?: number; drop?: string[]; keep?: string[]; bookingId?: string };
  }
  interface TripState {
    tripId: string; tripName: string; currentDay: number; todayIndex: number; dayCount: number;
    todayISO: string; weekday: number; live: boolean; nowMin: number; dayStartMin: number; dayEndMin: number;
    day: Record<string, unknown>; items: TripItem[];
    completedItems: string[]; remainingItems: string[]; skippedItems: string[];
    fixedCommitments: FixedCommitment[]; nextFixed: FixedCommitment | null;
    currentItem: TripItem | null; nextItem: TripItem | null;
    currentLocation: LatLng | null; startLocation: LatLng | null; hotelLocation: LatLng | null;
    availableMin: number; delayMin: number; travelMinToday: number;
    planningMode: PlanningMode; energyLevel: EnergyLevel; prefs: Record<string, unknown>;
  }
  interface ReplanResult {
    needed: boolean; feasible: boolean; keep: string[]; drop: string[]; dropNames: string[];
    lateBy: number; before: string[]; after: string[]; impact: SuggestionImpact;
  }
  const api: {
    ADAPT_CFG: Readonly<Record<string, number>>;
    currentDayIndex(trip: unknown, todayISO: string): number;
    weekdayOf(iso: string): number;
    commitmentOf(spot: unknown, day: unknown, bookings?: unknown[]): { type: CommitmentType; flexibility: Flexibility; bookingId: string | null };
    planningModeHint(trip: unknown): PlanningMode;
    buildTripState(trip: unknown, opts?: Record<string, unknown>): TripState;
    findFreeWindows(state: TripState, opts?: Record<string, unknown>): FreeWindow[];
    buildCandidates(trip: unknown, state: TripState, opts?: Record<string, unknown>): unknown[];
    rankNextActions(state: TripState, candidates: unknown[], opts?: Record<string, unknown>): NextActionCandidate[];
    generateReplan(state: TripState, opts?: Record<string, unknown>): ReplanResult;
    buildSuggestions(trip: unknown, state: TripState, opts?: Record<string, unknown>):
      { suggestions: TripSuggestion[]; windows: FreeWindow[]; replan: ReplanResult; ranked: NextActionCandidate[]; window: FreeWindow | null; empty: boolean };
    parseIntent(text: string): { energyLevel: EnergyLevel | null; prefs: Record<string, unknown>; reasons: string[]; understood: boolean };
    departureAdvice(state: TripState, item: TripItem | null, travelMin: number):
      { leaveMin: number; slackMin: number; level: 'EARLY' | 'NOW' | 'LATE'; text: string } | null;
    fillGaps(trip: unknown, state: TripState, opts?: Record<string, unknown>):
      { slots: { startMin: number; endMin: number; afterId: string | null; pick: NextActionCandidate }[]; impact: SuggestionImpact };
    planDayFlow(trip: unknown, state: TripState, opts?: Record<string, unknown>):
      { blocks: { kind: string; startMin: number; endMin?: number; title: string; segment: string; afterId?: string | null; itemId?: string; pick?: NextActionCandidate }[]; picks: NextActionCandidate[]; empty: boolean; impact: SuggestionImpact };
    suggestionKey(type: string, what: string, state: TripState): string;
    // ── Travel State 계층 (출발 계획 · Trip Pulse · 알림 계획) ──
    SAFETY_BUFFER: Readonly<Record<string, number>>;
    NOTIFICATION_KINDS: Readonly<Record<string, string>>;
    safetyBufferFor(item: TripItem, opts?: Record<string, unknown>): number;
    departurePlan(state: TripState, item: TripItem | null, travelMin: number, opts?: Record<string, unknown>): {
      leaveMin: number; slackMin: number; bufferMin: number; travelMin: number;
      level: 'EARLY' | 'NOW' | 'LATE'; stage: 'UPCOMING' | 'READY_TO_LEAVE' | 'LATE_RISK';
      lateByMin: number; text: string; targetMin: number;
    } | null;
    tripPulse(state: TripState, replan: ReplanResult | null, departure?: unknown, opts?: Record<string, unknown>):
      { code: string; text: string; detail: string };
    stateVersion(state: TripState, extra?: { stage?: string; pulse?: string }): string;
    notificationPlan(state: TripState, input?: {
      departure?: unknown; pulse?: unknown; replan?: unknown; suggestions?: unknown[];
      suppressUntilMin?: number; travelMode?: boolean; quiet?: boolean;
    }, opts?: Record<string, unknown>): {
      kind: string; origin: 'DEVICE' | 'SERVER'; dedupeKey: string; title: string; body: string;
      deepLink: string; targetId: string | null; priority: number; expiresAtMin: number | null;
    }[];
    pendingNotifications<T extends { dedupeKey: string }>(plan: T[], sentKeys: string[]): T[];
    suggestionExpiryMin(state: TripState, opts?: Record<string, unknown>): number;
    feedbackEntry(sug: unknown, action: string, atISO: string): { recommendationId: string; key: string; type: string; action: string; createdAt: string };
  };
  export = api;
}

declare module '@legacy/collab.js' {
  type Role = 'OWNER' | 'EDITOR' | 'VIEWER';
  interface MemberRow { id?: number | string; user_id?: string; role?: string; status?: string; display_name?: string | null; joined_at?: string | null; me?: boolean }
  interface RoleRow { role?: string }
  /** GET /api/v1/me의 여행 한 줄. supabaseTripId는 Supabase 실시간을 쓸 때만 온다 */
  interface MeTripRow { id?: string; role?: string; memberCount?: number; owner?: boolean; supabaseTripId?: string | number | null }
  interface InvitePreview { valid?: boolean; reason?: string | null; trip_name?: string | null; start_date?: string | null; day_count?: number | null; role?: string | null; expires_at?: string | null; already_member?: boolean }
  const api: {
    ROLES: readonly Role[];
    ROLE_LABEL: Readonly<Record<Role, string>>;
    COLLAB_CFG: Readonly<Record<string, number>>;
    JOIN_REASON: Readonly<Record<string, string>>;
    normRole(role: unknown): Role | null;
    /** 여행 취향 화이트리스트 — 서버(tc_norm_prefs · CollabService)와 같은 규칙 */
    normPrefs(p: unknown): Record<string, unknown>;
    canEdit(role: unknown): boolean;
    canManage(role: unknown): boolean;
    canLeave(role: unknown): boolean;
    canDelete(role: unknown): boolean;
    roleLabel(role: unknown): string;
    roleIcon(role: unknown): string;
    /** 로그아웃·역할 정보 없음(로컬 전용)은 소유자 — 혼자 쓰는 여행은 예전 그대로다 */
    roleOf(roles: Record<string, RoleRow> | null | undefined, clientId: string, signedIn: boolean): Role;
    tripRoleMap(rows: MeTripRow[] | null | undefined): Record<string, { role: Role; count: number; owner: boolean; serverId: string }>;
    memberName(m: MemberRow | null | undefined): string;
    displayNameFromEmail(email: string | null | undefined): string;
    memberSummary(members: MemberRow[] | null | undefined): { total: number; owners: number; editors: number; viewers: number; names: string[] };
    buildInviteLink(pageUrl: string, token: string): string;
    parseJoinHash(hash: string | null | undefined): string | null;
    inviteVerdict(preview: InvitePreview | null | undefined): { ok: boolean; reason: string; text: string; alreadyMember: boolean; role: Role | null };
    joinReasonText(reason: string | null | undefined): string;
    inviteRangeText(start: string | null | undefined, dayCount: number | null | undefined): string;
    isForbiddenError(err: unknown): boolean;
    forbiddenText(err: unknown, role: Role | null | undefined): string;
    readonly ACTIVITY_KINDS: readonly string[];
    /** 실시간 이벤트 하나가 **무엇을 다시 읽게 하는가**. payload를 화면 상태로 쓰지 않기 위한 단일 규칙(§41) */
    liveEffects(event: { kind?: string; mine?: boolean } | null | undefined): {
      candidates: boolean; members: boolean; pull: boolean; activity: boolean; notify: boolean;
    };
    /** 여행 취향 요약. 점수가 아니라 정리다 — 자동으로 무엇을 빼자고 하지 않는다(§62) */
    groupContext(rows: unknown[] | null | undefined, memberCount: number | null | undefined): GroupCtx;
    groupContextText(ctx: GroupCtx | null | undefined): string[];
    /** ⚠️ score는 **내부값**이다 — 화면·계약에 싣지 않는다(§21·§22) */
    consensusOf(candidate: unknown, memberCount: number | null | undefined): {
      score: number; strongSupportCount: number; oppositionCount: number;
      status: string | null; voted: number; members: number;
    };
    /** 반대 없고 두 명 이상이 말한 후보를 어느 날에 넣을지. 저장하지 않는 **미리보기**다(§79) */
    /** 참여자 이름표 — 나는 늘 '나'로 부르고 맨 앞에 둔다. 모르는 id는 '멤버' */
    whoLabels(who: string[] | null | undefined, members: unknown[] | null): string[];
    /** '모두' 또는 '나 · 지민'. who가 비어 있으면 모든 여행자다(§26) */
    whoText(spot: unknown, members: unknown[] | null): string;
    /** 이 일정에 내가 들어 있는가. 지정이 없으면 모두이므로 참이다 */
    includesMe(spot: unknown, myId: string | null | undefined): boolean;
    buildGroupProposal(
      candidates: unknown[] | null | undefined, days: unknown[] | null | undefined,
      memberCount: number | null | undefined, ctx?: GroupCtx | null, max?: number
    ): { headline: string; picks: ProposalPick[] } | null;
  };
  interface GroupCtx {
    members: number; answered: number;
    pace: { value: string; count: number } | null; paceSplit: boolean;
    walking: string | null; walkingWho: string[];
    morningNo: string[]; nightNo: string[];
    sharedInterests: string[]; conflicts: { interest: string; want: string[]; avoid: string[] }[];
  }
  interface ProposalPick {
    candidate: { id?: number | string; title?: string | null; lat?: number | null; lng?: number | null };
    di: number; km: number | null; reasons: string[];
  }
  export = api;
}

declare module '@legacy/intake.js' {
  type ShareKind = 'BOOKING' | 'PLACE' | 'TRANSPORT' | 'NOTE' | 'UNKNOWN';
  type CandidateType = 'HOTEL' | 'FLIGHT' | 'TRAIN' | 'CAR' | 'RESTAURANT' | 'TOUR' | 'OTHER';
  interface SharedInput {
    sourceType?: string; url?: string; text?: string; title?: string;
    receivedAt?: string; locale?: string; timeZone?: string;
  }
  interface Candidate {
    type: CandidateType; title: string | null; provider: string | null; providerId: string | null;
    confirmationNumber: string | null; startAt: string | null; endAt: string | null;
    location: string | null; amount: number | null; currency: string | null;
    sourceUrl: string | null; sourceTitle: string | null; receivedAt: string | null;
    reasons: string[]; ambiguities: string[]; missingFields: string[]; confidence: number;
  }
  const api: {
    INTAKE_CFG: Readonly<Record<string, number>>;
    MEMORY_CFG: Readonly<Record<string, number>>;
    SHARE_STATES: readonly string[];
    MEMORY_TYPES: readonly string[];
    PROVIDER_ADAPTERS: readonly { id: string; hosts: readonly string[]; type: CandidateType; name: string }[];
    classifyShare(input: SharedInput): { kind: ShareKind; confidence: number; reasons: string[] };
    normalizeDate(raw: string, opts?: { locale?: string; year?: number }):
      { iso: string | null; ambiguous: boolean; alternative: string | null };
    normalizeCurrency(raw: string, opts?: { hint?: string }): { code: string | null; ambiguous: boolean };
    normalizeAmount(raw: string): number | null;
    providerFor(url?: string): { id: string; type: CandidateType; name: string } | null;
    parseBookingCandidate(input: SharedInput, opts?: { locale?: string; year?: number; currencyHint?: string }): Candidate;
    candidateDisposition(c: unknown, opts?: unknown): 'AUTO' | 'REVIEW' | 'MANUAL';
    findDuplicateBooking(candidate: unknown, bookings: unknown[], opts?: unknown):
      { booking: unknown; score: number; reasons: string[] } | null;
    matchTripForBooking(candidate: unknown, trips: unknown[], opts?: unknown):
      { tripId: string; name: string; score: number; reasons: string[] }[];
    candidateToBooking(candidate: unknown, id: string): Record<string, unknown>;
    shareIdempotencyKey(input: SharedInput): string;
    shareQueueNext(state: string, event: string): string;
    titleSimilarity(a: string, b: string): number;
    associateMemory(
      capture: { atMinutes: number; location?: { lat: number; lng: number } | null },
      activities: unknown[], opts?: unknown
    ): { activityId: string | null; reason: string };
    memoryTimeline(events: unknown[], activities: unknown[]): {
      activityId: string | null; title: string; atMinutes: number;
      photos: number; notes: number; events: unknown[];
    }[];
    plannedVsActual(activities: unknown[], events: unknown[]):
      { planned: string[]; visited: string[]; missed: string[]; unplanned: number };
  };
  export = api;
}
