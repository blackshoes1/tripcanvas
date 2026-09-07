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
    func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse>
    func bookings(tripId: String) async throws -> TripService.Fetched<[BookingSummary]>
    func setActivity(tripId: String, activityId: String, action: TripService.ActivityAction, expectedRevision: Int, expectedName: String?) async throws -> MutationResponse
    func decideSuggestion(tripId: String, suggestionId: String, decision: TripService.SuggestionDecision, expectedRevision: Int) async throws -> MutationResponse
    /// 여행을 지운다(tombstone). **주최자만** — 서버도 그렇게 막는다.
    /// 여행을 만든다. 서버가 id를 정하고 만든 여행을 돌려준다 — 웹과 **같은 경로**(POST /api/v1/trips)다.
    func createTrip(_ draft: NewTripDraft) async throws -> TripSummary
    /// 붙여넣은 글을 초안으로 읽는다. **서버가 읽는다** — 파서를 앱에 복제하지 않는다.
    func parseItinerary(text: String) async throws -> ItineraryDraft
    /// 초안에서 고른 것만으로 여행을 만든다. 만들기와 채우기를 한 번에 보낸다.
    func createTrip(document: [String: JSONValue]) async throws -> TripSummary
    func deleteTrip(tripId: String, expectedRevision: Int) async throws
    /// 공유받은 여행에서 나간다. 여행 자체는 남는다.
    func leaveTrip(tripId: String) async throws
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

    /// 실시간 주소는 잘 바뀌지 않는다 — 한 번 물어보고 들고 있는다.
    /// 못 물어보면 nil이고, 그러면 실시간 없이 폴백(당겨서 새로고침)으로 간다.
    private var realtimeURL: URL??
    func cachedRealtimeURL() async -> URL? {
        if let cached = realtimeURL { return cached }
        let resolved = (try? await realtimeChoice())?.socketURL
        realtimeURL = .some(resolved)
        return resolved
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

    /// 일정 화면이 쓰는 하루치. 계산은 전부 서버가 한다 — 앱은 그린다.
    /// 오프라인이면 마지막으로 받은 것을 언제 받았는지와 함께 돌려준다(§29).
    func dayPlan(tripId: String, dayIndex: Int) async throws -> Fetched<DayPlanResponse> {
        let key = TripCache.dayPlanKey(tripId: tripId, dayIndex: dayIndex)
        do {
            let response: DayPlanResponse = try await api.get("/api/v1/trips/\(tripId)/days/\(dayIndex)")
            await cache.save(response, key: key)
            return Fetched(value: response, cachedAt: nil)
        } catch let error as APIError where error.isOffline {
            guard let cached = await cache.load(DayPlanResponse.self, key: key) else { throw error }
            return Fetched(value: cached.value, cachedAt: cached.savedAt)
        }
    }

    /// 여행 만들기. 문서는 **빈 일자 N개**뿐이다 — 우리가 모르는 필드를 지어내지 않고,
    /// 기본값은 서버의 `normalizeTrip`이 채운다(웹에서 만든 여행과 같은 모양이 된다).
    ///
    /// ⚠️ 낙관적으로 목록에 먼저 넣지 않는다. 여행의 id는 **서버가 정한다** —
    /// 가짜 id로 줄을 만들면 그 줄을 눌렀을 때 열 것이 없다.
    func createTrip(_ draft: NewTripDraft) async throws -> TripSummary {
        let days = (0..<draft.dayCount).map { _ in JSONValue.object(["title": .string(""), "spots": .array([])]) }
        let document: [String: JSONValue] = [
            "name": .string(draft.name),
            "start": .string(draft.start),
            "days": .array(days)
        ]
        let body = try JSONEncoder().encode(["trip": JSONValue.object(document)])
        let response: TripDetailResponse = try await api.post("/api/v1/trips", jsonBody: body)
        return response.trip
    }

    /// 붙여넣은 글 → 초안. 규칙은 서버의 `intake.js` 하나다(§엔진은 하나다).
    /// **아무것도 저장되지 않는다** — 담을 것을 고른 뒤 `createTrip(document:)`으로 만든다.
    func parseItinerary(text: String) async throws -> ItineraryDraft {
        let year = Calendar.current.component(.year, from: Date())
        let response: ItineraryParseResponse = try await api.post(
            "/api/v1/itineraries/parse", body: ["text": text, "year": year])
        return response.draft
    }

    /// 이미 만들어 둔 문서로 여행을 만든다(붙여넣기가 쓴다). 만들기와 장소 채우기가 한 번의 왕복이다.
    func createTrip(document: [String: JSONValue]) async throws -> TripSummary {
        let body = try JSONEncoder().encode(["trip": JSONValue.object(document)])
        let response: TripDetailResponse = try await api.post("/api/v1/trips", jsonBody: body)
        return response.trip
    }

    /// tombstone. `expectedRevision`이 어긋나면 서버가 409로 막는다 —
    /// 다른 기기가 먼저 바꾼 여행을 조용히 지우지 않기 위해서다.
    func deleteTrip(tripId: String, expectedRevision: Int) async throws {
        let _: OkResponse = try await api.delete(
            "/api/v1/trips/\(tripId)",
            query: [URLQueryItem(name: "expectedRevision", value: String(expectedRevision))])
    }

    /// 나가기는 삭제가 아니다 — 여행은 남고 내 목록에서만 사라진다.
    func leaveTrip(tripId: String) async throws {
        try await leave(tripId: tripId)
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
/// 멤버 이름표만 필요한 화면을 위한 좁은 창구. 일정 화면이 함께하기 전체를 알 필요는 없다.
protocol MemberListing {
    func members(tripId: String) async throws -> [MemberView]
}

protocol TripDocumentSource {
    func document(tripId: String) async throws -> TripDocumentSnapshot
    func saveDocument(tripId: String, document: TripDocument, expectedRevision: Int) async throws -> TripDocumentSnapshot
    /// 그 날의 계산(예상 도착·구간·합계)과 일자 스트립. **계산은 서버가 한다** — 앱은 그린다.
    func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse>
}

/// 새 여행에 필요한 최소한 — **어디로·언제·며칠**. 그 이상은 만든 뒤에 고치면 되는 것들이다.
///
/// ⚠️ `city`는 이름의 기본값과 장소 검색을 좁히는 데만 쓴다 — **문서에 저장하지 않는다.**
/// 여행 문서에 우리만 아는 필드를 새로 만들면 웹이 모르는 값이 생긴다.
struct NewTripDraft: Sendable, Equatable {
    var name: String = ""
    var start: String = ""
    var dayCount: Int = 3
    var city: String? = nil

    /// 앱에서 한 번에 만들 수 있는 최대 일수. 더 긴 여행은 만든 뒤 웹에서 늘린다.
    static let maxDays = 30

    var isValid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && start.count == 10
            && (1...Self.maxDays).contains(dayCount)
    }
}

/// 문서와 그 문서를 읽은 시점의 revision. 저장은 이 revision을 그대로 되돌려 준다(CAS).
struct TripDocumentSnapshot: Sendable {
    let document: TripDocument
    let revision: Int
    let role: MemberRole

    var canEdit: Bool { role.canEdit }
}

extension TripService: MemberListing {}

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
