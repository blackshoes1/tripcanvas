import Foundation

/// 여행 문서 — `lib.js`의 `normalizeTrip`이 만드는 모양 그대로.
///
/// 원문(`raw`)을 들고 아는 필드만 덮어 읽고 쓴다. 모르는 필드는 건드리지 않는다 —
/// 앱이 한 번 저장했다고 웹에서 만든 것이 사라지면 안 된다(`JSONValue` 주석).
///
/// **기본값은 저장하지 않는다.** 웹이 그렇게 한다(공유 링크 크기·§normalizeSpot) — 앱이 기본값을
/// 굳이 써 넣으면 같은 일정이 웹과 다른 바이트가 되어 쓸데없는 충돌·diff를 만든다.
struct TripDocument: Hashable, Sendable {
    private(set) var raw: [String: JSONValue]

    init(raw: [String: JSONValue]) { self.raw = raw }

    var name: String {
        get { raw["name"]?.stringValue ?? "" }
        set { raw["name"] = .string(newValue) }
    }

    /// 첫날 날짜 `YYYY-MM-DD`. 비어 있으면 날짜 없는 여행이다.
    var start: String {
        get { raw["start"]?.stringValue ?? "" }
        set { raw.setOrRemove("start", newValue.isEmpty ? nil : .string(newValue)) }
    }

    var timeZone: String? {
        get { raw["timeZone"]?.stringValue }
        set { raw.setOrRemove("timeZone", newValue.map { .string($0) }) }
    }

    var days: [TripDay] {
        get { (raw["days"]?.arrayValue ?? []).map { TripDay(raw: $0.objectValue ?? [:]) } }
        set { raw["days"] = .array(newValue.map { .object($0.raw) }) }
    }
}

/// 하루. 장소 목록과 그날의 기본 이동수단·시작시각을 가진다.
struct TripDay: Hashable, Sendable {
    private(set) var raw: [String: JSONValue]

    init(raw: [String: JSONValue] = [:]) { self.raw = raw }

    var title: String {
        get { raw["title"]?.stringValue ?? "" }
        set { raw["title"] = .string(newValue) }
    }

    var note: String {
        get { raw["note"]?.stringValue ?? "" }
        set { raw["note"] = .string(newValue) }
    }

    /// 그날의 기본 이동수단. 구간별로 다르면 장소의 `legMode`가 이긴다(`legModeOf`).
    var mode: TravelMode {
        get { TravelMode(rawValue: raw["mode"]?.stringValue ?? "") ?? .car }
        set { raw["mode"] = .string(newValue.rawValue) }
    }

    /// 출발 시각 `HH:MM`. 없으면 09:00으로 계산된다 — 그 기본값을 문서에 쓰지 않는다.
    var startAt: String? {
        get { raw["startAt"]?.stringValue }
        set { raw.setOrRemove("startAt", newValue.flatMap { $0.isEmpty ? nil : .string($0) }) }
    }

    /// `none`이면 전날 숙소를 이월받지 않는다(공항 이동일·야간열차).
    var carriesPreviousAnchor: Bool {
        get { raw["startPolicy"]?.stringValue != "none" }
        set { raw.setOrRemove("startPolicy", newValue ? nil : .string("none")) }
    }

    var spots: [TripSpot] {
        get { (raw["spots"]?.arrayValue ?? []).map { TripSpot(raw: $0.objectValue ?? [:]) } }
        set { raw["spots"] = .array(newValue.map { .object($0.raw) }) }
    }
}

/// 장소 하나. 좌표가 없을 수 있다 — 이름만 적어 둔 장소도 일정에 남는다.
struct TripSpot: Hashable, Sendable {
    private(set) var raw: [String: JSONValue]

    init(raw: [String: JSONValue] = [:]) { self.raw = raw }

    init(name: String, city: String = "기타") {
        self.raw = ["name": .string(name), "city": .string(city)]
    }

    var name: String {
        get { raw["name"]?.stringValue ?? "" }
        set { raw["name"] = .string(newValue) }
    }

    /// 색·묶음의 기준. 웹이 비어 있으면 '기타'로 채운다.
    var city: String {
        get { raw["city"]?.stringValue ?? "" }
        set { raw["city"] = .string(newValue.isEmpty ? "기타" : newValue) }
    }

    var desc: String {
        get { raw["desc"]?.stringValue ?? "" }
        set { raw["desc"] = .string(newValue) }
    }

    /// 좌표. 둘 중 하나라도 없으면 위치 없는 장소다 — 동선·ETA에서 빠진다.
    var point: GeoPoint? {
        get {
            guard let lat = raw["lat"]?.doubleValue, let lng = raw["lng"]?.doubleValue else { return nil }
            return GeoPoint(lat: lat, lng: lng)
        }
        set {
            // 웹은 좌표 없음을 null로 적는다(키를 지우지 않는다) — 같은 모양을 유지한다.
            raw["lat"] = newValue.map { .number($0.lat) } ?? .null
            raw["lng"] = newValue.map { .number($0.lng) } ?? .null
        }
    }

    /// 내가 정한 도착 시각 `HH:MM`.
    var arriveAt: String? {
        get { raw["at"]?.stringValue }
        set { raw.setOrRemove("at", newValue.flatMap { $0.isEmpty ? nil : .string($0) }) }
    }

    /// 상대가 정한 약속 시각 `HH:MM`(예약·입장). 일찍 도착하면 여기까지 기다린다.
    var bookedAt: String? {
        get { raw["bookAt"]?.stringValue }
        set { raw.setOrRemove("bookAt", newValue.flatMap { $0.isEmpty ? nil : .string($0) }) }
    }

    /// 머무는 시간(분).
    var stayMinutes: Int? {
        get { raw["stayMin"]?.intValue }
        set { raw.setOrRemove("stayMin", newValue.map { .number(max(0, $0)) }) }
    }

    var cost: Int? {
        get { raw["cost"]?.intValue }
        set { raw.setOrRemove("cost", newValue.map { .number(max(0, $0)) }) }
    }

    var currency: Currency? {
        get { Currency(rawValue: raw["cur"]?.stringValue ?? "") }
        set { raw.setOrRemove("cur", newValue.map { .string($0.rawValue) }) }
    }

    /// 이 장소로 오는 구간의 이동수단. 없으면 그날 기본을 쓴다.
    var legMode: TravelMode? {
        get { TravelMode(rawValue: raw["legMode"]?.stringValue ?? "") }
        set { raw.setOrRemove("legMode", newValue.map { .string($0.rawValue) }) }
    }

    var category: SpotCategory? {
        get { SpotCategory(rawValue: raw["cat"]?.stringValue ?? "") }
        set { raw.setOrRemove("cat", newValue.map { .string($0.rawValue) }) }
    }

    /// 숙소 연박 수.
    var nights: Int? {
        get { raw["nights"]?.intValue }
        set { raw.setOrRemove("nights", newValue.map { .number(min(60, max(1, $0))) }) }
    }

    /// 실행 상태. 기본(PLANNED)은 저장하지 않는다.
    var status: SpotStatus {
        get { SpotStatus(rawValue: raw["status"]?.stringValue ?? "") ?? .planned }
        set { raw.setOrRemove("status", newValue == .planned ? nil : .string(newValue.rawValue)) }
    }

    /// 꼭 가야 하는 곳. 일정 재구성이 마지막까지 지킨다. false는 저장하지 않는다.
    var isMust: Bool {
        get { raw["must"]?.boolValue ?? false }
        set { raw.setOrRemove("must", newValue ? .bool(true) : nil) }
    }
}

// MARK: - 일정 편집 (순수 · 테스트 대상)

extension TripDocument {
    /// 일자 인덱스가 문서 안에 있는지. 화면이 오래된 인덱스를 들고 있을 수 있다.
    func hasDay(_ dayIndex: Int) -> Bool { dayIndex >= 0 && dayIndex < days.count }

    /// 장소를 넣는다. `after`가 있으면 **그 바로 뒤**, 없으면 맨 뒤(§새 장소는 선택한 장소 뒤에).
    mutating func insertSpot(_ spot: TripSpot, dayIndex: Int, after: Int? = nil) {
        guard hasDay(dayIndex) else { return }
        var day = days[dayIndex]
        var spots = day.spots
        let position = after.map { min(max(0, $0 + 1), spots.count) } ?? spots.count
        spots.insert(spot, at: position)
        day.spots = spots
        replaceDay(dayIndex, with: day)
    }

    mutating func updateSpot(dayIndex: Int, at index: Int, with spot: TripSpot) {
        guard hasDay(dayIndex) else { return }
        var day = days[dayIndex]
        guard index >= 0 && index < day.spots.count else { return }
        var spots = day.spots
        spots[index] = spot
        day.spots = spots
        replaceDay(dayIndex, with: day)
    }

    mutating func removeSpot(dayIndex: Int, at index: Int) {
        guard hasDay(dayIndex) else { return }
        var day = days[dayIndex]
        guard index >= 0 && index < day.spots.count else { return }
        var spots = day.spots
        spots.remove(at: index)
        day.spots = spots
        replaceDay(dayIndex, with: day)
    }

    /// 같은 날 안에서 순서 바꾸기. SwiftUI의 `onMove`가 주는 형식(IndexSet, 삽입 위치)을 그대로 받는다.
    /// 표준 라이브러리의 `move(fromOffsets:toOffset:)`는 SwiftUI가 얹는 것이라 여기서 직접 옮긴다 —
    /// 모델 계층에 UI 프레임워크를 끌어들이지 않는다.
    mutating func moveSpots(dayIndex: Int, from source: IndexSet, to destination: Int) {
        guard hasDay(dayIndex) else { return }
        var day = days[dayIndex]
        let spots = day.spots
        let picked = source.sorted().compactMap { $0 >= 0 && $0 < spots.count ? spots[$0] : nil }
        guard !picked.isEmpty else { return }

        var remaining = spots
        for index in source.sorted(by: >) where index >= 0 && index < remaining.count {
            remaining.remove(at: index)
        }
        // destination은 **지우기 전** 기준의 자리다 — 앞에서 빠진 개수만큼 당긴다.
        let shift = source.filter { $0 < destination }.count
        let position = min(max(0, destination - shift), remaining.count)
        remaining.insert(contentsOf: picked, at: position)

        day.spots = remaining
        replaceDay(dayIndex, with: day)
    }

    /// 다른 날로 옮긴다. 옮긴 자리는 그 날의 맨 뒤 — 최적 위치를 추측하지 않는다.
    mutating func moveSpot(from origin: (day: Int, index: Int), toDay targetDay: Int) {
        guard hasDay(origin.day), hasDay(targetDay), origin.day != targetDay else { return }
        guard origin.index >= 0 && origin.index < days[origin.day].spots.count else { return }
        let spot = days[origin.day].spots[origin.index]
        removeSpot(dayIndex: origin.day, at: origin.index)
        insertSpot(spot, dayIndex: targetDay)
    }

    private mutating func replaceDay(_ index: Int, with day: TripDay) {
        var all = days
        all[index] = day
        days = all
    }
}

// MARK: - 문서 안의 값들

/// 이동수단. `lib.js`의 `_MODES`와 같은 순서·같은 문자열이다.
enum TravelMode: String, CaseIterable, Sendable {
    case car, taxi, transit, train, walk, bike, flight

    var label: String {
        switch self {
        case .car: "자차"
        case .taxi: "택시"
        case .transit: "대중교통"
        case .train: "기차"
        case .walk: "도보"
        case .bike: "자전거"
        case .flight: "비행기"
        }
    }

    var symbol: String {
        switch self {
        case .car: "car.fill"
        case .taxi: "car.side.fill"
        case .transit: "bus.fill"
        case .train: "tram.fill"
        case .walk: "figure.walk"
        case .bike: "bicycle"
        case .flight: "airplane"
        }
    }
}

/// `lib.js`의 `_CURS`.
enum Currency: String, CaseIterable, Sendable {
    case krw = "KRW", usd = "USD", eur = "EUR", jpy = "JPY", cny = "CNY"
}

/// `lib.js`의 `SPOT_CATS` — id는 저장값이라 바꾸면 기존 데이터가 '미지정'이 된다.
enum SpotCategory: String, CaseIterable, Sendable {
    case stay, food, cafe, sight, activity, shop, transport, nature

    var label: String {
        switch self {
        case .stay: "숙소"
        case .food: "식당"
        case .cafe: "카페"
        case .sight: "명소"
        case .activity: "액티비티"
        case .shop: "쇼핑"
        case .transport: "교통"
        case .nature: "자연"
        }
    }

    var icon: String {
        switch self {
        case .stay: "🏠"
        case .food: "🍽"
        case .cafe: "☕"
        case .sight: "🏛"
        case .activity: "🎢"
        case .shop: "🛍"
        case .transport: "🚉"
        case .nature: "🌿"
        }
    }
}

/// `lib.js`의 `_STATUS`. 자동으로 완료를 판정하지 않는다 — 사용자가 누른다.
enum SpotStatus: String, CaseIterable, Sendable {
    case planned = "PLANNED", completed = "COMPLETED", skipped = "SKIPPED", cancelled = "CANCELLED"

    var label: String {
        switch self {
        case .planned: "예정"
        case .completed: "완료"
        case .skipped: "건너뜀"
        case .cancelled: "취소"
        }
    }
}

private extension Dictionary where Key == String, Value == JSONValue {
    /// 값이 없으면 **키를 지운다**. 웹이 기본값을 저장하지 않는 규칙을 앱도 그대로 지킨다.
    mutating func setOrRemove(_ key: String, _ value: JSONValue?) {
        if let value { self[key] = value } else { removeValue(forKey: key) }
    }
}

/// `GET/PUT /api/v1/trips/:id` 응답. 요약(trip)과 문서 원문(document)이 함께 온다.
///
/// ⚠️ 이 타입은 앱 타깃 전용이다 — 위젯·공유·Watch는 `Contract.swift`만 함께 컴파일하므로
/// 여기 있는 것을 참조하면 그 타깃들이 깨진다.
struct TripDetailResponse: Codable, Sendable {
    let trip: TripSummary
    let document: [String: JSONValue]
}
