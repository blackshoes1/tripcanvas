import XCTest

final class ChoiceFlowsUITests: XCTestCase {
    private func launch() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ios-review-ui", "--review-choice", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"]
        app.launch()
        XCTAssertTrue(app.buttons["choiceOpenEditor"].waitForExistence(timeout: 10))
        return app
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<10 {
            if element.exists && element.isHittable { return }
            app.swipeUp()
        }
        XCTAssertTrue(element.isHittable)
    }

    private func save(_ app: XCUIApplication) {
        let saves = app.buttons.matching(identifier: "spotEditorSave").allElementsBoundByIndex
        let button = saves.first(where: { $0.isHittable }) ?? app.buttons["spotEditorSave"].firstMatch
        XCTAssertTrue(button.isEnabled)
        button.tap()
    }

    private func createPending(_ app: XCUIApplication) {
        app.buttons["choiceOpenEditor"].tap()
        let add = app.buttons["addAlternativeChoice"]
        reveal(add, in: app)
        add.tap()
        let name = app.textFields["spotEditorName"].firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap(); name.typeText("Riverside walk")
        // 다른 칸을 눌러 입력을 확정한다. 키보드 조합 여부 대신 실제 선택지 왕복을 검증한다.
        app.textFields["도시"].firstMatch.tap()
        save(app)
        XCTAssertTrue(app.buttons["chooseAlternativePlace"].waitForExistence(timeout: 5))
        save(app)
        let state = app.staticTexts["choiceSavedState"]
        let pending = expectation(for: NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "PENDING", "Riverside walk"), evaluatedWith: state)
        wait(for: [pending], timeout: 10)
        XCTAssertTrue(state.label.contains("행 1"))
    }

    func testCreateSelectAndReopenOneSlotPreservesBothPlaces() {
        let app = launch()
        createPending(app)
        app.buttons["choiceOpenEditor"].tap()
        let choose = app.buttons["chooseAlternativePlace"]
        reveal(choose, in: app)
        choose.tap()
        save(app)
        let state = app.staticTexts["choiceSavedState"]
        let selected = expectation(for: NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "현재 · Riverside walk", "SELECTED"), evaluatedWith: state)
        wait(for: [selected], timeout: 10)
        XCTAssertTrue(state.label.contains("다른 곳 · 합성 미술관"))
        XCTAssertTrue(state.label.contains("행 1"))
        app.buttons["choiceOpenEditor"].tap()
        let reopen = app.buttons["다시 미정으로 두기"]
        reveal(reopen, in: app)
        reopen.tap()
        save(app)
        let pending = expectation(for: NSPredicate(format: "label CONTAINS %@", "PENDING"), evaluatedWith: state)
        wait(for: [pending], timeout: 10)
        XCTAssertTrue(state.label.contains("다른 곳 · 합성 미술관"))
    }

    func testFailedSaveKeepsDraftAndSecondSavePersistsWithCAS() {
        let app = launch()
        createPending(app)
        app.buttons["choiceFailNextSave"].tap()
        app.buttons["choiceOpenEditor"].tap()
        let choose = app.buttons["chooseAlternativePlace"]
        reveal(choose, in: app)
        choose.tap()
        save(app)
        XCTAssertTrue(app.staticTexts["spotEditorError"].waitForExistence(timeout: 10))
        let unlocked = expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: app.buttons["spotEditorSave"].firstMatch)
        wait(for: [unlocked], timeout: 10)
        save(app)
        let state = app.staticTexts["choiceSavedState"]
        let saved = expectation(for: NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "현재 · Riverside walk", "revision 3"), evaluatedWith: state)
        wait(for: [saved], timeout: 10)
        XCTAssertTrue(state.label.contains("행 1"))
    }
}
