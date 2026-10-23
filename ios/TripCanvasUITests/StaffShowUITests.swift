import XCTest

final class StaffShowUITests: XCTestCase {
    func testDriverCardOmitsReservationIdentityAndNumber() {
        let app = XCUIApplication()
        app.launchArguments = ["--ios-review-ui", "--review-staff", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"]
        app.launch()
        XCTAssertTrue(app.buttons["staffShowOpen"].waitForExistence(timeout: 10)); app.buttons["staffShowOpen"].tap()
        XCTAssertTrue(app.buttons["staffAudience"].waitForExistence(timeout: 5)); app.buttons["staffAudience"].tap()
        app.buttons["택시기사에게"].tap()
        XCTAssertTrue(app.staticTexts["staffShowAddress"].exists)
        XCTAssertFalse(app.staticTexts["SYNTHETIC GUEST"].exists)
        XCTAssertFalse(app.buttons["staffShowReveal"].exists)
        XCTAssertFalse(app.staticTexts["staffShowConfirmation"].exists)
        captureTravelUX(app, "staff-driver-minimal-card")
    }
    func testOfflineStaffCardKeepsConfirmationHiddenUntilExplicitRevealAndHidesOnReopen() {
        let app = XCUIApplication()
        app.launchArguments = ["--ios-review-ui", "--review-staff", "--review-large", "--review-dark", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"]
        app.launch()
        let open = app.buttons["staffShowOpen"]
        XCTAssertTrue(open.waitForExistence(timeout: 10)); open.tap()
        XCTAssertTrue(app.staticTexts["staffShowName"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["staffShowName"].label, "Hôtel de démonstration")
        captureTravelUX(app, "staff-show-large-dark-private")
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
