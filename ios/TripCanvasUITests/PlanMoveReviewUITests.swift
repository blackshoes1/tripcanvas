import XCTest

final class PlanMoveReviewUITests: XCTestCase {
    private func launch(_ extras: [String] = []) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ios-review-ui", "--review-plan-move", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"] + extras
        app.launch()
        XCTAssertTrue(app.textFields["spotEditorName"].waitForExistence(timeout: 10))
        return app
    }
    private func reveal(_ element: XCUIElement, app: XCUIApplication, upward: Bool = true) {
        for _ in 0..<8 where !element.isHittable { if upward { app.swipeUp() } else { app.swipeDown() } }
        XCTAssertTrue(element.isHittable)
    }
    private func editName(_ name: String, app: XCUIApplication) {
        let field = app.textFields["spotEditorName"]
        field.tap()
        field.press(forDuration: 1.2)
        if app.menuItems["모두 선택"].waitForExistence(timeout: 1) { app.menuItems["모두 선택"].tap() }
        else {
            let old = field.value as? String ?? ""
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count))
        }
        field.typeText(name)
    }
    private func openMove(_ app: XCUIApplication) {
        let menu = app.buttons["다른 날로 옮기기"]
        reveal(menu, app: app)
        menu.tap()
        let day = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Day 2")).firstMatch
        XCTAssertTrue(day.waitForExistence(timeout: 5))
        captureTravelUX(app, "move-review-day-menu")
        day.tap()
        XCTAssertTrue(app.navigationBars["날짜·순서 옮기기"].waitForExistence(timeout: 5))
        waitForConfirmation(app)
    }
    private func waitForConfirmation(_ app: XCUIApplication) {
        let button = app.buttons["이대로 옮기기"]
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: button)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 10), .completed)
    }
    func testNestedMoveCancelKeepsTheUnsavedEditorDraft() {
        let app = launch()
        editName("수정한 이동 장소", app: app)
        openMove(app)
        XCTAssertTrue(app.staticTexts["2. 수정한 이동 장소"].exists)
        app.navigationBars["날짜·순서 옮기기"].buttons["취소"].tap()
        reveal(app.textFields["spotEditorName"], app: app, upward: false)
        XCTAssertEqual(app.textFields["spotEditorName"].value as? String, "수정한 이동 장소")
        XCTAssertTrue(app.staticTexts["합성 이동 검토 · 저장 시도 0회 · 저장 완료 0회"].exists)
    }
    func testArrivalEditRefreshesConflictAndOnlyConfirmationSaves() {
        let app = launch()
        openMove(app)
        XCTAssertTrue(app.staticTexts["2. 이동할 장소"].exists)
        let conflict = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "시간 확인 필요")).firstMatch
        reveal(conflict, app: app)
        captureTravelUX(app, "move-review-at-conflict")
        let arrival = app.switches["내가 정한 도착 시각"]
        reveal(arrival, app: app, upward: false); arrival.switches.firstMatch.tap()
        XCTAssertEqual(arrival.value as? String, "0")
        waitForConfirmation(app)
        XCTAssertTrue(app.staticTexts["3. 이동할 장소"].exists)
        XCTAssertFalse(conflict.exists)
        let position = app.buttons["movePosition"]
        reveal(position, app: app, upward: false); position.tap()
        app.buttons["오전 일정 뒤"].tap()
        waitForConfirmation(app)
        XCTAssertTrue(app.staticTexts["2. 이동할 장소"].exists, "시각이 없으면 고른 위치를 유지한다")
        app.buttons["이대로 옮기기"].tap()
        XCTAssertTrue(app.staticTexts["저장 시도 1회 · 저장 완료 1회"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.navigationBars["날짜·순서 옮기기"].exists)
        XCTAssertFalse(app.textFields["spotEditorName"].exists)
    }
    func testFailedConfirmationKeepsTheSelectedDayAndAllowsExplicitRetry() {
        let app = launch(["--review-move-fail"])
        openMove(app)
        app.buttons["이대로 옮기기"].tap()
        let error = app.staticTexts["합성 저장 실패 · 선택은 그대로예요"]
        reveal(error, app: app)
        captureTravelUX(app, "move-review-failed-confirmation")
        reveal(app.staticTexts["2. 이동할 장소"], app: app, upward: false)
        app.buttons["이대로 옮기기"].tap()
        XCTAssertTrue(app.staticTexts["저장 시도 2회 · 저장 완료 1회"].waitForExistence(timeout: 10))
    }
}
