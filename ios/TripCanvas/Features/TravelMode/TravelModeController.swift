import Foundation
import Observation
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Travel Mode — 여행 중에만 켜지는 상태(§7).
///
/// 켜져 있을 때만 앱이 먼저 말을 건다. 꺼져 있으면 계획을 보는 사람에게 출발 알림을 보내지 않는다.
/// 켜져 있어도 알림은 **상태가 바뀔 때만** 나간다 — 이 앱은 일정 알람 앱이 아니다(§42).
///
/// 갱신 주기를 시계로 돌리지 않는다. `stateVersion`이 그대로면 잠금화면도 위젯도 다시 그리지 않는다(§21·§56).
@Observable
@MainActor
final class TravelModeController {
    private(set) var snapshot: TravelModeSnapshot
    private(set) var travelState: TravelStateResponse?
    private(set) var responseSequence = 0
    private(set) var responseCachedAt: Date?
    private(set) var lastError: String?
    private(set) var isRefreshing = false
    private var accountGeneration = 0
    private var modeGeneration = 0
    private var refreshGeneration = 0
    private var lastPersistedSnapshot: TravelModeSnapshot
    /// 설정에서 실시간 현황을 다시 켠 횟수. 진행 중인 새로고침이 그 사이에 켜졌는지 알려고 센다.
    private var liveActivityRestarts = 0
    private var arrivalRefreshPending = false

    private let service: TravelStateSource
    private let location: LocationProvider
    private let push: PushScheduling
    private let liveActivity: LiveActivityControlling
    private let arrivalMonitor: (any ArrivalMonitoring)?
    private let arrivalContext: @MainActor (String) -> ArrivalMonitoringContext?

    init(service: TravelStateSource,
         location: LocationProvider,
         push: PushScheduling,
         liveActivity: LiveActivityControlling,
         arrivalMonitor: (any ArrivalMonitoring)? = nil,
         arrivalContext: @escaping @MainActor (String) -> ArrivalMonitoringContext? = { _ in nil }) {
        self.service = service
        self.location = location
        self.push = push
        self.liveActivity = liveActivity
        self.arrivalMonitor = arrivalMonitor; self.arrivalContext = arrivalContext
        let restored = SharedStore.loadTravelMode()?.value ?? TravelModeSnapshot()
        self.snapshot = restored; self.lastPersistedSnapshot = restored
        liveActivity.onReenable { [weak self] in Task { await self?.liveActivityReenabled() } }
        arrivalMonitor?.onObservation = { [weak self] context, event in
            await self?.recordArrival(context: context, event: event) ?? .discard
        }
    }

    /// 앱이 위치 이벤트로 다시 실행돼도 계정·실제 ActivityKit 활동이 맞을 때만 복구한다.
    func restoreArrivalMonitoring() {
        let tripID = isActive ? snapshot.tripId : nil
        arrivalMonitor?.restore(context: tripID.flatMap(arrivalContext), activeTripID: tripID)
    }

    func resetForAccountChange() {
        accountGeneration += 1
        modeGeneration += 1
        refreshGeneration += 1
        snapshot = TravelModeSnapshot()
        lastPersistedSnapshot = snapshot
        travelState = nil
        responseCachedAt = nil
        lastError = nil
        isRefreshing = false
        arrivalRefreshPending = false; arrivalMonitor?.stop()
        SharedStore.clear()
        WidgetRefresher.reload()
        Task { await liveActivity.end() }
    }

    var isActive: Bool { snapshot.isActive }
    var pulseText: String { travelState?.pulse.text ?? "" }

    /// Siri·단축어는 별도 환경 객체에서 같은 저장소를 바꾼다. 앱 복귀·요청 완료에서 다시 읽는다.
    func synchronizePersistedState() async {
        guard let stored = SharedStore.loadTravelMode()?.value, stored != lastPersistedSnapshot else { return }
        modeGeneration += 1
        refreshGeneration += 1; isRefreshing = false
        snapshot = stored; lastPersistedSnapshot = stored
        travelState = nil; lastError = nil
        responseCachedAt = nil
        restoreArrivalMonitoring()
        if !snapshot.isActive { await liveActivity.end() }
    }

    // MARK: 시작 / 종료 (§8·§9)

    /// 여행 당일이면 먼저 권해도 되는 상태인지. 자동으로 켜지는 않는다 — 제안만 한다.
    func shouldOfferStart(for trip: TripSummary) -> Bool {
        trip.isLive && (!isActive || snapshot.tripId != trip.id)
    }

    func start(trip: TripSummary) async {
        if snapshot.tripId != trip.id { arrivalMonitor?.stop() }
        modeGeneration += 1
        refreshGeneration += 1; isRefreshing = false
        snapshot.state = .active
        snapshot.tripId = trip.id
        snapshot.startedAt = Date()
        snapshot.lastStateVersion = nil
        persist()
        Analytics.track(.travelModeStarted, ["tripId": trip.id])
        await refresh(tripId: trip.id, reason: .started)
    }

    /// 하루가 끝났거나 사용자가 껐을 때. 진행 상태(무엇을 이미 알렸는지)는 남긴다 —
    /// 다시 켰을 때 같은 알림이 또 나가면 안 된다.
    func stop() async {
        arrivalRefreshPending = false; arrivalMonitor?.stop()
        modeGeneration += 1
        refreshGeneration += 1; isRefreshing = false
        Analytics.track(.travelModeEnded, ["tripId": snapshot.tripId ?? ""])
        snapshot.state = .inactive
        persist()
        await liveActivity.end()
    }

    /// 사용자가 설정에서 실시간 현황을 다시 켰다 — 그 자리에서 잠금화면 안내를 시작한다.
    /// 띄울 내용은 새로 받는다: 잠금화면 안내는 서버에서 방금 받은 상태로만 시작한다(`apply`).
    func liveActivityReenabled() async {
        // Siri·단축어가 앱 밖에서 안내를 켰을 수 있다 — 복귀 순서상 그 저장을 아직 안 읽었을 수 있다.
        await synchronizePersistedState()
        guard isActive, let tripId = snapshot.tripId else { return }
        liveActivityRestarts += 1
        await refresh(tripId: tripId, reason: .userAction)
    }

    /// 잠깐 멈춤 — 알림만 멈추고 화면은 그대로 둔다.
    func pause() {
        arrivalRefreshPending = false; arrivalMonitor?.stop()
        modeGeneration += 1
        snapshot.state = .paused
        persist()
    }

    /// "오늘은 쉬기" — 정해진 시간 동안 먼저 제안하지 않는다(§36).
    func rest(until date: Date) {
        snapshot.suppressUntil = date
        persist()
    }

    // MARK: 갱신
    //
    // 매분 polling하지 않는다. 앱이 앞으로 나오거나, 사용자가 무언가를 바꾸거나,
    // 알림을 열었을 때만 다시 묻는다.
    enum RefreshReason { case started, foreground, userAction, notificationOpened, manual, arrival }

    func refresh(tripId: String, reason: RefreshReason) async {
        if reason == .arrival, isRefreshing { arrivalRefreshPending = true; return }
        if reason == .arrival { arrivalRefreshPending = false }
        let restarts = liveActivityRestarts
        await refreshOnce(tripId: tripId, reason: reason)
        // 받는 사이에 실시간 현황이 다시 켜졌으면 그 요청은 `isRefreshing`에 막혔다 — 이 응답은 꺼져 있을 때
        // 잠금화면에 갔을 수 있으니 한 번 더 받는다. 한 번뿐이다: 오프라인이면 다음 복귀가 챙긴다.
        if liveActivityRestarts != restarts, !isRefreshing { await refreshOnce(tripId: tripId, reason: .userAction) }
        if arrivalRefreshPending, !isRefreshing, isActive, snapshot.tripId == tripId {
            arrivalRefreshPending = false
            await refreshOnce(tripId: tripId, reason: .arrival)
        }
    }

    private func refreshOnce(tripId: String, reason: RefreshReason) async {
        await synchronizePersistedState()
        guard isActive, snapshot.tripId == tripId else { return }
        guard !isRefreshing else { return }
        isRefreshing = true
        let generation = accountGeneration
        let mode = modeGeneration
        refreshGeneration += 1
        let request = refreshGeneration
        defer { if generation == accountGeneration, request == refreshGeneration { isRefreshing = false } }
        restoreArrivalMonitoring()
        if reason != .arrival { await arrivalMonitor?.retryPending() }

        // 위치는 Travel Mode가 켜져 있고 권한이 있을 때만, 그때그때 한 번씩만 묻는다(§5).
        var point: GeoPoint?
        if reason != .arrival, isActive, location.permission == .granted {
            if await location.requestOnce() != nil { point = location.freshArrivalPoint() }
        }

        do {
            guard generation == accountGeneration, mode == modeGeneration else { return }
            let fetched = try await service.travelState(
                tripId: tripId,
                location: point,
                locationUpdatedAt: point == nil ? nil : ISO8601DateFormatter.tripCanvas.string(from: Date()),
                travelMode: isActive,
                suppressUntil: suppressUntilMinutes(),
                markSent: false            // 조회는 계획만 받는다. 시스템 등록에 성공한 항목만 별도로 확인한다.
            )
            await synchronizePersistedState()
            guard generation == accountGeneration, mode == modeGeneration else { return }
            await apply(fetched.value, cachedAt: fetched.cachedAt)
            if fetched.cachedAt != nil { lastError = "지금은 연결이 없어 저장된 일정 기준으로 안내하고 있어요." }
        } catch let error as APIError where error.isOffline {
            guard generation == accountGeneration, mode == modeGeneration else { return }
            // 오프라인이어도 잠금화면을 비우지 않는다(§59) — 마지막 상태를 그대로 둔다.
            lastError = "지금은 연결이 없어 저장된 일정 기준으로 안내하고 있어요."
        } catch {
            guard generation == accountGeneration, mode == modeGeneration else { return }
            lastError = error.localizedDescription
        }
    }

    private func apply(_ response: TravelStateResponse, cachedAt: Date?) async {
        responseCachedAt = cachedAt
        travelState = response
        responseSequence += 1

        // 위젯은 앱 데이터를 복제하지 않는다 — 압축본만 넘긴다(§28).
        SharedStore.saveWidgetSnapshot(response.widget, savedAt: cachedAt ?? Date())
        SharedStore.saveActivityState(response.liveActivity, savedAt: cachedAt ?? Date())

        // 상태 지문이 그대로면 아무것도 다시 그리지 않는다. 이것이 배터리 정책의 핵심이다.
        let changed = snapshot.lastStateVersion != response.stateVersion
        snapshot.lastStateVersion = response.stateVersion

        if isActive, cachedAt == nil {
            let generation = accountGeneration
            let mode = modeGeneration
            // Intent의 perform이 끝나기 전에 잠금화면 시작·복구가 끝나야 한다.
            if response.liveActivity.shouldEnd == true {
                arrivalMonitor?.stop()
                await liveActivity.end()
            } else {
                await liveActivity.sync(response, changed: changed)
            }
            await synchronizePersistedState()
            guard generation == accountGeneration, mode == modeGeneration, isActive else { return }
            if response.liveActivity.shouldEnd != true {
                arrivalMonitor?.update(response, context: arrivalContext(response.today.trip.id))
            }
            lastError = liveActivity.lastError
            if response.liveActivity.shouldEnd != true { await scheduleDeviceNotifications(response) }
            guard generation == accountGeneration, mode == modeGeneration, isActive else { return }
        }
        WidgetRefresher.reload()
        persist()
    }

    /// 기기가 판단할 알림만 예약한다. 서버가 보낼 것(가격·재구성)까지 띄우면 두 번 온다(§11).
    private func scheduleDeviceNotifications(_ response: TravelStateResponse) async {
        let generation = accountGeneration, mode = modeGeneration
        await push.prepareForDelivery()
        guard generation == accountGeneration, mode == modeGeneration, isActive else { return }
        var delivered = response.notifications.filter { $0.origin == .device && snapshot.sentNotificationKeys.contains($0.dedupeKey) }
        let pending = response.notifications.filter { item in
            item.origin == .device && !snapshot.sentNotificationKeys.contains(item.dedupeKey)
        }
        for item in pending {
            let registered = await push.schedule(item)
            guard generation == accountGeneration, mode == modeGeneration, isActive else { return }
            guard registered else { continue }
            snapshot.sentNotificationKeys.append(item.dedupeKey)
            delivered.append(item)
            persist() // 서버 확인 응답이 유실돼도 이 기기에서 같은 알림을 다시 등록하지 않는다.
            Analytics.track(.departureNotificationSent, ["kind": item.kind.rawValue])
        }
        // 하루치만 들고 있으면 충분하다.
        if snapshot.sentNotificationKeys.count > 50 {
            snapshot.sentNotificationKeys.removeFirst(snapshot.sentNotificationKeys.count - 50)
        }
        if !delivered.isEmpty {
            do { try await service.acknowledgeNotifications(tripId: response.today.trip.id, items: delivered, stateVersion: response.stateVersion) }
            catch {
                guard generation == accountGeneration, mode == modeGeneration else { return }
                if lastError == nil { lastError = "알림은 등록했지만 서버 확인 기록에 연결하지 못했어요. 다음 확인 때 다시 시도해요." }
            }
        }
    }

    private func suppressUntilMinutes() -> String? {
        guard let until = snapshot.suppressUntil, until > Date() else { return nil }
        let calendar = Calendar.current
        let parts = calendar.dateComponents([.hour, .minute], from: until)
        guard let hour = parts.hour, let minute = parts.minute else { return nil }
        return String(format: "%02d:%02d", hour, minute)
    }

    private func recordArrival(context: ArrivalMonitoringContext, event: LiveActivityArrivalRequest) async -> ArrivalReportResult {
        await synchronizePersistedState()
        guard isActive, snapshot.tripId == event.tripId, arrivalContext(event.tripId) == context,
              context.deviceId == event.deviceId, context.activityId == event.activityId else { return .discard }
        let account = accountGeneration, mode = modeGeneration
        do {
            try await service.reportArrival(event)
            guard !Task.isCancelled, account == accountGeneration, mode == modeGeneration,
                  isActive, arrivalContext(event.tripId) == context else { return .discard }
            await refresh(tripId: event.tripId, reason: .arrival)
            return .recorded
        } catch {
            guard account == accountGeneration, mode == modeGeneration else { return .discard }
            if let error = error as? APIError {
                switch error {
                case .unauthorized, .forbidden, .notFound, .badRequest: return .discard
                case .stale, .revisionConflict:
                    await refresh(tripId: event.tripId, reason: .arrival)
                    return .discard
                default: break
                }
            }
            lastError = "도착 확인을 보내지 못했어요. 연결되면 다시 확인해요."
            return .retry
        }
    }

    private func persist() { lastPersistedSnapshot = snapshot; SharedStore.saveTravelMode(snapshot) }
}

/// Travel Mode가 필요로 하는 것만 추린 계약 — 테스트에서 가짜로 갈아끼운다.
@MainActor
protocol TravelStateSource {
    func travelState(tripId: String, location: GeoPoint?, locationUpdatedAt: String?,
                     travelMode: Bool, suppressUntil: String?, markSent: Bool) async throws -> TripService.Fetched<TravelStateResponse>
    func acknowledgeNotifications(tripId: String, items: [NotificationPlanItem], stateVersion: String) async throws
    func reportArrival(_ request: LiveActivityArrivalRequest) async throws
}
extension TravelStateSource {
    func acknowledgeNotifications(tripId: String, items: [NotificationPlanItem], stateVersion: String) async throws {}
    func reportArrival(_ request: LiveActivityArrivalRequest) async throws { throw APIError.badRequest("도착 자동 확인을 지원하지 않아요.") }
}

@MainActor
protocol PushScheduling {
    func present(_ item: NotificationPlanItem)
    func prepareForDelivery() async
    func schedule(_ item: NotificationPlanItem) async -> Bool
}
extension PushScheduling {
    func prepareForDelivery() async {}
    func schedule(_ item: NotificationPlanItem) async -> Bool { present(item); return true }
}

@MainActor
protocol LiveActivityControlling {
    var lastError: String? { get }
    func sync(_ response: TravelStateResponse, changed: Bool) async
    func end() async
    /// 사용자가 설정에서 실시간 현황을 다시 켰을 때 부를 것.
    func onReenable(_ handler: @escaping @MainActor () -> Void)
}

extension LiveActivityControlling {
    var lastError: String? { nil }
    func onReenable(_ handler: @escaping @MainActor () -> Void) {}
}
