import Foundation

/// 마지막으로 본 Today·여행 목록·예약을 파일로 남겨 둔다(§28~30).
/// 완전한 offline-first가 아니다 — **읽기만** 살린다. 쓰기는 연결됐을 때만 한다.
///
/// 화면 컴포넌트가 직접 UserDefaults를 만지지 않도록 캐시는 이 한 곳에 모은다(§30).
struct CachedPayload<T: Codable>: Codable {
    let value: T
    let savedAt: Date
    /// 이전 캐시에는 없던 필드라 optional로 읽는다.
    let revision: Int?

    init(value: T, savedAt: Date, revision: Int? = nil) {
        self.value = value; self.savedAt = savedAt; self.revision = revision
    }
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
    private struct CacheIndex: Codable {
        var removedTrips: Set<String> = []
        var revisions: [String: Int] = [:]
        var tripGenerations: [String: Int] = [:]
    }
    private var indexes: [String: CacheIndex] = [:]

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
            indexes[accountDirectory(previous).path] = nil
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

    private func index(_ scope: Scope?) -> CacheIndex {
        let path = accountDirectory(scope).path
        if let known = indexes[path] { return known }
        let saved = (try? Data(contentsOf: url(for: "cache-index", scope: scope)))
            .flatMap { try? decoder.decode(CacheIndex.self, from: $0) } ?? CacheIndex()
        indexes[path] = saved
        return saved
    }

    private func saveIndex(_ value: CacheIndex, scope: Scope?) {
        indexes[accountDirectory(scope).path] = value
        try? FileManager.default.createDirectory(at: accountDirectory(scope), withIntermediateDirectories: true)
        if let data = try? encoder.encode(value) { try? data.write(to: url(for: "cache-index", scope: scope), options: .atomic) }
    }

    /// 문서와 계산이 서로 다른 키여도 같은 여행의 revision은 뒤로 가지 않는다.
    private func identity<T>(_ value: T) -> (id: String, revision: Int)? {
        if let value = value as? TripDetailResponse { return (value.trip.id, value.trip.revision) }
        if let value = value as? TodayResponse { return (value.trip.id, value.trip.revision) }
        if let value = value as? DayPlanResponse { return (value.trip.id, value.trip.revision) }
        if let value = value as? TravelStateResponse { return (value.today.trip.id, value.today.trip.revision) }
        if let value = value as? OfflineTrip { return (value.detail.trip.id, value.detail.trip.revision) }
        return nil
    }

    private func belongs(_ key: String, to id: String) -> Bool {
        if [Self.documentKey(tripId: id), Self.todayKey(tripId: id, dayIndex: nil), Self.bookingsKey(tripId: id),
         Self.coverKey(tripId: id), OfflineTrip.key(id), "travel-state-\(id)"].contains(key)
        { return true }
        return ["today-\(id)-d", "day-plan-\(id)-d"].contains { prefix in
            key.hasPrefix(prefix) && Int(key.dropFirst(prefix.count)) != nil
        }
    }

    func tripGeneration(_ id: String, scope: Scope?) -> Int? {
        guard accepts(scope), !index(scope).removedTrips.contains(id) else { return nil }
        return index(scope).tripGenerations[id] ?? 0
    }

    func acceptsTrip(_ id: String, generation: Int, scope: Scope?) -> Bool {
        tripGeneration(id, scope: scope) == generation
    }

    func visibleTrips(_ trips: [TripSummary], scope: Scope?) -> [TripSummary] {
        guard accepts(scope) else { return [] }
        let removed = index(scope).removedTrips
        return trips.filter { !removed.contains($0.id) }
    }

    /// 서버가 삭제/탈퇴를 확인한 뒤에만 부른다. 표식은 재시작 후에도 남고 늦은 GET도 막는다.
    func removeTrip(_ id: String, scope: Scope?) {
        guard accepts(scope) else { return }
        var state = index(scope)
        state.removedTrips.insert(id)
        state.revisions[id] = nil
        state.tripGenerations[id, default: 0] += 1
        saveIndex(state, scope: scope)
        if let cached = load([TripSummary].self, key: Self.tripsKey, scope: scope) {
            save(cached.value.filter { $0.id != id }, key: Self.tripsKey, scope: scope, savedAt: cached.savedAt)
        }
        let keys = [Self.documentKey(tripId: id), Self.todayKey(tripId: id, dayIndex: nil), Self.bookingsKey(tripId: id),
                    Self.coverKey(tripId: id), OfflineTrip.key(id), "travel-state-\(id)"]
            + (0..<TripLimits.maxDays).flatMap { [Self.todayKey(tripId: id, dayIndex: $0), Self.dayPlanKey(tripId: id, dayIndex: $0)] }
        for key in keys { try? FileManager.default.removeItem(at: url(for: key, scope: scope)) }
    }

    /// 새 초대 수락이 확인돼야 다시 읽을 수 있다. 탈퇴 전에 시작한 요청은 세대가 다르다.
    func restoreTrip(_ id: String, scope: Scope?) {
        guard accepts(scope) else { return }
        var state = index(scope)
        state.removedTrips.remove(id)
        state.tripGenerations[id, default: 0] += 1
        saveIndex(state, scope: scope)
    }

    @discardableResult
    func save<T: Codable>(_ value: T, key: String, scope: Scope? = nil, savedAt: Date = Date(),
                         tripID: String? = nil, tripGeneration: Int? = nil) -> Bool {
        guard accepts(scope) else { return false }
        var state = index(scope)
        guard !state.removedTrips.contains(where: { belongs(key, to: $0) }) else { return false }
        let identity = identity(value)
        if let id = tripID, let tripGeneration {
            guard !state.removedTrips.contains(id), tripGeneration == (state.tripGenerations[id] ?? 0) else { return false }
        }
        if let identity {
            let previous = (try? Data(contentsOf: url(for: key, scope: scope)))
                .flatMap { try? decoder.decode(CachedPayload<T>.self, from: $0) }
                .flatMap { self.identity($0.value)?.revision } ?? -1
            guard !state.removedTrips.contains(identity.id),
                  identity.revision >= max(state.revisions[identity.id] ?? -1, previous) else { return false }
        }
        // 목록 응답은 revision 하나가 없으므로 확인된 삭제 표식을 적용한다.
        let stored = (value as? [TripSummary]).flatMap { visibleTrips($0, scope: scope) as? T } ?? value
        try? FileManager.default.createDirectory(at: accountDirectory(scope), withIntermediateDirectories: true)
        let payload = CachedPayload(value: stored, savedAt: savedAt, revision: identity?.revision)
        guard let data = try? encoder.encode(payload) else { return false }
        do {
            try data.write(to: url(for: key, scope: scope), options: .atomic)
            if let identity {
                state.revisions[identity.id] = identity.revision
                saveIndex(state, scope: scope)
            }
            return true
        }
        catch { return false }
    }

    func load<T: Codable>(_ type: T.Type, key: String, scope: Scope? = nil) -> CachedPayload<T>? {
        guard accepts(scope), !index(scope).removedTrips.contains(where: { belongs(key, to: $0) }),
              let data = try? Data(contentsOf: url(for: key, scope: scope)),
              let cached = try? decoder.decode(CachedPayload<T>.self, from: data) else { return nil }
        if let identity = identity(cached.value), identity.revision < (index(scope).revisions[identity.id] ?? -1) { return nil }
        return cached
    }

    func clear() {
        indexes = [:]
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
