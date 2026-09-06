import Foundation

// next/src/features/trip-state/domain/contract.ts 를 그대로 옮긴 것.
// 저쪽이 단일 출처다 — 필드를 여기서 임의로 바꾸지 말고 contract.ts를 먼저 고친다.
//
// 시각은 전부 '그 날 자정부터의 분'이다. 여행지 현지 기준이며, 기기 시간대로 환산하지 않는다
// (서울에서 마드리드 일정을 볼 때 9시간 밀리는 사고를 막는다).

// MARK: - 알 수 없는 값에 견디기
//
// 서버가 새 상태를 추가해도 구버전 앱이 즉시 깨지면 안 된다(§10). 모든 문자열 enum은
// 모르는 값을 .unknown으로 받는다 — 화면은 '알 수 없음'으로 그리되 앱은 계속 동작한다.
//
// Decodable만으로는 부족하다. 이 enum들을 품은 struct가 전부 Codable이고,
// 특히 Live Activity의 ContentState는 ActivityKit이 Codable & Hashable을 요구한다.
// 인코딩 구현은 표준 라이브러리가 준다(RawRepresentable where RawValue == String).
// 인코딩 대상은 전부 기기 안(Keychain·캐시·App Group)이라 서버 payload는 달라지지 않는다.
protocol UnknownCodable: RawRepresentable, Codable where RawValue == String {
    static var unknownCase: Self { get }
}
extension UnknownCodable {
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: raw) ?? Self.unknownCase
    }
}

enum Flexibility: String, UnknownCodable, Sendable {
    case fixed = "FIXED", semiFixed = "SEMI_FIXED", flexible = "FLEXIBLE", unknown
    static var unknownCase: Flexibility { .unknown }
}

enum ActivityStatus: String, UnknownCodable, Sendable {
    case planned = "PLANNED", ready = "READY", inProgress = "IN_PROGRESS"
    case completed = "COMPLETED", skipped = "SKIPPED", cancelled = "CANCELLED", unknown
    static var unknownCase: ActivityStatus { .unknown }

    var isDone: Bool { self == .completed || self == .skipped || self == .cancelled }
}

enum CommitmentType: String, UnknownCodable, Sendable {
    case flight = "FLIGHT", train = "TRAIN", hotel = "HOTEL", restaurant = "RESTAURANT"
    case tour = "TOUR", car = "CAR", other = "OTHER", unknown
    static var unknownCase: CommitmentType { .unknown }

    /// 색만으로 종류를 구분하지 않기 위해 기호를 함께 쓴다(§47 접근성).
    var symbol: String {
        switch self {
        case .flight: "airplane"
        case .train: "tram.fill"
        case .hotel: "bed.double.fill"
        case .restaurant: "fork.knife"
        case .tour: "ticket.fill"
        case .car: "car.fill"
        case .other, .unknown: "mappin.and.ellipse"
        }
    }
}

/// 함께하기 — 이 여행에서 나의 역할. 접근 제어는 서버(RLS)가 하고, 앱은 편집 도구를 감출 뿐이다.
enum MemberRole: String, UnknownCodable, Sendable {
    case owner = "OWNER", editor = "EDITOR", viewer = "VIEWER", unknown
    static var unknownCase: MemberRole { .unknown }

    var canEdit: Bool { self == .owner || self == .editor }
    var label: String {
        switch self {
        case .owner: "주최자"
        case .editor: "편집"
        case .viewer: "보기"
        case .unknown: "멤버"
        }
    }
}

enum TravelStatus: String, UnknownCodable, Sendable {
    case noPlan = "NO_PLAN", upcoming = "UPCOMING", readyToLeave = "READY_TO_LEAVE"
    case traveling = "TRAVELING", arrived = "ARRIVED", inProgress = "IN_PROGRESS"
    case delayed = "DELAYED", completed = "COMPLETED", unknown
    static var unknownCase: TravelStatus { .unknown }
}

enum SuggestionType: String, UnknownCodable, Sendable {
    case nextActivity = "NEXT_ACTIVITY", replan = "REPLAN", priceSaving = "PRICE_SAVING", rest = "REST", unknown
    static var unknownCase: SuggestionType { .unknown }
}

enum SuggestionActionKind: String, UnknownCodable, Sendable {
    case visitPlace = "VISIT_PLACE", checkIn = "CHECK_IN", moveToToday = "MOVE_TO_TODAY"
    case rest = "REST", returnToHotel = "RETURN_TO_HOTEL", eat = "EAT", replan = "REPLAN", openBooking = "OPEN_BOOKING", unknown
    static var unknownCase: SuggestionActionKind { .unknown }
}

enum PlanningMode: String, UnknownCodable, Sendable {
    case manual = "MANUAL", assisted = "ASSISTED", delegated = "DELEGATED", unknown
    static var unknownCase: PlanningMode { .unknown }
}

enum EnergyLevel: String, UnknownCodable, Sendable {
    case low = "LOW", normal = "NORMAL", high = "HIGH", unknown
    static var unknownCase: EnergyLevel { .unknown }
}

enum DepartureLevel: String, UnknownCodable, Sendable {
    case early = "EARLY", now = "NOW", late = "LATE", unknown
    static var unknownCase: DepartureLevel { .unknown }
}

enum PriceState: String, UnknownCodable, Sendable {
    case savingAvailable = "SAVING_AVAILABLE", cheaperUnverified = "CHEAPER_UNVERIFIED"
    case goodPrice = "GOOD_PRICE", watching = "WATCHING", error = "ERROR", untracked = "UNTRACKED", unknown
    static var unknownCase: PriceState { .unknown }
}

enum TravelTimeSource: String, UnknownCodable, Sendable {
    case straightLineEstimate = "STRAIGHT_LINE_ESTIMATE", routed = "ROUTED", unknown
    static var unknownCase: TravelTimeSource { .unknown }
}

enum BookingKind: String, UnknownCodable, Sendable {
    case hotel, car, flight, unknown
    static var unknownCase: BookingKind { .unknown }
}

// MARK: - 값

struct GeoPoint: Codable, Hashable, Sendable {
    let lat: Double
    let lng: Double
}

struct TripSummary: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let start: String
    let dayCount: Int
    let revision: Int
    let updatedAt: String
    let timeZone: String
    let cities: [String]
    /// 오늘이 몇 일차인지. -1이면 여행 기간 밖이다.
    let todayIndex: Int
    /// 함께하기 — 구버전 서버 응답에는 없을 수 있어 옵셔널로 받는다(없으면 혼자 쓰는 여행으로 본다).
    let role: MemberRole?
    let memberCount: Int?

    var isLive: Bool { todayIndex >= 0 }
    var isShared: Bool { (memberCount ?? 1) > 1 }
    var canEdit: Bool { (role ?? .owner).canEdit }
}

struct DaySummary: Codable, Hashable, Sendable {
    let index: Int
    let date: String
    let title: String
    let mode: String
    let startMinutes: Int
    let spotCount: Int
    let timeZone: String
}

struct ActivitySummary: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let city: String
    let desc: String
    let status: ActivityStatus
    let flexibility: Flexibility
    let type: CommitmentType
    let etaMinutes: Int
    let startMinutes: Int
    let endMinutes: Int
    let stayMinutes: Int
    let travelInMinutes: Int
    let fixedAtMinutes: Int?
    let location: GeoPoint?
    let mustVisit: Bool
    let optional: Bool
    let bookingId: String?
    let bookUrl: String?
    let placeId: String?

    /// 상대가 정한 약속(항공·열차·예약)은 다른 일정과 시각적으로 구분한다(§19).
    var isFixedCommitment: Bool { flexibility == .fixed }
}

struct FixedCommitmentSummary: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let activityId: String
    let type: CommitmentType
    let title: String
    let startMinutes: Int
    let endMinutes: Int
    let location: GeoPoint?
    let flexibility: Flexibility
}

struct TripStateSummary: Codable, Hashable, Sendable {
    let currentDay: Int
    let todayIndex: Int
    let dayCount: Int
    let live: Bool
    let nowMinutes: Int
    let dayStartMinutes: Int
    let dayEndMinutes: Int
    let availableMinutes: Int
    let delayMinutes: Int
    let travelMinutesToday: Int
    let planningMode: PlanningMode
    let energyLevel: EnergyLevel
    let completedActivityIds: [String]
    let remainingActivityIds: [String]
    let skippedActivityIds: [String]
    let currentLocation: GeoPoint?
}

struct DepartureAdvice: Codable, Hashable, Sendable {
    let leaveMinutes: Int
    let slackMinutes: Int
    let level: DepartureLevel
    /// 서버가 만든 문장을 그대로 보여준다 — 클라이언트가 다시 쓰면 톤이 갈라진다.
    let text: String
}

struct NextAction: Codable, Hashable, Sendable {
    let activityId: String?
    let title: String
    let status: TravelStatus
    let travelMinutes: Int?
    let etaMinutes: Int?
    let startMinutes: Int?
    let stayMinutes: Int?
    let departure: DepartureAdvice?
    let location: GeoPoint?
    let type: CommitmentType
    let flexibility: Flexibility
    let reasons: [String]
}

struct SuggestionImpact: Codable, Hashable, Sendable {
    let timeChangeMinutes: Int?
    let travelTimeChangeMinutes: Int?
    let costChange: Double?
    let removedActivities: [String]?
    let addedActivities: [String]?
}

struct SuggestionAction: Codable, Hashable, Sendable {
    let kind: SuggestionActionKind
    let activityId: String?
    let fromDay: Int?
    let bookingId: String?
    let dropActivityIds: [String]
    let startMinutes: Int?
}

struct TripSuggestion: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let type: SuggestionType
    let title: String
    let description: String
    /// 왜 이걸 권하는지. 비어 있으면 카드를 그리지 않는 편이 낫다("AI가 추천했습니다"는 설명이 아니다).
    let reasons: [String]
    let impact: SuggestionImpact
    let action: SuggestionAction
    /// 수락이 실제로 일정을 바꾸는가. false면 '추가하기' 버튼을 내지 않는다.
    let acceptable: Bool
}

struct ReplanPreview: Codable, Hashable, Sendable {
    let needed: Bool
    let feasible: Bool
    let lateMinutes: Int
    let before: [String]
    let after: [String]
    let dropActivityIds: [String]
    let dropNames: [String]
    let movesToNextDay: Bool
    let impact: SuggestionImpact
}

/// Live Activity가 그대로 쓸 compact state. 이번 단계에서는 만들지 않고 자리만 맞춰 둔다(§40).
struct TravelActivityState: Codable, Hashable, Sendable {
    let tripName: String
    let dayLabel: String
    let nextTitle: String
    let startAtISO: String?
    let travelMinutes: Int?
    let status: TravelStatus
}

struct TodayResponse: Codable, Hashable, Sendable {
    let schemaVersion: Int
    let generatedAt: String
    let travelTimeSource: TravelTimeSource
    let trip: TripSummary
    let day: DaySummary
    let currentState: TripStateSummary
    let nextAction: NextAction?
    let suggestions: [TripSuggestion]
    let remainingActivities: [ActivitySummary]
    let activities: [ActivitySummary]
    let fixedCommitments: [FixedCommitmentSummary]
    let replan: ReplanPreview
    let activityState: TravelActivityState
}

struct TripListResponse: Codable, Sendable {
    let schemaVersion: Int
    let trips: [TripSummary]
}

struct MutationResponse: Codable, Sendable {
    let schemaVersion: Int
    let applied: Bool
    /// 이미 그 상태였다 — 오류가 아니다. 두 번 눌러도 같은 결과가 되도록 설계돼 있다.
    let alreadyApplied: Bool
    let revision: Int
    let today: TodayResponse
}

struct PriceStatus: Codable, Hashable, Sendable {
    let state: PriceState
    let currentPrice: Double?
    let savingAmount: Double?
    let currency: String
    let seller: String?
    /// 언제 확인한 값인지 — 없으면 '확인 전'이다. 오래된 값을 최신처럼 보여주지 않는다.
    let observedAt: String?
    let note: String
}

struct BookingSummary: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let type: BookingKind
    let title: String
    let provider: String
    let url: String?
    let price: Double
    let currency: String
    let start: String?
    let end: String?
    let refundable: Bool?
    let freeCancelUntil: String?
    let confirmation: String?
    let place: String?
    let startTime: String?
    let endTime: String?
    let priceStatus: PriceStatus?
}

struct BookingListResponse: Codable, Sendable {
    let schemaVersion: Int
    let bookings: [BookingSummary]
}

struct APIErrorBody: Codable, Sendable {
    let error: String
    let message: String
    let revision: Int?
}

// MARK: - Travel State (여행 중 단 하나의 조회)
//
// 여행 중에는 endpoint를 연달아 부르는 것 자체가 배터리다(§57).
// Today + 하루 상태 + 출발 계획 + 알림 계획 + 잠금화면/위젯 압축본이 이 응답 하나에 있다.

enum TripPulseCode: String, UnknownCodable, Sendable {
    case noPlan = "NO_PLAN", onTrack = "ON_TRACK", ahead = "AHEAD", delayed = "DELAYED"
    case freeTime = "FREE_TIME", needsAttention = "NEEDS_ATTENTION", resting = "RESTING"
    case dayComplete = "DAY_COMPLETE", unknown
    static var unknownCase: TripPulseCode { .unknown }
}

/// 하루 상태 한 마디. **code를 화면에 쓰지 않는다** — text만 보여준다(§51).
struct TripPulse: Codable, Hashable, Sendable {
    let code: TripPulseCode
    let text: String
    let detail: String
}

/// 출발 단계. 알림은 이 값이 바뀔 때만 검토한다(§15) — 같은 단계에서 반복하지 않는다.
enum DepartureStage: String, UnknownCodable, Sendable {
    case upcoming = "UPCOMING", readyToLeave = "READY_TO_LEAVE", lateRisk = "LATE_RISK", unknown
    static var unknownCase: DepartureStage { .unknown }
}

struct DeparturePlan: Codable, Hashable, Sendable {
    let activityId: String
    /// 권장 출발 = 약속 − 이동 − 안전여유
    let leaveMinutes: Int
    let leaveAtISO: String?
    let slackMinutes: Int
    /// 일정 성격별 안전 여유 (열차 30분, 항공 120분 …)
    let bufferMinutes: Int
    let travelMinutes: Int
    let targetMinutes: Int
    /// 지금 나서도 약속에 늦는 분. 0이면 늦지 않는다.
    let lateByMinutes: Int
    let level: DepartureLevel
    let stage: DepartureStage
    let text: String
}

enum NotificationKind: String, UnknownCodable, Sendable {
    case departureReminder, fixedCommitmentReminder, scheduleDelay
    case replanSuggestion, emptySlotSuggestion, priceSaving, unknown
    static var unknownCase: NotificationKind { .unknown }
}

enum NotificationOrigin: String, UnknownCodable, Sendable {
    case device = "DEVICE", server = "SERVER", unknown
    static var unknownCase: NotificationOrigin { .unknown }
}

struct NotificationPlanItem: Codable, Hashable, Sendable, Identifiable {
    let kind: NotificationKind
    /// 누가 판단하는가 — 기기는 DEVICE 항목만 예약한다. 서버 것까지 띄우면 두 번 온다(§11).
    let origin: NotificationOrigin
    /// 같은 상황을 두 번 알리지 않기 위한 키(§46)
    let dedupeKey: String
    let title: String
    let body: String
    /// 홈이 아니라 그 화면으로 바로 간다(§40)
    let deepLink: String
    let targetId: String?
    let priority: Int
    let expiresAtISO: String?

    var id: String { dedupeKey }
}

/// 잠금화면·Dynamic Island가 그릴 압축 상태. 일정표를 통째로 넣지 않는다(§75.5).
struct LiveActivityState: Codable, Hashable, Sendable {
    let tripName: String
    let dayLabel: String
    let status: TravelStatus
    let nextTitle: String
    let nextStartISO: String?
    let travelMinutes: Int?
    let departureText: String?
    let fixedTitle: String?
    let fixedStartISO: String?
    let pulseText: String
    let stateVersion: String
}

struct WidgetActivity: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let title: String
    let startMinutes: Int
    let startISO: String?
    let type: CommitmentType
    let isFixed: Bool
}

/// 위젯은 앱 데이터를 복제하지 않고 이 압축본만 App Group으로 공유한다(§28).
struct WidgetSnapshot: Codable, Hashable, Sendable {
    let tripId: String
    let tripName: String
    let dayLabel: String
    let dayTitle: String
    let pulseText: String
    let nextActivity: WidgetActivity?
    let nextTravelMinutes: Int?
    let upcoming: [WidgetActivity]
    let updatedAtISO: String
    let stateVersion: String
}

struct TravelStateResponse: Codable, Sendable {
    let schemaVersion: Int
    /// 이 값이 그대로면 아무것도 바뀌지 않은 것이다 — 잠금화면을 다시 그릴지의 기준(§21·§47).
    let stateVersion: String
    let today: TodayResponse
    let pulse: TripPulse
    let departure: DeparturePlan?
    /// 아직 보내지 않은 것만 담겨 온다.
    let notifications: [NotificationPlanItem]
    let liveActivity: LiveActivityState
    let widget: WidgetSnapshot
    let suggestionsExpireAtISO: String?
    let suggestionsExpireMinutes: Int
    /// 이번 계산에 쓴 위치. 서버에 저장되지 않는다(§55).
    let locationUsed: GeoPoint?
    let locationUpdatedAt: String?
    let travelMode: Bool
}

struct DeviceRegistrationResponse: Codable, Sendable {
    let schemaVersion: Int
    let registered: Bool
    let deviceId: String
}

// MARK: - 유입 (공유 → 예약 후보) · 여행 기록

enum ShareKind: String, UnknownCodable, Sendable {
    case booking = "BOOKING", place = "PLACE", transport = "TRANSPORT", note = "NOTE", unknown = "UNKNOWN"
    static var unknownCase: ShareKind { .unknown }
}

enum CandidateType: String, UnknownCodable, Sendable {
    case hotel = "HOTEL", flight = "FLIGHT", train = "TRAIN", car = "CAR"
    case restaurant = "RESTAURANT", tour = "TOUR", other = "OTHER", unknown
    static var unknownCase: CandidateType { .unknown }
}

/// 이 후보를 어떻게 다룰지. **AUTO여도 저장은 사용자가 확인한 뒤에만** 일어난다(§76.2).
enum CandidateDisposition: String, UnknownCodable, Sendable {
    case auto = "AUTO", review = "REVIEW", manual = "MANUAL", unknown
    static var unknownCase: CandidateDisposition { .unknown }
}

struct BookingCandidate: Codable, Hashable, Sendable {
    let type: CandidateType
    let title: String?
    let provider: String?
    let providerId: String?
    let confirmationNumber: String?
    let startAt: String?
    let endAt: String?
    let location: String?
    let amount: Double?
    let currency: String?
    let sourceUrl: String?
    let sourceTitle: String?
    /// 숫자를 그대로 보여주지 않는다 — disposition으로 다룬다.
    let confidence: Double
    /// 못 읽은 필수 항목. 미리보기가 빈 칸을 그대로 보여주게 한다.
    let missingFields: [String]
    /// 날짜·통화처럼 확실하지 않은 것. 있으면 자동으로 넘기지 않는다.
    let ambiguities: [String]
    let reasons: [String]
    let disposition: CandidateDisposition
}

struct TripMatch: Codable, Hashable, Sendable, Identifiable {
    let tripId: String
    let name: String
    let score: Double
    let reasons: [String]
    var id: String { tripId }
}

struct DuplicateBookingMatch: Codable, Hashable, Sendable {
    let tripId: String
    let bookingId: String
    let title: String
    let score: Double
    let reasons: [String]
}

struct ImportPreviewResponse: Codable, Sendable {
    let schemaVersion: Int
    /// 같은 공유를 두 번 처리하지 않기 위한 키.
    let idempotencyKey: String
    let kind: ShareKind
    let kindConfidence: Double
    let kindReasons: [String]
    let candidate: BookingCandidate?
    let tripMatches: [TripMatch]
    let duplicate: DuplicateBookingMatch?
    /// 못 읽어도 버리지 않는다 — 메모로 남길 수 있게 원문이 함께 온다.
    let rawText: String?
    let rawUrl: String?
    let rawTitle: String?
}

struct ImportCommitResponse: Codable, Sendable {
    let schemaVersion: Int
    let bookingId: String
    let revision: Int
    /// 저장으로 끝나지 않는다 — 새 예약이 남은 일정과 부딪히는지 함께 온다.
    let replan: ReplanPreview
    let today: TodayResponse
}

enum MemoryType: String, UnknownCodable, Sendable {
    case photo = "PHOTO", note = "NOTE", visit = "VISIT", moment = "MOMENT", unknown
    static var unknownCase: MemoryType { .unknown }
}

struct MemoryEvent: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let dayIndex: Int?
    let activityId: String?
    let type: MemoryType
    let caption: String?
    /// 기기 사진 보관함의 식별자. 원본 이미지는 서버로 올리지 않는다.
    let assetRefs: [String]
    let location: GeoPoint?
    let atMinutes: Int?
    let capturedAt: String
    let clientKey: String?
}

struct MemoryTimelineGroup: Codable, Hashable, Sendable, Identifiable {
    let activityId: String?
    let title: String
    let atMinutes: Int
    let photos: Int
    let notes: Int
    let eventIds: [String]
    var id: String { activityId ?? "unassigned-\(atMinutes)" }
}

struct MemoryListResponse: Codable, Sendable {
    let schemaVersion: Int
    let events: [MemoryEvent]
    let timeline: [MemoryTimelineGroup]
}

struct MemoryCreateResponse: Codable, Sendable {
    let schemaVersion: Int
    let event: MemoryEvent
    /// 어느 일정에 붙였는지, 왜 그렇게 붙였는지.
    let association: MemoryAssociation
    let alreadyExists: Bool
}

struct MemoryAssociation: Codable, Hashable, Sendable {
    let activityId: String?
    let reason: String
}

// MARK: - 그룹 제안 (§28·§29·§35)

/// 반대 없이 두 명 이상이 말한 후보를 **어느 날에** 넣을지 정리한 미리보기.
///
/// ⚠️ 판정은 서버가 한다(`collab.js`의 `buildGroupProposal`) — 앱은 **그리기만** 한다.
/// 같은 규칙을 Swift로 다시 만들면 웹과 앱이 같은 상황에서 서로 다른 답을 말하게 된다.
/// ⚠️ 합의 점수는 계약에 없다(§21·§22). 화면에 나가는 것은 `reasons` 문장뿐이다.
struct GroupProposalPick: Codable, Hashable, Sendable, Identifiable {
    let candidateId: Int
    let title: String
    /// 0부터 센 일자. 화면 표기는 `dayLabel`을 쓴다.
    let dayIndex: Int
    let dayLabel: String
    let reasons: [String]
    /// 그 날 마지막 장소에서의 거리. 좌표를 모르면 nil — 추측하지 않는다.
    let distanceKm: Double?

    var id: Int { candidateId }
}

struct GroupProposalImpact: Codable, Hashable, Sendable {
    let spotsAdded: Int
    let daysTouched: Int
}

/// 수락 말고도 빠져나갈 길이 늘 있다 — 자동 적용은 하지 않는다(§79).
enum GroupProposalOptionKey: String, Codable, Sendable {
    case accept = "ACCEPT"
    case adjust = "ADJUST"
    case dismiss = "DISMISS"
}

struct GroupProposalOption: Codable, Hashable, Sendable, Identifiable {
    let key: String
    let label: String

    var id: String { key }
    /// 모르는 값이 와도 화면이 죽지 않게 — 계약이 앞서 나갔을 수 있다.
    var action: GroupProposalOptionKey? { GroupProposalOptionKey(rawValue: key) }
}

struct GroupProposalView: Codable, Hashable, Sendable {
    let summary: String
    let picks: [GroupProposalPick]
    let impact: GroupProposalImpact
    let options: [GroupProposalOption]
    /// 취향을 남긴 사람이 있을 때의 요약 문장. 없으면 빈 배열이다.
    let groupNotes: [String]
}

/// 제안할 것이 없으면 `proposal`이 nil이다 — 억지로 만들지 않는다.
struct GroupProposalResponse: Codable, Sendable {
    let schemaVersion: Int
    let proposal: GroupProposalView?
}

// MARK: - 일자 계획 (일정 화면)
//
// Today가 "지금 무엇을"이라면 이쪽은 "그 날 전체가 어떻게 흐르는가"다.
// ⚠️ 서버는 **값**을 준다 — 완성된 문장이 아니다. 표기(“약 12km · 25분”)는 앱이 정한다.
// ⚠️ 계산은 서버 하나(`dayView.ts` → `lib.js`)가 한다. 여기서 시각·거리를 다시 계산하지 않는다 —
//    그러면 웹과 앱이 같은 일정에 다른 시각을 말하게 된다.

/// 한 장소로 '들어오는' 구간.
struct DayPlanLeg: Codable, Hashable, Sendable {
    /// car·taxi·transit·train·walk·bike·flight — 계약의 다른 곳(`DaySummary.mode`)과 같은 규칙이다.
    let mode: String
    let minutes: Int
    let distanceKm: Double
    /// 실측 경로인지 추정인지. 서버에 구간 캐시가 없어 지금은 늘 추정이다 — 화면이 "예상"이라 말해야 한다.
    let source: TravelTimeSource
}

struct DayPlanSpot: Codable, Hashable, Sendable {
    /// `days[di].spots` 안의 위치. 편집이 인덱스 기반이라 반드시 필요하다.
    let index: Int
    let name: String
    let city: String
    let category: String?
    let location: GeoPoint?
    /// 예상 도착 (자정 기준 분). 24시를 넘으면 1440보다 큰 값이 그대로 온다.
    let etaMinutes: Int
    /// 📌 내가 정한 도착 시각(`at`)이라 계산이 아니라 고정이다.
    let fixed: Bool
    /// 고정 시각이 이동상 불가능하다.
    let conflict: Bool
    /// 상대가 정한 약속(`bookAt`) — 예약·입장.
    let bookedAtMinutes: Int?
    /// 약속까지 기다리는 시간. 일찍 도착하면 0보다 크다.
    let waitMinutes: Int
    let stayMinutes: Int?
    let status: String
    /// 좌표가 없으면 nil — 그 장소는 동선에서 빠진다.
    let incomingLeg: DayPlanLeg?
}

/// 일정의 장소와 연결되지 않은 렌터카 픽업·반납. ⚠️ 좌표가 없어 동선·ETA·지도에 넣지 않는다.
struct DayPlanCarEvent: Codable, Hashable, Sendable {
    enum Kind: String, Codable, Sendable { case pickup = "PICKUP", returned = "RETURN" }
    let kind: Kind
    let bookingId: String
    let place: String
    let atMinutes: Int?
}

struct DayPlanCostPart: Codable, Hashable, Sendable {
    let label: String
    let amount: Int
}

struct DayPlanCarriedStay: Codable, Hashable, Sendable {
    let name: String
    let location: GeoPoint?
}

struct DayPlanBack: Codable, Hashable, Sendable {
    let name: String
    let location: GeoPoint?
    let leg: DayPlanLeg
}

struct DayPlanCost: Codable, Hashable, Sendable {
    let total: Int
    let parts: [DayPlanCostPart]
}

struct DayPlanTotals: Codable, Hashable, Sendable {
    let distanceKm: Double
    let travelMinutes: Int
    /// 그날 마지막 일정이 끝나는 시각(자정 기준 분). 장소가 없으면 nil.
    let endMinutes: Int?
    /// 종료가 자정을 넘는다 — 일정 과밀.
    let overloaded: Bool
    let cost: DayPlanCost
}

struct DayPlanDay: Codable, Hashable, Sendable {
    let index: Int
    /// YYYY-MM-DD ('' = 시작일 미지정)
    let date: String
    let title: String
    let note: String
    /// 그날의 기본 이동수단. 구간별 재정의는 각 장소의 `incomingLeg.mode`가 이긴다.
    let mode: String
    let startMinutes: Int
    let timeZone: String
    /// 🏠 전날 숙소 이월 — **숙소일 때만.** ETA 계산의 기준점(anchor)과 다를 수 있다.
    let carriedStay: DayPlanCarriedStay?
    let spots: [DayPlanSpot]
    let carPickups: [DayPlanCarEvent]
    let carReturns: [DayPlanCarEvent]
    /// 숙소 복귀 자동 구간. ⚠️ **일정의 마지막 날에는 없다**(떠나는 날이다).
    let back: DayPlanBack?
    /// 좌표가 없어 동선·지도에서 빠지는 장소 수.
    let spotsWithoutLocation: Int
    let totals: DayPlanTotals
}

/// 일자 스트립 한 칸. 화면이 "며칠째"만이 아니라 **언제, 어떤 날**인지 말할 수 있게 한다.
/// ⚠️ 날짜를 앱에서 `start + index`로 더하지 않는다 — 규칙은 서버(`isoDateOf`)에 있다.
struct DayPlanStripEntry: Codable, Hashable, Sendable, Identifiable {
    let index: Int
    /// YYYY-MM-DD ('' = 시작일 미지정)
    let date: String
    let title: String
    let spotCount: Int

    var id: Int { index }
}

struct DayPlanResponse: Codable, Hashable, Sendable {
    let schemaVersion: Int
    let generatedAt: String
    let travelTimeSource: TravelTimeSource
    let trip: TripSummary
    let dayCount: Int
    /// 일자 스트립 — 여행 전체의 날 목록. 어느 날을 보든 같이 온다.
    let days: [DayPlanStripEntry]
    let day: DayPlanDay
}
