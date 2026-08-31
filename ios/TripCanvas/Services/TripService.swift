import Foundation

/// API 호출을 화면에서 감춘다. 화면은 "무엇을 원하는지"만 말하고 경로·본문은 여기서 만든다.
///
/// 오프라인이면 캐시로 떨어진다 — 마지막으로 본 Today는 계속 볼 수 있어야 한다(§28).
/// 쓰기(완료·건너뛰기·수락)는 캐시로 대신하지 않는다: 서버가 받았는지 확인되지 않은 변경을
/// 반영된 것처럼 보여주면 웹과 어긋난다.
/// 화면(ViewModel)이 의존하는 계약. 테스트에서 가짜로 갈아끼울 수 있게 프로토콜로 둔다.
@MainActor
protocol TripDataSource {
    func trips() async throws -> TripService.Fetched<[TripSummary]>
    func today(tripId: String, dayIndex: Int?) async throws -> TripService.Fetched<TodayResponse>
    func bookings(tripId: String) async throws -> TripService.Fetched<[BookingSummary]>
    func setActivity(tripId: String, activityId: String, action: TripService.ActivityAction, expectedRevision: Int, expectedName: String?) async throws -> MutationResponse
    func decideSuggestion(tripId: String, suggestionId: String, decision: TripService.SuggestionDecision, expectedRevision: Int) async throws -> MutationResponse
}

@MainActor
final class TripService: TripDataSource {
    private let api: APIClient
    private let cache: TripCache

    init(api: APIClient, cache: TripCache) {
        self.api = api
        self.cache = cache
    }

    struct Fetched<T: Codable> {
        let value: T
        /// 캐시에서 꺼낸 것이면 언제 받아온 것인지. nil이면 방금 서버에서 온 값이다.
        let cachedAt: Date?
        var isStale: Bool { cachedAt != nil }
    }

    // MARK: 조회

    func trips() async throws -> Fetched<[TripSummary]> {
        do {
            let response: TripListResponse = try await api.get("/api/v1/trips")
            await cache.save(response.trips, key: TripCache.tripsKey)
            return Fetched(value: response.trips, cachedAt: nil)
        } catch let error as APIError where error.isOffline {
            guard let cached = await cache.load([TripSummary].self, key: TripCache.tripsKey) else { throw error }
            return Fetched(value: cached.value, cachedAt: cached.savedAt)
        }
    }

    func today(tripId: String, dayIndex: Int? = nil) async throws -> Fetched<TodayResponse> {
        var query: [URLQueryItem] = []
        if let dayIndex { query.append(URLQueryItem(name: "day", value: String(dayIndex))) }
        let key = TripCache.todayKey(tripId: tripId, dayIndex: dayIndex)
        do {
            let response: TodayResponse = try await api.get("/api/v1/trips/\(tripId)/today", query: query)
            await cache.save(response, key: key)
            return Fetched(value: response, cachedAt: nil)
        } catch let error as APIError where error.isOffline {
            guard let cached = await cache.load(TodayResponse.self, key: key) else { throw error }
            return Fetched(value: cached.value, cachedAt: cached.savedAt)
        }
    }

    func bookings(tripId: String) async throws -> Fetched<[BookingSummary]> {
        let key = TripCache.bookingsKey(tripId: tripId)
        do {
            let response: BookingListResponse = try await api.get("/api/v1/trips/\(tripId)/bookings")
            await cache.save(response.bookings, key: key)
            return Fetched(value: response.bookings, cachedAt: nil)
        } catch let error as APIError where error.isOffline {
            guard let cached = await cache.load([BookingSummary].self, key: key) else { throw error }
            return Fetched(value: cached.value, cachedAt: cached.savedAt)
        }
    }

    // MARK: 변경 — 응답에 바뀐 뒤의 Today가 함께 온다(왕복 한 번)

    enum ActivityAction: String { case complete, skip, reset }

    func setActivity(tripId: String, activityId: String, action: ActivityAction, expectedRevision: Int, expectedName: String?) async throws -> MutationResponse {
        var body: [String: Any] = ["expectedRevision": expectedRevision]
        if let expectedName { body["expectedName"] = expectedName }
        let response: MutationResponse = try await api.post(
            "/api/v1/trips/\(tripId)/activities/\(activityId)/\(action.rawValue)", body: body)
        await cache.save(response.today, key: TripCache.todayKey(tripId: tripId, dayIndex: nil))
        return response
    }

    enum SuggestionDecision: String { case accept, skip }

    func decideSuggestion(tripId: String, suggestionId: String, decision: SuggestionDecision, expectedRevision: Int) async throws -> MutationResponse {
        let response: MutationResponse = try await api.post(
            "/api/v1/trips/\(tripId)/suggestions/\(decision.rawValue)",
            body: ["suggestionId": suggestionId, "expectedRevision": expectedRevision])
        await cache.save(response.today, key: TripCache.todayKey(tripId: tripId, dayIndex: nil))
        return response
    }

    func replanPreview(tripId: String) async throws -> ReplanPreview {
        struct Envelope: Codable { let schemaVersion: Int; let replan: ReplanPreview; let today: TodayResponse }
        let response: Envelope = try await api.post("/api/v1/trips/\(tripId)/replan-preview")
        return response.replan
    }
}
