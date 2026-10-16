import XCTest

final class CalmTravelUITests: XCTestCase {
    private func launch(_ extras: [String] = []) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ios-review-ui", "--review-calm", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"] + extras
        app.launch(); return app
    }
    func testChooseAlternativeAndUndoSaveWithoutOpeningThePlaceEditor() {
        let app = launch()
        XCTAssertTrue(app.buttons["calmOpenChoice"].waitForExistence(timeout: 10)); app.buttons["calmOpenChoice"].tap()
        let select = app.buttons["quickChooseAlternative"]
        for _ in 0..<6 where !select.isHittable { app.swipeUp() }
        XCTAssertTrue(select.isHittable); select.tap()
        XCTAssertTrue(app.staticTexts["quickChoiceSaved"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["quickChoiceSaved"].label.contains("합성 강변 산책"))
        captureTravelUX(app, "quick-choice-confirmed-save")
        app.buttons["quickChoiceUndo"].tap()
        XCTAssertTrue(app.buttons["quickChooseCurrent"].waitForExistence(timeout: 5))
        app.buttons["닫기"].tap()
        XCTAssertTrue(app.staticTexts["calmSavedState"].label.contains("합성 미술관 · revision 5"))
    }
    func testFailedChoiceDoesNotClaimSaveOrOfferBlindRetry() {
        let app = launch()
        XCTAssertTrue(app.buttons["calmFailNext"].waitForExistence(timeout: 10)); app.buttons["calmFailNext"].tap()
        app.buttons["calmOpenChoice"].tap()
        XCTAssertTrue(app.buttons["quickChooseCurrent"].waitForExistence(timeout: 5)); app.buttons["quickChooseCurrent"].tap()
        let error = app.staticTexts["quickChoiceError"]
        for _ in 0..<6 where !error.isHittable { app.swipeUp() }
        XCTAssertTrue(error.waitForExistence(timeout: 5)); XCTAssertFalse(app.staticTexts["quickChoiceSaved"].exists)
        XCTAssertFalse(app.buttons["quickChooseCurrent"].exists)
        XCTAssertFalse(app.buttons["quickChooseAlternative"].exists)
        captureTravelUX(app, "quick-choice-failed-save")
    }
    func testStaffOriginalPreservesTypedSpaceAndTomorrowShowsExactDate() {
        let app = launch()
        XCTAssertTrue(app.buttons["calmEditOriginal"].waitForExistence(timeout: 10)); app.buttons["calmEditOriginal"].tap()
        app.buttons["직원에게 보여줄 원문"].tap()
        let name = app.textFields["staffBookingName"]
        XCTAssertTrue(name.waitForExistence(timeout: 5)); name.tap(); name.typeText("John Doe")
        app.buttons["calmOriginalDone"].tap()
        XCTAssertEqual(app.staticTexts["calmOriginalName"].label, "John Doe")
        let tomorrow = app.buttons["tomorrowOpenDay"]
        for _ in 0..<7 where !tomorrow.isHittable { app.swipeUp() }
        XCTAssertTrue(tomorrow.isHittable); tomorrow.tap()
        XCTAssertEqual(app.staticTexts["calmOpenedDay"].label, "Day 2 · 10월 17일 일정 열림")
        captureTravelUX(app, "tomorrow-brief-and-offline-readiness")
    }
    func testExpiredCalculationAsksForCheckInsteadOfReassurance() {
        let app = launch(["--review-calm-expired", "--review-large", "--review-dark"])
        let text = app.staticTexts["calmMomentText"]
        XCTAssertTrue(text.waitForExistence(timeout: 10))
        XCTAssertTrue(text.label.contains("다시 확인"))
        XCTAssertFalse(text.label.contains("괜찮아요"))
        captureTravelUX(app, "calm-expired-large-dark")
    }
}
