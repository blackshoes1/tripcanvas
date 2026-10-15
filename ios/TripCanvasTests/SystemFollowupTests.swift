import AppIntents
import CoreLocation
import UserNotifications
import XCTest
@testable import TripCanvas

@MainActor final class SystemFollowupTests: XCTestCase {
    private func trip(_ id: String, live: Bool = true) -> TripSummary {
        .init(id: id, name: id, start: "2026-10-14", dayCount: 3, revision: 1, updatedAt: id,
              timeZone: "Asia/Seoul", cities: [], todayIndex: live ? 0 : -1, daysUntilStart: live ? 0 : 7,
              role: .owner, memberCount: 1)
    }
    private func until(_ condition: () -> Bool) async {
        for _ in 0..<1000 { if condition() { return }; await Task.yield() }
        XCTFail("비동기 요청이 시작되지 않았어요")
    }
    private func fixture() throws -> TravelStateResponse {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "travel-state", withExtension: "json"))
        return try JSONDecoder().decode(TravelStateResponse.self, from: Data(contentsOf: url))
    }

    private let emptySlotKey = "parity|2026-09-01|emptySlotSuggestion|parity|2026-09-01|EAT|점심 시간이 비어 있어요|offered"

    /// 같은 서버 계약으로 DEVICE 빈 시간과 SERVER 제안을 함께 내려준다.
    private func emptySlotFixtureData(includeDevice: Bool = true) throws -> Data {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "travel-state", withExtension: "json"))
        var raw = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let original = try XCTUnwrap((raw["notifications"] as? [[String: Any]])?.first)
        var device = original
        device["kind"] = "emptySlotSuggestion"; device["origin"] = "DEVICE"
        device["dedupeKey"] = emptySlotKey; device["title"] = "점심 시간이 비어 있어요"
        device["deepLink"] = try XCTUnwrap(ActionRouter.link(.suggestion(
            tripId: "parity", suggestionId: "parity|2026-09-01|EAT|점심 시간이 비어 있어요"))).absoluteString
        device["priority"] = 0
        var server = original
        server["kind"] = "replanSuggestion"; server["origin"] = "SERVER"
        server["dedupeKey"] = "parity|2026-09-01|replanSuggestion|none|needed"
        raw["notifications"] = includeDevice ? [device, server] : [server]
        return try JSONSerialization.data(withJSONObject: raw)
    }

    func testSiriMutationUsesThePersistedActiveTripInsteadOfFirstLiveTrip() throws {
        let selected = try IntentSupport.selectTrip([trip("A"), trip("B")],
            snapshot: .init(state: .active, tripId: "B"), forMutation: true)
        XCTAssertEqual(selected.id, "B")
        XCTAssertThrowsError(try IntentSupport.selectTrip([trip("A"), trip("B")], snapshot: .init(), forMutation: true))
        XCTAssertThrowsError(try IntentSupport.selectTrip([trip("A")], snapshot: .init(state: .active, tripId: "removed"), forMutation: true))
        XCTAssertThrowsError(try IntentSupport.selectTrip([trip("future", live: false)], snapshot: .init(), forMutation: true))
    }

    func testOpenTodayIntentUsesTheProvidedAppRouter() async throws {
        let router = ActionRouter()
        _ = try await OpenTodayIntent(tripId: "B", router: router).perform()
        XCTAssertEqual(router.destination, .today(tripId: "B", focusActivityId: nil))
    }

    func testNotificationTapIsDeliveredToTheAppRouterAndInvalidLinksAreIgnored() {
        let router = ActionRouter()
        let push = PushService(handlesSystemNotifications: false) { _ in }
        push.onOpenLink = { router.open(url: $0) }
        push.receiveLink("tripcanvas://trip/B/today?focus=d0s1", kind: "departureReminder")
        XCTAssertEqual(router.destination, .today(tripId: "B", focusActivityId: "d0s1"))
        XCTAssertNil(push.pendingDeepLink)
        router.clear()
        push.receiveLink("https://example.com", kind: nil)
        XCTAssertNil(router.destination)
    }

    func testAPNsBridgeRegistersTheReceivedTokenAndReportsFailure() async {
        var registered = ""
        let push = PushService(handlesSystemNotifications: false) { registered = $0 }
        AppPushBridge.service = push
        defer { AppPushBridge.service = nil }
        await AppPushBridge.registered(Data([0xab, 0x01]))
        XCTAssertEqual(registered, "ab01")
        XCTAssertEqual(push.deviceToken, "ab01")
        XCTAssertNil(push.registrationError)
        push.registrationFailed()
        XCTAssertNotNil(push.registrationError)
    }

    func testConcurrentLocationRequestsShareOneSystemRequestAndBothFinish() async {
        let manager = FollowupLocationManager(), provider = LocationProvider(manager: manager)
        let first = Task { await provider.requestOnce() }
        let second = Task { await provider.requestOnce() }
        await until { provider.pendingRequestCount == 2 }
        provider.locationManager(CLLocationManager(), didUpdateLocations: [CLLocation(latitude: 35, longitude: 135)])
        let firstPoint = await first.value, secondPoint = await second.value
        XCTAssertEqual(firstPoint, GeoPoint(lat: 35, lng: 135))
        XCTAssertEqual(secondPoint, GeoPoint(lat: 35, lng: 135))
        XCTAssertEqual(manager.requests, 1)
    }

    func testCancellingOneLocationCallerDoesNotCancelTheOther() async {
        let manager = FollowupLocationManager(), provider = LocationProvider(manager: manager)
        let first = Task { await provider.requestOnce() }
        let second = Task { await provider.requestOnce() }
        await until { provider.pendingRequestCount == 2 }
        first.cancel()
        let cancelled = await first.value; XCTAssertNil(cancelled)
        provider.locationManager(CLLocationManager(), didUpdateLocations: [CLLocation(latitude: 36, longitude: 136)])
        let point = await second.value; XCTAssertEqual(point, GeoPoint(lat: 36, lng: 136))
    }

    func testLocationTimeoutFinishesWithoutAnUnresolvedContinuation() async {
        let provider = LocationProvider(manager: FollowupLocationManager(), timeout: 0.02)
        let point = await provider.requestOnce(); XCTAssertNil(point)
    }

    func testLocationWaitsForAuthorizationBeforeRequestingAFix() async {
        let manager = FollowupLocationManager(); manager.authorizationStatus = .notDetermined
        let provider = LocationProvider(manager: manager)
        let request = Task { await provider.requestOnce() }
        await until { manager.authorizationRequests == 1 }
        XCTAssertEqual(manager.requests, 0)
        manager.authorizationStatus = .authorizedWhenInUse
        provider.locationManagerDidChangeAuthorization(CLLocationManager())
        await until { manager.requests == 1 }
        provider.locationManager(CLLocationManager(), didUpdateLocations: [CLLocation(latitude: 35, longitude: 135)])
        let point = await request.value
        XCTAssertNotNil(point)
    }

    func testDeniedOrFailedNotificationRegistrationDoesNotMarkThePlanAsSent() async throws {
        SharedStore.clear(); defer { SharedStore.clear() }
        let response = try fixture(), source = FollowupTravelSource(response), push = FollowupPush()
        let mode = TravelModeController(service: source, location: LocationProvider(manager: FollowupLocationManager(denied: true)), push: push, liveActivity: FollowupActivity())
        await mode.start(trip: response.today.trip)
        XCTAssertTrue(source.markSent.allSatisfy { !$0 })
        XCTAssertTrue(mode.snapshot.sentNotificationKeys.isEmpty)
        XCTAssertTrue(source.acknowledgements.isEmpty)
        push.succeeds = true
        await mode.refresh(tripId: response.today.trip.id, reason: .manual)
        XCTAssertEqual(source.acknowledgements.count, 1)
        XCTAssertFalse(mode.snapshot.sentNotificationKeys.isEmpty)
    }

    func testAcknowledgementResponseLossRetriesWithoutRegisteringTheNotificationTwice() async throws {
        SharedStore.clear(); defer { SharedStore.clear() }
        let response = try fixture(), source = FollowupTravelSource(response), push = FollowupPush()
        push.succeeds = true; source.failAcknowledgement = true
        let mode = TravelModeController(service: source, location: LocationProvider(manager: FollowupLocationManager(denied: true)), push: push, liveActivity: FollowupActivity())
        await mode.start(trip: response.today.trip)
        let scheduled = push.scheduled
        XCTAssertGreaterThan(scheduled, 0)
        source.failAcknowledgement = false
        await mode.refresh(tripId: response.today.trip.id, reason: .manual)
        XCTAssertEqual(push.scheduled, scheduled)
        XCTAssertEqual(source.acknowledgements.count, 2)
        XCTAssertNil(mode.lastError)
    }

    func testEmptySlotDeviceDecodesRegistersAndAcknowledgesWhileServerItemIsExcluded() async throws {
        SharedStore.clear(); defer { SharedStore.clear() }
        let response = try JSONDecoder().decode(TravelStateResponse.self, from: emptySlotFixtureData())
        XCTAssertEqual(response.notifications.map(\.kind), [.emptySlotSuggestion, .replanSuggestion])
        XCTAssertEqual(response.notifications.map(\.origin), [.device, .server])
        let source = FollowupTravelSource(response), push = FollowupPush()
        push.succeeds = true
        let mode = TravelModeController(service: source,
            location: LocationProvider(manager: FollowupLocationManager(denied: true)), push: push,
            liveActivity: FollowupActivity())

        await mode.start(trip: response.today.trip)

        XCTAssertEqual(push.scheduledItems.map(\.kind), [.emptySlotSuggestion])
        XCTAssertEqual(push.scheduledItems.map(\.dedupeKey), [emptySlotKey])
        XCTAssertEqual(source.acknowledgements.count, 1)
        XCTAssertEqual(source.acknowledgements.first?.map(\.kind), [.emptySlotSuggestion])
        XCTAssertEqual(source.acknowledgements.first?.map(\.dedupeKey), [emptySlotKey])
        XCTAssertEqual(mode.snapshot.sentNotificationKeys, [emptySlotKey])
        XCTAssertTrue(source.markSent.allSatisfy { !$0 })
        XCTAssertNil(mode.lastError)
    }

    func testEmptySlotAckNetworkFailureRetriesSameWirePayloadWithoutSecondRegistration() async throws {
        try await verifyEmptySlotAcknowledgementTransport(firstRequestStored: false)
    }

    func testEmptySlotAckResponseLossAfterServerStorageDoesNotResendOrAcknowledgeServerItem() async throws {
        try await verifyEmptySlotAcknowledgementTransport(firstRequestStored: true)
    }

    /// 실제 TripService → APIClient → JSON 요청을 통과시킨다. 외부 주소로 연결하지 않는다.
    private func verifyEmptySlotAcknowledgementTransport(firstRequestStored: Bool) async throws {
        SharedStore.clear(); defer { SharedStore.clear() }
        let planData = try emptySlotFixtureData(), acceptedData = try emptySlotFixtureData(includeDevice: false)
        let response = try JSONDecoder().decode(TravelStateResponse.self, from: planData)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [EmptySlotAcknowledgementProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel(); EmptySlotAcknowledgementProtocol.respond = nil }
        let service = TripService(api: APIClient(baseURL: URL(string: "https://empty-slot.invalid")!,
            tokens: EmptySlotAcknowledgementTokens(), session: session), cache: TripCache(directory: directory))
        var serverRecorded = false
        var acknowledgementKeys: [[String]] = []
        EmptySlotAcknowledgementProtocol.respond = { request in
            XCTAssertEqual(request.url?.path, "/api/v1/trips/parity/travel-state")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer empty-slot-synthetic")
            if request.httpMethod == "GET" {
                let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
                XCTAssertFalse(query.contains { $0.name == "markSent" && $0.value == "1" })
                return (200, serverRecorded ? acceptedData : planData)
            }
            XCTAssertEqual(request.httpMethod, "POST")
            let body = try EmptySlotAcknowledgementProtocol.body(request)
            XCTAssertEqual(body["stateVersion"] as? String, response.stateVersion)
            let items = try XCTUnwrap(body["items"] as? [[String: String]])
            XCTAssertEqual(items.map { $0["kind"] }, ["emptySlotSuggestion"])
            XCTAssertEqual(items.map { $0["dedupeKey"] }, [self.emptySlotKey])
            acknowledgementKeys.append(items.compactMap { $0["dedupeKey"] })
            if acknowledgementKeys.count == 1 {
                serverRecorded = firstRequestStored
                throw URLError(.networkConnectionLost)
            }
            serverRecorded = true
            return (200, Data(#"{"schemaVersion":1,"acknowledged":true}"#.utf8))
        }
        let push = FollowupPush(); push.succeeds = true
        let mode = TravelModeController(service: service,
            location: LocationProvider(manager: FollowupLocationManager(denied: true)), push: push,
            liveActivity: FollowupActivity())

        await mode.start(trip: response.today.trip)
        XCTAssertEqual(push.scheduledItems.map(\.dedupeKey), [emptySlotKey])
        XCTAssertEqual(acknowledgementKeys, [[emptySlotKey]])
        XCTAssertNotNil(mode.lastError, "전송 결과를 잃은 확인 요청을 성공이라고 말하지 않는다")

        await mode.refresh(tripId: response.today.trip.id, reason: .manual)
        XCTAssertEqual(push.scheduledItems.map(\.kind), [.emptySlotSuggestion], "확인을 재시도해도 알림은 한 번만 등록한다")
        XCTAssertEqual(acknowledgementKeys, firstRequestStored ? [[emptySlotKey]] : [[emptySlotKey], [emptySlotKey]])
        XCTAssertTrue(serverRecorded)
        XCTAssertNil(mode.lastError)
    }

    func testPushChecksPermissionAndAwaitsTheSystemRegistrationResult() async throws {
        let item = try XCTUnwrap(try fixture().notifications.first { $0.origin == .device })
        var allowed = false, requests = 0
        let push = PushService(handlesSystemNotifications: false, permissionReader: { allowed ? .granted : .denied }, enqueue: { _ in
            requests += 1; throw APIError.offline
        }) { _ in }
        await push.prepareForDelivery()
        let denied = await push.schedule(item); XCTAssertFalse(denied); XCTAssertEqual(requests, 0)
        allowed = true; await push.prepareForDelivery()
        let failed = await push.schedule(item); XCTAssertFalse(failed); XCTAssertEqual(requests, 1)
    }
}

@MainActor private final class FollowupLocationManager: LocationManaging {
    var delegate: (any CLLocationManagerDelegate)?
    var authorizationStatus: CLAuthorizationStatus = .authorizedWhenInUse
    var requests = 0, authorizationRequests = 0
    init(denied: Bool = false) { if denied { authorizationStatus = .denied } }
    func requestWhenInUseAuthorization() { authorizationRequests += 1 }
    func requestLocation() { requests += 1 }
    func stopUpdatingLocation() {}
}
@MainActor private final class FollowupTravelSource: TravelStateSource {
    let response: TravelStateResponse
    var markSent: [Bool] = [], acknowledgements: [[NotificationPlanItem]] = []
    var failAcknowledgement = false
    init(_ response: TravelStateResponse) { self.response = response }
    func travelState(tripId: String, location: GeoPoint?, locationUpdatedAt: String?, travelMode: Bool, suppressUntil: String?, markSent: Bool) async throws -> TripService.Fetched<TravelStateResponse> {
        self.markSent.append(markSent); return .init(value: response, cachedAt: nil)
    }
    func acknowledgeNotifications(tripId: String, items: [NotificationPlanItem], stateVersion: String) async throws {
        acknowledgements.append(items)
        if failAcknowledgement { throw APIError.offline }
    }
}
@MainActor private final class FollowupPush: PushScheduling {
    var succeeds = false, scheduled = 0
    var scheduledItems: [NotificationPlanItem] = []
    func present(_ item: NotificationPlanItem) {}
    func schedule(_ item: NotificationPlanItem) async -> Bool {
        if succeeds { scheduled += 1; scheduledItems.append(item) }
        return succeeds
    }
}

@MainActor private struct EmptySlotAcknowledgementTokens: TokenProviding {
    func accessToken() async throws -> String { "empty-slot-synthetic" }
    func refreshToken() async throws -> String { "empty-slot-synthetic" }
}

private final class EmptySlotAcknowledgementProtocol: URLProtocol {
    @MainActor static var respond: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Task { @MainActor in
            do {
                guard let respond = Self.respond else { throw URLError(.notConnectedToInternet) }
                let (status, data) = try respond(request)
                let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data)
                client?.urlProtocolDidFinishLoading(self)
            } catch { client?.urlProtocol(self, didFailWithError: error) }
        }
    }
    override func stopLoading() {}

    static func body(_ request: URLRequest) throws -> [String: Any] {
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
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}
@MainActor private final class FollowupActivity: LiveActivityControlling {
    func sync(_ response: TravelStateResponse, changed: Bool) async {}
    func end() async {}
}
