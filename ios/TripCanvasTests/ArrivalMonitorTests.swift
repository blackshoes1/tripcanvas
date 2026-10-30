import CoreLocation
import UIKit
import XCTest
@testable import TripCanvas

@MainActor final class ArrivalMonitorTests: XCTestCase {
    private let context = ArrivalMonitoringContext(accountID: "account", deviceId: "device", activityId: "live")
    private let now = ISO8601DateFormatter().date(from: "2026-10-30T10:00:00Z")!

    private func defaults() -> UserDefaults {
        let name = "ArrivalMonitorTests.\(UUID().uuidString)", result = UserDefaults(suiteName: name)!
        addTeardownBlock { result.removePersistentDomain(forName: name) }
        return result
    }
    private func response(count: Int = 1, revision: Int = 7, mutate: (inout [String: Any]) -> Void = { _ in }) throws -> TravelStateResponse {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "travel-state", withExtension: "json"))
        var raw = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        var today = raw["today"] as! [String: Any]
        var trip = today["trip"] as! [String: Any]
        trip["id"] = "trip"; trip["revision"] = revision; trip["timeZone"] = "UTC"; trip["todayIndex"] = 0
        today["trip"] = trip; today["generatedAt"] = "2026-10-30T10:00:00Z"
        var day = today["day"] as! [String: Any]
        day["index"] = 0; day["date"] = "2026-10-30"; day["timeZone"] = "UTC"; today["day"] = day
        var state = today["currentState"] as! [String: Any]
        state["live"] = true; state["nowMinutes"] = 600; today["currentState"] = state
        let template = (today["activities"] as! [[String: Any]])[0]
        today["activities"] = (0..<count).map { index -> [String: Any] in
            var activity = template
            activity["id"] = "d0s\(index)"; activity["name"] = "목표 \(index)"
            activity["status"] = "PLANNED"; activity["choiceState"] = NSNull()
            activity["startMinutes"] = 610 + index; activity["endMinutes"] = 700 + index
            activity["location"] = ["lat": 37.5 + Double(index) / 100, "lng": 127.0]
            return activity
        }
        raw["today"] = today
        var activity = raw["liveActivity"] as! [String: Any]
        activity["shouldEnd"] = false
        activity["target"] = ["dayIndex": 0, "activityId": "d0s0", "revision": revision]
        raw["liveActivity"] = activity
        mutate(&raw)
        return try JSONDecoder().decode(TravelStateResponse.self, from: JSONSerialization.data(withJSONObject: raw))
    }
    private func monitor(_ manager: ArrivalManager, store: UserDefaults? = nil, background: ArrivalBackground? = nil) -> ArrivalMonitor {
        let background = background ?? ArrivalBackground()
        return ArrivalMonitor(manager: manager, defaults: store ?? defaults(), available: true, now: { self.now },
                              beginBackground: { background.begin($0) }, endBackground: { background.end($0) })
    }
    private func settle(_ condition: () -> Bool) async {
        for _ in 0..<1000 { if condition() { return }; await Task.yield() }
        XCTFail("비동기 도착 이벤트가 완료되지 않았다")
    }

    func testOnlyAlwaysAndPreciseAuthorizationArmsDestinationsWithoutRequestingPermission() throws {
        let manager = ArrivalManager(); manager.authorizationStatus = .authorizedWhenInUse
        let monitor = monitor(manager)
        monitor.update(try response(), context: context)
        XCTAssertTrue(manager.started.isEmpty)
        XCTAssertEqual(manager.authorizationRequests, 0)
        monitor.enable(); XCTAssertEqual(manager.authorizationRequests, 1)
        manager.authorizationStatus = .authorizedAlways; manager.accuracyAuthorization = .reducedAccuracy
        monitor.refreshAuthorization(); XCTAssertTrue(manager.started.isEmpty)
        manager.accuracyAuthorization = .fullAccuracy
        monitor.refreshAuthorization()
        XCTAssertEqual(manager.started.count, 1)
        XCTAssertEqual(manager.started[0].radius, 100)
        XCTAssertTrue(manager.started[0].notifyOnEntry); XCTAssertTrue(manager.started[0].notifyOnExit)
        manager.authorizationStatus = .denied
        monitor.refreshAuthorization(); XCTAssertTrue(manager.monitoredRegions.isEmpty)
    }

    func testUnrestoredAuxiliaryEnvironmentDoesNotRemoveTheAppsExistingRegions() async {
        let manager = ArrivalManager()
        let region = CLCircularRegion(center: .init(latitude: 37.5, longitude: 127), radius: 100,
                                      identifier: "withj.arrival.existing")
        manager.monitoredRegions = [region]
        let auxiliary = monitor(manager)
        auxiliary.locationManagerDidChangeAuthorization(CLLocationManager())
        await Task.yield()
        auxiliary.refreshAuthorization()
        XCTAssertEqual(manager.monitoredRegions, [region], "소유권 없는 Siri 환경의 초기 delegate는 앱 감시를 지우지 않는다")
        auxiliary.stop()
        XCTAssertTrue(manager.monitoredRegions.isEmpty, "명시적 종료는 보관 감시도 정리한다")
    }

    func testOnlyEarliestTwentyUnfinishedLocatedUnexpiredAndChosenActivitiesAreMonitored() throws {
        let manager = ArrivalManager(), monitor = monitor(manager)
        let value = try response(count: 25) { raw in
            var today = raw["today"] as! [String: Any], activities = today["activities"] as! [[String: Any]]
            activities[0]["status"] = "COMPLETED"; activities[1]["status"] = "SKIPPED"
            activities[2]["location"] = NSNull(); activities[3]["endMinutes"] = 599
            activities[4]["choiceState"] = "PENDING"
            today["activities"] = activities; raw["today"] = today
        }
        monitor.update(value, context: context)
        XCTAssertEqual(manager.started.count, 20)
        XCTAssertEqual(manager.started.first?.center.latitude, 37.55)
        XCTAssertEqual(manager.started.last?.center.latitude, 37.74)
        monitor.update(value, context: context)
        XCTAssertEqual(manager.started.count, 20, "동일 응답은 기존 감시를 재등록하지 않는다")
    }

    func testAlreadyInsideIsReportedAfterRegistrationAndDuplicateEntryIsDeduplicated() async throws {
        let manager = ArrivalManager(), background = ArrivalBackground()
        let monitor = monitor(manager, background: background)
        var events: [LiveActivityArrivalRequest] = []
        monitor.onObservation = { _, event in events.append(event); return .recorded }
        monitor.update(try response(), context: context)
        let region = try XCTUnwrap(manager.started.first)
        monitor.locationManager(CLLocationManager(), didStartMonitoringFor: region)
        await settle { manager.stateRequests.count == 1 }
        monitor.locationManager(CLLocationManager(), didDetermineState: .inside, for: region)
        await settle { events.count == 1 && background.ended.count == 1 }
        monitor.locationManager(CLLocationManager(), didEnterRegion: region)
        await Task.yield(); await monitor.retryPending()
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].target, .init(dayIndex: 0, activityId: "d0s0", revision: 7))
        XCTAssertTrue(events[0].arrived)
        XCTAssertFalse(try String(data: JSONEncoder().encode(events[0]), encoding: .utf8)!.contains("lat"), "실제/목적지 좌표는 API에 싣지 않는다")
    }

    func testExitDuringPendingEntryIsDeliveredAfterEntryWithIncreasingSequence() async throws {
        let manager = ArrivalManager(), monitor = monitor(manager)
        var events: [LiveActivityArrivalRequest] = [], release: CheckedContinuation<ArrivalReportResult, Never>?
        monitor.onObservation = { _, event in
            events.append(event)
            if events.count == 1 { return await withCheckedContinuation { release = $0 } }
            return .recorded
        }
        monitor.update(try response(), context: context)
        let region = try XCTUnwrap(manager.started.first)
        monitor.locationManager(CLLocationManager(), didEnterRegion: region)
        await settle { release != nil }
        monitor.locationManager(CLLocationManager(), didExitRegion: region)
        await Task.yield(); release?.resume(returning: .recorded)
        await settle { events.count == 2 }
        XCTAssertEqual(events.map(\.arrived), [true, false])
        XCTAssertGreaterThan(events[1].eventRevision, events[0].eventRevision)
    }

    func testFailedRegistrationRaceRetainsTheExactEventUntilNextRetry() async throws {
        let manager = ArrivalManager(), monitor = monitor(manager)
        var events: [LiveActivityArrivalRequest] = []
        monitor.onObservation = { _, event in events.append(event); return events.count > 1 ? .recorded : .retry }
        monitor.update(try response(), context: context)
        monitor.locationManager(CLLocationManager(), didEnterRegion: try XCTUnwrap(manager.started.first))
        await settle { events.count == 1 }
        await monitor.retryPending()
        if events.count == 1 { await monitor.retryPending() }
        XCTAssertEqual(events.count, 2)
        XCTAssertEqual(events[0], events[1], "등록 전 도착의 재시도도 동일 sequence/payload다")
        await monitor.retryPending(); XCTAssertEqual(events.count, 2)
    }

    func testNewRevisionDuringAcknowledgementDoesNotRemoveFromTheNewEmptyQueue() async throws {
        let manager = ArrivalManager(), monitor = monitor(manager)
        let updated = try response(revision: 8)
        var events: [LiveActivityArrivalRequest] = []
        monitor.onObservation = { _, event in
            events.append(event)
            monitor.update(updated, context: self.context)
            return .recorded
        }
        monitor.update(try response(), context: context)
        monitor.locationManager(CLLocationManager(), didEnterRegion: try XCTUnwrap(manager.started.first))
        await settle { events.count == 1 && manager.started.count == 2 }
        await monitor.retryPending()
        XCTAssertEqual(events.count, 1, "재진입 갱신이 지운 이전 이벤트를 ACK하거나 removeFirst하지 않는다")
        monitor.locationManager(CLLocationManager(), didEnterRegion: manager.started[0])
        await Task.yield(); await monitor.retryPending(); XCTAssertEqual(events.count, 1)
    }

    func testOldOfflineEntryIsReobservedWithANewTimestampAndSequence() async throws {
        let manager = ArrivalManager()
        var clock = now, events: [LiveActivityArrivalRequest] = []
        var release: CheckedContinuation<ArrivalReportResult, Never>?
        let monitor = ArrivalMonitor(manager: manager, defaults: defaults(), available: true, now: { clock },
                                     beginBackground: { _ in .invalid }, endBackground: { _ in })
        monitor.onObservation = { _, event in
            events.append(event)
            if events.count == 1 { return await withCheckedContinuation { release = $0 } }
            return .recorded
        }
        monitor.update(try response(), context: context)
        let region = try XCTUnwrap(manager.started.first)
        monitor.locationManager(CLLocationManager(), didEnterRegion: region)
        await settle { release != nil }
        clock = clock.addingTimeInterval(15 * 60 + 1)
        release?.resume(returning: .retry)
        await monitor.retryPending()
        await monitor.retryPending()
        XCTAssertEqual(events.count, 1, "15분 지난 증거를 그대로 다시 POST하지 않는다")
        XCTAssertEqual(manager.stateRequests.count, 1)
        monitor.locationManager(CLLocationManager(), didDetermineState: .inside, for: region)
        await settle { events.count == 2 }
        XCTAssertGreaterThan(events[1].eventRevision, events[0].eventRevision)
        XCTAssertNotEqual(events[1].observedAtISO, events[0].observedAtISO)
        XCTAssertTrue(events[1].arrived)
    }

    func testPermanentRejectionDoesNotBlockTheNewerExit() async throws {
        let manager = ArrivalManager(), monitor = monitor(manager)
        var events: [LiveActivityArrivalRequest] = [], release: CheckedContinuation<ArrivalReportResult, Never>?
        monitor.onObservation = { _, event in
            events.append(event)
            if events.count == 1 { return await withCheckedContinuation { release = $0 } }
            return .recorded
        }
        monitor.update(try response(), context: context)
        let region = try XCTUnwrap(manager.started.first)
        monitor.locationManager(CLLocationManager(), didEnterRegion: region)
        await settle { release != nil }
        monitor.locationManager(CLLocationManager(), didExitRegion: region)
        await Task.yield(); release?.resume(returning: .discard)
        await settle { events.count == 2 }
        XCTAssertEqual(events.map(\.arrived), [true, false])
    }

    func testBackgroundExpirationRetainsUnacknowledgedEvidenceAndEndsTheTask() async throws {
        let manager = ArrivalManager(), background = ArrivalBackground(), monitor = monitor(manager, background: background)
        var events: [LiveActivityArrivalRequest] = [], release: CheckedContinuation<ArrivalReportResult, Never>?
        monitor.onObservation = { _, event in
            events.append(event)
            if events.count == 1 { return await withCheckedContinuation { release = $0 } }
            return .recorded
        }
        monitor.update(try response(), context: context)
        monitor.locationManager(CLLocationManager(), didEnterRegion: try XCTUnwrap(manager.started.first))
        await settle { release != nil }
        background.expiration?(); release?.resume(returning: .recorded)
        await settle { background.ended.count == 1 }
        await monitor.retryPending()
        await monitor.retryPending()
        XCTAssertEqual(events.count, 2)
        XCTAssertEqual(events[0], events[1], "만료된 작업의 늦은 성공은 현재 ACK로 사용하지 않는다")
        XCTAssertEqual(background.started, background.ended.count)
    }

    func testColdRestoreChecksTheAccountAndRechecksOutsideBeforeKeepingArrival() async throws {
        let store = defaults(), firstManager = ArrivalManager(), first = monitor(firstManager, store: store)
        var entered = false
        first.onObservation = { _, _ in entered = true; return .recorded }
        first.update(try response(), context: context)
        let region = try XCTUnwrap(firstManager.started.first)
        first.locationManager(CLLocationManager(), didEnterRegion: region)
        await settle { entered }; await first.retryPending()
        let manager = ArrivalManager(); manager.monitoredRegions = [region]
        let restored = monitor(manager, store: store)
        var events: [LiveActivityArrivalRequest] = []
        restored.onObservation = { _, event in events.append(event); return .recorded }
        restored.restore(context: context, activeTripID: "trip")
        XCTAssertEqual(manager.stateRequests.map(\.identifier), [region.identifier])
        restored.locationManager(CLLocationManager(), didDetermineState: .outside, for: region)
        await settle { events.count == 1 }
        XCTAssertFalse(events[0].arrived, "종료 중 나갔다면 최초 상태 확인에서 서버 증거를 무효화한다")
        restored.restore(context: .init(accountID: "other", deviceId: "device", activityId: "live"), activeTripID: "trip")
        XCTAssertTrue(manager.monitoredRegions.isEmpty)
        restored.locationManager(CLLocationManager(), didEnterRegion: region)
        await Task.yield(); await restored.retryPending(); XCTAssertEqual(events.count, 1)
    }

    func testStopDropsPendingEventsAndPreservesUnrelatedRegions() async throws {
        let manager = ArrivalManager(), monitor = monitor(manager)
        let unrelated = CLCircularRegion(center: .init(latitude: 1, longitude: 1), radius: 100, identifier: "unrelated")
        manager.monitoredRegions.insert(unrelated)
        var events = 0
        monitor.onObservation = { _, _ in events += 1; return .retry }
        monitor.update(try response(), context: context)
        let region = try XCTUnwrap(manager.started.first)
        monitor.stop()
        monitor.locationManager(CLLocationManager(), didEnterRegion: region)
        await Task.yield(); await monitor.retryPending()
        XCTAssertEqual(events, 0)
        XCTAssertEqual(manager.monitoredRegions, [unrelated])
    }

    func testOverlappingEntryKeepsTheCurrentTargetUntilItExits() async throws {
        let manager = ArrivalManager(), monitor = monitor(manager)
        var events: [LiveActivityArrivalRequest] = []
        monitor.onObservation = { _, event in events.append(event); return .recorded }
        monitor.update(try response(count: 2), context: context)
        monitor.locationManager(CLLocationManager(), didEnterRegion: manager.started[0])
        await settle { events.count == 1 }; await monitor.retryPending()
        monitor.locationManager(CLLocationManager(), didEnterRegion: manager.started[1])
        await Task.yield(); await monitor.retryPending(); XCTAssertEqual(events.count, 1)
        monitor.locationManager(CLLocationManager(), didExitRegion: manager.started[0])
        await settle { events.count == 3 }
        XCTAssertEqual(events.map(\.arrived), [true, false, true])
        XCTAssertEqual(events[2].target.activityId, "d0s1")
    }

    func testAcceptedArrivalRefreshesWithoutAskingForGPSAndStopsWithTheMode() async throws {
        SharedStore.clear(); defer { SharedStore.clear() }
        let source = ArrivalTravelSource(try response()), monitor = ArrivalMonitorFake(), location = ArrivalNoGPS()
        let mode = TravelModeController(service: source, location: LocationProvider(manager: location),
            push: ArrivalPush(), liveActivity: ArrivalActivity(), arrivalMonitor: monitor, arrivalContext: { _ in self.context })
        await mode.start(trip: source.response.today.trip)
        let event = request()
        let accepted = await monitor.onObservation?(context, event)
        XCTAssertEqual(accepted, .recorded)
        XCTAssertEqual(source.arrivals, [event]); XCTAssertEqual(source.reads, 2)
        XCTAssertEqual(location.requests, 0)
        await mode.stop()
        XCTAssertGreaterThan(monitor.stops, 0)
        let afterStop = await monitor.onObservation?(context, event)
        XCTAssertEqual(afterStop, .discard); XCTAssertEqual(source.arrivals.count, 1)
    }

    func testArrivalDuringAReadIsRefreshedOnceTheOlderReadFinishes() async throws {
        SharedStore.clear(); defer { SharedStore.clear() }
        let source = ArrivalTravelSource(try response()), monitor = ArrivalMonitorFake()
        let mode = TravelModeController(service: source, location: LocationProvider(manager: ArrivalNoGPS()),
            push: ArrivalPush(), liveActivity: ArrivalActivity(), arrivalMonitor: monitor, arrivalContext: { _ in self.context })
        await mode.start(trip: source.response.today.trip)
        var pending: CheckedContinuation<Void, Never>?
        source.onRead = { await withCheckedContinuation { pending = $0 } }
        let read = Task { await mode.refresh(tripId: "trip", reason: .foreground) }
        await settle { pending != nil }
        let accepted = await monitor.onObservation?(context, request())
        XCTAssertEqual(accepted, .recorded)
        source.onRead = nil; pending?.resume(); await read.value
        XCTAssertEqual(source.reads, 3, "도착 전에 시작한 응답 뒤 서버의 새 도착 상태를 다시 읽는다")
    }

    private func request() -> LiveActivityArrivalRequest {
        .init(deviceId: context.deviceId, activityId: context.activityId, tripId: "trip",
              target: .init(dayIndex: 0, activityId: "d0s0", revision: 7), arrived: true,
              observedAtISO: "2026-10-30T10:00:00Z", eventRevision: 1)
    }
}

@MainActor private final class ArrivalManager: ArrivalRegionManaging {
    var delegate: (any CLLocationManagerDelegate)?
    var authorizationStatus: CLAuthorizationStatus = .authorizedAlways
    var accuracyAuthorization: CLAccuracyAuthorization = .fullAccuracy
    var monitoredRegions: Set<CLRegion> = []
    var maximumRegionMonitoringDistance: CLLocationDistance = 1000
    var started: [CLCircularRegion] = [], stateRequests: [CLRegion] = []
    var authorizationRequests = 0
    func requestAlwaysAuthorization() { authorizationRequests += 1 }
    func startMonitoring(for region: CLRegion) { monitoredRegions.insert(region); started.append(region as! CLCircularRegion) }
    func stopMonitoring(for region: CLRegion) { monitoredRegions.remove(region) }
    func requestState(for region: CLRegion) { stateRequests.append(region) }
}
@MainActor private final class ArrivalBackground {
    var started = 0, ended: [UIBackgroundTaskIdentifier] = []
    var expiration: (@MainActor () -> Void)?
    func begin(_ expiry: @escaping @MainActor () -> Void) -> UIBackgroundTaskIdentifier {
        started += 1; expiration = expiry; return UIBackgroundTaskIdentifier(rawValue: started)
    }
    func end(_ identifier: UIBackgroundTaskIdentifier) { ended.append(identifier) }
}
@MainActor private final class ArrivalMonitorFake: ArrivalMonitoring {
    var onObservation: (@MainActor (ArrivalMonitoringContext, LiveActivityArrivalRequest) async -> ArrivalReportResult)?
    var stops = 0
    func restore(context: ArrivalMonitoringContext?, activeTripID: String?) {}
    func update(_ response: TravelStateResponse, context: ArrivalMonitoringContext?) {}
    func retryPending() async {}
    func stop() { stops += 1 }
}
@MainActor private final class ArrivalTravelSource: TravelStateSource {
    let response: TravelStateResponse
    var arrivals: [LiveActivityArrivalRequest] = [], reads = 0
    var onRead: (() async -> Void)?
    init(_ response: TravelStateResponse) { self.response = response }
    func travelState(tripId: String, location: GeoPoint?, locationUpdatedAt: String?, travelMode: Bool, suppressUntil: String?, markSent: Bool) async throws -> TripService.Fetched<TravelStateResponse> {
        reads += 1; await onRead?(); return .init(value: response, cachedAt: nil)
    }
    func reportArrival(_ request: LiveActivityArrivalRequest) async throws { arrivals.append(request) }
}
@MainActor private final class ArrivalNoGPS: LocationManaging {
    var delegate: (any CLLocationManagerDelegate)?
    var authorizationStatus: CLAuthorizationStatus = .denied
    var requests = 0
    func requestWhenInUseAuthorization() {}
    func requestLocation() { requests += 1 }
    func stopUpdatingLocation() {}
}
@MainActor private struct ArrivalPush: PushScheduling { func present(_ item: NotificationPlanItem) {} }
@MainActor private struct ArrivalActivity: LiveActivityControlling {
    func sync(_ response: TravelStateResponse, changed: Bool) async {}
    func end() async {}
}
