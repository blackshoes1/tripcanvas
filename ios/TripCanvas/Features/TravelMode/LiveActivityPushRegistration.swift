import Foundation
import Observation

struct LiveActivityPushRegistrationRequest: Equatable, Sendable {
    let deviceId: String
    let activityId: String
    let tripId: String
    let pushToken: String
    let environment: String
    let startedAtISO: String
    let tokenRevision: Int
}

@MainActor
protocol LiveActivityPushSource {
    var liveActivityRegistrationScope: TripCache.Scope? { get }
    func registerLiveActivity(_ request: LiveActivityPushRegistrationRequest) async throws
    func unregisterLiveActivity(deviceId: String, activityId: String) async throws
}

/// 토큰은 활동마다 다르다. 회전 중의 늦은 응답과 계정 변경을 현재 연결 상태로 받아들이지 않는다.
@Observable @MainActor
final class LiveActivityPushRegistration {
    private(set) var error: String?
    private(set) var isRegistered = false
    private(set) var isRegistering = false
    private let source: LiveActivityPushSource
    private let defaults: UserDefaults
    private var active: LiveActivityPushRegistrationRequest?
    private var activeScope: TripCache.Scope?
    private var generation = 0

    init(source: LiveActivityPushSource, defaults: UserDefaults = .standard) {
        self.source = source; self.defaults = defaults
    }

    func register(deviceId: String, activityId: String, tripId: String, token: String,
                  environment: String, startedAt: Date) async {
        guard let scope = source.liveActivityRegistrationScope, scope.accountID != nil else { return }
        let started = ISO8601DateFormatter.tripCanvas.string(from: startedAt)
        let unchanged = active.map {
            $0.deviceId == deviceId && $0.activityId == activityId && $0.tripId == tripId
                && $0.pushToken == token && $0.environment == environment && $0.startedAtISO == started
        } == true && activeScope == scope
        if unchanged, isRegistered || isRegistering { return }
        if !unchanged {
            let key = "withj.liveActivity.tokenRevision.v1"
            let revision = max(Int(Date().timeIntervalSince1970 * 1000), defaults.integer(forKey: key) + 1)
            defaults.set(revision, forKey: key)
            active = .init(deviceId: deviceId, activityId: activityId, tripId: tripId, pushToken: token,
                           environment: environment, startedAtISO: started, tokenRevision: revision)
            activeScope = scope
        }
        guard let registration = active else { return }
        generation += 1
        let request = generation
        error = nil; isRegistered = false; isRegistering = true
        defer { if generation == request { isRegistering = false } }
        do {
            try await source.registerLiveActivity(registration)
            guard request == generation, scope == source.liveActivityRegistrationScope else { return }
            isRegistered = true
        } catch {
            guard request == generation, scope == source.liveActivityRegistrationScope else { return }
            self.error = error.localizedDescription
        }
    }

    func remove(deviceId: String, activityId: String, scope: TripCache.Scope?) async {
        if active?.activityId == activityId, active?.deviceId == deviceId, activeScope == scope { reset() }
        guard let scope, scope.accountID != nil, scope == source.liveActivityRegistrationScope else { return }
        // 서버는 종료 표시를 남긴다. 이 요청보다 늦게 도착한 등록으로 안내가 되살아나지 않는다.
        try? await source.unregisterLiveActivity(deviceId: deviceId, activityId: activityId)
    }

    func reset() {
        generation += 1; active = nil; activeScope = nil
        error = nil; isRegistered = false; isRegistering = false
    }
}

extension TripService: LiveActivityPushSource {
    var liveActivityRegistrationScope: TripCache.Scope? { cacheScope }

    func registerLiveActivity(_ registration: LiveActivityPushRegistrationRequest) async throws {
        let request = try await tripRequest(registration.tripId)
        let client = try await liveActivityAPI(scope: request.scope)
        struct Registered: Decodable { let registered: Bool; let expiresAtISO: String }
        let result: Registered = try await client.post("/api/v1/live-activities", body: [
            "deviceId": registration.deviceId, "activityId": registration.activityId,
            "tripId": registration.tripId, "pushToken": registration.pushToken,
            "environment": registration.environment, "startedAtISO": registration.startedAtISO,
            "tokenRevision": registration.tokenRevision
        ])
        try await checkTripRequest(registration.tripId, request)
        guard result.registered else { throw APIError.stale("잠금화면 자동 갱신을 연결하지 못했어요.") }
    }

    func unregisterLiveActivity(deviceId: String, activityId: String) async throws {
        let scope = cacheScope
        let client = try await liveActivityAPI(scope: scope)
        struct Removed: Decodable { let removed: Bool }
        let _: Removed = try await client.delete("/api/v1/live-activities", query: [
            URLQueryItem(name: "deviceId", value: deviceId), URLQueryItem(name: "activityId", value: activityId)
        ])
        guard scope == cacheScope else { throw APIError.unauthorized }
    }

    private func liveActivityAPI(scope: TripCache.Scope?) async throws -> APIClient {
        let token = try await api.tokens.accessToken()
        guard scope?.accountID != nil, scope == cacheScope else { throw APIError.unauthorized }
        return APIClient(baseURL: api.baseURL, tokens: LiveActivityRegistrationToken(token: token), session: api.session)
    }
}

/// 계정이 바뀌어도 이전 활동의 요청을 새 로그인으로 재전송하지 않는다.
@MainActor private struct LiveActivityRegistrationToken: TokenProviding {
    let token: String
    func accessToken() async throws -> String { token }
    func refreshToken() async throws -> String { throw APIError.unauthorized }
}
