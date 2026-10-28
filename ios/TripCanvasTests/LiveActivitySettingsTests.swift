import CoreLocation
import XCTest
@testable import TripCanvas

/// 실시간 현황이 꺼져 있을 때 `지금`이 그 사실을 알고, 다시 켜지면 그 자리에서 시작하는가(2026-10-26).
///
/// 시스템 허용은 가짜로 갈아끼운다. 허용이 켜진 채로 `sync`를 부르면 진짜 ActivityKit이 시뮬레이터에
/// 안내를 띄우므로, 컨트롤러에 대해서는 꺼진 쪽만 부른다 — 다시 켜졌을 때 누가 무엇을 하는지는
/// `TravelModeController`를 가짜 안내와 묶어 본다.
@MainActor
final class LiveActivitySettingsTests: XCTestCase {
    private func fixture() throws -> TravelStateResponse {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "travel-state", withExtension: "json"))
        return try JSONDecoder().decode(TravelStateResponse.self, from: Data(contentsOf: url))
    }

    private var suites: [String] = []
    override func tearDown() {
        for name in suites { UserDefaults().removePersistentDomain(forName: name) }
        suites = []
        super.tearDown()
    }

    /// 접어 둔 것은 기기에 남는다 — 테스트마다 비운 저장소를 쓴다(앱의 `.standard`를 더럽히지 않게).
    private func defaults(_ name: String = UUID().uuidString) -> UserDefaults {
        let suite = "live-activity-tests.\(name)"
        suites.append(suite)
        return UserDefaults(suiteName: suite)!
    }

    private func makeController(_ authorization: SettingsAuthorization, defaults: UserDefaults? = nil) -> LiveActivityController {
        LiveActivityController(authorization: authorization, defaults: defaults ?? self.defaults())
    }

    private func settle(until condition: () -> Bool) async {
        for _ in 0..<500 where !condition() { await Task.yield() }
    }

    /// 위치를 묻지 않는 쪽으로 고정한다 — 기기 권한에 따라 새로고침이 위치를 기다리면 `settle`이 모자란다.
    private func travelMode(_ source: SettingsTravelSource, _ activity: SettingsActivity) -> TravelModeController {
        TravelModeController(service: source, location: LocationProvider(manager: SettingsLocationManager()),
                             push: SettingsPush(), liveActivity: activity)
    }

    // MARK: 컨트롤러 — 꺼져 있음을 아는가

    func testStartsDisabledOnlyWhenTheBuildCanShowLiveActivities() {
        XCTAssertTrue(makeController(SettingsAuthorization(enabled: false)).isDisabledInSettings)
        XCTAssertFalse(makeController(SettingsAuthorization(enabled: true)).isDisabledInSettings)
        // 무료 계정 빌드에는 설정에 스위치가 없다 — '설정에서 켜기'는 갈 곳이 없으니 말하지 않는다.
        let unsupported = SettingsAuthorization(enabled: false, supported: false)
        let controller = makeController(unsupported)
        XCTAssertFalse(controller.isDisabledInSettings)
        controller.sceneBecameActive()
        XCTAssertFalse(controller.isDisabledInSettings)
    }

    func testSyncWhileDisabledSaysSoInsteadOfAnError() async throws {
        let authorization = SettingsAuthorization(enabled: true)
        let controller = makeController(authorization)
        authorization.areActivitiesEnabled = false      // 알림 없이 꺼졌어도 확인하는 순간 안다
        await controller.sync(try fixture(), changed: true)
        XCTAssertTrue(controller.isDisabledInSettings)
        XCTAssertNil(controller.lastError)
        XCTAssertFalse(controller.isRunning)
    }

    // MARK: 컨트롤러 — 다시 켜짐을 한 번, 앞에 있을 때 알리는가

    func testReenableIsReportedOnlyOnTheOffToOnTransition() async {
        let authorization = SettingsAuthorization(enabled: false)
        let controller = makeController(authorization)
        var reenabled = 0
        controller.onReenable { reenabled += 1 }

        authorization.set(true)
        await settle { reenabled == 1 }
        XCTAssertEqual(reenabled, 1)
        XCTAssertFalse(controller.isDisabledInSettings)

        // 켜진 채로 같은 값이 다시 와도, 복귀가 겹쳐도 두 번 시작하지 않는다.
        // 뒤의 false가 처리됐다면 앞의 true도 처리된 것이다.
        authorization.set(true)
        controller.sceneBecameActive()
        authorization.set(false)
        await settle { controller.isDisabledInSettings }
        XCTAssertTrue(controller.isDisabledInSettings)
        XCTAssertEqual(reenabled, 1)

        authorization.set(true)
        await settle { reenabled == 2 }
        XCTAssertEqual(reenabled, 2)
    }

    func testReenableSeenInTheBackgroundWaitsForTheForeground() async {
        let authorization = SettingsAuthorization(enabled: false)
        let controller = makeController(authorization)
        var reenabled = 0
        controller.onReenable { reenabled += 1 }

        // 설정에서 켜는 동안 앱은 뒤에 있다 — 그때 시작하면 `.visibility`로 거절된다.
        authorization.isAppActive = false
        authorization.set(true)
        await settle { !controller.isDisabledInSettings }
        XCTAssertFalse(controller.isDisabledInSettings, "꺼져 있다는 안내는 바로 걷는다")
        XCTAssertEqual(reenabled, 0)

        authorization.isAppActive = true
        controller.sceneBecameActive()
        XCTAssertEqual(reenabled, 1)
        controller.sceneBecameActive()
        XCTAssertEqual(reenabled, 1)
    }

    func testComingBackCatchesASwitchTheStreamNeverReported() {
        let authorization = SettingsAuthorization(enabled: false)
        let controller = makeController(authorization)
        var reenabled = 0
        controller.onReenable { reenabled += 1 }

        authorization.areActivitiesEnabled = true       // 스트림이 늦거나 오지 않았다
        controller.sceneBecameActive()
        XCTAssertFalse(controller.isDisabledInSettings)
        XCTAssertEqual(reenabled, 1)
    }

    func testDismissedNoticeStaysQuietUntilSomethingChanges() async {
        let authorization = SettingsAuthorization(enabled: false)
        let controller = makeController(authorization)
        controller.dismissNotice()
        XCTAssertTrue(controller.isNoticeDismissed)
        controller.sceneBecameActive()
        XCTAssertTrue(controller.isNoticeDismissed, "같은 상태로 돌아왔을 뿐이면 다시 조르지 않는다")

        // 켰다가 다시 끄면 새로 말한다.
        authorization.areActivitiesEnabled = true
        controller.sceneBecameActive()
        authorization.areActivitiesEnabled = false
        controller.sceneBecameActive()
        XCTAssertTrue(controller.isDisabledInSettings)
        XCTAssertFalse(controller.isNoticeDismissed)

        // 여행 중 안내를 끄면 접어 둔 것도 잊는다.
        controller.dismissNotice()
        await controller.end()
        XCTAssertFalse(controller.isNoticeDismissed)
    }

    func testDismissalSurvivesARelaunchButNotASwitchFlippedMeanwhile() {
        let store = defaults()
        let first = makeController(SettingsAuthorization(enabled: false), defaults: store)
        first.dismissNotice()
        XCTAssertTrue(makeController(SettingsAuthorization(enabled: false), defaults: store).isNoticeDismissed,
                      "앱을 다시 열었을 뿐이면 다시 조르지 않는다")
        // 앱이 꺼져 있는 동안 켰다가 — 켜진 채로 열리면 접어 둔 것은 지난 일이다.
        XCTAssertFalse(makeController(SettingsAuthorization(enabled: true), defaults: store).isNoticeDismissed)
        XCTAssertFalse(makeController(SettingsAuthorization(enabled: false), defaults: store).isNoticeDismissed)
    }

    func testComingBackFollowsADismissalClearedByAnotherEnvironment() async {
        let store = defaults()
        let app = makeController(SettingsAuthorization(enabled: false), defaults: store)
        app.dismissNotice()
        // Siri·단축어는 자기 환경(같은 저장소, 다른 컨트롤러)에서 안내를 끈다 — `end()`가 접어 둔 표시를 지운다.
        let siri = makeController(SettingsAuthorization(enabled: false), defaults: store)
        await siri.end()
        XCTAssertTrue(app.isNoticeDismissed)
        app.sceneBecameActive()
        XCTAssertFalse(app.isNoticeDismissed, "안내를 껐다 켰으면 다시 말한다")
    }

    func testSyncNoticingTheSwitchFlippedForgetsTheDismissal() async throws {
        let authorization = SettingsAuthorization(enabled: true)
        let live = makeController(authorization)
        live.dismissNotice()
        authorization.areActivitiesEnabled = false      // 스트림도 복귀도 없이 꺼졌다 — `sync`가 먼저 안다
        await live.sync(try fixture(), changed: true)
        XCTAssertTrue(live.isDisabledInSettings)
        XCTAssertFalse(live.isNoticeDismissed, "꺼짐을 새로 알았으면 접어 둔 것은 잊는다")
    }

    func testNoticeShowsOnlyForThisTripsTravelModeWhileDisabledAndNotDismissed() {
        XCTAssertTrue(LiveActivitySettingsNotice.isShown(travelModeTripId: "t1", tripId: "t1", disabledInSettings: true, dismissed: false))
        XCTAssertFalse(LiveActivitySettingsNotice.isShown(travelModeTripId: nil, tripId: "t1", disabledInSettings: true, dismissed: false),
                       "여행 중 안내를 켜지 않았으면 잠금화면을 기대하지 않는다")
        XCTAssertFalse(LiveActivitySettingsNotice.isShown(travelModeTripId: "t2", tripId: "t1", disabledInSettings: true, dismissed: false))
        XCTAssertFalse(LiveActivitySettingsNotice.isShown(travelModeTripId: "t1", tripId: "t1", disabledInSettings: false, dismissed: false))
        XCTAssertFalse(LiveActivitySettingsNotice.isShown(travelModeTripId: "t1", tripId: "t1", disabledInSettings: true, dismissed: true))
    }

    // MARK: 여행 중 안내 — 현재 여행에서 시작할 수 있는가

    func testAnotherTripsRestoredGuidanceDoesNotHideStartForThisLiveTrip() async throws {
        SharedStore.clear()
        defer { SharedStore.clear() }
        let response = try fixture()
        SharedStore.saveTravelMode(.init(state: .active, tripId: "previous-trip"))
        let source = SettingsTravelSource(response)
        let activity = SettingsActivity()
        let mode = travelMode(source, activity)

        XCTAssertTrue(mode.shouldOfferStart(for: response.today.trip),
                      "다른 여행의 안내가 남아 있어도 현재 여행에서 켤 수 있어야 한다")
        XCTAssertEqual(mode.snapshot.tripId, "previous-trip", "켜기를 누르기 전에는 기존 안내를 바꾸지 않는다")

        await mode.start(trip: response.today.trip)
        XCTAssertEqual(mode.snapshot.tripId, response.today.trip.id)
        XCTAssertEqual(activity.synced, 1)
        XCTAssertFalse(mode.shouldOfferStart(for: response.today.trip))
    }

    func testStartOfferStaysHiddenForThisTripsActiveGuidance() throws {
        SharedStore.clear()
        defer { SharedStore.clear() }
        let response = try fixture()
        SharedStore.saveTravelMode(.init(state: .active, tripId: response.today.trip.id))
        let mode = travelMode(SettingsTravelSource(response), SettingsActivity())

        XCTAssertFalse(mode.shouldOfferStart(for: response.today.trip))
    }

    func testAnotherTripsGuidanceDoesNotOfferStartForAPreview() throws {
        SharedStore.clear()
        defer { SharedStore.clear() }
        let response = try fixture()
        let trip = response.today.trip
        let preview = TripSummary(id: trip.id, name: trip.name, start: trip.start, dayCount: trip.dayCount,
                                  revision: trip.revision, updatedAt: trip.updatedAt, timeZone: trip.timeZone,
                                  cities: trip.cities, todayIndex: -1, daysUntilStart: 1,
                                  role: trip.role, memberCount: trip.memberCount)
        SharedStore.saveTravelMode(.init(state: .active, tripId: "previous-trip"))
        let mode = travelMode(SettingsTravelSource(response), SettingsActivity())

        XCTAssertFalse(mode.shouldOfferStart(for: preview))
    }

    // MARK: 여행 중 안내 — 다시 켜지면 새로 받아 시작하는가

    func testReenableRestartsFromAFreshTravelState() async throws {
        SharedStore.clear()
        defer { SharedStore.clear() }
        let response = try fixture()
        let source = SettingsTravelSource(response)
        let activity = SettingsActivity()
        let mode = travelMode(source, activity)
        await mode.start(trip: response.today.trip)
        XCTAssertEqual(source.fetched, 1)
        XCTAssertEqual(activity.synced, 1)

        let reenable = try XCTUnwrap(activity.handler, "여행 중 안내가 다시 켜짐을 듣고 있어야 한다")
        reenable()
        await settle { activity.synced == 2 }
        XCTAssertEqual(source.fetched, 2, "다시 켜지면 서버에서 새로 받는다 — 잠금화면은 방금 받은 상태로만 시작한다")
        XCTAssertEqual(activity.synced, 2)
    }

    func testReenableDuringAnInFlightRefreshIsNotDropped() async throws {
        SharedStore.clear()
        defer { SharedStore.clear() }
        let response = try fixture()
        let source = SettingsTravelSource(response)
        let activity = SettingsActivity()
        let mode = travelMode(source, activity)
        source.delays = true
        let started = Task { await mode.start(trip: response.today.trip) }
        await settle { source.pending != nil }

        // 받는 중에 켜졌다 — 이 요청은 `isRefreshing`에 막힌다. 끝난 뒤 한 번 더 받아야 한다.
        try XCTUnwrap(activity.handler)()
        await settle { false }
        source.delays = false
        source.pending?.resume(returning: .init(value: response, cachedAt: nil))
        await started.value
        await settle { activity.synced == 2 }
        XCTAssertEqual(source.fetched, 2)
        XCTAssertEqual(activity.synced, 2)
    }

    func testReenableSeesTravelModeTurnedOnBySiriWhileAway() async throws {
        SharedStore.clear()
        defer { SharedStore.clear() }
        let response = try fixture()
        let source = SettingsTravelSource(response)
        let activity = SettingsActivity()
        let app = travelMode(source, activity)
        // Siri·단축어는 자기 환경에서 안내를 켜고 저장만 남긴다 — 앱은 아직 그 저장을 읽지 않았다.
        let siri = travelMode(SettingsTravelSource(response), SettingsActivity())
        await siri.start(trip: response.today.trip)
        XCTAssertFalse(app.isActive)

        await app.liveActivityReenabled()
        XCTAssertTrue(app.isActive)
        XCTAssertEqual(source.fetched, 1)
        XCTAssertEqual(activity.synced, 1)
    }

    func testReenableDoesNothingWhenTravelModeIsOff() async throws {
        SharedStore.clear()
        defer { SharedStore.clear() }
        let response = try fixture()
        let source = SettingsTravelSource(response)
        let activity = SettingsActivity()
        let mode = travelMode(source, activity)
        await mode.liveActivityReenabled()
        XCTAssertEqual(source.fetched, 0)

        await mode.start(trip: response.today.trip)
        await mode.stop()
        await mode.liveActivityReenabled()
        XCTAssertEqual(source.fetched, 1, "안내를 끈 뒤에는 설정을 다시 켜도 잠금화면을 띄우지 않는다")
        XCTAssertEqual(activity.synced, 1)
    }
}

@MainActor private final class SettingsAuthorization: LiveActivityAuthorization {
    let isSupported: Bool
    var areActivitiesEnabled: Bool
    var isAppActive = true
    private let stream: AsyncStream<Bool>
    private let continuation: AsyncStream<Bool>.Continuation
    init(enabled: Bool, supported: Bool = true) {
        areActivitiesEnabled = enabled
        isSupported = supported
        (stream, continuation) = AsyncStream.makeStream(of: Bool.self)
    }
    func enablementUpdates() -> AsyncStream<Bool> { stream }
    func set(_ enabled: Bool) { areActivitiesEnabled = enabled; continuation.yield(enabled) }
}

@MainActor private final class SettingsTravelSource: TravelStateSource {
    let response: TravelStateResponse
    var fetched = 0
    var delays = false
    var pending: CheckedContinuation<TripService.Fetched<TravelStateResponse>, Error>?
    init(_ response: TravelStateResponse) { self.response = response }
    func travelState(tripId: String, location: GeoPoint?, locationUpdatedAt: String?, travelMode: Bool,
                     suppressUntil: String?, markSent: Bool) async throws -> TripService.Fetched<TravelStateResponse> {
        fetched += 1
        if delays { return try await withCheckedThrowingContinuation { pending = $0 } }
        return .init(value: response, cachedAt: nil)
    }
}

@MainActor private final class SettingsPush: PushScheduling {
    func present(_ item: NotificationPlanItem) {}
}

@MainActor private final class SettingsLocationManager: LocationManaging {
    var delegate: (any CLLocationManagerDelegate)?
    var authorizationStatus: CLAuthorizationStatus = .denied
    func requestWhenInUseAuthorization() {}
    func requestLocation() {}
    func stopUpdatingLocation() {}
}

@MainActor private final class SettingsActivity: LiveActivityControlling {
    var synced = 0
    var handler: (@MainActor () -> Void)?
    func sync(_ response: TravelStateResponse, changed: Bool) async { synced += 1 }
    func end() async {}
    func onReenable(_ handler: @escaping @MainActor () -> Void) { self.handler = handler }
}
