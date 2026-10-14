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
    func present(_ item: NotificationPlanItem) {}
    func schedule(_ item: NotificationPlanItem) async -> Bool { if succeeds { scheduled += 1 }; return succeeds }
}
@MainActor private final class FollowupActivity: LiveActivityControlling {
    func sync(_ response: TravelStateResponse, changed: Bool) async {}
    func end() async {}
}
