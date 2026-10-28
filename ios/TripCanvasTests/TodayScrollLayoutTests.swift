import SwiftUI
import UIKit
import XCTest
@testable import TripCanvas

@MainActor
final class TodayScrollLayoutTests: XCTestCase {
    func testNarrowTodayScrollsVerticallyWithoutHorizontalOverflow() async throws {
        try await checkScrollLayout(typeSize: .large)
    }

    func testNarrowTodayWithAccessibilityTextKeepsVerticalScrollAndRefresh() async throws {
        try await checkScrollLayout(typeSize: .accessibility3)
    }

    func testBadgesDoNotPushRowActionsOutsideANarrowCard() throws {
        let fixture = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(TodayLiveReviewHarness.fixture.utf8)) as? [String: Any])
        var raw = try XCTUnwrap((fixture["activities"] as? [[String: Any]])?.first)
        raw["mustVisit"] = true; raw["flexibility"] = "FIXED"
        let activity = try JSONDecoder().decode(ActivitySummary.self, from: JSONSerialization.data(withJSONObject: raw))
        for next in [false, true] {
            let host = UIHostingController(rootView: ActivityRow(activity: activity, isNext: next,
                isBusy: false, onComplete: {}, onSkip: {}).environment(\.dynamicTypeSize, .accessibility3))
            let size = host.sizeThatFits(in: CGSize(width: 272, height: 1200))
            XCTAssertLessThanOrEqual(size.width, 273, "화면 폭만 고정하고 일정 행을 잘라 숨기면 안 된다")
        }
    }

    private func checkScrollLayout(typeSize: DynamicTypeSize) async throws {
        let auth = AuthStore(client: LayoutAuthClient(), store: LayoutSessionStore())
        let environment = AppEnvironment(auth: auth, handlesSystemNotifications: false)
        var fixture = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(TodayLiveReviewHarness.fixture.utf8)) as? [String: Any])
        fixture["generatedAt"] = ISO8601DateFormatter().string(from: Date())
        for key in ["activities", "remainingActivities"] {
            var activities = try XCTUnwrap(fixture[key] as? [[String: Any]])
            for index in activities.indices { activities[index]["mustVisit"] = true; activities[index]["flexibility"] = "FIXED" }
            fixture[key] = activities
        }
        let response = try JSONDecoder().decode(TodayResponse.self, from: JSONSerialization.data(withJSONObject: fixture))
        let host = UIHostingController(rootView: TodayLiveReviewHarness(response: response)
            .environment(environment).environment(\.dynamicTypeSize, typeSize))
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 320, height: 568)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil }

        // 합성 source의 비동기 응답과 실제 SwiftUI/UIKit 레이아웃이 반영될 때까지 기다린다.
        var scroll: UIScrollView?
        for _ in 0..<50 {
            host.view.layoutIfNeeded()
            scroll = descendants(of: host.view).compactMap { $0 as? UIScrollView }
                .first { $0.refreshControl != nil }
            if let scroll, scroll.contentSize.height > scroll.bounds.height { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        let view = try XCTUnwrap(scroll, "지금 화면의 당겨서 새로고침이 연결된 UIScrollView가 필요하다 (\(typeSize))")
        host.view.layoutIfNeeded()
        let metrics = "type=\(typeSize), contentSize=\(view.contentSize), bounds=\(view.bounds), horizontalBounce=\(view.alwaysBounceHorizontal)"
        XCTAssertGreaterThan(view.bounds.width, 0, metrics)
        XCTAssertLessThanOrEqual(view.bounds.width, 321, "좁은 화면을 실제로 측정해야 한다: \(metrics)")
        XCTAssertLessThanOrEqual(view.contentSize.width, view.bounds.width + 1, "가로 스크롤 영역이 생기면 안 된다: \(metrics)")
        XCTAssertFalse(view.alwaysBounceHorizontal, "내용이 좁아도 화면 전체가 좌우로 튕기면 안 된다: \(metrics)")
        XCTAssertGreaterThan(view.contentSize.height, view.bounds.height, "세로로 긴 오늘 내용은 스크롤할 수 있어야 한다: \(metrics)")
        XCTAssertTrue(view.isScrollEnabled, metrics)
        XCTAssertNotNil(view.refreshControl, "당겨서 새로고침을 유지해야 한다: \(metrics)")
    }

    private func descendants(of view: UIView) -> [UIView] {
        [view] + view.subviews.flatMap { descendants(of: $0) }
    }
}

/// Keychain의 실제 세션을 읽지 않고, 인증 요청도 네트워크로 보내지 않는다.
private struct LayoutSessionStore: SessionStoring {
    func loadSession() -> AuthSession? { nil }
    func saveSession(_ session: AuthSession) {}
    func removeSession() {}
    func takeLegacySession() -> Bool { false }
}

private struct LayoutAuthClient: AuthClient {
    func signIn(email: String, password: String) async throws -> AuthSession { throw AuthError.network }
    func signUp(email: String, password: String) async throws -> SignUpResult { throw AuthError.network }
    func session(token: String) async throws -> AuthSession? { throw AuthError.network }
    func signOut(token: String) async {}
    func requestPasswordReset(email: String) async throws { throw AuthError.network }
}
