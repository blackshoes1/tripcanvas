import Foundation
import Observation
#if canImport(ActivityKit)
import ActivityKit
#endif
#if canImport(WidgetKit)
import WidgetKit
#endif

/// Live Activity 생명주기. Travel Mode가 켜져 있을 때만 존재한다(§17).
///
/// **매분 갱신하지 않는다.** `stateVersion`이 그대로면 아무것도 하지 않는다 — 잠금화면을
/// 1분마다 다시 그리는 것은 그 자체로 배터리다(§21·§56).
/// 네트워크 오류로 상태를 못 받아도 마지막 유효 상태를 그대로 둔다 — 빈 화면으로 만들지 않는다(§59).
@Observable
@MainActor
final class LiveActivityController: LiveActivityControlling {
    private(set) var isRunning = false
    private(set) var lastError: String?

    #if canImport(ActivityKit)
    private var activity: Activity<TripCanvasActivityAttributes>?
    #endif

    func sync(_ response: TravelStateResponse, changed: Bool) async {
        #if canImport(ActivityKit)
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            // 사용자가 꺼 두었다 — 조용히 넘어간다. 핵심 앱 흐름을 깨지 않는다(§60).
            lastError = nil
            return
        }
        let state = TripCanvasActivityAttributes.ContentState(from: response.liveActivity)

        if let current = activity {
            // 지문이 같으면 갱신하지 않는다. 이것이 여기서 가장 중요한 한 줄이다.
            guard changed || current.content.state.stateVersion != state.stateVersion else { return }
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
                pushType: nil)      // remote update는 다음 단계 — 지금은 앱이 밀어준다
            isRunning = true
            Analytics.track(.liveActivityStarted, ["tripId": response.today.trip.id])
        } catch {
            // 실패해도 Today 화면은 그대로 동작해야 한다.
            lastError = error.localizedDescription
        }
        #endif
    }

    func end() async {
        #if canImport(ActivityKit)
        guard let current = activity else { return }
        await current.end(nil, dismissalPolicy: .immediate)
        activity = nil
        isRunning = false
        Analytics.track(.liveActivityEnded, [:])
        #endif
    }

    #if canImport(ActivityKit)
    /// 다음 고정 일정 시각이 지나면 이 화면은 낡은 것이다 — 시스템이 흐리게 처리하도록 알려 준다.
    private func staleDate(for response: TravelStateResponse) -> Date? {
        let iso = response.liveActivity.fixedStartISO ?? response.liveActivity.nextStartISO
        guard let iso, let date = ISO8601DateFormatter.tripCanvas.date(from: iso) else { return nil }
        return date.addingTimeInterval(30 * 60)
    }
    #endif
}

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
