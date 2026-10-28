#if DEBUG
import SwiftUI

/// 실제 목록→여행→일정 라우팅을 합성 응답으로 검증한다. 운영 API와 Keychain을 쓰지 않는다.
@MainActor struct LiveActivityLinkReviewHarness: View {
    @State private var environment: AppEnvironment

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ActivityLinkReviewProtocol.self]
        let service = TripService(api: APIClient(baseURL: URL(string: "https://activity-link.invalid")!,
            tokens: ActivityLinkReviewTokens(), session: URLSession(configuration: config)),
            cache: TripCache(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)))
        let environment = AppEnvironment(auth: AuthStore(client: ActivityLinkReviewAuth(), store: ActivityLinkReviewSession()),
                                         service: service, handlesSystemNotifications: false)
        if ProcessInfo.processInfo.arguments.contains("--review-activity-link-cold") {
            environment.router.open(.activity(tripId: "link-review",
                target: .init(dayIndex: 1, activityId: "d1s1", revision: 7)))
        }
        _environment = State(initialValue: environment)
    }

    var body: some View {
        TripListView()
            .environment(environment)
            .onOpenURL { environment.router.open(url: $0) }
    }
}

@MainActor private struct ActivityLinkReviewTokens: TokenProviding {
    func accessToken() async throws -> String { "synthetic-token" }
    func refreshToken() async throws -> String { "synthetic-token" }
}
private struct ActivityLinkReviewSession: SessionStoring {
    func loadSession() -> AuthSession? { nil }
    func saveSession(_ session: AuthSession) {}
    func removeSession() {}
    func takeLegacySession() -> Bool { false }
}
private struct ActivityLinkReviewAuth: AuthClient {
    func signIn(email: String, password: String) async throws -> AuthSession { throw AuthError.network }
    func signUp(email: String, password: String) async throws -> SignUpResult { throw AuthError.network }
    func session(token: String) async throws -> AuthSession? { throw AuthError.network }
    func signOut(token: String) async {}
    func requestPasswordReset(email: String) async throws { throw AuthError.network }
}

private final class ActivityLinkReviewProtocol: URLProtocol {
    private var workTask: Task<Void, Never>?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        workTask = Task { @MainActor in
            // 목록보다 먼저 들어온 콜드 스타트 목적지가 사라지지 않는지 본다.
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            let stale = ProcessInfo.processInfo.arguments.contains("--review-activity-link-stale")
            let trip = TripSummary(id: "link-review", name: "합성 링크 여행", start: "2026-10-28", dayCount: 2,
                revision: stale ? 8 : 7, updatedAt: "", timeZone: "Asia/Seoul", cities: [],
                todayIndex: -1, daysUntilStart: 7, role: .viewer, memberCount: 1)
            let document: [String: JSONValue] = ["name": .string(trip.name), "start": .string(trip.start), "days": .array([
                .object(["title": .string("첫째 날"), "spots": .array([.object(TripSpot(name: "첫날 표시한 곳").raw)])]),
                .object(["title": .string("둘째 날"), "spots": .array([
                    .object(TripSpot(name: "다른 곳").raw), .object(TripSpot(name: "잠금화면에 표시한 곳").raw)])])
            ])]
            let path = request.url?.path ?? ""
            let data: Data?
            if path == "/api/v1/trips" {
                data = try? JSONEncoder().encode(TripListResponse(schemaVersion: 1, trips: [trip]))
            } else if path == "/api/v1/trips/link-review" {
                data = try? JSONEncoder().encode(TripDetailResponse(trip: trip, document: document))
            } else { data = nil }
            guard let url = request.url else { return }
            let response = HTTPURLResponse(url: url, statusCode: data == nil ? 503 : 200, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data ?? Data(#"{"message":"합성 계산 미연결"}"#.utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() { workTask?.cancel() }
}
#endif
