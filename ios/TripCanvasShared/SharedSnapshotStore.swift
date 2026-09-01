import Foundation

/// 앱 · 위젯 · Live Activity가 함께 보는 최소 상태.
///
/// 위젯이 앱 데이터베이스를 복제하지 않는다(§28). 앱이 서버에서 받은 압축본(WidgetSnapshot /
/// LiveActivityState)만 App Group에 써 두고, 위젯은 그것만 읽는다 — 위젯 프로세스에는
/// 네트워크도 인증도 없다.
///
/// 여기 들어가는 값에 예약번호·항공편·좌표를 넣지 않는다(§54). 잠금화면은 잠긴 상태에서도 보인다.
///
/// ⚠️ 접근 수준은 internal로 둔다. TripCanvasShared/ 는 프레임워크가 아니라 각 타깃에
/// **소스로** 들어가므로(project.yml) 앱·위젯·확장 안에서 이미 같은 모듈이다.
/// public을 붙이면 Contract.swift의 internal 타입을 시그니처에 드러내 컴파일이 막힌다.
enum SharedStore {
    /// project.yml의 App Group과 같아야 한다.
    static let appGroupId = "group.com.fromj.trip"

    private static let widgetKey = "widget.snapshot.v1"
    private static let activityKey = "liveactivity.state.v1"
    private static let travelModeKey = "travelmode.state.v1"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroupId) }

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()
    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    /// 저장한 값과 저장 시각. 위젯이 "언제 받은 정보인지" 말할 수 있어야 한다(§29).
    struct Stamped<T: Codable>: Codable {
        let value: T
        let savedAt: Date
        init(value: T, savedAt: Date) {
            self.value = value
            self.savedAt = savedAt
        }
    }

    private static func write<T: Codable>(_ value: T, key: String) {
        guard let data = try? encoder.encode(Stamped(value: value, savedAt: Date())) else { return }
        defaults?.set(data, forKey: key)
    }
    private static func read<T: Codable>(_ type: T.Type, key: String) -> Stamped<T>? {
        guard let data = defaults?.data(forKey: key) else { return nil }
        return try? decoder.decode(Stamped<T>.self, from: data)
    }

    static func saveWidgetSnapshot(_ snapshot: WidgetSnapshot) { write(snapshot, key: widgetKey) }
    static func loadWidgetSnapshot() -> Stamped<WidgetSnapshot>? { read(WidgetSnapshot.self, key: widgetKey) }

    static func saveActivityState(_ state: LiveActivityState) { write(state, key: activityKey) }
    static func loadActivityState() -> Stamped<LiveActivityState>? { read(LiveActivityState.self, key: activityKey) }

    static func saveTravelMode(_ state: TravelModeSnapshot) { write(state, key: travelModeKey) }
    static func loadTravelMode() -> Stamped<TravelModeSnapshot>? { read(TravelModeSnapshot.self, key: travelModeKey) }

    static func clear() {
        [widgetKey, activityKey, travelModeKey].forEach { defaults?.removeObject(forKey: $0) }
    }
}

/// Travel Mode의 지속 상태 — 앱이 죽었다 살아나도 이어져야 한다(§9 "진행 상태를 보존한다").
struct TravelModeSnapshot: Codable, Hashable, Sendable {
    enum State: String, Codable, Sendable { case inactive, active, paused }

    var state: State
    var tripId: String?
    var dayIndex: Int?
    var startedAt: Date?
    /// "오늘은 쉬기"를 고른 뒤의 침묵 구간(§36). 이 시각까지는 먼저 제안하지 않는다.
    var suppressUntil: Date?
    /// 마지막으로 잠금화면에 반영한 상태 지문 — 같으면 다시 그리지 않는다(§21).
    var lastStateVersion: String?
    /// 이미 띄운 알림 키 — 같은 상황을 두 번 알리지 않는다(§46).
    var sentNotificationKeys: [String]

    init(state: State = .inactive, tripId: String? = nil, dayIndex: Int? = nil,
                startedAt: Date? = nil, suppressUntil: Date? = nil,
                lastStateVersion: String? = nil, sentNotificationKeys: [String] = []) {
        self.state = state
        self.tripId = tripId
        self.dayIndex = dayIndex
        self.startedAt = startedAt
        self.suppressUntil = suppressUntil
        self.lastStateVersion = lastStateVersion
        self.sentNotificationKeys = sentNotificationKeys
    }

    var isActive: Bool { state == .active }
}
