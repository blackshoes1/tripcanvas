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
    private(set) var lastError: String?
    private(set) var isRefreshing = false

    private let service: TravelStateSource
    private let location: LocationProvider
    private let push: PushScheduling
    private let liveActivity: LiveActivityControlling

    init(service: TravelStateSource,
         location: LocationProvider,
         push: PushScheduling,
         liveActivity: LiveActivityControlling) {
        self.service = service
        self.location = location
        self.push = push
        self.liveActivity = liveActivity
        self.snapshot = SharedStore.loadTravelMode()?.value ?? TravelModeSnapshot()
    }

    var isActive: Bool { snapshot.isActive }
    var pulseText: String { travelState?.pulse.text ?? "" }

    // MARK: 시작 / 종료 (§8·§9)

    /// 여행 당일이면 먼저 권해도 되는 상태인지. 자동으로 켜지는 않는다 — 제안만 한다.
    func shouldOfferStart(for trip: TripSummary) -> Bool {
        trip.isLive && !isActive
    }

    func start(trip: TripSummary) async {
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
        Analytics.track(.travelModeEnded, ["tripId": snapshot.tripId ?? ""])
        snapshot.state = .inactive
        persist()
        await liveActivity.end()
    }

    /// 잠깐 멈춤 — 알림만 멈추고 화면은 그대로 둔다.
    func pause() {
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
    enum RefreshReason { case started, foreground, userAction, notificationOpened, manual }

    func refresh(tripId: String, reason: RefreshReason) async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        // 위치는 Travel Mode가 켜져 있고 권한이 있을 때만, 그때그때 한 번씩만 묻는다(§5).
        var point: GeoPoint?
        if isActive, location.permission == .granted {
            point = await location.requestOnce()
        }

        do {
            let response = try await service.travelState(
                tripId: tripId,
                location: point,
                locationUpdatedAt: point == nil ? nil : ISO8601DateFormatter.tripCanvas.string(from: Date()),
                travelMode: isActive,
                suppressUntil: suppressUntilMinutes(),
                markSent: isActive          // 켜져 있을 때만 '보낸 것'으로 기록한다
            )
            apply(response)
            lastError = nil
        } catch let error as APIError where error.isOffline {
            // 오프라인이어도 잠금화면을 비우지 않는다(§59) — 마지막 상태를 그대로 둔다.
            lastError = "지금은 연결이 없어 저장된 일정 기준으로 안내하고 있어요."
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func apply(_ response: TravelStateResponse) {
        travelState = response

        // 위젯은 앱 데이터를 복제하지 않는다 — 압축본만 넘긴다(§28).
        SharedStore.saveWidgetSnapshot(response.widget)
        SharedStore.saveActivityState(response.liveActivity)

        // 상태 지문이 그대로면 아무것도 다시 그리지 않는다. 이것이 배터리 정책의 핵심이다.
        let changed = snapshot.lastStateVersion != response.stateVersion
        snapshot.lastStateVersion = response.stateVersion

        if isActive {
            Task { await liveActivity.sync(response, changed: changed) }
            scheduleDeviceNotifications(response)
        }
        WidgetRefresher.reload()
        persist()
    }

    /// 기기가 판단할 알림만 예약한다. 서버가 보낼 것(가격·재구성)까지 띄우면 두 번 온다(§11).
    private func scheduleDeviceNotifications(_ response: TravelStateResponse) {
        let pending = response.notifications.filter { item in
            item.origin == .device && !snapshot.sentNotificationKeys.contains(item.dedupeKey)
        }
        guard !pending.isEmpty else { return }
        for item in pending {
            push.present(item)
            snapshot.sentNotificationKeys.append(item.dedupeKey)
            Analytics.track(.departureNotificationSent, ["kind": item.kind.rawValue])
        }
        // 하루치만 들고 있으면 충분하다.
        if snapshot.sentNotificationKeys.count > 50 {
            snapshot.sentNotificationKeys.removeFirst(snapshot.sentNotificationKeys.count - 50)
        }
    }

    private func suppressUntilMinutes() -> String? {
        guard let until = snapshot.suppressUntil, until > Date() else { return nil }
        let calendar = Calendar.current
        let parts = calendar.dateComponents([.hour, .minute], from: until)
        guard let hour = parts.hour, let minute = parts.minute else { return nil }
        return String(format: "%02d:%02d", hour, minute)
    }

    private func persist() { SharedStore.saveTravelMode(snapshot) }
}

/// Travel Mode가 필요로 하는 것만 추린 계약 — 테스트에서 가짜로 갈아끼운다.
@MainActor
protocol TravelStateSource {
    func travelState(tripId: String, location: GeoPoint?, locationUpdatedAt: String?,
                     travelMode: Bool, suppressUntil: String?, markSent: Bool) async throws -> TravelStateResponse
}

@MainActor
protocol PushScheduling {
    func present(_ item: NotificationPlanItem)
}

@MainActor
protocol LiveActivityControlling {
    func sync(_ response: TravelStateResponse, changed: Bool) async
    func end() async
}
