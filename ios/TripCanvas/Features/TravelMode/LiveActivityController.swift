import Foundation
import Observation
import UIKit
#if canImport(ActivityKit)
import ActivityKit
#endif
#if canImport(WidgetKit)
import WidgetKit
#endif

/// 시스템에 남은 안내를 재사용하고, 다른 여행·중복 안내만 종료한다.
enum LiveActivityRecovery {
    struct Existing: Equatable {
        let id: String
        let tripId: String
        let tripName: String
        let dayLabel: String
    }
    struct Decision: Equatable {
        let reuseID: String?
        let endIDs: [String]
    }
    static func decide(_ existing: [Existing], tripId: String, tripName: String, dayLabel: String) -> Decision {
        let reuse = existing.first { $0.tripId == tripId && $0.tripName == tripName && $0.dayLabel == dayLabel }?.id
        return Decision(reuseID: reuse, endIDs: existing.filter { $0.id != reuse }.map(\.id))
    }

    #if canImport(ActivityKit)
    static func shouldRefresh(current: TripCanvasActivityAttributes.ContentState,
                              latest: TripCanvasActivityAttributes.ContentState, changed: Bool) -> Bool {
        // 분마다 달라지는 안내 문구는 서버의 상태 지문을 따른다. 새 링크만 별도로 복구한다.
        changed || current.stateVersion != latest.stateVersion || current.target != latest.target
    }
    #endif
}

/// 시스템의 '실시간 현황' 허용. 사용자는 앱 밖(설정 앱의 With J 페이지)에서 켜고 끈다 — 테스트에서 갈아끼운다.
@MainActor
protocol LiveActivityAuthorization {
    /// 이 빌드가 실시간 현황을 띄울 수 있는가. 무료 계정 빌드(`project-free.yml`)는 키도 확장도 없어
    /// 설정에 스위치가 없다 — 그때 '설정에서 켜기'는 갈 곳이 없으니 꺼져 있다고 말하지 않는다.
    var isSupported: Bool { get }
    var areActivitiesEnabled: Bool { get }
    /// 앱이 앞에 있는가. 실시간 현황은 앞에 있을 때만 시작할 수 있다(`ActivityAuthorizationError.visibility`).
    var isAppActive: Bool { get }
    /// 켜고 끌 때마다 새 값을 낸다.
    func enablementUpdates() -> AsyncStream<Bool>
}

struct SystemLiveActivityAuthorization: LiveActivityAuthorization {
    var isSupported: Bool { Bundle.main.object(forInfoDictionaryKey: "NSSupportsLiveActivities") as? Bool == true }

    var areActivitiesEnabled: Bool {
        #if canImport(ActivityKit)
        ActivityAuthorizationInfo().areActivitiesEnabled
        #else
        false
        #endif
    }

    var isAppActive: Bool { UIApplication.shared.applicationState == .active }

    func enablementUpdates() -> AsyncStream<Bool> {
        #if canImport(ActivityKit)
        AsyncStream { continuation in
            let info = ActivityAuthorizationInfo()
            let task = Task {
                for await enabled in info.activityEnablementUpdates { continuation.yield(enabled) }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
        #else
        AsyncStream { $0.finish() }
        #endif
    }
}

/// Live Activity 생명주기. Travel Mode가 켜져 있을 때만 존재한다(§17).
///
/// **매분 갱신하지 않는다.** `stateVersion`이 그대로면 아무것도 하지 않는다 — 잠금화면을
/// 1분마다 다시 그리는 것은 그 자체로 배터리다(§21·§56).
/// 네트워크 오류로 상태를 못 받아도 마지막 유효 상태를 그대로 둔다 — 빈 화면으로 만들지 않는다(§59).
///
/// ⚠️ **실시간 현황이 꺼져 있으면 그 사실을 들고 있는다**(`isDisabledInSettings`, 2026-10-26). 전에는 조용히
/// 넘어가기만 해서, 첫 안내 밑의 '허용 안 함'을 한 번 누른 사람은 '여행 중 안내'가 켜져 보이는데 잠금화면에는
/// 아무것도 없고 이유도 들을 수 없었다. 지금은 `지금`이 설정으로 보내고, 다시 켜지면 `onReenable`로 알린다.
/// ⚠️ 다시 켜짐은 **앱이 앞에 있을 때만** 알린다 — 설정에서 켜는 동안 앱은 뒤에 있고, 그때 시작하면
/// `.visibility`로 거절된다. 뒤에서 알게 된 것은 들고 있다가 앞으로 올 때(`sceneBecameActive`) 알린다.
/// ⚠️ 실제로는 복귀 때 다시 읽기가 **주 경로**다 — 시뮬레이터(iOS 26.5·27)에서 설정을 켜고 꺼도
/// `activityEnablementUpdates`는 한 번도 오지 않았다(2026-10-26). 스트림은 앱이 앞에 있는 동안의 변화를 위한 보조다.
@Observable
@MainActor
final class LiveActivityController: LiveActivityControlling {
    private(set) var isRunning = false
    private(set) var lastError: String?
    /// 사용자가 설정에서 실시간 현황을 꺼 두었다. 꺼 둔 것은 사용자의 선택이라 앱 흐름을 막지 않는다(§60).
    private(set) var isDisabledInSettings: Bool
    /// '이대로 둘게요'. 여행 중 안내를 끄거나 설정이 바뀔 때까지 다시 말하지 않는다 — 기기에 남겨 앱을 다시 열어도 지킨다.
    private(set) var isNoticeDismissed: Bool
    @ObservationIgnored private let defaults: UserDefaults
    private static let dismissedKey = "withj.liveActivity.noticeDismissed.v1"
    @ObservationIgnored private var reenableHandler: (@MainActor () -> Void)?
    /// 다시 켜졌는데 아직 시작하지 못했다(앱이 뒤에 있었다·시작이 `.visibility`로 거절됐다).
    @ObservationIgnored private var restartWhenActive = false
    private var generation = 0
    private let authorization: LiveActivityAuthorization
    @ObservationIgnored private nonisolated(unsafe) var enablementTask: Task<Void, Never>?
    @ObservationIgnored private nonisolated(unsafe) var pushTokenTask: Task<Void, Never>?
    @ObservationIgnored private nonisolated(unsafe) var activityStateTask: Task<Void, Never>?
    private let remoteSource: LiveActivityPushSource?
    private let pushRegistration: LiveActivityPushRegistration?
    private var observedActivityID: String?
    private var observedDeviceID: String?
    private var observedScope: TripCache.Scope?
    private static let startsKey = "withj.liveActivity.remoteStarts.v1"
    var remoteUpdatesError: String? { pushRegistration?.error }

    #if canImport(ActivityKit)
    private var activity: Activity<TripCanvasActivityAttributes>?
    #endif

    /// 기본값은 init 안에서 만든다 — 기본 인자는 메인 액터 밖에서 평가된다.
    init(authorization: LiveActivityAuthorization? = nil, defaults: UserDefaults = .standard,
         remoteSource: LiveActivityPushSource? = nil) {
        let authorization = authorization ?? SystemLiveActivityAuthorization()
        self.authorization = authorization
        self.defaults = defaults
        self.remoteSource = remoteSource
        self.pushRegistration = remoteSource.map { LiveActivityPushRegistration(source: $0, defaults: defaults) }
        let disabled = authorization.isSupported && !authorization.areActivitiesEnabled
        self.isDisabledInSettings = disabled
        // 앱이 꺼져 있는 동안 켜졌다면 접어 둔 것은 지난 일이다.
        if !disabled { defaults.removeObject(forKey: Self.dismissedKey) }
        self.isNoticeDismissed = disabled && defaults.bool(forKey: Self.dismissedKey)
        let updates = authorization.enablementUpdates()
        enablementTask = Task { [weak self] in
            for await enabled in updates {
                guard let self else { return }
                self.applyEnablement(enabled, appActive: self.authorization.isAppActive)
            }
        }
    }

    deinit { enablementTask?.cancel(); pushTokenTask?.cancel(); activityStateTask?.cancel() }

    /// 꺼져 있던 실시간 현황이 다시 켜졌을 때 부를 것. 띄울 내용은 부르는 쪽이 새로 받는다(`TravelModeController`).
    func onReenable(_ handler: @escaping @MainActor () -> Void) { reenableHandler = handler }

    /// 앱이 앞으로 왔다 — 설정에서 돌아오는 길이 대개 이것이다. 스트림이 늦거나 뒤에서 왔어도 여기서 맞춘다.
    func sceneBecameActive() {
        // 접어 둔 것은 Siri·단축어의 환경(같은 저장소, 다른 컨트롤러)이 지웠을 수 있다 — 저장된 쪽을 따른다.
        isNoticeDismissed = isDisabledInSettings && defaults.bool(forKey: Self.dismissedKey)
        applyEnablement(authorization.areActivitiesEnabled, appActive: true)
    }

    func dismissNotice() { setNoticeDismissed(true) }

    /// 잠금 중 재실행 때도 시스템에 남아 있는 이 여행의 안내만 사용한다.
    func arrivalContext(for tripId: String, accountID: String?) -> ArrivalMonitoringContext? {
        guard let accountID, authorization.areActivitiesEnabled,
              remoteSource?.liveActivityRegistrationScope?.accountID == accountID else { return nil }
        #if canImport(ActivityKit)
        guard let current = Activity<TripCanvasActivityAttributes>.activities.first(where: {
            $0.attributes.tripId == tripId && ($0.activityState == .active || $0.activityState == .stale)
        }) else { return nil }
        return ArrivalMonitoringContext(accountID: accountID, deviceId: DeviceIdentity.current, activityId: current.id)
        #else
        return nil
        #endif
    }

    /// 꺼짐·켜짐이 바뀌면 접어 둔 것은 잊는다 — 어느 길로 알게 됐든(스트림·복귀·`sync`) 같은 규칙이다.
    private func setDisabled(_ disabled: Bool) {
        if disabled != isDisabledInSettings { setNoticeDismissed(false) }
        isDisabledInSettings = disabled
    }

    private func setNoticeDismissed(_ dismissed: Bool) {
        isNoticeDismissed = dismissed
        if dismissed { defaults.set(true, forKey: Self.dismissedKey) } else { defaults.removeObject(forKey: Self.dismissedKey) }
    }

    /// 꺼짐 → 켜짐을 한 번만 알린다 — 켜진 채로 같은 값이 다시 와도(스트림과 복귀가 겹쳐도) 두 번 시작하지 않는다.
    private func applyEnablement(_ enabled: Bool, appActive: Bool) {
        guard authorization.isSupported else { return }
        let wasDisabled = isDisabledInSettings
        setDisabled(!enabled)
        guard enabled else {
            restartWhenActive = false
            stopRemoteObservation()
            return
        }
        if wasDisabled { restartWhenActive = true }
        guard appActive, restartWhenActive else { return }
        restartWhenActive = false
        reenableHandler?()
    }

    func sync(_ response: TravelStateResponse, changed: Bool) async {
        if response.liveActivity.shouldEnd == true {
            await end()
            return
        }
        #if canImport(ActivityKit)
        generation += 1
        let request = generation
        guard authorization.areActivitiesEnabled else {
            // 사용자가 꺼 두었다 — 핵심 앱 흐름은 깨지 않되(§60), 꺼져 있다는 사실은 `지금`이 말한다.
            setDisabled(authorization.isSupported)
            lastError = nil
            return
        }
        setDisabled(false)
        restartWhenActive = false
        let state = TripCanvasActivityAttributes.ContentState(from: response.liveActivity)
        let trip = response.today.trip
        let dayLabel = response.liveActivity.dayLabel
        var running = Activity<TripCanvasActivityAttributes>.activities.filter { $0.activityState == .active || $0.activityState == .stale }
        // 이전 앱의 pushType:nil 안내는 앞에 있을 때 한 번 다시 만들어 원격 갱신에 연결한다.
        if remoteSource != nil, authorization.isAppActive {
            let known = defaults.dictionary(forKey: Self.startsKey) ?? [:]
            for old in running where known[old.id] == nil && old.pushToken == nil {
                await old.end(nil, dismissalPolicy: .immediate)
                guard request == generation else { return }
            }
            running = running.filter { $0.activityState == .active || $0.activityState == .stale }
        }
        let recovery = LiveActivityRecovery.decide(running.map {
            .init(id: $0.id, tripId: $0.attributes.tripId, tripName: $0.attributes.tripName, dayLabel: $0.attributes.dayLabel)
        }, tripId: trip.id, tripName: trip.name, dayLabel: dayLabel)
        for old in running where recovery.endIDs.contains(old.id) {
            removeRemoteActivity(old.id)
            await old.end(nil, dismissalPolicy: .immediate)
            guard request == generation else { return }
        }
        // 종료를 기다리는 동안 다른 호출이 이미 만들었을 수 있으므로 생성 바로 전에 다시 확인한다.
        activity = Activity<TripCanvasActivityAttributes>.activities.first {
            ($0.activityState == .active || $0.activityState == .stale) && $0.attributes.tripId == trip.id
                && $0.attributes.tripName == trip.name && $0.attributes.dayLabel == dayLabel
        }
        if let current = activity {
            isRunning = true; lastError = nil
            observeRemoteUpdates(current, tripId: trip.id)
            // 이전 앱이 같은 지문으로 보관한 상태에도 새 링크 필드를 한 번 반영한다.
            guard LiveActivityRecovery.shouldRefresh(current: current.content.state, latest: state, changed: changed) else { return }
            await current.update(ActivityContent(state: state, staleDate: staleDate(for: response)))
            return
        }

        let attributes = TripCanvasActivityAttributes(
            tripId: response.today.trip.id,
            tripName: response.today.trip.name,
            dayLabel: response.liveActivity.dayLabel)
        do {
            activity = try Activity.request(
                attributes: attributes,
                content: ActivityContent(state: state, staleDate: staleDate(for: response)),
                pushType: .token)
            if let activity {
                var starts = defaults.dictionary(forKey: Self.startsKey) ?? [:]
                starts[activity.id] = Date().timeIntervalSince1970
                defaults.set(starts, forKey: Self.startsKey)
                observeRemoteUpdates(activity, tripId: trip.id)
            }
            isRunning = true
            lastError = nil
            Analytics.track(.liveActivityStarted, ["tripId": response.today.trip.id])
        } catch let error as ActivityAuthorizationError where error.isDenied {
            // 확인한 직후에 설정에서 꺼졌다 — 오류 문장이 아니라 꺼져 있다는 사실로 말한다.
            setDisabled(authorization.isSupported)
            lastError = nil
        } catch let error as ActivityAuthorizationError where error.isVisibility {
            // 앱이 뒤에 있었다 — 고장이 아니다. 앞으로 오면 다시 시작한다.
            restartWhenActive = true
            lastError = nil
        } catch {
            // 실패해도 Today 화면은 그대로 동작해야 한다.
            lastError = error.localizedDescription
        }
        #endif
    }

    func end() async {
        generation += 1
        lastError = nil
        stopRemoteObservation()
        pushRegistration?.reset()
        // 안내를 껐다 — 다시 켜졌다고 되살릴 것도, 접어 둔 안내도 없다.
        restartWhenActive = false
        setNoticeDismissed(false)
        #if canImport(ActivityKit)
        let running = Activity<TripCanvasActivityAttributes>.activities
        activity = nil
        isRunning = false
        var starts = defaults.dictionary(forKey: Self.startsKey) ?? [:]
        for current in running { starts.removeValue(forKey: current.id) }
        defaults.set(starts, forKey: Self.startsKey)
        for current in running { await current.end(nil, dismissalPolicy: .immediate) }
        Analytics.track(.liveActivityEnded, [:])
        #endif
    }

    #if canImport(ActivityKit)
    private func observeRemoteUpdates(_ current: Activity<TripCanvasActivityAttributes>, tripId: String) {
        guard let remoteSource, pushRegistration != nil,
              let scope = remoteSource.liveActivityRegistrationScope, scope.accountID != nil else { return }
        if observedActivityID == current.id, observedScope == scope {
            if let token = current.pushToken {
                Task { await register(token, activity: current, tripId: tripId, scope: scope) }
            }
            return
        }
        stopRemoteObservation()
        observedActivityID = current.id; observedDeviceID = DeviceIdentity.current; observedScope = scope
        pushTokenTask = Task { [weak self] in
            if let token = current.pushToken { await self?.register(token, activity: current, tripId: tripId, scope: scope) }
            for await token in current.pushTokenUpdates {
                guard !Task.isCancelled else { return }
                await self?.register(token, activity: current, tripId: tripId, scope: scope)
            }
        }
        activityStateTask = Task { [weak self] in
            for await state in current.activityStateUpdates {
                guard !Task.isCancelled else { return }
                if state == .ended || state == .dismissed {
                    self?.removeRemoteActivity(current.id)
                    self?.isRunning = false
                    return
                }
            }
        }
    }

    private func register(_ token: Data, activity: Activity<TripCanvasActivityAttributes>, tripId: String,
                          scope: TripCache.Scope) async {
        guard observedActivityID == activity.id, observedScope == scope,
              remoteSource?.liveActivityRegistrationScope == scope, let deviceId = observedDeviceID,
              let pushRegistration else { return }
        var starts = defaults.dictionary(forKey: Self.startsKey) ?? [:]
        let startedAt = starts[activity.id] as? Double ?? Date().timeIntervalSince1970
        starts[activity.id] = startedAt
        defaults.set(starts, forKey: Self.startsKey)
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        await pushRegistration.register(deviceId: deviceId, activityId: activity.id, tripId: tripId,
            token: token.map { String(format: "%02x", $0) }.joined(), environment: environment,
            startedAt: Date(timeIntervalSince1970: startedAt))
    }

    /// 일정 경계를 지나도 갱신이 도착하지 않으면 최근 안내임을 표시한다.
    private func staleDate(for response: TravelStateResponse) -> Date? {
        TodayRefreshTiming.nextBoundary(for: response.today)?.addingTimeInterval(30)
    }
    #endif

    private func removeRemoteActivity(_ id: String) {
        guard observedActivityID == id else { return }
        stopRemoteObservation()
        var starts = defaults.dictionary(forKey: Self.startsKey) ?? [:]
        starts.removeValue(forKey: id)
        defaults.set(starts, forKey: Self.startsKey)
    }

    private func stopRemoteObservation() {
        pushTokenTask?.cancel(); pushTokenTask = nil
        activityStateTask?.cancel(); activityStateTask = nil
        let id = observedActivityID, device = observedDeviceID, scope = observedScope
        observedActivityID = nil; observedDeviceID = nil; observedScope = nil
        if let id, let device, let pushRegistration {
            Task { await pushRegistration.remove(deviceId: device, activityId: id, scope: scope) }
        }
    }
}

#if canImport(ActivityKit)
private extension ActivityAuthorizationError {
    var isDenied: Bool {
        switch self {
        case .denied: true
        default: false
        }
    }
    var isVisibility: Bool {
        switch self {
        case .visibility: true
        default: false
        }
    }
}
#endif

/// 위젯 타임라인 갱신을 한 곳에 가둔다 — 화면 코드가 WidgetKit을 직접 부르지 않게.
enum WidgetRefresher {
    static func reload() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadTimelines(ofKind: "TripCanvasTodayWidget")
        #endif
    }
}

/// 이벤트 기록 — 실제 provider는 아직 붙이지 않는다(§61). 형태만 맞춰 쌓아 둔다.
enum Analytics {
    enum Event: String {
        case travelModeStarted = "travel_mode_started"
        case travelModeEnded = "travel_mode_ended"
        case departureNotificationSent = "departure_notification_sent"
        case notificationOpened = "notification_opened"
        case liveActivityStarted = "live_activity_started"
        case liveActivityEnded = "live_activity_ended"
        case widgetOpened = "widget_opened"
        case locationSuggestionShown = "location_suggestion_shown"
        case locationSuggestionAccepted = "location_suggestion_accepted"
        case replanNotificationOpened = "replan_notification_opened"
        case intentUsed = "intent_used"
        case shareReceived = "share_received"
        case shareParsed = "share_parsed"
        case bookingImportPreviewed = "booking_import_previewed"
        case bookingImportAccepted = "booking_import_accepted"
        case bookingImportCorrected = "booking_import_corrected"
        case watchOpened = "watch_opened"
        case memoryCreated = "memory_created"
        case photoAttached = "photo_attached"
    }

    /// 최근 것만 들고 있는다. 외부로 보내지 않는다 — 보낼 곳이 정해지면 여기만 바꾼다.
    private(set) nonisolated(unsafe) static var recent: [(name: String, at: Date, props: [String: String])] = []

    static func track(_ event: Event, _ props: [String: String] = [:]) {
        recent.append((event.rawValue, Date(), props))
        if recent.count > 200 { recent.removeFirst(recent.count - 200) }
    }
}
