import Foundation

/// 마지막으로 본 Today·여행 목록·예약을 파일로 남겨 둔다(§28~30).
/// 완전한 offline-first가 아니다 — **읽기만** 살린다. 쓰기는 연결됐을 때만 한다.
///
/// 화면 컴포넌트가 직접 UserDefaults를 만지지 않도록 캐시는 이 한 곳에 모은다(§30).
struct CachedPayload<T: Codable>: Codable {
    let value: T
    let savedAt: Date
}

actor TripCache {
    struct Scope: Equatable, Sendable {
        let accountID: String?
        let generation: Int
    }
    private var activeScope: Scope?

    private let directory: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(directory: URL? = nil, scope: Scope? = nil) {
        activeScope = scope
        let base = directory ?? FileManager.default
            .urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("TripCanvas", isDirectory: true)
        self.directory = base
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
    }

    /// 모든 요청은 시작할 때의 계정 세대를 들고 온다. 이전 계정 응답은 다시 활성화할 수 없다.
    func activate(_ scope: Scope?) {
        guard let scope, scope.generation > (activeScope?.generation ?? -1) else { return }
        if let previous = activeScope, previous.accountID != nil {
            try? FileManager.default.removeItem(at: accountDirectory(previous))
        }
        activeScope = scope
    }

    private func accountDirectory(_ scope: Scope?) -> URL {
        guard let id = scope?.accountID else { return directory }
        let encoded = id.utf8.map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent("account-" + encoded, isDirectory: true)
    }

    private func accepts(_ scope: Scope?) -> Bool {
        scope == activeScope && (scope == nil || scope?.accountID != nil)
    }

    private func url(for key: String, scope: Scope?) -> URL {
        // 여행 id는 uid() 형식(영숫자·-·_)이지만 방어적으로 파일명을 정리한다.
        let safe = key.replacingOccurrences(of: "[^A-Za-z0-9_.-]", with: "_", options: .regularExpression)
        return accountDirectory(scope).appendingPathComponent("\(safe).json")
    }

    func save<T: Codable>(_ value: T, key: String, scope: Scope? = nil, savedAt: Date = Date()) {
        guard accepts(scope) else { return }
        try? FileManager.default.createDirectory(at: accountDirectory(scope), withIntermediateDirectories: true)
        let payload = CachedPayload(value: value, savedAt: savedAt)
        guard let data = try? encoder.encode(payload) else { return }
        try? data.write(to: url(for: key, scope: scope), options: .atomic)
    }

    func load<T: Codable>(_ type: T.Type, key: String, scope: Scope? = nil) -> CachedPayload<T>? {
        guard accepts(scope), let data = try? Data(contentsOf: url(for: key, scope: scope)) else { return nil }
        return try? decoder.decode(CachedPayload<T>.self, from: data)
    }

    func clear() {
        try? FileManager.default.removeItem(at: directory)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    static func todayKey(tripId: String, dayIndex: Int?) -> String {
        dayIndex.map { "today-\(tripId)-d\($0)" } ?? "today-\(tripId)"
    }
    static func dayPlanKey(tripId: String, dayIndex: Int) -> String { "day-plan-\(tripId)-d\(dayIndex)" }
    static func documentKey(tripId: String) -> String { "document-\(tripId)" }
    static let tripsKey = "trips"
    static func bookingsKey(tripId: String) -> String { "bookings-\(tripId)" }
    /// 여행 표지. 원본은 서버(`trip_covers`)이고 여기 것은 **먼저 그리기용 사본**이다.
    static func coverKey(tripId: String) -> String { "cover-\(tripId)" }
}
