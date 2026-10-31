import Foundation

// ActivityKit은 iOS 전용이다 — watchOS 타깃에는 모듈 자체가 없다.
// TripCanvasShared/ 는 앱·위젯·공유확장·Watch 네 타깃에 소스로 들어가므로
// Live Activity 정의는 반드시 이 가드 안에 있어야 한다.
// (포맷터처럼 플랫폼 무관한 것은 SharedFormatters.swift 로 뺐다.)
#if canImport(ActivityKit)
import ActivityKit
import SwiftUI

/// 잠금화면·Dynamic Island가 쓰는 상태. 앱과 위젯 확장이 **같은 정의**를 봐야 해서 공유 타깃에 둔다.
///
/// 여기에 여행 전체 일정표를 넣지 않는다(§75.5). 잠긴 화면에 계속 떠 있는 정보이므로
/// 예약번호·항공편·주소·좌표도 넣지 않는다(§54). 담는 것은 "지금 무엇을, 언제, 얼마나 걸려서"뿐이다.
struct TripCanvasActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// 다음에 할 일. 없으면 "오늘 남은 일정 없음".
        var nextTitle: String
        var shouldEnd: Bool?
        var target: LiveActivityTarget?
        var nowFocus: NowFocus?
        /// 원격 갱신으로 날짜·이름이 바뀌어도 최초 생성 시의 attributes에 묶이지 않는다.
        var tripName: String?
        var dayLabel: String?
        var nextStartAt: Date?
        var travelMinutes: Int?
        /// 서버가 만든 출발 안내 문장. 클라이언트가 다시 쓰지 않는다(톤이 갈라진다).
        var departureText: String?
        var status: TravelStatus
        /// 예정 시간 경과와 사용자가 표시한 방문 완료를 구분한다. 이전 상태에는 없다.
        var scheduleElapsed: Bool?
        /// 오늘 남은 고정 약속 — "13:00 Lunch" 한 줄.
        var fixedTitle: String?
        var fixedStartAt: Date?
        /// 하루 상태 한 마디. 내부 코드가 아니라 문장이다.
        var pulseText: String
        /// 이 값이 그대로면 갱신하지 않는다 — 불필요한 업데이트는 배터리다(§56).
        var stateVersion: String

        init(from state: LiveActivityState) {
            self.nextTitle = state.nextTitle
            self.shouldEnd = state.shouldEnd
            self.target = state.target
            self.nowFocus = state.nowFocus
            self.tripName = state.tripName
            self.dayLabel = state.dayLabel
            self.nextStartAt = ISO8601DateFormatter.tripCanvas.date(from: state.nextStartISO ?? "")
            self.travelMinutes = state.travelMinutes
            self.departureText = state.departureText
            self.status = state.status
            self.scheduleElapsed = state.scheduleElapsed
            self.fixedTitle = state.fixedTitle
            self.fixedStartAt = ISO8601DateFormatter.tripCanvas.date(from: state.fixedStartISO ?? "")
            self.pulseText = state.pulseText
            self.stateVersion = state.stateVersion
        }
    }

    let tripId: String
    let tripName: String
    let dayLabel: String
}

/// Dynamic Island·잠금화면이 공유하는 표시 규칙. 뷰마다 다시 쓰지 않는다.
enum ActivityPresentation {
    static func target(_ state: TripCanvasActivityAttributes.ContentState) -> LiveActivityTarget? {
        guard let focus = state.nowFocus, focus.kind != .unknown, focus.kind != .schedule else { return state.target }
        return focus.focusedTarget
    }

    static func title(_ state: TripCanvasActivityAttributes.ContentState) -> String {
        switch state.nowFocus?.kind {
        case .currentStay: state.nowFocus?.currentStay?.title ?? state.nextTitle
        case .freeTime: "자유시간"
        case .departure: state.nowFocus?.next?.title ?? state.nextTitle
        default: state.nextTitle
        }
    }

    static func travelMinutes(_ state: TripCanvasActivityAttributes.ContentState) -> Int? {
        switch state.nowFocus?.kind {
        case .currentStay, .freeTime: nil
        case .departure: state.nowFocus?.next?.travelMinutes ?? state.travelMinutes
        default: state.travelMinutes
        }
    }
    /// Compact trailing: "🚗 22m" — 정보를 극도로 압축한다(§20).
    static func compactTravel(_ minutes: Int?) -> String {
        guard let minutes, minutes > 0 else { return "" }
        return "\(minutes)m"
    }

    static func symbol(for status: TravelStatus) -> String {
        switch status {
        case .readyToLeave, .traveling: "figure.walk.departure"
        case .delayed: "exclamationmark.triangle.fill"
        case .inProgress, .arrived: "mappin.circle.fill"
        case .completed: "checkmark.circle.fill"
        case .noPlan: "sparkles"
        case .upcoming, .unknown: "clock.fill"
        }
    }

    static func symbol(for state: TripCanvasActivityAttributes.ContentState) -> String {
        if state.nowFocus?.kind == .freeTime { return "cup.and.saucer.fill" }
        if state.nowFocus?.kind == .currentStay { return "mappin.circle.fill" }
        if state.nowFocus?.kind == .departure { return "figure.walk.departure" }
        return state.scheduleElapsed == true ? "clock.fill" : symbol(for: state.status)
    }

    static func heading(_ state: TripCanvasActivityAttributes.ContentState) -> String {
        if state.nowFocus?.kind == .currentStay { return "지금 머무는 곳" }
        if state.nowFocus?.kind == .freeTime { return "지금" }
        if state.nowFocus?.kind == .departure { return "다음" }
        if state.scheduleElapsed == true { return "오늘" }
        return state.status == .inProgress || state.status == .arrived ? "지금" : "다음"
    }

    /// 잠금화면 한 줄 요약. 출발 안내가 있으면 그것이 가장 쓸모 있다.
    static func headline(_ state: TripCanvasActivityAttributes.ContentState) -> String {
        if state.nowFocus?.kind == .currentStay {
            return state.nowFocus?.currentStay?.status == .arrived ? "도착했어요" : "여기서 머무는 중이에요"
        }
        if state.nowFocus?.kind == .freeTime { return "다음 일정까지 여유가 있어요" }
        if state.nowFocus?.kind == .departure, let text = state.nowFocus?.next?.departureText { return text }
        if state.status == .arrived { return "도착했어요" }
        if let text = state.departureText, !text.isEmpty { return text }
        return state.pulseText
    }
}

/// 시스템이 잠금 상태에서도 숫자를 갱신한다. 분마다 ActivityKit 업데이트를 요청하지 않는다.
struct DepartureCountdown: View {
    let leaveAt: Date
    var compact = false
    var body: some View {
        HStack(spacing: 4) {
            if !compact { Text("출발까지") }
            Text(timerInterval: min(Date(), leaveAt)...leaveAt,
                 countsDown: true, showsHours: true)
                .monospacedDigit()
                .accessibilityIdentifier("nowDepartureCountdown")
        }
    }
}
#endif
