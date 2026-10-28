#if DEBUG
import SwiftUI
import Observation

/// 현재 카드부터 저장까지 실제 화면을 사용한다. 문서·검색·미리보기·CAS는 합성 HTTP 응답이다.
@MainActor struct TodayPlaceChangeReviewHarness: View {
    @State private var source = TodayPlaceReviewServer()
    @State private var environment: AppEnvironment?
    @State private var model: TodayViewModel?
    @State private var openedActivity = ""

    var body: some View {
        Group {
            if let environment, let model {
                NavigationStack {
                    TodayView(trip: source.trip, model: model, onOpenPlan: { openedActivity = "전체 일정" },
                              onOpenActivity: { day, activity in openedActivity = "Day \(day + 1) · \(activity.name)" },
                              onOpenPlanDay: { day in openedActivity = "Day \(day + 1) 목록" })
                        .safeAreaInset(edge: .bottom) {
                            VStack {
                                Text(source.summary).font(.caption2).accessibilityIdentifier("placeReviewServerState")
                                if !openedActivity.isEmpty {
                                    Text(openedActivity).accessibilityIdentifier("placeReviewOpenedActivity")
                                }
                            }
                        }
                }.environment(environment)
            } else { ProgressView() }
        }
        .task {
            guard environment == nil else { return }
            TodayPlaceReviewProtocol.server = source
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [TodayPlaceReviewProtocol.self]
            let api = APIClient(baseURL: URL(string: "https://place-change.invalid")!, tokens: TodayPlaceReviewTokens(),
                                session: URLSession(configuration: config))
            let cache = TripCache(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
            let service = TripService(api: api, cache: cache)
            if source.offline, let today = try? source.today() {
                _ = await cache.save(today, key: TripCache.todayKey(tripId: source.trip.id, dayIndex: nil))
            }
            let places = PlaceSearchService(api: api, googleKey: "", bundleId: "com.fromj.trip")
            environment = AppEnvironment(auth: AuthStore(client: TodayPlaceReviewAuth(), store: TodayPlaceReviewSession()),
                                         service: service, places: places, handlesSystemNotifications: false)
            model = TodayViewModel(trip: source.trip, service: service)
        }
    }
}

@Observable @MainActor private final class TodayPlaceReviewServer {
    private(set) var revision = 7
    private(set) var saves = 0
    private(set) var previews = 0
    private(set) var attempts = 0
    private(set) var document: TripDocument
    let original: TripDocument
    let offline = ProcessInfo.processInfo.arguments.contains("--review-place-offline")
    private let viewer = ProcessInfo.processInfo.arguments.contains("--review-place-viewer")
    private let conflict = ProcessInfo.processInfo.arguments.contains("--review-place-conflict")

    init() {
        var spot = TripSpot(name: "현재 미술관", city: "서울")
        spot.point = .init(lat: 37.55, lng: 126.98)
        spot.arriveAt = "14:00"; spot.stayMinutes = 60; spot.bookedAt = "14:00"; spot.cost = 1000
        spot.setField("futurePlace", .string("원문 보존"))
        if ProcessInfo.processInfo.arguments.contains("--review-place-selected") {
            spot.choice = .init(alternative: TripSpot(name: "보관한 공원", city: "서울"), state: .selected)
        }
        var next = TripSpot(name: "다음 예약", city: "서울")
        next.bookedAt = "15:00"; next.stayMinutes = 30
        let document = TripDocument(raw: ["id": .string("place-review"), "name": .string("합성 장소 변경"),
            "start": .string("2026-10-28"), "days": .array([
                .object(["title": .string("첫날"), "spots": .array([.object(spot.raw), .object(next.raw)])])])])
        self.document = document; original = document
    }

    var trip: TripSummary {
        .init(id: "place-review", name: "합성 장소 변경", start: "2026-10-28", dayCount: 1, revision: revision,
              updatedAt: "", timeZone: "Asia/Seoul", cities: ["서울"], todayIndex: 0, daysUntilStart: nil,
              role: viewer ? .viewer : .owner, memberCount: 1)
    }
    var summary: String {
        let spot = document.days[0].spots[0]
        return "저장 \(saves)회 · 검토 \(previews)회 · 시도 \(attempts)회 · \(spot.name) · 도착 \(spot.arriveAt ?? "없음") · 보관 \(spot.choice?.alternative.name ?? "없음") · 원문일치 \(document == original)"
    }
    func today() throws -> TodayResponse {
        var raw = try JSONSerialization.jsonObject(with: Data(TodayLiveReviewHarness.fixture.utf8)) as! [String: Any]
        let spot = document.days[0].spots[0]
        raw["generatedAt"] = ISO8601DateFormatter().string(from: Date())
        raw["trip"] = try object(trip)
        var day = raw["day"] as! [String: Any]
        day["date"] = trip.start; day["spotCount"] = 2; raw["day"] = day
        var activity = (raw["activities"] as! [[String: Any]])[0]
        activity["id"] = "d0s0"; activity["name"] = spot.name; activity["city"] = "서울"
        activity["status"] = "IN_PROGRESS"; activity["flexibility"] = "FLEXIBLE"; activity["type"] = "OTHER"
        activity["startMinutes"] = 840; activity["endMinutes"] = 900; activity["stayMinutes"] = 60
        activity["location"] = ["lat": 37.55, "lng": 126.98]
        activity["bookingId"] = NSNull(); activity["bookUrl"] = NSNull()
        raw["activities"] = [activity]; raw["remainingActivities"] = [activity]
        var next = raw["nextAction"] as! [String: Any]
        next["activityId"] = "d0s0"; next["title"] = spot.name; next["status"] = "IN_PROGRESS"
        next["type"] = "OTHER"; next["flexibility"] = "FLEXIBLE"; next["startMinutes"] = 840
        next["stayMinutes"] = 60; next["location"] = NSNull(); next["departure"] = NSNull()
        raw["nextAction"] = next; raw["suggestions"] = []; raw["fixedCommitments"] = []
        return try JSONDecoder().decode(TodayResponse.self, from: JSONSerialization.data(withJSONObject: raw))
    }
    private func plan(_ proposed: TripDocument, after: Bool) throws -> DayPlanResponse {
        let url = Bundle.main.url(forResource: "move-review-day-plan", withExtension: "json")!
        var raw = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        raw["trip"] = try object(trip)
        var day = raw["day"] as! [String: Any]
        let template = (day["spots"] as! [[String: Any]])[0]
        day["index"] = 0
        day["spots"] = proposed.days[0].spots.enumerated().map { index, spot in
            var value = template
            value["index"] = index; value["name"] = spot.name
            value["etaMinutes"] = index == 0 ? 840 : 930
            value["bookedAtMinutes"] = index == 1 ? 900 : NSNull()
            value["bookingLateMinutes"] = after && index == 1 ? 30 : NSNull()
            value["conflict"] = after && index == 1
            return value
        }
        raw["day"] = day
        return try JSONDecoder().decode(DayPlanResponse.self, from: JSONSerialization.data(withJSONObject: raw))
    }
    func respond(_ request: URLRequest) throws -> (Int, Data) {
        let path = request.url?.path ?? ""
        if path.hasSuffix("/today") {
            if offline { throw URLError(.notConnectedToInternet) }
            return (200, try JSONEncoder().encode(today()))
        }
        if path == "/api/v1/places/search" {
            return (200, try JSONEncoder().encode(PlaceSearchResponse(provider: "kakao", places: [
                .init(name: "검색한 공원", address: "합성 주소", city: "서울", lat: 37.56, lng: 126.99,
                      category: nil, provider: "kakao", providerId: "synthetic-place", placeUrl: nil)
            ])))
        }
        if path.hasSuffix("/plan-preview") {
            previews += 1
            let body = try body(request)
            let proposed = TripDocument(raw: body["document"]?.objectValue ?? [:])
            return (200, try JSONEncoder().encode(PlanChangePreview(before: plan(document, after: false), after: plan(proposed, after: true))))
        }
        if path == "/api/v1/trips/place-review" {
            if request.httpMethod == "PUT" {
                attempts += 1
                let body = try body(request)
                if conflict || body["expectedRevision"]?.intValue != revision {
                    return (409, Data(#"{"code":"STALE_VERSION","message":"합성 다른 기기의 변경","revision":8}"#.utf8))
                }
                document = TripDocument(raw: body["trip"]?.objectValue ?? [:])
                revision += 1; saves += 1
            }
            return (200, try JSONEncoder().encode(TripDetailResponse(trip: trip, document: document.raw)))
        }
        return (503, Data(#"{"message":"합성 미연결"}"#.utf8))
    }
    private func object<T: Encodable>(_ value: T) throws -> [String: Any] {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as! [String: Any]
    }
    private func body(_ request: URLRequest) throws -> [String: JSONValue] {
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(contentsOf: buffer.prefix(count))
            }
        }
        return try JSONDecoder().decode(JSONValue.self, from: data).objectValue ?? [:]
    }
}

private final class TodayPlaceReviewProtocol: URLProtocol {
    @MainActor static var server: TodayPlaceReviewServer?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Task { @MainActor in
            do {
                guard let server = Self.server, let url = request.url else { throw URLError(.notConnectedToInternet) }
                let (status, data) = try server.respond(request)
                client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
            } catch { client?.urlProtocol(self, didFailWithError: error) }
        }
    }
    override func stopLoading() {}
}
@MainActor private struct TodayPlaceReviewTokens: TokenProviding {
    func accessToken() async throws -> String { "synthetic-token" }
    func refreshToken() async throws -> String { "synthetic-token" }
}
private struct TodayPlaceReviewSession: SessionStoring {
    func loadSession() -> AuthSession? { nil }
    func saveSession(_ session: AuthSession) {}
    func removeSession() {}
    func takeLegacySession() -> Bool { false }
}
private struct TodayPlaceReviewAuth: AuthClient {
    func signIn(email: String, password: String) async throws -> AuthSession { throw AuthError.network }
    func signUp(email: String, password: String) async throws -> SignUpResult { throw AuthError.network }
    func session(token: String) async throws -> AuthSession? { throw AuthError.network }
    func signOut(token: String) async {}
    func requestPasswordReset(email: String) async throws { throw AuthError.network }
}
#endif
