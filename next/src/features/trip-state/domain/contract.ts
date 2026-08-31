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
  | 'REVISION_CONFLICT'   // 다른 기기가 먼저 바꿈 → 최신 Today를 받아 다시 시도
  | 'BAD_REQUEST'
  | 'UPSTREAM_ERROR';

export interface ApiError {
  error: ApiErrorCode;
  message: string;          // 사용자에게 그대로 보여도 되는 한국어 문장
  revision?: number;
}
