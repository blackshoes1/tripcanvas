import XCTest

final class TodayScheduleUITests: XCTestCase {
    private func launch(_ state: String) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ios-review-ui", "--review-today-live", state,
                               "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"]
        app.launch()
        return app
    }

    func testCurrentActivityOffersMoveFromTheNowMenu() {
        let app = launch("--review-time-current")
        let menu = app.buttons["저녁 예약 작업"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["지금 일정"].exists)
        menu.tap()
        app.buttons["다른 날로 옮기기"].tap()
        let request = app.staticTexts["todayMoveRequested"]
        XCTAssertTrue(request.waitForExistence(timeout: 3))
        XCTAssertEqual(request.label, "Day 1 · 저녁 예약 · 변경 기준 2")
        captureTravelUX(app, "today-current-move-menu")
    }

    func testElapsedUnrecordedScheduleRemainsAvailableToMove() {
        let app = launch("--review-time-elapsed")
        XCTAssertTrue(app.otherElements["todayElapsedSchedule"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["지금 일정"].exists)
        let menu = app.buttons["숙소 작업"]
        for _ in 0..<6 where !menu.isHittable { app.swipeUp() }
        XCTAssertTrue(menu.isHittable)
        menu.tap()
        app.buttons["다른 날로 옮기기"].tap()
        XCTAssertTrue(app.staticTexts["todayMoveRequested"].waitForExistence(timeout: 3))
        XCTAssertEqual(app.staticTexts["todayMoveRequested"].label, "Day 1 · 숙소 · 변경 기준 2")
        captureTravelUX(app, "today-elapsed-move-menu")
    }
}
