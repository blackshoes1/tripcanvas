import XCTest

final class StaffShowUITests: XCTestCase {
    func testOfflineStaffCardKeepsConfirmationHiddenUntilExplicitRevealAndHidesOnReopen() {
        let app = XCUIApplication()
        app.launchArguments = ["--ios-review-ui", "--review-staff", "--review-large", "--review-dark", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"]
        app.launch()
        let open = app.buttons["staffShowOpen"]
        XCTAssertTrue(open.waitForExistence(timeout: 10)); open.tap()
        XCTAssertTrue(app.staticTexts["staffShowName"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["staffShowName"].label, "Hôtel de démonstration")
        XCTAssertFalse(app.staticTexts["staffShowConfirmation"].exists)
        let reveal = app.buttons["staffShowReveal"]
        for _ in 0..<8 where !reveal.isHittable { app.swipeUp() }
        XCTAssertTrue(reveal.isHittable); reveal.tap()
        XCTAssertTrue(app.staticTexts["staffShowConfirmation"].exists)
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.buttons["staffShowClose"].waitForExistence(timeout: 5))
        let hidden = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.staticTexts["staffShowConfirmation"])
        wait(for: [hidden], timeout: 5)
        app.buttons["staffShowClose"].tap()
        XCTAssertTrue(open.waitForExistence(timeout: 5)); open.tap()
        XCTAssertTrue(app.staticTexts["staffShowName"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["staffShowConfirmation"].exists)
        app.buttons["staffShowClose"].tap()
    }
}
