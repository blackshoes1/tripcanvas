import XCTest

final class StayExtensionUITests: XCTestCase {
    func testChooseDurationAndApplyPreview() {
        let app = XCUIApplication()
        app.launchArguments = ["--ios-review-ui", "--review-stay", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"]
        app.launch()
        let thirty = app.buttons["stayMinutes30"]
        XCTAssertTrue(thirty.waitForExistence(timeout: 8)); thirty.tap()
        let apply = app.buttons["stayApply"]
        for _ in 0..<6 where !apply.isHittable { app.swipeUp() }
        XCTAssertTrue(apply.isHittable); apply.tap()
        let result = app.staticTexts["stayResult"]
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        XCTAssertEqual(result.label, "머무름 저장 확인")
    }
    func testLostResponseOffersRefreshInsteadOfDuplicateApply() {
        let app = XCUIApplication()
        app.launchArguments = ["--ios-review-ui", "--review-stay", "--review-stay-failure", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"]
        app.launch()
        let apply = app.buttons["stayApply"]
        XCTAssertTrue(apply.waitForExistence(timeout: 8))
        for _ in 0..<6 where !apply.isHittable { app.swipeUp() }
        apply.tap()
        XCTAssertTrue(app.staticTexts["stayError"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["stayApply"].exists)
        let refresh = app.buttons["최신 일정 확인"]
        for _ in 0..<5 where !refresh.isHittable { app.swipeUp() }
        refresh.tap()
        XCTAssertTrue(app.staticTexts["stayResult"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["stayResult"].label, "원래 일정 유지")
    }
}
