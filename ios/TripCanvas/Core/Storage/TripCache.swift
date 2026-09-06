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
    private let directory: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(directory: URL? = nil) {
        let base = directory ?? FileManager.default
            .urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("TripCanvas", isDirectory: true)
        self.directory = base
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
    }

    private func url(for key: String) -> URL {
        // 여행 id는 uid() 형식(영숫자·-·_)이지만 방어적으로 파일명을 정리한다.
        let safe = key.replacingOccurrences(of: "[^A-Za-z0-9_.-]", with: "_", options: .regularExpression)
        return directory.appendingPathComponent("\(safe).json")
    }

    func save<T: Codable>(_ value: T, key: String) {
        let payload = CachedPayload(value: value, savedAt: Date())
        guard let data = try? encoder.encode(payload) else { return }
        try? data.write(to: url(for: key), options: .atomic)
    }

    func load<T: Codable>(_ type: T.Type, key: String) -> CachedPayload<T>? {
        guard let data = try? Data(contentsOf: url(for: key)) else { return nil }
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
    static let tripsKey = "trips"
    static func bookingsKey(tripId: String) -> String { "bookings-\(tripId)" }
}
