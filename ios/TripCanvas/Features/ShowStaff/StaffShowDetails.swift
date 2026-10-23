import Foundation

/// 사용자가 예약 확인서·현지 표지에서 확인한 원문. 번역이나 장소 이름으로 추측해 채우지 않는다.
/// 여행 문서의 일부이므로 기존 계정별 문서 캐시와 CAS 저장을 그대로 따른다.
struct StaffShowDetails: Hashable, Sendable {
    private(set) var raw: [String: JSONValue]
    init(raw: [String: JSONValue] = [:]) { self.raw = raw }

    var localName: String {
        get { Self.text(raw["localName"]?.stringValue, limit: 240) }
        set { set("localName", newValue, limit: 240) }
    }
    var address: String {
        get { Self.text(raw["address"]?.stringValue, limit: 500) }
        set { set("address", newValue, limit: 500) }
    }
    var bookingName: String {
        get { Self.text(raw["bookingName"]?.stringValue, limit: 160) }
        set { set("bookingName", newValue, limit: 160) }
    }
    private mutating func set(_ key: String, _ text: String, limit: Int) {
        let value = Self.text(text, limit: limit)
        raw.setOrRemove(key, value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : .string(value))
    }
    /// 서버 문자열 상한과 같은 UTF-16 단위. 이모지·결합 문자를 중간에서 자르지 않는다.
    private static func text(_ value: String?, limit: Int) -> String {
        var count = 0
        // TextField writes on every keystroke. Preserve trailing spaces/newlines while editing.
        return String((value ?? "").prefix { character in
            count += String(character).utf16.count
            return count <= limit
        })
    }
}

extension TripSpot {
    var staffDetails: StaffShowDetails {
        get { StaffShowDetails(raw: raw["staffShow"]?.objectValue ?? [:]) }
        set { setField("staffShow", newValue.raw.isEmpty ? nil : .object(newValue.raw)) }
    }
}

extension TripBooking {
    var staffDetails: StaffShowDetails {
        get { StaffShowDetails(raw: raw["staffShow"]?.objectValue ?? [:]) }
        set {
            // TripBooking의 raw setter는 해당 타입 내부에만 있다. 원문 전체를 새로 구성해 다른 키를 보존한다.
            var object = raw
            object.setOrRemove("staffShow", newValue.raw.isEmpty ? nil : .object(newValue.raw))
            self = TripBooking(raw: object)
        }
    }
}

/// 표시 전용 값. 네트워크·번역·위치 조회가 없어 저장된 문서만으로 오프라인에서도 열린다.
struct StaffShowCard: Identifiable, Hashable, Sendable {
    enum Audience: String, CaseIterable, Identifiable {
        case driver, reservation
        var id: String { rawValue }
        var label: String { self == .driver ? "택시기사에게" : "숙소·예약 직원에게" }
    }
    struct Fact: Identifiable, Hashable, Sendable {
        let label: String
        let value: String
        var id: String { label }
    }
    let title: String
    let hasLocalName: Bool
    let address: String?
    let point: GeoPoint?
    let facts: [Fact]
    /// 이 값은 명시적인 공개 버튼을 누르기 전에는 뷰 트리에도 넣지 않는다.
    let confirmation: String?
    let isReservation: Bool
    var id: String { title + (address ?? "") + facts.map(\.value).joined(separator: "|") }

    init(spot: TripSpot, booking: TripBooking? = nil) {
        let localName = Self.nonempty(spot.staffDetails.localName) ?? Self.nonempty(booking?.staffDetails.localName)
        title = localName ?? Self.nonempty(spot.name) ?? Self.nonempty(booking?.title) ?? "이름이 저장되지 않았어요"
        hasLocalName = localName != nil
        address = Self.nonempty(spot.staffDetails.address) ?? Self.nonempty(booking?.staffDetails.address)
        point = Self.validPoint(spot.point)
        var rows: [Fact] = []
        if let bookedAt = spot.bookedAt, ClockText.isValid(bookedAt) {
            rows.append(.init(label: "Time / 예약·입장 시각", value: bookedAt))
        }
        if spot.admission.raw["source"]?.stringValue == "USER", spot.admission.isBooked,
           let people = Self.explicitCount(spot.admission.raw["people"], maximum: 100) {
            rows.append(.init(label: "Guests / 예약 인원", value: "\(people)"))
        }
        if let booking { Self.appendBookingFacts(booking, to: &rows) }
        let name = Self.nonempty(booking?.staffDetails.bookingName) ?? Self.nonempty(spot.staffDetails.bookingName)
        if let name { rows.append(.init(label: "Name / 예약자명", value: name)) }
        facts = rows
        confirmation = Self.nonempty(booking?.confirmation) ?? ["confirmation", "confirmationNumber", "code"]
            .compactMap { Self.nonempty(spot.raw[$0]?.stringValue) }.first
        isReservation = booking != nil || spot.admission.isBooked || rows.contains { $0.label.hasPrefix("Time") }
    }

    init(booking: TripBooking, linkedSpot: TripSpot? = nil) {
        self.init(spot: linkedSpot ?? TripSpot(name: booking.title), booking: booking)
    }

    /// 문서를 아직 못 받은 예약 화면도 이미 받은 사실을 즉시 보여준다. 현지어·주소로 격상하지 않는다.
    init(summary: BookingSummary) {
        title = Self.nonempty(summary.title) ?? "이름이 저장되지 않았어요"
        hasLocalName = false; address = nil; point = nil; isReservation = true
        var rows: [Fact] = []
        if let start = summary.start, ISODateText.parseLoose(start) == start {
            rows.append(.init(label: "Date / 예약 날짜", value: start))
        }
        if let time = summary.startTime, ClockText.isValid(time) { rows.append(.init(label: "Time / 예약 시각", value: time)) }
        facts = rows; confirmation = Self.nonempty(summary.confirmation)
    }

    private static func appendBookingFacts(_ booking: TripBooking, to rows: inout [Fact]) {
        if let start = booking.start, ISODateText.parseLoose(start) == start {
            rows.append(.init(label: booking.type == .hotel ? "Check-in / 체크인" : "Start / 시작일", value: start))
        }
        if let end = booking.end, ISODateText.parseLoose(end) == end {
            rows.append(.init(label: booking.type == .hotel ? "Check-out / 체크아웃" : "End / 종료일", value: end))
        }
        if booking.type == .hotel, let adults = Self.explicitCount(booking.raw["adults"], maximum: 8), !rows.contains(where: { $0.label.hasPrefix("Guests") }) {
            rows.append(.init(label: "Adults / 성인", value: "\(adults)"))
        }
        if booking.type == .car, let time = booking.carPickupTime, ClockText.isValid(time) {
            rows.append(.init(label: "Pickup / 픽업 시각", value: time))
        }
        if booking.type == .car, let time = booking.carReturnTime, ClockText.isValid(time) {
            rows.append(.init(label: "Return / 반납 시각", value: time))
        }
        if booking.type == .car, let place = nonempty(booking.carPickup) {
            rows.append(.init(label: "Pickup location / 픽업 지점", value: place))
        }
        if booking.type == .car, let place = nonempty(booking.carReturn) {
            rows.append(.init(label: "Return location / 반납 지점", value: place))
        }
    }

    private static func nonempty(_ value: String?) -> String? {
        guard let value else { return nil }
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }
    private static func explicitCount(_ value: JSONValue?, maximum: Int) -> Int? {
        guard let number = value?.doubleValue, number.isFinite, number == number.rounded(),
              number >= 1, number <= Double(maximum) else { return nil }
        return Int(number)
    }
    private static func validPoint(_ point: GeoPoint?) -> GeoPoint? {
        guard let point, point.lat.isFinite, point.lng.isFinite,
              (-90...90).contains(point.lat), (-180...180).contains(point.lng) else { return nil }
        return point
    }
}

enum StaffShowSelection {
    enum Failure: LocalizedError, Equatable {
        case changed, unavailable
        var errorDescription: String? {
            switch self {
            case .changed: "일정이 바뀌었어요. 지금 화면을 새로고침한 뒤 다시 열어 주세요."
            case .unavailable: "이 일정에 연결된 장소 정보가 없어요. 일정에서 장소를 확인해 주세요."
            }
        }
    }
    static func card(document: TripDocument, documentRevision: Int, activityID: String,
                     expectedName: String, expectedRevision: Int) throws -> StaffShowCard {
        guard documentRevision == expectedRevision else { throw Failure.changed }
        guard activityID.hasPrefix("d"), let marker = activityID.firstIndex(of: "s") else { throw Failure.unavailable }
        let dayText = String(activityID[activityID.index(after: activityID.startIndex)..<marker])
        let spotText = String(activityID[activityID.index(after: marker)...])
        let asciiDigits: (String) -> Bool = { !$0.isEmpty && $0.utf8.allSatisfy { (48...57).contains($0) } }
        guard asciiDigits(dayText), asciiDigits(spotText), let day = Int(dayText), let index = Int(spotText),
              document.hasDay(day), document.days[day].spots.indices.contains(index) else { throw Failure.unavailable }
        let spot = document.days[day].spots[index]
        guard spot.name == expectedName else { throw Failure.changed }
        guard spot.raw["choice"]?.objectValue?["state"]?.stringValue != "PENDING" else { throw Failure.unavailable }
        let booking = (spot.bookingId ?? spot.carPickupId ?? spot.carReturnId).flatMap { document.booking(id: $0) }
        return StaffShowCard(spot: spot, booking: booking)
    }

    static func linkedSpot(document: TripDocument, booking: TripBooking) -> TripSpot? {
        let links = document.links(forBooking: booking.id)
        let ref = booking.type == .car ? links.carPickup : links.stay
        return ref.flatMap { document.spot(at: $0) }
    }

    /// 비용에서 파생한 예약만 요약으로 보여준다. 새 문서에서 지워진 예약을 옛 요약으로 되살리지 않는다.
    static func summaryExists(document: TripDocument, summary: BookingSummary) -> Bool {
        let parts = summary.id.split(separator: ":")
        guard parts.count == 4, parts[0] == "reservation", String(parts[1]) == summary.source else { return false }
        let items: [JSONValue]
        if summary.source == "TRIP_COST" {
            guard parts[2] == "trip" else { return false }
            items = document.raw["costItems"]?.arrayValue ?? []
        } else if summary.source == "DAY_COST", let day = summary.dayIndex, document.hasDay(day) {
            guard Int(parts[2]) == day else { return false }
            items = document.days[day].raw["costItems"]?.arrayValue ?? []
        } else { return false }
        return items.contains { $0.objectValue?["id"]?.stringValue == String(parts[3]) && $0.objectValue?["title"]?.stringValue == summary.title }
    }
}
