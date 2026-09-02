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

export type ApiErrorCode =
  | 'UNAUTHORIZED'        // 토큰 없음/만료 → 재로그인
  | 'TRIP_NOT_FOUND'
  | 'ACTIVITY_NOT_FOUND'
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

// ─────────────────────────────────────────────────────────────────────────────
// 함께하기 — 후보 장소 · 반응 · 코멘트 · 취향 · 활동 기록
//
// **판단은 서버에서 끝난다.** 묶음·배지 문장·충돌 선택지·그룹 제안은 전부 `collab.js`가 만들고
// 여기에는 그 결과만 담긴다. iOS가 mood나 합의를 다시 계산하면 웹과 다른 답을 하게 된다(§8).
// 합의 점수(0~100)는 내부값이라 이 계약에 **없다** — 문장만 나간다(§21·§22).

export type CandidateStatus = 'PROPOSED' | 'SCHEDULED' | 'REJECTED';
export type ReactionKind = 'MUST' | 'OK' | 'PASS';
/** 배지 색조. 이름이 곧 의미다 — 색만으로 구분하지 않고 늘 문장이 함께 간다(§47) */
export type VerdictTone = 'good' | 'split' | 'mixed' | 'quiet';

/** 누가 어떤 반응을 남겼는지. name은 `tc_member_label()`이 만든 이름표다 — 계정 이메일은 여행에 나오지 않는다(§69) */
export interface CandidateReactor {
  name: string;
  reaction: ReactionKind;
  me: boolean;
}

export interface CandidateVerdict {
  /** 두 명 이상이 말했으면 합의 문장, 아니면 '무엇을 더 하면 되는지'. 숫자는 들어가지 않는다 */
  text: string;
  tone: VerdictTone;
}

/** §24 갈린 후보의 세 선택지. SPLIT은 아직 안내만이라 action이 없다 */
export interface ConflictOption {
  key: 'TOGETHER' | 'SPLIT' | 'SKIP';
  title: string;
  text: string;
  action: 'SCHEDULE' | 'REJECT' | null;
}

/** MUST와 PASS가 같이 있을 때만 채워진다. 자동으로 빼지 않는다(§23) */
export interface CandidateConflict {
  must: string[];
  ok: string[];
  pass: string[];
  options: ConflictOption[];
}

export interface TripCandidate {
  /** bigint를 문자열로 — JS number의 안전 범위 밖을 대비한다 */
  id: string;
  title: string;
  placeId: string | null;
  location: GeoPoint | null;
  addr: string | null;
  note: string | null;
  url: string | null;
  status: CandidateStatus;
  /** '2'(2일차) 같은 위치 표시다 — 장소 id가 아니다 */
  scheduledRef: string | null;
  /** '내가 추가' · '지민이 추가' 처럼 완성된 문장 */
  proposedBy: string;
  mine: boolean;
  myReaction: ReactionKind | null;
  /** '❤️ 3 · 👍 1'. 0인 것은 빠진다 */
  reactionSummary: string;
  reactors: CandidateReactor[];
  commentCount: number;
  verdict: CandidateVerdict;
  conflict: CandidateConflict | null;
  createdAt: string;
  /** 이 후보를 뺄 수 있는가 — 역할이 아니라 '누가 냈는가'로 갈린다 */
  canRemove: boolean;
}

export type CandidateGroupKey = 'LOVED' | 'NEEDS_OPINION' | 'RESTING' | 'SCHEDULED' | 'REJECTED';

/** 보드의 묶음. **묶음이 정렬보다 먼저다** — 순서가 아니라 어디에 한마디가 필요한지를 보인다 */
export interface CandidateGroup {
  key: CandidateGroupKey;
  title: string;
  candidates: TripCandidate[];
}

export interface GroupProposalPick {
  candidateId: string;
  title: string;
  dayIndex: number;
  distanceKm: number | null;
  reasons: string[];
}

/** §28·§29 미리보기다 — 저장되지 않는다. 사람이 눌러야 일정에 들어간다(§79) */
export interface GroupProposal {
  headline: string;
  picks: GroupProposalPick[];
}

export interface CandidateBoardResponse {
  schemaVersion: number;
  tripId: string;
  role: MemberRole | null;
  memberCount: number;
  /** 후보 추가·일정 반영은 편집 권한 이상. 반응·코멘트는 활성 멤버 전원(§12) */
  canPropose: boolean;
  canReact: boolean;
  groups: CandidateGroup[];
  proposal: GroupProposal | null;
  /** 취향 요약 문장들. 정리만 하고 결정하지 않는다(§62) */
  groupContext: string[];
}

export interface CandidateComment {
  id: string;
  body: string;
  authorLabel: string;
  mine: boolean;
  createdAt: string;
  canDelete: boolean;
}

export interface CommentListResponse {
  schemaVersion: number;
  candidateId: string;
  canComment: boolean;
  comments: CandidateComment[];
}

export type PacePreference = 'RELAXED' | 'NORMAL' | 'PACKED';
export type WalkingPreference = 'LOW' | 'NORMAL' | 'HIGH';

/** 여행별 취향이다 — 고정 프로필이 아니다(§18). 서버 `tc_norm_prefs`가 아는 값만 남는다 */
export interface MemberPreference {
  pace: PacePreference | null;
  walking: WalkingPreference | null;
  /** 아침 일찍이 괜찮은가. null은 답하지 않음 */
  morning: boolean | null;
  night: boolean | null;
  interests: string[];
  dislikes: string[];
  note: string | null;
}

export interface MemberPreferenceRow {
  name: string;
  mine: boolean;
  /** '여유롭게 · 관심: 미술관' 한 줄 요약 */
  summary: string;
  prefs: MemberPreference;
}

export interface PreferenceResponse {
  schemaVersion: number;
  mine: MemberPreference;
  members: MemberPreferenceRow[];
  groupContext: string[];
}

export interface ActivityEntry {
  id: string;
  /** 완성된 한국어 문장. 내부 구조를 그대로 내보내지 않는다(§39) */
  text: string;
  mine: boolean;
  at: string;
  /** '3분 전' */
  relative: string;
}

export interface ActivityListResponse {
  schemaVersion: number;
  entries: ActivityEntry[];
}
