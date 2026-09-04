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
    // extension(TravelStateSource)에서도 쓰므로 private이 아니다.
    let api: APIClient
    let cache: TripCache

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

// MARK: - Travel State · 기기 등록
//
// 여행 중에는 이 하나만 부른다(§57). 여러 endpoint를 연달아 부르는 것이 곧 배터리다.
extension TripService: TravelStateSource {
    func travelState(tripId: String, location: GeoPoint?, locationUpdatedAt: String?,
                     travelMode: Bool, suppressUntil: String?, markSent: Bool) async throws -> TravelStateResponse {
        var query: [URLQueryItem] = []
        if let location {
            // 위치는 이번 계산에만 쓰인다 — 서버가 저장하지 않는다(§55).
            query.append(URLQueryItem(name: "lat", value: String(location.lat)))
            query.append(URLQueryItem(name: "lng", value: String(location.lng)))
            if let locationUpdatedAt { query.append(URLQueryItem(name: "locUpdatedAt", value: locationUpdatedAt)) }
        }
        if travelMode { query.append(URLQueryItem(name: "travelMode", value: "1")) }
        if let suppressUntil { query.append(URLQueryItem(name: "suppressUntil", value: suppressUntil)) }
        if markSent { query.append(URLQueryItem(name: "markSent", value: "1")) }

        let key = "travel-state-\(tripId)"
        do {
            let response: TravelStateResponse = try await api.get("/api/v1/trips/\(tripId)/travel-state", query: query)
            await cache.save(response, key: key)
            return response
        } catch let error as APIError where error.isOffline {
            // 오프라인이어도 잠금화면·위젯이 비지 않게 마지막 상태를 돌려준다(§58·§59).
            guard let cached = await cache.load(TravelStateResponse.self, key: key) else { throw error }
            return cached.value
        }
    }

    /// 로그인한 기기를 등록한다. 토큰이 바뀌면 다시 부르면 되고, 같은 기기는 한 행으로 유지된다(§45).
    func registerDevice(deviceId: String, pushToken: String, preferences: [String: Bool], appVersion: String?) async throws {
        struct Ack: Codable { let registered: Bool }
        let _: Ack = try await api.post("/api/v1/devices", body: [
            "deviceId": deviceId, "platform": "ios", "pushToken": pushToken,
            "enabled": true, "preferences": preferences, "appVersion": appVersion ?? ""
        ])
    }

    /// 로그아웃 시 반드시 부른다 — 남의 기기로 알림이 가면 안 된다.
    func unregisterDevice(deviceId: String) async throws {
        struct Ack: Codable { let registered: Bool }
        let _: Ack = try await api.delete("/api/v1/devices", query: [URLQueryItem(name: "deviceId", value: deviceId)])
    }
}

// MARK: - 여행 문서 (편집)

/// 편집 화면이 쓰는 계약. 테스트에서 가짜로 갈아끼울 수 있게 따로 둔다.
@MainActor
protocol TripDocumentSource {
    func document(tripId: String) async throws -> TripDocumentSnapshot
    func saveDocument(tripId: String, document: TripDocument, expectedRevision: Int) async throws -> TripDocumentSnapshot
}

/// 문서와 그 문서를 읽은 시점의 revision. 저장은 이 revision을 그대로 되돌려 준다(CAS).
struct TripDocumentSnapshot: Sendable {
    let document: TripDocument
    let revision: Int
    let role: MemberRole

    var canEdit: Bool { role.canEdit }
}

extension TripService: TripDocumentSource {
    /// 여행 문서 전체 + revision + 내 역할.
    ///
    /// 캐시로 떨어지지 않는다 — 편집은 최신 revision을 알아야 하고, 오래된 문서 위에서 고치면
    /// 저장할 때 전부 충돌로 돌아온다. 오프라인이면 그냥 오프라인이라고 말한다.
    func document(tripId: String) async throws -> TripDocumentSnapshot {
        let response: TripDetailResponse = try await api.get("/api/v1/trips/\(tripId)")
        return TripDocumentSnapshot(
            document: TripDocument(raw: response.document),
            revision: response.trip.revision,
            role: response.trip.role ?? .owner)
    }

    /// revision CAS 저장. 다른 기기가 먼저 바꿨으면 `APIError.revisionConflict`가 나온다 —
    /// 화면은 그때 최신을 다시 읽어 사용자에게 물어야 한다. 조용히 덮어쓰지 않는다(§91).
    @discardableResult
    func saveDocument(tripId: String, document: TripDocument, expectedRevision: Int) async throws -> TripDocumentSnapshot {
        let body: [String: JSONValue] = [
            "trip": .object(document.raw),
            "expectedRevision": .number(expectedRevision)
        ]
        let response: TripDetailResponse = try await api.put(
            "/api/v1/trips/\(tripId)", jsonBody: try JSONValue.data(from: body))
        return TripDocumentSnapshot(
            document: TripDocument(raw: response.document),
            revision: response.trip.revision,
            role: response.trip.role ?? .owner)
    }
}
