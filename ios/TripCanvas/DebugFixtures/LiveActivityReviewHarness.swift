#if DEBUG
import SwiftUI

/// 실시간 현황이 꺼진 `지금`의 안내를 합성 허용으로 보인다. 시스템 스위치는 UI 테스트가 켜고 끌 수 없어
/// 허용만 가짜로 두고, 안내 띠·보일지 판정(`isShown`)·컨트롤러는 앱의 것을 쓴다. 앱이 뒤로 가면(설정 앱이
/// 열리면) 사용자가 거기서 켠 것으로 친다. ⚠️ 복귀 때 `sceneBecameActive`를 부르는 것은 앱(`TripCanvasApp`)이
/// 아니라 이 하네스다 — 앱 쪽 호출은 실제 설정 스위치로 따로 확인했다(PR 본문).
@MainActor struct LiveActivityReviewHarness: View {
    @State private var authorization = ReviewLiveActivityAuthorization()
    /// 접어 둔 것이 실행 사이에 남으면 다음 UI 테스트에서 안내가 안 보인다 — 매번 비운 저장소를 쓴다.
    @State private var defaults: UserDefaults = {
        let defaults = UserDefaults(suiteName: "live-activity-review") ?? .standard
        defaults.removePersistentDomain(forName: "live-activity-review")
        return defaults
    }()
    @State private var controller: LiveActivityController?
    @State private var restarts = 0
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.m) {
                    if let controller, LiveActivitySettingsNotice.isShown(travelModeTripId: "review", tripId: "review",
                        disabledInSettings: controller.isDisabledInSettings, dismissed: controller.isNoticeDismissed) {
                        LiveActivitySettingsNotice { controller.dismissNotice() }
                    }
                    Text("다시 시작 \(restarts)번").accessibilityIdentifier("liveActivityRestarts")
                }.padding(Space.l)
            }.paperGround().navigationTitle("합성 실시간 현황")
        }
        .task {
            let live = LiveActivityController(authorization: authorization, defaults: defaults)
            live.onReenable { restarts += 1 }
            controller = live
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { authorization.areActivitiesEnabled = true }
            if phase == .active { controller?.sceneBecameActive() }
        }
    }
}

@MainActor private final class ReviewLiveActivityAuthorization: LiveActivityAuthorization {
    var isSupported: Bool { true }
    var areActivitiesEnabled = false
    var isAppActive: Bool { true }
    func enablementUpdates() -> AsyncStream<Bool> { AsyncStream { _ in } }
}
#endif
