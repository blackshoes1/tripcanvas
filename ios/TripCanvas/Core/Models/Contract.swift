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

// MARK: - 함께하기 (후보 장소 · 반응 · 코멘트 · 취향 · 활동)
//
// **판단은 서버에서 끝나 있다.** 묶음·배지 문장·충돌 선택지·그룹 제안·취향 요약은 전부
// `collab.js`가 만든 결과이고 여기서는 그리기만 한다. mood나 합의를 Swift로 다시 계산하면
// 웹과 다른 답을 하게 된다(§8). 합의 점수는 계약에 아예 없다 — 화면에는 문장만 있다(§21·§22).

enum CandidateStatus: String, UnknownCodable, Sendable {
    case proposed = "PROPOSED", scheduled = "SCHEDULED", rejected = "REJECTED", unknown
    static var unknownCase: CandidateStatus { .unknown }
}

enum ReactionKind: String, UnknownCodable, Sendable {
    case must = "MUST", ok = "OK", pass = "PASS", unknown
    static var unknownCase: ReactionKind { .unknown }

    /// 색만으로 구분하지 않는다 — 기호와 문구가 늘 함께 간다(§47).
    var symbol: String {
        switch self {
        case .must: "heart.fill"
        case .ok: "hand.thumbsup.fill"
        case .pass: "hand.raised.fill"
        case .unknown: "questionmark"
        }
    }
    var label: String {
        switch self {
        case .must: "꼭 가고 싶어요"
        case .ok: "좋아요"
        case .pass: "이번엔 패스"
        case .unknown: "의견 없음"
        }
    }
}

enum VerdictTone: String, UnknownCodable, Sendable {
    case good, split, mixed, quiet, unknown
    static var unknownCase: VerdictTone { .unknown }
}

struct CandidateReactor: Codable, Hashable, Sendable {
    /// 서버의 `tc_member_label()`이 만든 이름표다 — 계정 이메일은 여행에 나오지 않는다(§69).
    let name: String
    let reaction: ReactionKind
    let me: Bool
}

struct CandidateVerdict: Codable, Hashable, Sendable {
    /// 완성된 문장. 숫자가 들어 있지 않다.
    let text: String
    let tone: VerdictTone
}

struct ConflictOption: Codable, Hashable, Sendable {
    let key: String
    let title: String
    let text: String
    /// 누를 동작이 없는 선택지(자유시간 분리)는 nil이다 — 안내만 한다.
    let action: String?
}

struct CandidateConflict: Codable, Hashable, Sendable {
    let must: [String]
    let ok: [String]
    let pass: [String]
    let options: [ConflictOption]
}

struct TripCandidate: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let placeId: String?
    let location: GeoPoint?
    let addr: String?
    let note: String?
    let url: String?
    let status: CandidateStatus
    let scheduledRef: String?
    /// '내가 추가' · '지민이 추가' 처럼 이미 완성된 문장.
    let proposedBy: String
    let mine: Bool
    let myReaction: ReactionKind?
    let reactionSummary: String
    let reactors: [CandidateReactor]
    let commentCount: Int
    let verdict: CandidateVerdict
    let conflict: CandidateConflict?
    let createdAt: String
    let canRemove: Bool
}

enum CandidateGroupKey: String, UnknownCodable, Sendable {
    case loved = "LOVED", needsOpinion = "NEEDS_OPINION", resting = "RESTING"
    case scheduled = "SCHEDULED", rejected = "REJECTED", unknown
    static var unknownCase: CandidateGroupKey { .unknown }
}

struct CandidateGroup: Codable, Identifiable, Hashable, Sendable {
    let key: CandidateGroupKey
    let title: String
    let candidates: [TripCandidate]

    var id: String { key.rawValue }
}

struct GroupProposalPick: Codable, Identifiable, Hashable, Sendable {
    let candidateId: String
    let title: String
    let dayIndex: Int
    let distanceKm: Double?
    let reasons: [String]

    var id: String { candidateId }
}

/// 미리보기다 — 저장되지 않는다. 사람이 눌러야 일정에 들어간다(§79).
struct GroupProposal: Codable, Hashable, Sendable {
    let headline: String
    let picks: [GroupProposalPick]
}

struct CandidateBoardResponse: Codable, Sendable {
    let schemaVersion: Int
    let tripId: String
    let role: MemberRole?
    let memberCount: Int
    let canPropose: Bool
    let canReact: Bool
    let groups: [CandidateGroup]
    let proposal: GroupProposal?
    let groupContext: [String]

    var isEmpty: Bool { groups.allSatisfy { $0.candidates.isEmpty } }
}

struct CandidateComment: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let body: String
    let authorLabel: String
    let mine: Bool
    let createdAt: String
    let canDelete: Bool
}

struct CommentListResponse: Codable, Sendable {
    let schemaVersion: Int
    let candidateId: String
    let canComment: Bool
    let comments: [CandidateComment]
}

enum PacePreference: String, UnknownCodable, Sendable {
    case relaxed = "RELAXED", normal = "NORMAL", packed = "PACKED", unknown
    static var unknownCase: PacePreference { .unknown }

    var label: String {
        switch self {
        case .relaxed: "여유롭게"
        case .normal: "적당하게"
        case .packed: "빡빡하게"
        case .unknown: "정하지 않음"
        }
    }
}

enum WalkingPreference: String, UnknownCodable, Sendable {
    case low = "LOW", normal = "NORMAL", high = "HIGH", unknown
    static var unknownCase: WalkingPreference { .unknown }

    var label: String {
        switch self {
        case .low: "많이 걷기 싫어요"
        case .normal: "적당히 걸어요"
        case .high: "많이 걸어도 좋아요"
        case .unknown: "정하지 않음"
        }
    }
}

/// 여행별 취향이다 — 고정 프로필이 아니다(§18). 답하지 않은 항목은 nil이다.
struct MemberPreference: Codable, Hashable, Sendable {
    let pace: PacePreference?
    let walking: WalkingPreference?
    let morning: Bool?
    let night: Bool?
    let interests: [String]
    let dislikes: [String]
    let note: String?

    static let empty = MemberPreference(
        pace: nil, walking: nil, morning: nil, night: nil, interests: [], dislikes: [], note: nil)

    /// 서버가 아는 키만 보낸다 — 값이 없는 항목은 아예 빼서 서버의 화이트리스트와 결과가 갈리지 않게 한다.
    var payload: [String: Any] {
        var out: [String: Any] = [:]
        if let pace, pace != .unknown { out["pace"] = pace.rawValue }
        if let walking, walking != .unknown { out["walking"] = walking.rawValue }
        if let morning { out["morning"] = morning }
        if let night { out["night"] = night }
        if !interests.isEmpty { out["interests"] = interests }
        if !dislikes.isEmpty { out["dislikes"] = dislikes }
        if let note, !note.isEmpty { out["note"] = note }
        return out
    }
}

struct MemberPreferenceRow: Codable, Identifiable, Hashable, Sendable {
    let name: String
    let mine: Bool
    /// '여유롭게 · 관심: 미술관' 한 줄 요약.
    let summary: String
    let prefs: MemberPreference

    var id: String { name }
}

struct PreferenceResponse: Codable, Sendable {
    let schemaVersion: Int
    let mine: MemberPreference
    let members: [MemberPreferenceRow]
    let groupContext: [String]
}

struct ActivityEntry: Codable, Identifiable, Hashable, Sendable {
    let id: String
    /// 완성된 한국어 문장. 내부 구조를 그대로 내보내지 않는다(§39).
    let text: String
    let mine: Bool
    let at: String
    let relative: String
}

struct ActivityListResponse: Codable, Sendable {
    let schemaVersion: Int
    let entries: [ActivityEntry]
}
