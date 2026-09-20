import Foundation

/// 비용 입력도 원문을 유지한다. 연결 예약, 참여자와 알 수 없는 필드를 지우지 않는다.
struct CostEntry: Hashable, Sendable, Identifiable {
    var raw: [String: JSONValue]
    var id: String { raw["id"]?.stringValue ?? "" }
    var title: String {
        get { raw["title"]?.stringValue ?? "" }
        set { raw["title"] = .string(newValue) }
    }
    var kind: String {
        get { raw["kind"]?.stringValue ?? "OTHER" }
        set { raw["kind"] = .string(newValue) }
    }
    var amount: Double? {
        get { raw["amount"]?.doubleValue }
        set { raw.setOrRemove("amount", newValue.map(JSONValue.number)) }
    }
    var currency: Currency {
        get { Currency(rawValue: raw["cur"]?.stringValue ?? "") ?? .krw }
        set { raw["cur"] = .string(newValue.rawValue) }
    }
    var basis: CostBasis {
        get { CostBasis(rawValue: raw["costBasis"]?.stringValue ?? "") ?? .entered }
        set { raw["costBasis"] = .string(newValue.rawValue) }
    }
    var people: Int {
        get { raw["costPeople"]?.intValue ?? 1 }
        set { raw["costPeople"] = .number(min(100, max(1, newValue))) }
    }
    var isPartial: Bool {
        get { raw["costPartial"]?.boolValue ?? false }
        set { raw.setOrRemove("costPartial", newValue ? .bool(true) : nil) }
    }
    /// 예약해 둔 돈인가 이미 낸 돈인가. 고르지 않으면 문서에 **키 자체를 남기지 않는다** —
    /// `NONE`을 적어 두면 '아직 안 골랐다'와 '골랐는데 그 값이다'가 같은 모양이 되고,
    /// 공유 링크도 기본값만큼 무거워진다.
    var payState: CostPayState {
        get { CostPayState(rawValue: raw["payState"]?.stringValue ?? "") ?? .none }
        set { raw.setOrRemove("payState", newValue == .none ? nil : .string(newValue.rawValue)) }
    }
    /// 영수증·품목 사진의 **참조**(사진 보관함 식별자)만 담는다. 원본 이미지는 여행 문서에 넣지 않는다 —
    /// 문서는 저장할 때마다 통째로 오가므로 사진을 실으면 동기화가 무거워지고 공유 링크가 터진다.
    var photos: [String] {
        get { (raw["photos"]?.arrayValue ?? []).compactMap { $0.stringValue } }
        set { raw.setOrRemove("photos", newValue.isEmpty ? nil : .array(newValue.map { .string($0) })) }
    }
    /// 낸 날짜 `YYYY-MM-DD` — 가계부 정렬용. 여행 날짜와 무관하다(출발 두 달 전에 낸 보험료).
    var paidOn: String? {
        get { raw["paidOn"]?.stringValue }
        set { raw.setOrRemove("paidOn", newValue.flatMap { $0.isEmpty ? nil : .string($0) }) }
    }

    init(raw: [String: JSONValue] = [:]) { self.raw = raw }

    init(spot: TripSpot) {
        raw = spot.raw
        raw["amount"] = spot.raw["cost"]
        raw["title"] = .string(spot.name)
        raw["kind"] = .string(spot.raw["costKind"]?.stringValue ?? "AUTO")
    }

    func applying(to original: TripSpot) -> TripSpot {
        var spot = original
        spot.cost = amount
        spot.setField("costKind", kind == "AUTO" ? nil : .string(kind))
        for key in ["cur", "costBasis", "costPeople", "costPartial", "payState", "photos"] { spot.setField(key, raw[key]) }
        return spot
    }
}

extension TripDocument {
    /// **준비한 비용** — 예약이 아닌 사전 지출(여행자보험·유심·미리 산 입장권). 하루 항목과 같은 모양이고
    /// 어느 날에도 속하지 않는다. 비면 키를 지운다(웹 `normalizeTrip`과 같다).
    var costItems: [CostEntry] {
        get { (raw["costItems"]?.arrayValue ?? []).compactMap { $0.objectValue.map(CostEntry.init(raw:)) } }
        set { setField("costItems", newValue.isEmpty ? nil : .array(newValue.map { .object($0.raw) })) }
    }
}

extension TripDay {
    var budget: CostEntry? {
        get { raw["budget"]?.objectValue.map(CostEntry.init(raw:)) }
        set { setField("budget", newValue.map { .object($0.raw) }) }
    }
    var costItems: [CostEntry] {
        get { (raw["costItems"]?.arrayValue ?? []).compactMap { $0.objectValue.map(CostEntry.init(raw:)) } }
        set { setField("costItems", newValue.isEmpty ? nil : .array(newValue.map { .object($0.raw) })) }
    }
}

enum MoneyInput {
    static func text(amount: Double?) -> String {
        guard let amount else { return "" }
        return NSDecimalNumber(value: amount).stringValue
    }

    /// 비어 있음과 확인한 0을 나눈다. 부호·임의 문자·잘못된 소수는 무료로 바꾸지 않는다.
    static func amount(from text: String, currency: Currency? = nil) -> Double? {
        var value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasSuffix("원") { value.removeLast(); value = value.trimmingCharacters(in: .whitespaces) }
        let pattern = #"^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]{1,2})?$"#
        guard value.range(of: pattern, options: .regularExpression) != nil,
              let amount = Double(value.replacingOccurrences(of: ",", with: "")),
              amount.isFinite, amount <= 1_000_000_000_000 else { return nil }
        if (currency ?? .krw) == .krw || currency == .jpy {
            guard amount.rounded() == amount else { return nil }
        }
        return amount
    }
}

/// 서버의 비용 분류 ID에 대응하는 표시 이름. 집계와 자동 분류는 서버가 한다.
enum CostCategory: String, CaseIterable {
    case flight = "FLIGHT", stay = "STAY", rent = "RENT", transit = "TRANSIT"
    case food = "FOOD", shopping = "SHOPPING", ticket = "TICKET", transport = "TRANSPORT", other = "OTHER"
    var label: String {
        switch self {
        case .flight: "항공"
        case .stay: "숙박"
        case .rent: "렌트"
        case .transit: "대중교통"
        case .food: "식비"
        case .shopping: "쇼핑"
        case .ticket: "입장권·관람권"
        case .transport: "택시·기타 교통"
        case .other: "기타"
        }
    }

    /// 목록·편집기의 아이콘. 예약 종류(`TripBookingType.symbol`)와 같은 그림을 쓴다.
    var symbol: String {
        switch self {
        case .flight: "airplane"
        case .stay: "bed.double.fill"
        case .rent: "car.fill"
        case .transit: "tram.fill"
        case .food: "fork.knife"
        case .shopping: "bag.fill"
        case .ticket: "ticket.fill"
        case .transport: "car.side.fill"
        case .other: "shippingbox.fill"
        }
    }

    /// 항공·숙박·렌트는 **예약**(`trip.bookings`)이다 — 기간·조건·가격 추적이 붙는다. 나머지는 여행 단위 비용(`trip.costItems`).
    var bookingType: TripBookingType? {
        switch self {
        case .flight: .flight
        case .stay: .hotel
        case .rent: .car
        default: nil
        }
    }

    init(bookingType: TripBookingType) {
        switch bookingType {
        case .flight: self = .flight
        case .hotel: self = .stay
        case .car: self = .rent
        }
    }

    static let bookingKinds: [CostCategory] = [.flight, .stay, .rent]
    static let itemKinds: [CostCategory] = allCases.filter { $0.bookingType == nil }
}

extension CostPayState {
    /// **결제일이 있으면 날짜가 정한다**(`lib.js costPayStateOf`와 같은 규칙, 2026-09-18) — 오늘이거나 지났으면 결제,
    /// 아직이면 예약. 없으면 손으로 고른 값. 서버 응답(`payState`)이 있으면 그것이 먼저다(여행 시간대의 오늘로 계산했다) —
    /// 이 함수는 응답이 없을 때(옛 API·오프라인) 기기 날짜로 같은 답을 내려는 것이다.
    static func resolved(paidOn: String?, manual: CostPayState, today: String) -> CostPayState {
        guard let paidOn, ISODateText.isValid(paidOn), ISODateText.isValid(today) else { return manual }
        return paidOn <= today ? .paid : .reserved
    }
}
