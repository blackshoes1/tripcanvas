import XCTest

final class TodayScrollUITests: XCTestCase {
    func testHorizontalDragKeepsThePageAlignedAndVerticalScrollingStillWorks() {
        let app = launch()
        let title = app.staticTexts["첫날"]
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        let before = title.frame
        let scroll = app.scrollViews.firstMatch
        let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.2))
        let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2))
        start.press(forDuration: 0.1, thenDragTo: end)
        XCTAssertEqual(title.frame.minX, before.minX, accuracy: 1)
        scroll.swipeUp()
        XCTAssertLessThan(title.frame.minY, before.minY, "본문은 계속 세로로 스크롤돼야 한다")
        captureTravelUX(app, "today-vertical-scroll")
    }

    func testPullToRefreshStillFetchesToday() {
        let app = launch()
        let loads = app.staticTexts["todayReviewLoads"]
        XCTAssertTrue(loads.waitForExistence(timeout: 10))
        XCTAssertEqual(loads.label, "오늘 조회 1회")
        let scroll = app.scrollViews.firstMatch
        scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15))
            .press(forDuration: 0.1, thenDragTo: scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)))
        let refreshed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "오늘 조회 2회"), object: loads)
        XCTAssertEqual(XCTWaiter.wait(for: [refreshed], timeout: 10), .completed)
        captureTravelUX(app, "today-pull-refresh")
    }

    func testLargeTextKeepsRowActionsInsideTheScreen() {
        let app = launch(["--review-time-elapsed", "--review-today-badges", "--review-large"])
        let action = app.buttons["숙소 작업"]
        XCTAssertTrue(action.waitForExistence(timeout: 10))
        for _ in 0..<8 where !action.isHittable { app.swipeUp() }
        XCTAssertTrue(action.isHittable)
        XCTAssertGreaterThanOrEqual(action.frame.minX, app.frame.minX)
        XCTAssertLessThanOrEqual(action.frame.maxX, app.frame.maxX)
        captureTravelUX(app, "today-large-text-row-width")
    }

    private func launch(_ extras: [String] = []) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ios-review-ui", "--review-today-live", "--review-time-current", "--review-today-scroll",
                               "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"] + extras
        app.launch()
        return app
    }
}
