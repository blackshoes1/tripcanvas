import XCTest

final class DailyMomentsUITests: XCTestCase {
    private func launch(_ extras: [String] = []) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ios-review-ui", "--review-moments", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"] + extras
        app.launch(); return app
    }

    func testViewerCanChooseAndWithdrawOnlyTheirOwnWish() {
        let app = launch()
        let choose = app.buttons["dailyMomentChoose-cafe"]
        XCTAssertTrue(choose.waitForExistence(timeout: 10)); choose.tap()
        XCTAssertTrue(app.staticTexts["나: 합성 카페"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["영희: 노을 보기"].exists)
        let withdraw = app.buttons["dailyMomentWithdraw"]
        for _ in 0..<5 where !withdraw.isHittable { app.swipeUp() }
        XCTAssertTrue(withdraw.isHittable); withdraw.tap()
        XCTAssertTrue(app.staticTexts["내 선택을 거뒀어요"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["나: 합성 카페"].exists)
        XCTAssertTrue(app.staticTexts["영희: 노을 보기"].exists)
    }

    func testOfflineChoiceDoesNotAppearSavedAndRetryKeepsCompanionWish() {
        let app = launch(["--review-moments-failure"])
        let choose = app.buttons["dailyMomentChoose-cafe"]
        XCTAssertTrue(choose.waitForExistence(timeout: 10)); choose.tap()
        XCTAssertTrue(app.staticTexts["네트워크에 연결되어 있지 않아요."].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["나: 합성 카페"].exists)
        XCTAssertTrue(app.staticTexts["영희: 노을 보기"].exists)
        for _ in 0..<5 where !choose.isHittable { app.swipeUp() }
        choose.tap()
        XCTAssertTrue(app.staticTexts["나: 합성 카페"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["영희: 노을 보기"].exists)
    }
}
