// 웹·iOS가 함께 쓰는 API contract. **이 파일이 단일 출처다** — Swift Codable 모델은 이것을 그대로 옮긴다.
//
// 판단 로직은 여기에 없다. 판단은 저장소 루트의 adaptive.js(웹이 쓰는 그 엔진)가 하고,
// 이 계층은 그 결과를 플랫폼 중립적인 모양으로 눕히기만 한다. iOS가 자체 엔진을 갖는 순간
// 두 플랫폼의 답이 갈라지므로, iOS는 표현만 하고 판단은 서버가 한다.
//
// 시각은 전부 '그 날 자정부터의 분'(0~1440+)으로 보낸다. 여행지 현지 시각이 기준이고,
// 절대 시각(ISO)이 필요한 곳(Live Activity 등)만 따로 ISO를 함께 싣는다 — 기기 시간대가
// 여행지와 다를 때 클라이언트가 잘못 환산하는 사고를 막는다.

/** contract 버전. 구버전 iOS가 즉시 깨지지 않도록 필드 제거·의미 변경 시에만 올린다(추가는 그대로). */
export const CONTRACT_SCHEMA_VERSION = 1;
/** 경로 버전. /api/v1/... */
export const API_VERSION = 'v1';

export type Flexibility = 'FIXED' | 'SEMI_FIXED' | 'FLEXIBLE';
export type ActivityStatus = 'PLANNED' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED' | 'CANCELLED';
export type CommitmentType = 'FLIGHT' | 'TRAIN' | 'HOTEL' | 'RESTAURANT' | 'TOUR' | 'CAR' | 'OTHER';
export type PlanningMode = 'MANUAL' | 'ASSISTED' | 'DELEGATED';
/** 이 여행에서 호출자의 역할(함께하기). 접근 제어는 DB(RLS)가 하고, 이 값은 화면이 편집 도구를 감추는 데 쓴다. */
export type MemberRole = 'OWNER' | 'EDITOR' | 'VIEWER';
export type EnergyLevel = 'LOW' | 'NORMAL' | 'HIGH';

/** 지금 사용자가 놓인 상태 — Today 화면의 헤드라인을 결정한다. */
export type TravelStatus =
  | 'NO_PLAN'          // 오늘 일정이 없다 (정상 상태다 — 빈 화면 대신 제안을 보여준다)
  | 'UPCOMING'         // 다음 일정까지 여유가 있다
  | 'READY_TO_LEAVE'   // 지금 나서면 맞다
  | 'TRAVELING'        // 출발 시각을 지나 이동 중일 것이다
  | 'ARRIVED'          // 도착했지만 예약 시각을 기다리는 중
  | 'IN_PROGRESS'      // 지금 그 일정을 하는 중
  | 'DELAYED'          // 계획보다 밀렸다
  | 'COMPLETED';       // 오늘 남은 일정이 없다

export interface GeoPoint { lat: number; lng: number }

export interface TripSummary {
  id: string;               // trips.client_id (웹의 trip.id와 같다)
  name: string;
  start: string;            // YYYY-MM-DD ('' 가능 — 날짜 미정 여행)
  dayCount: number;
  revision: number;         // 낙관적 잠금 기준값. 쓰기 요청에 그대로 실어 보낸다
  updatedAt: string;        // ISO
  timeZone: string;         // '' 가능
  cities: string[];
  todayIndex: number;       // 오늘이 몇 일차인지. -1이면 여행 기간 밖
  role: MemberRole;         // 내 역할 — VIEWER면 쓰기 요청은 403(FORBIDDEN)이다
  memberCount: number;      // 활성 멤버 수(주최자 포함). 1이면 혼자 쓰는 여행
}

export interface DaySummary {
  index: number;
  date: string;             // YYYY-MM-DD ('' 가능)
  title: string;
  mode: string;             // car·taxi·transit·train·walk·bike·flight
  startMinutes: number;
  spotCount: number;
  timeZone: string;
}

export interface ActivitySummary {
  id: string;               // 'd{dayIndex}s{spotIndex}' — 이 여행 문서 안에서만 유효한 위치 기반 id
  name: string;
  city: string;
  desc: string;
  status: ActivityStatus;
  flexibility: Flexibility;
  type: CommitmentType;
  etaMinutes: number;       // 이동상 도착 예정
  startMinutes: number;     // 실제 시작 (예약이면 예약 시각까지 기다린 뒤)
  endMinutes: number;
  stayMinutes: number;
  travelInMinutes: number;
  fixedAtMinutes: number | null;   // 상대가 정한 약속(bookAt) 또는 내가 정한 시각(at)
  location: GeoPoint | null;
  mustVisit: boolean;
  optional: boolean;
  bookingId: string | null;
  bookUrl: string | null;
  placeId: string | null;
}

export interface FixedCommitmentSummary {
  id: string;
  activityId: string;
  type: CommitmentType;
  title: string;
  startMinutes: number;
  endMinutes: number;
  location: GeoPoint | null;
  flexibility: Flexibility;
}

export interface TripStateSummary {
  currentDay: number;
  todayIndex: number;
  dayCount: number;
  live: boolean;            // 오늘이 이 일자인가 (여행 중 / 계획 중을 가른다)
  nowMinutes: number;
  dayStartMinutes: number;
  dayEndMinutes: number;
  availableMinutes: number;
  delayMinutes: number;
  travelMinutesToday: number;
  planningMode: PlanningMode;
  energyLevel: EnergyLevel;
  completedActivityIds: string[];
  remainingActivityIds: string[];
  skippedActivityIds: string[];
  currentLocation: GeoPoint | null;
}

export interface DepartureAdvice {
  leaveMinutes: number;
  slackMinutes: number;
  level: 'EARLY' | 'NOW' | 'LATE';
  text: string;             // 사람이 읽을 문장. 명령형을 쓰지 않는다
}

export interface NextAction {
  activityId: string | null;
  title: string;
  status: TravelStatus;
  travelMinutes: number | null;
  etaMinutes: number | null;
  startMinutes: number | null;
  stayMinutes: number | null;
  departure: DepartureAdvice | null;
  location: GeoPoint | null;
  type: CommitmentType;
  flexibility: Flexibility;
  reasons: string[];
}

export interface SuggestionImpact {
  timeChangeMinutes?: number;
  travelTimeChangeMinutes?: number;
  costChange?: number;
  removedActivities?: string[];
  addedActivities?: string[];
}

export type SuggestionType = 'NEXT_ACTIVITY' | 'REPLAN' | 'PRICE_SAVING' | 'REST';
export type SuggestionActionKind =
  | 'VISIT_PLACE' | 'CHECK_IN' | 'MOVE_TO_TODAY' | 'REST' | 'RETURN_TO_HOTEL' | 'EAT' | 'REPLAN' | 'OPEN_BOOKING';

export interface TripSuggestion {
  id: string;               // 결정적 키 — accept/skip 요청에 그대로 실어 보낸다
  type: SuggestionType;
  title: string;
  description: string;
  reasons: string[];        // 왜 이걸 권하는지. 비어 있으면 안 된다
  impact: SuggestionImpact;
  action: {
    kind: SuggestionActionKind;
    activityId: string | null;    // 오늘 일정 안의 대상
    fromDay: number | null;       // 다른 날에서 옮겨오는 경우 그 일자
    bookingId: string | null;
    dropActivityIds: string[];    // REPLAN에서 뺄 일정
    startMinutes: number | null;
  };
  /** 수락 가능한지 — EAT처럼 장소를 사용자가 직접 골라야 하는 제안은 false */
  acceptable: boolean;
}

export interface ReplanPreview {
  needed: boolean;
  feasible: boolean;
  lateMinutes: number;
  before: string[];
  after: string[];
  dropActivityIds: string[];
  dropNames: string[];
  movesToNextDay: boolean;  // 뺀 일정을 다음 날로 옮기는지 (마지막 날이면 '건너뜀' 표시)
  impact: SuggestionImpact;
}

/** §40 Live Activity / Dynamic Island가 그대로 쓸 수 있는 compact state. 이번 단계에서는 표시만 하지 않는다. */
export interface TravelActivityState {
  tripName: string;
  dayLabel: string;
  nextTitle: string;
  startAtISO: string | null;
  travelMinutes: number | null;
  status: TravelStatus;
}

/** 이동시간의 출처. 서버는 캐시된 실제 경로가 없으므로 직선거리 추정이다 — 클라이언트가 그대로 표기한다. */
export type TravelTimeSource = 'STRAIGHT_LINE_ESTIMATE' | 'ROUTED';

export interface TodayResponse {
  schemaVersion: number;
  generatedAt: string;
  travelTimeSource: TravelTimeSource;
  trip: TripSummary;
  day: DaySummary;
  currentState: TripStateSummary;
  nextAction: NextAction | null;
  suggestions: TripSuggestion[];
  remainingActivities: ActivitySummary[];
  activities: ActivitySummary[];
  fixedCommitments: FixedCommitmentSummary[];
  replan: ReplanPreview;
  activityState: TravelActivityState;
}

/** 가격 추적 상태 — 웹의 배지와 같은 판정(price.js). 확정 절약과 '조건 확인 필요'를 섞지 않는다. */
export type PriceState = 'SAVING_AVAILABLE' | 'CHEAPER_UNVERIFIED' | 'GOOD_PRICE' | 'WATCHING' | 'ERROR' | 'UNTRACKED';

export interface PriceStatus {
  state: PriceState;
  currentPrice: number | null;
  /** 예약 통화 기준 실질 절약(취소 수수료 반영). CHEAPER_UNVERIFIED면 최대 차액이다 */
  savingAmount: number | null;
  currency: string;
  seller: string | null;
  /** 언제 확인한 값인지 — 오래된 값을 최신처럼 보여주지 않기 위해 반드시 함께 표기한다 */
  observedAt: string | null;
  note: string;
}

export interface BookingSummary {
  id: string;
  type: 'hotel' | 'car' | 'flight';
  title: string;
  provider: string;
  url: string | null;
  price: number;
  currency: string;
  start: string | null;
  end: string | null;
  refundable: boolean | null;
  freeCancelUntil: string | null;
  /** 예약 번호 — 웹에 입력 UI가 아직 없어 대개 null이다(없는 값을 지어내지 않는다) */
  confirmation: string | null;
  place: string | null;
  startTime: string | null;
  endTime: string | null;
  priceStatus: PriceStatus | null;
}

export interface BookingListResponse {
  schemaVersion: number;
  bookings: BookingSummary[];
}

// ── Travel State (여행 중 iOS가 쓰는 집약 응답) ──

/** 하루 상태 한 마디. 내부 코드는 화면에 그대로 쓰지 않고 text만 보여준다(§51). */
export type TripPulseCode =
  | 'NO_PLAN' | 'ON_TRACK' | 'AHEAD' | 'DELAYED' | 'FREE_TIME' | 'NEEDS_ATTENTION' | 'RESTING' | 'DAY_COMPLETE';

export interface TripPulse {
  code: TripPulseCode;
  text: string;
  detail: string;
}

/** 출발 단계 — 알림은 이 값이 바뀔 때만 검토한다(§15). */
export type DepartureStage = 'UPCOMING' | 'READY_TO_LEAVE' | 'LATE_RISK';

export interface DeparturePlan {
  activityId: string;
  /** 권장 출발 = 약속 − 이동 − 안전여유 */
  leaveMinutes: number;
  leaveAtISO: string | null;
  slackMinutes: number;
  /** 일정 성격별 안전 여유 (열차 30분, 항공 120분 …) */
  bufferMinutes: number;
  travelMinutes: number;
  targetMinutes: number;
  /** 지금 나서도 약속에 늦는 분. 0이면 늦지 않는다 */
  lateByMinutes: number;
  level: 'EARLY' | 'NOW' | 'LATE';
  stage: DepartureStage;
  text: string;
}

export type NotificationKind =
  | 'departureReminder' | 'fixedCommitmentReminder' | 'scheduleDelay'
  | 'replanSuggestion' | 'emptySlotSuggestion' | 'priceSaving';

export interface NotificationPlanItem {
  kind: NotificationKind;
  /** 누가 판단하는가 — 위치가 필요한 것은 기기, 일정 전체·가격은 서버(§11) */
  origin: 'DEVICE' | 'SERVER';
  /** 같은 상황을 두 번 알리지 않기 위한 키. 단계가 바뀌면 값도 바뀐다(§46) */
  dedupeKey: string;
  title: string;
  body: string;
  /** 홈이 아니라 그 화면으로 바로 간다(§40) */
  deepLink: string;
  targetId: string | null;
  priority: number;
  expiresAtISO: string | null;
}

/** 잠금화면·Dynamic Island가 그릴 압축 상태. 일정표를 통째로 넣지 않는다(§75.5). */
export interface LiveActivityState {
  tripName: string;
  dayLabel: string;
  status: TravelStatus;
  nextTitle: string;
  nextStartISO: string | null;
  travelMinutes: number | null;
  departureText: string | null;
  fixedTitle: string | null;
  fixedStartISO: string | null;
  pulseText: string;
  stateVersion: string;
}

export interface WidgetActivity {
  id: string;
  title: string;
  startMinutes: number;
  startISO: string | null;
  type: CommitmentType;
  isFixed: boolean;
}

/** 위젯은 앱 데이터를 복제하지 않고 이 압축본만 공유한다(§28). */
export interface WidgetSnapshot {
  tripId: string;
  tripName: string;
  dayLabel: string;
  dayTitle: string;
  pulseText: string;
  nextActivity: WidgetActivity | null;
  nextTravelMinutes: number | null;
  upcoming: WidgetActivity[];
  updatedAtISO: string;
  stateVersion: string;
}

export interface TravelStateResponse {
  schemaVersion: number;
  /** 이 값이 그대로면 아무것도 바뀌지 않은 것이다 — Live Activity 갱신·알림 중복 제거의 기준(§47) */
  stateVersion: string;
  today: TodayResponse;
  pulse: TripPulse;
  departure: DeparturePlan | null;
  /** 아직 보내지 않은 것만 담긴다 */
  notifications: NotificationPlanItem[];
  liveActivity: LiveActivityState;
  widget: WidgetSnapshot;
  suggestionsExpireAtISO: string | null;
  suggestionsExpireMinutes: number;
  /** 이번 계산에 쓴 위치. 서버에 저장하지 않는다(§55) */
  locationUsed: GeoPoint | null;
  locationUpdatedAt: string | null;
  travelMode: boolean;
}

// ── 유입 (공유 → 예약 후보) · 여행 기록 ──

export type ShareKind = 'BOOKING' | 'PLACE' | 'TRANSPORT' | 'NOTE' | 'UNKNOWN';
export type CandidateType = 'HOTEL' | 'FLIGHT' | 'TRAIN' | 'CAR' | 'RESTAURANT' | 'TOUR' | 'OTHER';
/** 이 후보를 어떻게 다룰지. AUTO여도 저장은 사용자가 확인한 뒤에만 일어난다(§16). */
export type CandidateDisposition = 'AUTO' | 'REVIEW' | 'MANUAL';

export interface BookingCandidate {
  type: CandidateType;
  title: string | null;
  provider: string | null;
  providerId: string | null;
  confirmationNumber: string | null;
  startAt: string | null;
  endAt: string | null;
  location: string | null;
  amount: number | null;
  currency: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  /** 0~1. 얼마나 믿을 만한가 — 숫자를 그대로 보여주지 않고 disposition으로 다룬다 */
  confidence: number;
  /** 못 읽은 필수 항목. 미리보기가 빈 칸을 그대로 보여주게 한다 */
  missingFields: string[];
  /** 날짜·통화처럼 확실하지 않은 것. 있으면 자동으로 넘기지 않는다 */
  ambiguities: string[];
  reasons: string[];
  disposition: CandidateDisposition;
}

export interface TripMatch {
  tripId: string;
  name: string;
  score: number;
  reasons: string[];
}

export interface DuplicateBookingMatch {
  tripId: string;
  bookingId: string;
  title: string;
  score: number;
  reasons: string[];
}

export interface ImportPreviewResponse {
  schemaVersion: number;
  /** 같은 공유를 두 번 처리하지 않기 위한 키(§57) */
  idempotencyKey: string;
  kind: ShareKind;
  kindConfidence: number;
  kindReasons: string[];
  /** 예약으로 볼 만할 때만. 장소·메모는 null이다 */
  candidate: BookingCandidate | null;
  tripMatches: TripMatch[];
  duplicate: DuplicateBookingMatch | null;
  /** 못 읽어도 버리지 않는다 — 메모로 남길 수 있게 원문을 돌려준다(§50) */
  rawText: string | null;
  rawUrl: string | null;
  rawTitle: string | null;
}

export interface ImportCommitResponse {
  schemaVersion: number;
  bookingId: string;
  revision: number;
  /** 새 예약이 남은 일정과 부딪히는지 — 저장으로 끝나지 않고 다음 행동으로 이어진다(§42) */
  replan: ReplanPreview;
  today: TodayResponse;
}

export type MemoryType = 'PHOTO' | 'NOTE' | 'VISIT' | 'MOMENT';

export interface MemoryEvent {
  id: string;
  dayIndex: number | null;
  activityId: string | null;
  type: MemoryType;
  caption: string | null;
  /** 기기 사진 보관함의 식별자. 원본 이미지는 서버로 올리지 않는다(§76.6) */
  assetRefs: string[];
  location: GeoPoint | null;
  atMinutes: number | null;
  capturedAt: string;
  clientKey: string | null;
}

export interface MemoryTimelineGroup {
  activityId: string | null;
  title: string;
  atMinutes: number;
  photos: number;
  notes: number;
  eventIds: string[];
}

export interface MemoryListResponse {
  schemaVersion: number;
  events: MemoryEvent[];
  timeline: MemoryTimelineGroup[];
}

export interface MemoryCreateResponse {
  schemaVersion: number;
  event: MemoryEvent;
  /** 어느 일정에 붙였는지, 왜 그렇게 붙였는지 */
  association: { activityId: string | null; reason: string };
  alreadyExists: boolean;
}

export interface DeviceRegistration {
  deviceId: string;
  platform: 'ios' | 'web';
  pushToken: string;
  enabled: boolean;
  /** 범주별 on/off — 없는 키는 켜진 것으로 본다(§41) */
  preferences: Record<string, boolean>;
  appVersion: string | null;
}

export interface TripListResponse {
  schemaVersion: number;
  trips: TripSummary[];
}

/**
 * GET/POST/PUT /api/v1/trips[/:id] — 여행 문서 전체. 단순 조회·저장은 판단이 없으므로 문서 그대로다.
 * 쓰기(PUT)는 마지막에 읽은 revision을 expectedRevision으로 실어 보낸다 — 다르면 409 STALE_VERSION(현재 revision 동봉).
 */
export interface TripDetailResponse {
  schemaVersion: number;
  trip: TripSummary;
  /** 정규화된 여행 문서(normalizeTrip을 지난 것) — 웹 localStorage의 trip과 같은 모양 */
  document: Record<string, unknown>;
}

export interface TripDeleteResponse {
  schemaVersion: number;
  deleted: true;
  revision: number;
}

/**
 * 쓰기 응답. 바뀐 뒤의 Today를 함께 돌려준다 — 여행 중에는 왕복 횟수가 곧 체감 속도다.
 * alreadyApplied는 오류가 아니다: 같은 요청을 두 번 보내도 같은 결과가 되도록(idempotent) 설계했다.
 */
export interface MutationResponse {
  schemaVersion: number;
  applied: boolean;
  alreadyApplied: boolean;
  revision: number;
  today: TodayResponse;
}

/**
 * 그룹 제안 — 반대 없이 두 명 이상이 말한 후보를 **어느 날에** 넣을지 정리한 미리보기(§28·§29).
 *
 * 판정은 `collab.js`의 `buildGroupProposal` 하나가 한다 — 웹과 iOS가 각자 계산하면 같은 상황에서
 * 서로 다른 답을 말하게 된다(§79). 앱은 이 응답을 **그리기만** 한다.
 *
 * ⚠️ **합의 점수(0~100)는 내부값이라 여기에 싣지 않는다**(§21·§22). 화면에 나가는 것은 `reasons` 문장뿐이다.
 * ⚠️ 이것은 미리보기다 — 서버는 아무것도 저장하지 않는다. 사람이 수락해야 일정이 된다(§79).
 */
export interface GroupProposalPick {
  candidateId: number;
  title: string;
  /** 0부터 센 일자. 화면 표기는 dayLabel을 쓴다 */
  dayIndex: number;
  dayLabel: string;
  /** 왜 이 날인지 — 사람 말 문장. 점수는 들어 있지 않다 */
  reasons: string[];
  /** 그 날 마지막 장소에서의 거리. 좌표를 모르면 null(추측하지 않는다) */
  distanceKm: number | null;
}

/** 수락 말고도 빠져나갈 길이 늘 있다 — 자동 적용은 하지 않는다(§79) */
export type GroupProposalOptionKey = 'ACCEPT' | 'ADJUST' | 'DISMISS';

export interface GroupProposalOption {
  key: GroupProposalOptionKey;
  label: string;
}

export interface GroupProposalView {
  /** 한 줄 요약 — "이 2곳은 다들 좋아해요 — 각각 가장 맞는 날에 넣으면 동선이 자연스러워요" */
  summary: string;
  picks: GroupProposalPick[];
  /** 수락하면 무엇이 달라지는지. 사람이 판단할 재료다 */
  impact: {
    /** 새로 들어갈 장소 수 */
    spotsAdded: number;
    /** 바뀌는 일자 수 */
    daysTouched: number;
  };
  options: GroupProposalOption[];
  /** 취향을 남긴 사람이 있으면 그 요약 문장들. 없으면 빈 배열 */
  groupNotes: string[];
}

/** 제안할 것이 없으면 `proposal: null`이다 — 억지로 만들지 않는다(§79) */
export interface GroupProposalResponse {
  schemaVersion: number;
  proposal: GroupProposalView | null;
}

export type ApiErrorCode =
  | 'UNAUTHORIZED'        // 토큰 없음/만료 → 재로그인
  | 'TRIP_NOT_FOUND'
  | 'ACTIVITY_NOT_FOUND'
  | 'DAY_NOT_FOUND'       // 여행은 있는데 그 일자가 없음 → 일자 수를 다시 받아 고른다
  | 'SUGGESTION_STALE'    // 상태가 바뀌어 그 제안이 더는 유효하지 않음 → Today 새로고침
  | 'FORBIDDEN'           // 이 여행을 바꿀 권한이 없음(보기 권한·내보내짐) → 편집 도구를 감추고 주최자에게 요청
  | 'REVISION_CONFLICT'   // 다른 기기가 먼저 바꿈 → 최신 Today를 받아 다시 시도
  | 'BAD_REQUEST'
  | 'UPSTREAM_ERROR';

export interface ApiError {
  error: ApiErrorCode;
  message: string;          // 사용자에게 그대로 보여도 되는 한국어 문장
  revision?: number;
}

// ── 일자 계획(Day Plan) ─────────────────────────────────────────────────────
//
// iOS 일정 화면이 쓰는 조회. Today가 "지금 무엇을"이라면 이쪽은 "그 날 전체가 어떻게 흐르는가"다.
//
// ⚠️ **라벨이 아니라 값을 보낸다.** 웹의 `DayView`는 `"📏 하루 동선 약 12.4km · 🚗25분"` 같은
// 완성된 문장을 들고 있는데, 그걸 그대로 보내면 앱이 서버가 만든 한국어를 그리게 되고
// 거리와 시간을 따로 배치할 수도 없다. 계약의 나머지(NextAction·DaySummary)와 같은 규칙을 지킨다.
//
// 계산은 `next/src/features/itinerary/domain/dayView.ts`가 이미 하고 있고 그 안은 `lib.js`다.
// 여기서 규칙을 새로 만들지 않는다(§엔진은 하나다).

/** 한 장소로 '들어오는' 구간. */
export interface DayPlanLeg {
  mode: string;                    // car·taxi·transit·train·walk·bike·flight
  minutes: number;
  distanceKm: number;
  /** 이 구간이 실측 경로인지 추정인지. 서버에는 구간 캐시가 없어 지금은 늘 추정이다. */
  source: TravelTimeSource;
}

export interface DayPlanSpot {
  /** `days[di].spots` 안의 위치. 편집이 인덱스 기반이라 반드시 필요하다. */
  index: number;
  name: string;
  city: string;
  category: string | null;
  location: GeoPoint | null;
  /** 예상 도착 (자정 기준 분). 24시를 넘으면 1440을 넘는 값이 그대로 온다. */
  etaMinutes: number;
  /** 📌 내가 정한 도착 시각(`at`)이라 계산이 아니라 고정이다. */
  fixed: boolean;
  /** 고정 시각이 이동상 불가능하다. */
  conflict: boolean;
  /** 상대가 정한 약속(`bookAt`) — 예약·입장. */
  bookedAtMinutes: number | null;
  /** 약속까지 기다리는 시간. 일찍 도착하면 0보다 크다. */
  waitMinutes: number;
  stayMinutes: number | null;
  /** PLANNED·COMPLETED·SKIPPED·CANCELLED */
  status: string;
  /** 이 장소로 오는 구간. 첫 유효 장소는 이월 앵커에서 출발한다. 좌표가 없으면 null. */
  incomingLeg: DayPlanLeg | null;
}

/** 일정의 장소와 연결되지 않은 렌터카 픽업·반납. ⚠️ 좌표가 없어 동선·ETA·지도에 넣지 않는다. */
export interface DayPlanCarEvent {
  kind: 'PICKUP' | 'RETURN';
  bookingId: string;
  place: string;
  atMinutes: number | null;
}

export interface DayPlanCostPart { label: string; amount: number }

export interface DayPlanDay {
  index: number;
  date: string;                    // YYYY-MM-DD ('' = 시작일 미지정)
  title: string;
  note: string;
  /** 그날의 기본 이동수단. 구간별 재정의는 각 장소의 incomingLeg.mode가 이긴다. */
  mode: string;
  startMinutes: number;
  timeZone: string;
  /** 🏠 전날 숙소 이월 — **숙소일 때만.** ETA 계산의 기준점(anchor)과 다를 수 있다. */
  carriedStay: { name: string; location: GeoPoint | null } | null;
  spots: DayPlanSpot[];
  carPickups: DayPlanCarEvent[];
  carReturns: DayPlanCarEvent[];
  /** 숙소 복귀 자동 구간. ⚠️ **일정의 마지막 날에는 없다**(떠나는 날이다). */
  back: { name: string; location: GeoPoint | null; leg: DayPlanLeg } | null;
  /** 좌표가 없어 동선·지도에서 빠지는 장소 수. 화면이 그 사실을 말할 수 있게. */
  spotsWithoutLocation: number;
  totals: {
    distanceKm: number;
    travelMinutes: number;
    /** 그날 마지막 일정이 끝나는 시각(자정 기준 분). 장소가 없으면 null. */
    endMinutes: number | null;
    /** 종료가 자정을 넘는다 — 일정 과밀. */
    overloaded: boolean;
    cost: { total: number; parts: DayPlanCostPart[] };
  };
}

export interface DayPlanResponse {
  schemaVersion: number;
  generatedAt: string;
  /** ⚠️ 서버에는 구간 캐시가 없다 — 이동시간이 직선거리 추정이면 화면이 '예상'이라고 말해야 한다. */
  travelTimeSource: TravelTimeSource;
  trip: TripSummary;
  dayCount: number;
  day: DayPlanDay;
}
