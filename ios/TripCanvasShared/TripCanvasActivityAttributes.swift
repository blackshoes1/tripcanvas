import Foundation

// ActivityKit은 iOS 전용이다 — watchOS 타깃에는 모듈 자체가 없다.
// TripCanvasShared/ 는 앱·위젯·공유확장·Watch 네 타깃에 소스로 들어가므로
// Live Activity 정의는 반드시 이 가드 안에 있어야 한다.
// (포맷터처럼 플랫폼 무관한 것은 SharedFormatters.swift 로 뺐다.)
#if canImport(ActivityKit)
import ActivityKit

/// 잠금화면·Dynamic Island가 쓰는 상태. 앱과 위젯 확장이 **같은 정의**를 봐야 해서 공유 타깃에 둔다.
///
/// 여기에 여행 전체 일정표를 넣지 않는다(§75.5). 잠긴 화면에 계속 떠 있는 정보이므로
/// 예약번호·항공편·주소·좌표도 넣지 않는다(§54). 담는 것은 "지금 무엇을, 언제, 얼마나 걸려서"뿐이다.
struct TripCanvasActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// 다음에 할 일. 없으면 "오늘 남은 일정 없음".
        var nextTitle: String
        var nextStartAt: Date?
        var travelMinutes: Int?
        /// 서버가 만든 출발 안내 문장. 클라이언트가 다시 쓰지 않는다(톤이 갈라진다).
        var departureText: String?
        var status: TravelStatus
        /// 오늘 남은 고정 약속 — "13:00 Lunch" 한 줄.
        var fixedTitle: String?
        var fixedStartAt: Date?
        /// 하루 상태 한 마디. 내부 코드가 아니라 문장이다.
        var pulseText: String
        /// 이 값이 그대로면 갱신하지 않는다 — 불필요한 업데이트는 배터리다(§56).
        var stateVersion: String

        init(from state: LiveActivityState) {
            self.nextTitle = state.nextTitle
            self.nextStartAt = ISO8601DateFormatter.tripCanvas.date(from: state.nextStartISO ?? "")
            self.travelMinutes = state.travelMinutes
            self.departureText = state.departureText
            self.status = state.status
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

    /// 잠금화면 한 줄 요약. 출발 안내가 있으면 그것이 가장 쓸모 있다.
    static func headline(_ state: TripCanvasActivityAttributes.ContentState) -> String {
        if let text = state.departureText, !text.isEmpty { return text }
        return state.pulseText
    }
}
#endif
