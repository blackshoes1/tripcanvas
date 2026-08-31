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
protocol UnknownDecodable: RawRepresentable, Decodable where RawValue == String {
    static var unknownCase: Self { get }
}
extension UnknownDecodable {
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: raw) ?? Self.unknownCase
    }
}

enum Flexibility: String, UnknownDecodable, Sendable {
    case fixed = "FIXED", semiFixed = "SEMI_FIXED", flexible = "FLEXIBLE", unknown
    static var unknownCase: Flexibility { .unknown }
}

enum ActivityStatus: String, UnknownDecodable, Sendable {
    case planned = "PLANNED", ready = "READY", inProgress = "IN_PROGRESS"
    case completed = "COMPLETED", skipped = "SKIPPED", cancelled = "CANCELLED", unknown
    static var unknownCase: ActivityStatus { .unknown }

    var isDone: Bool { self == .completed || self == .skipped || self == .cancelled }
}

enum CommitmentType: String, UnknownDecodable, Sendable {
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

enum TravelStatus: String, UnknownDecodable, Sendable {
    case noPlan = "NO_PLAN", upcoming = "UPCOMING", readyToLeave = "READY_TO_LEAVE"
    case traveling = "TRAVELING", arrived = "ARRIVED", inProgress = "IN_PROGRESS"
    case delayed = "DELAYED", completed = "COMPLETED", unknown
    static var unknownCase: TravelStatus { .unknown }
}

enum SuggestionType: String, UnknownDecodable, Sendable {
    case nextActivity = "NEXT_ACTIVITY", replan = "REPLAN", priceSaving = "PRICE_SAVING", rest = "REST", unknown
    static var unknownCase: SuggestionType { .unknown }
}

enum SuggestionActionKind: String, UnknownDecodable, Sendable {
    case visitPlace = "VISIT_PLACE", checkIn = "CHECK_IN", moveToToday = "MOVE_TO_TODAY"
    case rest = "REST", returnToHotel = "RETURN_TO_HOTEL", eat = "EAT", replan = "REPLAN", openBooking = "OPEN_BOOKING", unknown
    static var unknownCase: SuggestionActionKind { .unknown }
}

enum PlanningMode: String, UnknownDecodable, Sendable {
    case manual = "MANUAL", assisted = "ASSISTED", delegated = "DELEGATED", unknown
    static var unknownCase: PlanningMode { .unknown }
}

enum EnergyLevel: String, UnknownDecodable, Sendable {
    case low = "LOW", normal = "NORMAL", high = "HIGH", unknown
    static var unknownCase: EnergyLevel { .unknown }
}

enum DepartureLevel: String, UnknownDecodable, Sendable {
    case early = "EARLY", now = "NOW", late = "LATE", unknown
    static var unknownCase: DepartureLevel { .unknown }
}

enum PriceState: String, UnknownDecodable, Sendable {
    case savingAvailable = "SAVING_AVAILABLE", cheaperUnverified = "CHEAPER_UNVERIFIED"
    case goodPrice = "GOOD_PRICE", watching = "WATCHING", error = "ERROR", untracked = "UNTRACKED", unknown
    static var unknownCase: PriceState { .unknown }
}

enum TravelTimeSource: String, UnknownDecodable, Sendable {
    case straightLineEstimate = "STRAIGHT_LINE_ESTIMATE", routed = "ROUTED", unknown
    static var unknownCase: TravelTimeSource { .unknown }
}

enum BookingKind: String, UnknownDecodable, Sendable {
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

    var isLive: Bool { todayIndex >= 0 }
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
