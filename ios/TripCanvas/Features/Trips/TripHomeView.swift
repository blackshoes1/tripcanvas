import SwiftUI

/// 여행 하나를 여는 화면. `지금`과 `일정`은 **형제다** — 하나가 다른 하나의 하위 화면이 아니다.
///
/// 예전에는 여행을 열면 언제나 `지금`이 뜨고 `일정`은 그 안의 툴바 버튼이었다. 그런데 출발 전에
/// 여는 여행은 대부분 "계획을 마저 짜려고" 여는 것이고, 그때 `지금`은 할 말이 없다(여행 기간 밖이다).
/// 그래서 무엇을 먼저 보일지는 **여행이 지금 진행 중인지**로 정한다.
struct TripHomeView: View {
    let trip: TripSummary
    /// 알림·딥링크가 목적지를 정해서 들어온 경우. nil이면 아래 규칙이 정한다.
    var requested: TripHomeTab?

    @State private var tab: TripHomeTab?

    var body: some View {
        // 사용자가 탭을 바꾸면 이 여행을 보는 동안 유지된다. 다시 들어오면 규칙이 다시 정한다 —
        // 어느 화면이 왜 떴는지 예측할 수 있어야 한다(기억을 디스크에 남기지 않는 이유).
        let selection = Binding(
            get: { tab ?? TripHomeTab.initial(isLive: trip.isLive, requested: requested) },
            set: { tab = $0 })

        VStack(spacing: 0) {
            // 목록에서 밀려 들어온 화면이라 탭바를 새로 깔지 않는다 — 계층 중간의 탭바는 뒤로가기를 흐린다.
            // 제목 자리도 쓰지 않는다: 거기엔 여행 이름이 있어야 한다(여행이 여러 개다).
            Picker("보기", selection: selection) {
                ForEach(TripHomeTab.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, Space.l)
            .padding(.vertical, Space.s)

            switch selection.wrappedValue {
            case .today: TodayView(trip: trip)
            case .plan: TripPlanView(trip: trip)
            }
        }
        .navigationTitle(trip.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// 여행 하나 안에서 나란히 있는 두 화면.
enum TripHomeTab: String, CaseIterable, Hashable, Sendable {
    case today
    case plan

    var label: String {
        switch self {
        case .today: return "지금"
        case .plan: return "일정"
        }
    }

    /// 처음 열었을 때 어느 쪽을 보일지.
    ///
    /// - `requested`(알림·딥링크로 들어온 목적지)가 있으면 **그것이 규칙을 이긴다.**
    ///   출발 알림을 눌렀는데 일정 편집 화면이 뜨면 안 된다.
    /// - 그 외에는 **여행이 지금 진행 중인지**로 정한다. 시작 전·끝난 뒤·날짜 없는 여행은
    ///   `지금`이 할 말이 없으므로 `일정`이다.
    ///
    /// ⚠️ `isLive`는 서버가 정한 `todayIndex >= 0`이다(`adaptive.js`의 `currentDayIndex`).
    /// 여기서 `start` 문자열을 오늘과 비교하지 않는다 — 시간대 판단이 엔진 안에 있고,
    /// 앱이 따로 계산하면 웹과 다른 날을 '오늘'이라고 부르게 된다.
    static func initial(isLive: Bool, requested: TripHomeTab?) -> TripHomeTab {
        if let requested { return requested }
        return isLive ? .today : .plan
    }
}
