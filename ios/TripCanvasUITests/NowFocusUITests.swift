import XCTest

final class NowFocusUITests: XCTestCase {
    private func launch(_ phase: String, offline: Bool = false) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ios-review-ui", "--review-today-live", phase,
            "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"] + (offline ? ["--review-now-offline"] : [])
        app.launch()
        addTeardownBlock { app.terminate() }
        return app
    }

    func testEarlyArrivedPlaceIsPrimaryAndItsMenuAndTapUseTheCurrentPlace() {
        let app = launch("--review-now-stay")
        let current = app.buttons["장소 정보: 머무는 카페"]
        XCTAssertTrue(current.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["지금 머무는 곳"].exists)
        XCTAssertTrue(app.staticTexts["도착했어요"].firstMatch.exists)
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "nowHeaderStatus").firstMatch.label.contains("도착"))
        XCTAssertTrue(app.staticTexts["다음 · 다음 미술관"].exists)
        XCTAssertFalse(app.buttons["장소 정보: 다음 미술관"].exists)
        current.tap()
        XCTAssertEqual(app.staticTexts["todayOpenRequested"].label, "Day 1 · 머무는 카페")
        app.buttons["머무는 카페 작업"].tap()
        app.buttons["다른 날로 옮기기"].tap()
        XCTAssertEqual(app.staticTexts["todayMoveRequested"].label, "Day 1 · 머무는 카페 · 변경 기준 2")
        captureTravelUX(app, "now-current-stay-primary")
    }

    func testDepartureFocusUsesTheFollowingPlaceEvenWhenLegacyStillPointsToCurrentPlace() {
        let app = launch("--review-now-departure")
        let next = app.buttons["장소 정보: 다음 미술관"]
        XCTAssertTrue(next.waitForExistence(timeout: 10))
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "nowHeaderStatus").firstMatch.label, "출발 안내")
        XCTAssertFalse(app.buttons["장소 정보: 머무는 카페"].exists)
        XCTAssertTrue(app.staticTexts["이제 다음 미술관으로 출발하면 여유 있게 도착해요"].exists)
        next.tap()
        XCTAssertEqual(app.staticTexts["todayOpenRequested"].label, "Day 1 · 다음 미술관")
        app.buttons["다음 미술관 작업"].tap()
        XCTAssertTrue(app.buttons["다른 장소로 바꾸기"].waitForExistence(timeout: 5))
        app.buttons["다른 날로 옮기기"].tap()
        XCTAssertEqual(app.staticTexts["todayMoveRequested"].label, "Day 1 · 다음 미술관 · 변경 기준 2")
        captureTravelUX(app, "now-departure-primary")
    }

    func testUnverifiedGapShowsNeutralFreeTimeAndASecondaryNextPlace() {
        let app = launch("--review-now-free")
        XCTAssertTrue(app.staticTexts["자유시간"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["다음 일정까지 여유가 있어요"].exists)
        XCTAssertFalse(app.buttons["장소 정보: 머무는 카페"].exists)
        XCTAssertFalse(app.buttons["장소 정보: 다음 미술관"].exists)
        let countdown = app.staticTexts["nowDepartureCountdown"]
        XCTAssertTrue(countdown.waitForExistence(timeout: 5))
        XCTAssertNotNil(countdown.label.rangeOfCharacter(from: .decimalDigits), "타이머의 접근성 값에도 실제 남은 시간이 있어야 한다")
        app.buttons["다음 장소 정보: 다음 미술관"].tap()
        XCTAssertEqual(app.staticTexts["todayOpenRequested"].label, "Day 1 · 다음 미술관")
        captureTravelUX(app, "now-free-time-primary")
    }

    func testCachedFreeTimeShowsRecentGuidanceAndHidesTheLiveCountdown() {
        let app = launch("--review-now-free", offline: true)
        XCTAssertTrue(app.staticTexts["자유시간"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["최근 안내예요 · 연결 후 다시 확인해 주세요"].exists)
        XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "nowDepartureCountdown").firstMatch.exists)
        captureTravelUX(app, "now-offline-recent-guidance")
    }
}
