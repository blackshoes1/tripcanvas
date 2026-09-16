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
        for key in ["cur", "costBasis", "costPeople", "costPartial"] { spot.setField(key, raw[key]) }
        return spot
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
}
