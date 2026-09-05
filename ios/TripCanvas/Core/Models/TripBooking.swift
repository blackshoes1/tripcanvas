import Foundation

/// 예약 하나 — `lib.js`의 `normalizeBooking`이 만드는 모양 그대로.
///
/// 예약(`trip.bookings`)은 여행 문서의 일부라 장소와 같은 길로 저장된다(revision CAS). 가격 관측
/// 기록은 여기 없다 — 그건 `/prices`에 따로 산다. `TripSpot`과 같은 규칙으로 원문(`raw`)을 들고
/// 아는 필드만 덮어 쓴다: 시세 조회가 남긴 `ptoken`·`enName`·`saved`는 앱이 모르는 채로 보존된다.
struct TripBooking: Hashable, Sendable, Identifiable {
    private(set) var raw: [String: JSONValue]

    init(raw: [String: JSONValue]) { self.raw = raw }

    /// 새 예약. 웹의 `bkSave`가 새 항목에 쓰는 것과 같은 바탕이다(id·createdAt·추적 on).
    init(type: TripBookingType = .hotel, id: String = TripBooking.newId(), createdAt: Date = Date()) {
        raw = [
            "id": .string(id),
            "type": .string(type.rawValue),
            "title": .string(""),
            "provider": .string(""),
            "price": .number(0),
            "track": .bool(true),
            "createdAt": .string(ISODateText.timestamp(createdAt))
        ]
    }

    /// `_ID_RE`(`[A-Za-z0-9_-]{1,40}`)를 지나는 id. 웹이 inline onclick 인자로도 쓰는 형식이라 이 밖의 문자는 없다.
    static func newId(now: Date = Date()) -> String {
        let stamp = String(Int(now.timeIntervalSince1970 * 1000), radix: 36)
        let alphabet = Array("0123456789abcdefghijklmnopqrstuvwxyz")
        let random = String((0..<6).map { _ in alphabet[Int.random(in: 0..<alphabet.count)] })
        return "bk\(stamp)\(random)"
    }

    static func isValidId(_ id: String) -> Bool {
        !id.isEmpty && id.count <= 40 && id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
    }

    var id: String { raw["id"]?.stringValue ?? "" }

    /// 모르는 종류는 숙박으로 본다(`normalizeBooking`과 같다).
    var type: TripBookingType {
        get { TripBookingType(rawValue: raw["type"]?.stringValue ?? "") ?? .hotel }
        set { raw["type"] = .string(newValue.rawValue) }
    }

    var title: String {
        get { raw["title"]?.stringValue ?? "" }
        set { raw["title"] = .string(newValue) }
    }

    var provider: String {
        get { raw["provider"]?.stringValue ?? "" }
        set { raw["provider"] = .string(newValue) }
    }

    var url: String? {
        get { raw["url"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } }
        set { raw.setOrRemove("url", newValue.flatMap { $0.isEmpty ? nil : .string($0) }) }
    }

    /// 총액. 예약은 여러 날에 걸친 총액이다 — 하루치는 `bookingShareOn`이 나눈다.
    var price: Int {
        get { raw["price"]?.intValue ?? 0 }
        set { raw["price"] = .number(max(0, newValue)) }
    }

    /// KRW는 기본값이라 저장하지 않는다(장소의 `cur`와 같은 규칙).
    var currency: Currency? {
        get { Currency(rawValue: raw["cur"]?.stringValue ?? "") }
        set { raw.setOrRemove("cur", newValue.flatMap { $0 == .krw ? nil : .string($0.rawValue) }) }
    }

    var currencyCode: String { (currency ?? .krw).rawValue }

    /// 시작일 `YYYY-MM-DD` — 체크인·픽업·출발.
    var start: String? {
        get { raw["start"]?.stringValue }
        set { raw.setOrRemove("start", newValue.flatMap { ISODateText.isValid($0) ? .string($0) : nil }) }
    }

    /// 종료일 `YYYY-MM-DD` — 체크아웃·반납·도착.
    var end: String? {
        get { raw["end"]?.stringValue }
        set { raw.setOrRemove("end", newValue.flatMap { ISODateText.isValid($0) ? .string($0) : nil }) }
    }

    /// 가격 추적. 웹은 항상 써 넣는다(`b.track = b.track !== false`) — 같은 바이트를 만들기 위해 여기서도 쓴다.
    var track: Bool {
        get { raw["track"]?.boolValue ?? true }
        set { raw["track"] = .bool(newValue) }
    }

    // MARK: 취소 조건

    /// 무료 취소 가능. 구버전 예약은 기한만 있었다 — 기한이 있으면 가능으로 읽는다(`normalizeBooking`).
    var refundable: Bool {
        get { raw["refundable"]?.boolValue ?? (freeCancelUntil != nil) }
        set { raw["refundable"] = .bool(newValue) }
    }

    var freeCancelUntil: String? {
        get { raw["freeCancelUntil"]?.stringValue }
        set { raw.setOrRemove("freeCancelUntil", newValue.flatMap { ISODateText.isValid($0) ? .string($0) : nil }) }
    }

    var cancelFee: Int? {
        get { raw["cancelFee"]?.intValue }
        set { raw.setOrRemove("cancelFee", newValue.flatMap { $0 > 0 ? .number($0) : nil }) }
    }

    // MARK: 숙박 조건 — 시세 비교의 기준. 미입력(nil)은 '모름'이다

    var adults: Int? {
        get { raw["adults"]?.intValue }
        set { raw.setOrRemove("adults", newValue.map { .number(min(8, max(1, $0))) }) }
    }

    var rooms: Int? {
        get { raw["rooms"]?.intValue }
        set { raw.setOrRemove("rooms", newValue.map { .number(min(4, max(1, $0))) }) }
    }

    var roomName: String? {
        get { raw["roomName"]?.stringValue }
        set {
            let trimmed = (newValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(120)
            raw.setOrRemove("roomName", trimmed.isEmpty ? nil : .string(String(trimmed)))
        }
    }

    /// nil = 모름. false도 뜻이 있어(조식 없음) 저장한다.
    var breakfast: Bool? {
        get { raw["breakfast"]?.boolValue }
        set { raw.setOrRemove("breakfast", newValue.map { .bool($0) }) }
    }

    // MARK: 렌터카 조건 — carMatchQuality의 기준. 차급·변속기·보험·주행거리가 다르면 확정 절약이 아니다

    var carPickup: String? {
        get { raw["carPickup"]?.stringValue }
        set { raw.setOrRemove("carPickup", TripBooking.freeText(newValue, limit: 120)) }
    }

    var carReturn: String? {
        get { raw["carReturn"]?.stringValue }
        set { raw.setOrRemove("carReturn", TripBooking.freeText(newValue, limit: 120)) }
    }

    /// IATA 세 글자. 그 형식이 아니면 저장하지 않는다(`normalizeBooking`이 버리는 것과 같다).
    var carPickupCode: String? {
        get { raw["carPickupCode"]?.stringValue }
        set { raw.setOrRemove("carPickupCode", TripBooking.airportCode(newValue)) }
    }

    var carReturnCode: String? {
        get { raw["carReturnCode"]?.stringValue }
        set { raw.setOrRemove("carReturnCode", TripBooking.airportCode(newValue)) }
    }

    var carPickupTime: String? {
        get { raw["carPickupTime"]?.stringValue }
        set { raw.setOrRemove("carPickupTime", newValue.flatMap { ClockText.isValid($0) ? .string($0) : nil }) }
    }

    var carReturnTime: String? {
        get { raw["carReturnTime"]?.stringValue }
        set { raw.setOrRemove("carReturnTime", newValue.flatMap { ClockText.isValid($0) ? .string($0) : nil }) }
    }

    /// 차급. 웹의 선택지는 `CarClass.known`이지만 가져온 예약에는 다른 문자열이 있을 수 있어 자유 문자열로 둔다.
    var carClass: String? {
        get { raw["carClass"]?.stringValue }
        set { raw.setOrRemove("carClass", TripBooking.freeText(newValue, limit: 40)) }
    }

    var transmission: CarTransmission? {
        get { CarTransmission(rawValue: raw["transmission"]?.stringValue ?? "") }
        set { raw.setOrRemove("transmission", newValue.map { .string($0.rawValue) }) }
    }

    var mileage: CarMileage? {
        get { CarMileage(rawValue: raw["mileage"]?.stringValue ?? "") }
        set { raw.setOrRemove("mileage", newValue.map { .string($0.rawValue) }) }
    }

    var insurance: CarInsurance? {
        get { CarInsurance(rawValue: raw["insurance"]?.stringValue ?? "") }
        set { raw.setOrRemove("insurance", newValue.map { .string($0.rawValue) }) }
    }

    /// 반납 지점은 (장소, 공항코드) **한 쌍**이다 — `lib.js`의 `carReturnPoint`와 같은 규칙.
    /// 둘 중 하나라도 있으면 내가 정한 반납 지점이고, 둘 다 비었을 때만 픽업과 같다.
    var returnPoint: (place: String, code: String) {
        let place = carReturn ?? "", code = carReturnCode ?? ""
        if !place.isEmpty || !code.isEmpty { return (place, code) }
        return (carPickup ?? "", carPickupCode ?? "")
    }

    var updatedAt: String? {
        get { raw["updatedAt"]?.stringValue }
        set { raw.setOrRemove("updatedAt", newValue.map { .string($0) }) }
    }

    /// 이름·기간이 시세 조회의 identity다 — 바뀌면 provider property 매핑(`ptoken`)을 다시 찾아야 한다.
    var identity: [String] { [title, start ?? "", end ?? ""] }

    mutating func forgetPropertyToken() { raw.removeValue(forKey: "ptoken") }

    // MARK: 검증 — 웹 `bkSave`·서버 `validateBookingDraft`와 같은 규칙

    /// 저장 전 검사. 통과하지 못하면 이유를 돌려주고, 화면이 그대로 말한다.
    func validate() -> BookingDraftError? {
        if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return .titleRequired }
        if price <= 0 { return .priceRequired }
        if type == .hotel && track && (start == nil || end == nil) { return .trackNeedsDates }
        if let start, let end {
            if type == .car {
                // 당일 대여는 정상이다 — 같은 날이면 시각이 앞뒤를 가른다(시세 조회도 pickupAt<returnAt만 본다).
                if start > end { return .returnBeforePickup }
                if start == end {
                    guard let pickup = carPickupTime, let ret = carReturnTime,
                          ClockText.minutes(pickup) < ClockText.minutes(ret) else { return .sameDayNeedsTimes }
                }
            } else if start >= end {
                return .checkoutNotAfterCheckin   // 역순·같은 날이면 시세 조회가 거부된다
            }
        }
        return nil
    }

    private static func freeText(_ value: String?, limit: Int) -> JSONValue? {
        let trimmed = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(limit)
        return trimmed.isEmpty ? nil : .string(String(trimmed))
    }

    private static func airportCode(_ value: String?) -> JSONValue? {
        let code = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard code.count == 3, code.allSatisfy({ $0.isASCII && $0.isUppercase }) else { return nil }
        return .string(code)
    }
}

enum BookingDraftError: Equatable, Sendable {
    case titleRequired, priceRequired, trackNeedsDates, returnBeforePickup, sameDayNeedsTimes, checkoutNotAfterCheckin

    /// 웹 toast와 같은 문장.
    var message: String {
        switch self {
        case .titleRequired: "예약 이름을 입력하세요"
        case .priceRequired: "예약 가격을 입력하세요"
        case .trackNeedsDates: "가격 추적에는 체크인·체크아웃 날짜가 필요해요"
        case .returnBeforePickup: "반납일이 픽업일보다 앞설 수 없어요"
        case .sameDayNeedsTimes: "당일 대여는 픽업 시각과 그보다 늦은 반납 시각이 필요해요"
        case .checkoutNotAfterCheckin: "체크아웃은 체크인보다 뒤여야 해요"
        }
    }
}

/// `normalizeBooking`의 `type` — hotel·car·flight. 그 밖은 hotel로 읽힌다.
enum TripBookingType: String, CaseIterable, Sendable {
    case hotel, car, flight

    var label: String {
        switch self {
        case .hotel: "숙박"
        case .car: "렌터카"
        case .flight: "항공"
        }
    }

    var symbol: String {
        switch self {
        case .hotel: "bed.double.fill"
        case .car: "car.fill"
        case .flight: "airplane"
        }
    }

    /// 시작일·종료일이 뜻하는 것. 같은 두 필드지만 종류마다 이름이 다르다.
    var startLabel: String {
        switch self {
        case .hotel: "체크인"
        case .car: "픽업일"
        case .flight: "출발일"
        }
    }

    var endLabel: String {
        switch self {
        case .hotel: "체크아웃"
        case .car: "반납일"
        case .flight: "도착일"
        }
    }
}

enum CarTransmission: String, CaseIterable, Sendable {
    case automatic, manual
    var label: String { self == .automatic ? "자동" : "수동" }
}

enum CarMileage: String, CaseIterable, Sendable {
    case unlimited = "UNLIMITED", limited = "LIMITED"
    var label: String { self == .unlimited ? "무제한" : "제한" }
}

enum CarInsurance: String, CaseIterable, Sendable {
    case basic = "BASIC", cdw = "CDW", full = "FULL"
    var label: String {
        switch self {
        case .basic: "기본"
        case .cdw: "CDW"
        case .full: "완전(풀커버)"
        }
    }
}

/// 웹 예약 화면의 차급 선택지. 저장값은 소문자 id다.
struct CarClassOption: Identifiable, Hashable, Sendable {
    let id: String
    let label: String

    static let known: [CarClassOption] = [
        .init(id: "mini", label: "Mini"), .init(id: "economy", label: "Economy"), .init(id: "compact", label: "Compact"),
        .init(id: "intermediate", label: "Intermediate"), .init(id: "standard", label: "Standard"),
        .init(id: "fullsize", label: "Fullsize"), .init(id: "premium", label: "Premium"),
        .init(id: "suv", label: "SUV"), .init(id: "van", label: "Van")
    ]
}

// MARK: - 문서 안의 예약 (순수 · 테스트 대상)

/// 일정 안의 장소 하나를 가리키는 자리. 장소에는 안정적인 id가 없어 (일자, 순서)로 짚는다.
struct SpotRef: Hashable, Sendable {
    let day: Int
    let index: Int
}

/// 예약을 일정의 장소와 잇는 연결. 숙박은 숙소 한 곳, 렌터카는 픽업·반납 지점.
struct BookingLinks: Hashable, Sendable {
    var stay: SpotRef?
    var carPickup: SpotRef?
    var carReturn: SpotRef?

    static let empty = BookingLinks()
}

extension TripDocument {
    /// 예약 목록. id가 불량한 항목은 웹의 `normalizeBooking`처럼 없는 것으로 본다.
    var bookings: [TripBooking] {
        get {
            (raw["bookings"]?.arrayValue ?? []).compactMap { value in
                guard let object = value.objectValue, let id = object["id"]?.stringValue, TripBooking.isValidId(id) else { return nil }
                return TripBooking(raw: object)
            }
        }
        set {
            // 비면 키를 지운다(공유 링크 크기 — 웹과 같다).
            setField("bookings", newValue.isEmpty ? nil : .array(newValue.map { .object($0.raw) }))
        }
    }

    func booking(id: String) -> TripBooking? { bookings.first { $0.id == id } }

    /// 예약을 넣거나 고친다. 연결은 **이 예약을 가리키던 것을 모두 풀고** 새로 맺는다 — 차를 받는 곳은 한 곳이다.
    mutating func upsertBooking(_ booking: TripBooking, links: BookingLinks = .empty, now: Date = Date()) {
        guard TripBooking.isValidId(booking.id) else { return }
        var saved = booking
        saved.updatedAt = ISODateText.timestamp(now)
        var all = bookings
        if let index = all.firstIndex(where: { $0.id == saved.id }) {
            // 이름·기간이 바뀌면 provider property 매핑을 다시 찾는다(웹 bkSave와 같다).
            if all[index].identity != saved.identity { saved.forgetPropertyToken() }
            all[index] = saved
        } else {
            all.append(saved)
        }
        bookings = all

        unlinkBooking(id: saved.id)
        switch saved.type {
        case .hotel:
            if let ref = links.stay { updateSpot(ref) { $0.bookingId = saved.id } }
        case .car:
            if let ref = links.carPickup { updateSpot(ref) { $0.carPickupId = saved.id } }
            if let ref = links.carReturn { updateSpot(ref) { $0.carReturnId = saved.id } }
        case .flight:
            break
        }
    }

    /// 예약 추적을 뺀다(실제 예약이 취소되지는 않는다). 장소에 남은 연결도 전부 푼다.
    mutating func removeBooking(id: String) {
        bookings = bookings.filter { $0.id != id }
        unlinkBooking(id: id)
    }

    /// 지금 이 예약이 연결된 자리들. 편집 화면이 처음 열릴 때 선택을 채운다.
    func links(forBooking id: String) -> BookingLinks {
        var links = BookingLinks()
        for (dayIndex, day) in days.enumerated() {
            for (index, spot) in day.spots.enumerated() {
                let ref = SpotRef(day: dayIndex, index: index)
                if spot.bookingId == id { links.stay = ref }
                if spot.carPickupId == id { links.carPickup = ref }
                if spot.carReturnId == id { links.carReturn = ref }
            }
        }
        return links
    }

    /// 숙박 예약과 이을 수 있는 장소 — 숙소로 표시된 것만(`bkStayOptions`와 같다).
    var stayRefs: [SpotRef] { spotRefs.filter { spot(at: $0)?.isStay == true } }

    /// 모든 장소의 자리. 렌터카 픽업·반납 연결에 쓴다.
    var spotRefs: [SpotRef] {
        days.enumerated().flatMap { dayIndex, day in
            day.spots.indices.map { SpotRef(day: dayIndex, index: $0) }
        }
    }

    func spot(at ref: SpotRef) -> TripSpot? {
        guard hasDay(ref.day), ref.index >= 0, ref.index < days[ref.day].spots.count else { return nil }
        return days[ref.day].spots[ref.index]
    }

    /// 그 일자의 날짜 `YYYY-MM-DD`. 여행에 시작일이 없으면 nil.
    func date(ofDay dayIndex: Int) -> String? {
        guard hasDay(dayIndex), let first = ISODateText.date(from: start) else { return nil }
        return ISODateText.text(from: ISODateText.calendar.date(byAdding: .day, value: dayIndex, to: first) ?? first)
    }

    private mutating func unlinkBooking(id: String) {
        var all = days
        var changed = false
        for dayIndex in all.indices {
            var spots = all[dayIndex].spots
            for index in spots.indices {
                var spot = spots[index]
                if spot.bookingId == id { spot.bookingId = nil; changed = true }
                if spot.carPickupId == id { spot.carPickupId = nil; changed = true }
                if spot.carReturnId == id { spot.carReturnId = nil; changed = true }
                spots[index] = spot
            }
            all[dayIndex].spots = spots
        }
        if changed { days = all }
    }

    private mutating func updateSpot(_ ref: SpotRef, _ change: (inout TripSpot) -> Void) {
        guard var spot = spot(at: ref) else { return }
        change(&spot)
        updateSpot(dayIndex: ref.day, at: ref.index, with: spot)
    }
}

// MARK: - 날짜 문자열

/// `YYYY-MM-DD`와 `Date` 사이. 문서에 들어가는 값이라 화면 밖에서도 검사한다.
enum ISODateText {
    static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone.current
        return calendar
    }()

    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static let timestampFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static func isValid(_ text: String) -> Bool {
        let scalars = Array(text.unicodeScalars)
        guard scalars.count == 10 else { return false }
        for (offset, scalar) in scalars.enumerated() {
            if offset == 4 || offset == 7 { if scalar != "-" { return false } }
            else if !(scalar.value >= 48 && scalar.value <= 57) { return false }
        }
        return true
    }

    static func date(from text: String?) -> Date? {
        guard let text, isValid(text) else { return nil }
        return formatter.date(from: text)
    }

    static func text(from date: Date) -> String { formatter.string(from: date) }

    /// JS의 `toISOString()`과 같은 모양(`2026-09-05T01:02:03.000Z`).
    static func timestamp(_ date: Date) -> String { timestampFormatter.string(from: date) }
}
