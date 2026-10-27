import XCTest
@testable import TripCanvas

@MainActor
final class LiveActivityPushRegistrationTests: XCTestCase {
    private let startedAt = Date(timeIntervalSince1970: 1_800_000_000)
    private func defaults() -> UserDefaults {
        let name = "LiveActivityPushRegistrationTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        addTeardownBlock { defaults.removePersistentDomain(forName: name) }
        return defaults
    }
    private func register(_ registration: LiveActivityPushRegistration, token: String = "first", activity: String = "activity") async {
        await registration.register(deviceId: "device", activityId: activity, tripId: "trip", token: token,
                                    environment: "sandbox", startedAt: startedAt)
    }

    func testDuplicatePendingAndConfirmedTokenRegistersOnlyOnce() async throws {
        let source = PushRegistrationSource(), registration = LiveActivityPushRegistration(source: source, defaults: defaults())
        let began = expectation(description: "registration pending")
        var pending: CheckedContinuation<Void, Error>?
        source.onRegister = { _ in try await withCheckedThrowingContinuation { pending = $0; began.fulfill() } }
        let first = Task { await register(registration) }
        await fulfillment(of: [began], timeout: 2)
        await register(registration)
        XCTAssertEqual(source.registrations.count, 1)
        XCTAssertTrue(registration.isRegistering)
        try XCTUnwrap(pending).resume()
        await first.value
        await register(registration)
        XCTAssertEqual(source.registrations.count, 1)
        XCTAssertTrue(registration.isRegistered)
        XCTAssertFalse(registration.isRegistering)
    }

    func testTokenRotationUsesPersistedMonotonicRevisionAndIgnoresLateFailure() async throws {
        let source = PushRegistrationSource(), store = defaults()
        let seed = Int(Date().timeIntervalSince1970 * 1000) + 10_000
        store.set(seed, forKey: "withj.liveActivity.tokenRevision.v1")
        let registration = LiveActivityPushRegistration(source: source, defaults: store)
        let firstBegan = expectation(description: "first token pending"), secondBegan = expectation(description: "rotated token pending")
        var pending: [String: CheckedContinuation<Void, Error>] = [:]
        source.onRegister = { request in
            try await withCheckedThrowingContinuation {
                pending[request.pushToken] = $0
                if request.pushToken == "first" { firstBegan.fulfill() } else { secondBegan.fulfill() }
            }
        }
        let first = Task { await register(registration) }
        await fulfillment(of: [firstBegan], timeout: 2)
        let second = Task { await register(registration, token: "rotated") }
        await fulfillment(of: [secondBegan], timeout: 2)
        XCTAssertEqual(source.registrations.map(\.tokenRevision), [seed + 1, seed + 2])
        try XCTUnwrap(pending["rotated"]).resume(); await second.value
        try XCTUnwrap(pending["first"]).resume(throwing: APIError.offline); await first.value
        XCTAssertTrue(registration.isRegistered)
        XCTAssertNil(registration.error)
        XCTAssertFalse(registration.isRegistering)
        source.onRegister = nil
        let relaunched = LiveActivityPushRegistration(source: source, defaults: store)
        await register(relaunched, token: "next")
        XCTAssertEqual(source.registrations.last?.tokenRevision, seed + 3)
    }

    func testOlderTokenSuccessCannotConfirmTheNewTokenWhileItIsPending() async throws {
        let source = PushRegistrationSource(), registration = LiveActivityPushRegistration(source: source, defaults: defaults())
        let oldBegan = expectation(description: "old token pending"), newBegan = expectation(description: "new token pending")
        var pending: [String: CheckedContinuation<Void, Error>] = [:]
        source.onRegister = { request in
            try await withCheckedThrowingContinuation {
                pending[request.pushToken] = $0
                if request.pushToken == "first" { oldBegan.fulfill() } else { newBegan.fulfill() }
            }
        }
        let old = Task { await register(registration) }
        await fulfillment(of: [oldBegan], timeout: 2)
        let new = Task { await register(registration, token: "rotated") }
        await fulfillment(of: [newBegan], timeout: 2)
        try XCTUnwrap(pending["first"]).resume(); await old.value
        XCTAssertFalse(registration.isRegistered)
        XCTAssertTrue(registration.isRegistering)
        try XCTUnwrap(pending["rotated"]).resume(); await new.value
        XCTAssertTrue(registration.isRegistered)
    }

    func testFailedRegistrationCanRetryTheSameTokenWithoutChangingRevision() async {
        let source = PushRegistrationSource(), registration = LiveActivityPushRegistration(source: source, defaults: defaults())
        source.onRegister = { _ in throw APIError.offline }
        await register(registration)
        XCTAssertEqual(registration.error, APIError.offline.localizedDescription)
        XCTAssertFalse(registration.isRegistered)
        XCTAssertFalse(registration.isRegistering)
        source.onRegister = nil
        await register(registration)
        XCTAssertTrue(registration.isRegistered)
        XCTAssertNil(registration.error)
        XCTAssertEqual(source.registrations.count, 2)
        XCTAssertEqual(source.registrations.first, source.registrations.last)
    }

    func testLogoutAndNewAccountDiscardLateRegistrationCompletion() async throws {
        for fails in [false, true] {
            let source = PushRegistrationSource(), registration = LiveActivityPushRegistration(source: source, defaults: defaults())
            let began = expectation(description: "old account registration pending")
            var pending: CheckedContinuation<Void, Error>?
            source.onRegister = { _ in try await withCheckedThrowingContinuation { pending = $0; began.fulfill() } }
            let first = Task { await register(registration) }
            await fulfillment(of: [began], timeout: 2)
            source.liveActivityRegistrationScope = .init(accountID: nil, generation: 2)
            registration.reset()
            await register(registration, token: "logged-out")
            XCTAssertEqual(source.registrations.count, 1)
            source.liveActivityRegistrationScope = .init(accountID: "account-b", generation: 3)
            source.onRegister = nil
            await register(registration, token: "new-account", activity: "new-activity")
            if fails { try XCTUnwrap(pending).resume(throwing: APIError.offline) }
            else { try XCTUnwrap(pending).resume() }
            await first.value
            XCTAssertTrue(registration.isRegistered)
            XCTAssertNil(registration.error)
            XCTAssertEqual(source.registrations.map(\.pushToken), ["first", "new-account"])
            XCTAssertEqual(source.scopes.map(\.accountID), ["account-a", "account-b"])
        }
    }

    func testScopeChangeWithoutResetDoesNotAcceptOldAcknowledgement() async throws {
        let source = PushRegistrationSource(), registration = LiveActivityPushRegistration(source: source, defaults: defaults())
        let began = expectation(description: "old scope registration pending")
        var pending: CheckedContinuation<Void, Error>?
        source.onRegister = { _ in try await withCheckedThrowingContinuation { pending = $0; began.fulfill() } }
        let first = Task { await register(registration) }
        await fulfillment(of: [began], timeout: 2)
        source.liveActivityRegistrationScope = .init(accountID: "account-b", generation: 2)
        try XCTUnwrap(pending).resume(); await first.value
        XCTAssertFalse(registration.isRegistered)
        XCTAssertFalse(registration.isRegistering)
        XCTAssertNil(registration.error)
    }

    func testRemoveUsesMatchingScopeAndLatePostCannotRestoreRegistration() async throws {
        let source = PushRegistrationSource(), registration = LiveActivityPushRegistration(source: source, defaults: defaults())
        let scope = source.liveActivityRegistrationScope
        let began = expectation(description: "post pending before delete")
        var pending: CheckedContinuation<Void, Error>?
        source.onRegister = { _ in try await withCheckedThrowingContinuation { pending = $0; began.fulfill() } }
        let first = Task { await register(registration) }
        await fulfillment(of: [began], timeout: 2)
        await registration.remove(deviceId: "device", activityId: "activity", scope: scope)
        XCTAssertEqual(source.removals.map { $0.0 + "/" + $0.1 }, ["device/activity"])
        try XCTUnwrap(pending).resume(); await first.value
        XCTAssertFalse(registration.isRegistered)
        XCTAssertFalse(registration.isRegistering)
        source.liveActivityRegistrationScope = .init(accountID: "account-b", generation: 2)
        await registration.remove(deviceId: "device", activityId: "activity", scope: scope)
        await registration.remove(deviceId: "device", activityId: "activity", scope: nil)
        XCTAssertEqual(source.removals.count, 1, "이전 계정의 종료 요청을 새 계정으로 보내지 않는다")
    }

    func testOldScopeRemovalDoesNotClearNewScopeRegistrationForTheSameActivity() async {
        let source = PushRegistrationSource(), registration = LiveActivityPushRegistration(source: source, defaults: defaults())
        let oldScope = source.liveActivityRegistrationScope
        await register(registration)
        source.liveActivityRegistrationScope = .init(accountID: "account-b", generation: 2)
        await register(registration, token: "new-account")
        XCTAssertTrue(registration.isRegistered)
        await registration.remove(deviceId: "device", activityId: "activity", scope: oldScope)
        XCTAssertTrue(registration.isRegistered, "늦은 이전 계정 종료는 새 계정의 연결 상태를 지우지 않는다")
        XCTAssertTrue(source.removals.isEmpty)
    }

    private func transport() -> (TripService, PushRegistrationTokens, URLSession, TripCache) {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [PushRegistrationProtocol.self]
        let session = URLSession(configuration: config), tokens = PushRegistrationTokens()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let scope = TripCache.Scope(accountID: "account-a", generation: 1)
        let cache = TripCache(directory: directory, scope: scope)
        let service = TripService(api: APIClient(baseURL: URL(string: "https://push-registration.invalid")!, tokens: tokens, session: session),
                                  cache: cache, cacheScope: scope)
        addTeardownBlock { session.invalidateAndCancel(); try? FileManager.default.removeItem(at: directory) }
        return (service, tokens, session, cache)
    }
    private var request: LiveActivityPushRegistrationRequest {
        .init(deviceId: "device +/한글", activityId: "activity+/=?", tripId: "trip", pushToken: "0123abcd",
              environment: "production", startedAtISO: "2027-01-15T08:00:00Z", tokenRevision: 123456789)
    }

    func testTripServiceEncodesActualPostAndDeleteWithoutPuttingTokenInURL() async throws {
        let (service, _, _, _) = transport()
        defer { PushRegistrationProtocol.handle = nil }
        var requests: [URLRequest] = [], body: [String: JSONValue]?
        PushRegistrationProtocol.handle = { operation in
            requests.append(operation.request)
            if operation.request.httpMethod == "POST" { body = try? operation.body() }
            operation.finish()
        }
        try await service.registerLiveActivity(request)
        try await service.unregisterLiveActivity(deviceId: request.deviceId, activityId: request.activityId)
        XCTAssertEqual(requests.map(\.httpMethod), ["POST", "DELETE"])
        XCTAssertEqual(requests.map { $0.url?.path }, ["/api/v1/live-activities", "/api/v1/live-activities"])
        XCTAssertTrue(requests.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == "Bearer account-a-token" })
        XCTAssertEqual(body, ["deviceId": .string(request.deviceId), "activityId": .string(request.activityId), "tripId": .string("trip"),
                              "pushToken": .string("0123abcd"), "environment": .string("production"),
                              "startedAtISO": .string(request.startedAtISO), "tokenRevision": .number(123456789)])
        XCTAssertNil(requests.first?.url?.query)
        let query = try XCTUnwrap(URLComponents(url: XCTUnwrap(requests.last?.url), resolvingAgainstBaseURL: false)?.queryItems)
        XCTAssertEqual(Dictionary(uniqueKeysWithValues: query.map { ($0.name, $0.value ?? "") }),
                       ["deviceId": request.deviceId, "activityId": request.activityId])
        XCTAssertNil(requests.last?.httpBody)
    }

    func testLateSuccessOr401NeverRetriesOldActivityUsingNewAccountToken() async throws {
        for removing in [false, true] {
            for status in [200, 401] {
                let (service, tokens, _, _) = transport()
                defer { PushRegistrationProtocol.handle = nil }
                let began = expectation(description: "old account transport pending")
                var pending: PushRegistrationProtocol?, requests: [URLRequest] = []
                PushRegistrationProtocol.handle = { operation in pending = operation; requests.append(operation.request); began.fulfill() }
                let work = Task {
                    do {
                        if removing { try await service.unregisterLiveActivity(deviceId: request.deviceId, activityId: request.activityId) }
                        else { try await service.registerLiveActivity(request) }
                        XCTFail("계정이 바뀐 뒤 이전 활동 요청을 성공으로 받아들이면 안 된다")
                    } catch { }
                }
                await fulfillment(of: [began], timeout: 2)
                tokens.token = "account-b-token"; service.useAccount("account-b")
                try XCTUnwrap(pending).finish(status: status)
                await work.value
                XCTAssertEqual(requests.count, 1)
                XCTAssertEqual(requests.first?.value(forHTTPHeaderField: "Authorization"), "Bearer account-a-token")
                XCTAssertEqual(tokens.refreshes, 0)
            }
        }
    }

    func testAccountChangeWhileAcquiringTokenPreventsPostAndDeleteTransport() async throws {
        for removing in [false, true] {
            let (service, tokens, _, _) = transport()
            defer { PushRegistrationProtocol.handle = nil }
            let began = expectation(description: "old scope waiting for token")
            var pending: CheckedContinuation<String, Error>?, requests = 0
            tokens.onAccess = { try await withCheckedThrowingContinuation { pending = $0; began.fulfill() } }
            PushRegistrationProtocol.handle = { operation in requests += 1; operation.finish() }
            let work = Task {
                do {
                    if removing { try await service.unregisterLiveActivity(deviceId: request.deviceId, activityId: request.activityId) }
                    else { try await service.registerLiveActivity(request) }
                    XCTFail("새 계정 토큰을 기다리던 이전 활동에 붙이면 안 된다")
                } catch { }
            }
            await fulfillment(of: [began], timeout: 2)
            service.useAccount("account-b")
            tokens.onAccess = nil
            try XCTUnwrap(pending).resume(returning: "account-b-token")
            await work.value
            XCTAssertEqual(requests, 0)
        }
    }

    func testDeletedTripBlocksRegistrationBeforeAndAfterTransport() async throws {
        let (service, _, _, cache) = transport()
        defer { PushRegistrationProtocol.handle = nil }
        let began = expectation(description: "trip registration pending")
        var pending: PushRegistrationProtocol?, requests = 0
        PushRegistrationProtocol.handle = { operation in pending = operation; requests += 1; began.fulfill() }
        let work = Task {
            do { try await service.registerLiveActivity(request); XCTFail("삭제한 여행의 늦은 등록은 성공이 아니다") }
            catch { }
        }
        await fulfillment(of: [began], timeout: 2)
        await cache.removeTrip("trip", scope: service.cacheScope)
        try XCTUnwrap(pending).finish()
        await work.value
        do { try await service.registerLiveActivity(request); XCTFail("삭제한 여행의 등록을 다시 보내면 안 된다") }
        catch { }
        XCTAssertEqual(requests, 1)
    }
}

@MainActor private final class PushRegistrationSource: LiveActivityPushSource {
    var liveActivityRegistrationScope: TripCache.Scope? = .init(accountID: "account-a", generation: 1)
    var registrations: [LiveActivityPushRegistrationRequest] = []
    var scopes: [TripCache.Scope] = []
    var removals: [(String, String)] = []
    var onRegister: ((LiveActivityPushRegistrationRequest) async throws -> Void)?
    func registerLiveActivity(_ request: LiveActivityPushRegistrationRequest) async throws {
        registrations.append(request)
        if let scope = liveActivityRegistrationScope { scopes.append(scope) }
        try await onRegister?(request)
    }
    func unregisterLiveActivity(deviceId: String, activityId: String) async throws { removals.append((deviceId, activityId)) }
}
@MainActor private final class PushRegistrationTokens: TokenProviding {
    var token = "account-a-token"
    var refreshes = 0
    var onAccess: (() async throws -> String)?
    func accessToken() async throws -> String { try await onAccess?() ?? token }
    func refreshToken() async throws -> String { refreshes += 1; return token }
}
private final class PushRegistrationProtocol: URLProtocol {
    @MainActor static var handle: ((PushRegistrationProtocol) -> Void)?
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "push-registration.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Task { @MainActor in Self.handle?(self) } }
    override func stopLoading() {}
    func finish(status: Int = 200) {
        let body = status == 200 ? #"{"registered":true,"expiresAtISO":"2027-01-15T20:00:00Z","removed":true}"# : #"{"error":"UNAUTHORIZED"}"#
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    func body() throws -> [String: JSONValue] {
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var bytes = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&bytes, maxLength: bytes.count)
                if count <= 0 { break }
                data.append(contentsOf: bytes.prefix(count))
            }
        }
        return try JSONDecoder().decode([String: JSONValue].self, from: data)
    }
}
