import XCTest

final class LiveActivityLinkUITests: XCTestCase {
    func testColdLinkWaitsForTheTripListThenOpensTheDisplayedDayAndSpotReadOnly() {
        let app = launch(["--review-activity-link-cold"])
        assertInformation(app, name: "잠금화면에 표시한 곳", day: 2)
        XCTAssertFalse(app.buttons["저장"].exists)
        captureTravelUX(app, "live-activity-link-cold")
    }

    func testWarmURLChangesTripsTabAndCanReopenTheSameDisplayedSpot() {
        let app = launch()
        XCTAssertTrue(app.staticTexts["합성 링크 여행"].waitForExistence(timeout: 10))
        app.open(URL(string: "tripcanvas://trip/link-review/activity?day=0&focus=d0s0&revision=7")!)
        assertInformation(app, name: "첫날 표시한 곳", day: 1)
        app.buttons["닫기"].tap()
        app.buttons["더보기"].tap()
        let second = URL(string: "tripcanvas://trip/link-review/activity?day=1&focus=d1s1&revision=7")!
        app.open(second)
        assertInformation(app, name: "잠금화면에 표시한 곳", day: 2)
        app.buttons["닫기"].tap()
        app.buttons["더보기"].tap()
        app.open(second)
        assertInformation(app, name: "잠금화면에 표시한 곳", day: 2)
        captureTravelUX(app, "live-activity-link-warm")
    }

    func testStaleDisplayedTargetFallsBackToItsDayWithoutOpeningADifferentSpot() {
        let app = launch(["--review-activity-link-cold", "--review-activity-link-stale"])
        XCTAssertTrue(app.staticTexts["둘째 날"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.navigationBars["장소 정보"].exists)
        captureTravelUX(app, "live-activity-link-stale")
    }

    private func assertInformation(_ app: XCUIApplication, name: String, day: Int) {
        XCTAssertTrue(app.navigationBars["장소 정보"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts[name].exists)
        XCTAssertTrue(app.staticTexts["합성 링크 여행 · Day \(day)"].exists)
    }

    private func launch(_ extras: [String] = []) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ios-review-ui", "--review-activity-link", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"] + extras
        app.launch()
        return app
    }
}
