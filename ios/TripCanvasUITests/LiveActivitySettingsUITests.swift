import XCTest

/// 실시간 현황이 꺼져 있을 때의 안내 띠가 설정으로 보내고, 켜고 돌아오면 다시 시작하는가.
/// 시스템 스위치 자체는 합성 허용으로 대신한다(`LiveActivityReviewHarness` — 앱이 뒤로 가면 켠 것으로 친다).
/// 설정 앱의 화면 배치는 iOS마다 달라 그걸 누르는 테스트는 CI에서 흔들린다. 여기서는 '설정에서 켜기'가 정말
/// 설정 앱을 앞으로 부르는지와, 돌아왔을 때 앱이 다시 읽어 시작하는지를 본다.
/// ⚠️ `지금` 화면 안의 배치(`TodayView.liveActivityNoticeSection`)는 이 테스트가 보지 않는다. 보일지 판정은 하네스와
/// 같은 `LiveActivitySettingsNotice.isShown`이고 유닛 테스트가 따로 본다.
final class LiveActivitySettingsUITests: XCTestCase {
    private let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")

    // 설정 앱을 앞에 남겨 두면 다음 테스트의 탭이 그리로 간다.
    override func tearDown() {
        settings.terminate()
        super.tearDown()
    }

    private func launch(_ extras: [String] = []) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ios-review-ui", "--review-live-activity", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"] + extras
        app.launch()
        return app
    }

    /// 두 앱의 상태로 기다린다. ⚠️ `settings.wait(for: .runningForeground)`만 보면 설정이 아직 뜨는 중에 통과해,
    /// 곧이어 앱을 앞으로 불러도 늦게 뜬 설정이 그 위를 덮는다(전체 실행에서 드러났다). 그래서 돌아온 뒤에는 누르지 않는다.
    private func waitUntil(_ timeout: TimeInterval, _ condition: @escaping () -> Bool) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }

    func testDisabledNoticeOpensSettingsAndRestartsAfterComingBack() {
        let app = launch()
        let open = app.buttons["설정에서 켜기"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["잠금화면 실시간 현황이 꺼져 있어요"].exists)
        captureTravelUX(app, "live-activity-disabled-notice")

        open.tap()
        XCTAssertTrue(waitUntil(15) { [settings] in settings.state == .runningForeground && app.state != .runningForeground },
                      "'설정에서 켜기'는 설정 앱을 열어야 한다")

        app.activate()
        XCTAssertTrue(app.staticTexts["다시 시작 1번"].waitForExistence(timeout: 15), "돌아오면 다시 읽어 시작해야 한다")
        XCTAssertFalse(app.buttons["설정에서 켜기"].exists, "다시 켜졌으면 안내를 걷는다")
    }

    /// 큰 글씨에서는 '설정에서 켜기'가 줄 끝에서 잘렸다 — 문구 아래로 내려 두 동작이 다 닿아야 한다.
    func testLargeTextKeepsBothActionsReachable() {
        let app = launch(["--review-large"])
        let open = app.buttons["설정에서 켜기"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        XCTAssertTrue(open.isHittable)
        XCTAssertTrue(app.buttons["이대로 둘게요"].isHittable)
        XCTAssertGreaterThanOrEqual(open.frame.width, open.frame.height, "버튼 글자가 세로로 접히지 않는다")
        captureTravelUX(app, "live-activity-disabled-notice-large")
    }

    func testNoticeCanBeLeftAsIs() {
        let app = launch()
        let dismiss = app.buttons["이대로 둘게요"]
        XCTAssertTrue(dismiss.waitForExistence(timeout: 10))
        dismiss.tap()
        XCTAssertFalse(app.buttons["설정에서 켜기"].waitForExistence(timeout: 2), "접으면 다시 조르지 않는다")
        XCTAssertTrue(app.staticTexts["다시 시작 0번"].exists)
    }
}
