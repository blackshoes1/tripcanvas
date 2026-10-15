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

    private func reveal(_ element: XCUIElement, in app: XCUIApplication, towardTop: Bool = false) {
        for _ in 0..<10 {
            if element.exists && element.isHittable { return }
            if towardTop { app.swipeDown() } else { app.swipeUp() }
        }
        if !element.isHittable { captureTravelUX(app, "choice-unavailable-\(element.identifier)") }
        XCTAssertTrue(element.isHittable, "보여야 할 항목: \(element.identifier)\n\(app.debugDescription)")
    }

    private func save(_ app: XCUIApplication, alternative: Bool = false) {
        let identifier = alternative ? "alternativeSpotEditorSave" : "spotEditorSave"
        let button = app.buttons[identifier]
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        XCTAssertTrue(button.isEnabled)
        XCTAssertTrue(button.isHittable)
        button.tap()
    }

    private func createPending(_ app: XCUIApplication) {
        app.buttons["choiceOpenEditor"].tap()
        let add = app.buttons["addAlternativeChoice"]
        reveal(add, in: app)
        add.tap()
        // 중첩 시트의 입력칸은 고유 ID로 고른다. firstMatch는 아래의 현재 장소를 가리킬 수 있다.
        let name = app.textFields["alternativeSpotEditorName"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        XCTAssertTrue(name.isHittable)
        XCTAssertTrue(["", "장소 이름"].contains(name.value as? String ?? ""), "새 선택지는 현재 장소 이름을 이어 쓰지 않는다")
        name.tap(); name.typeText("Riverside walk")
        XCTAssertEqual(name.value as? String, "Riverside walk")
        // ASCII 이름으로 선택지 생성·저장 왕복을 검증한다. 저장 버튼도 실제 화면을 그대로 쓴다.
        save(app, alternative: true)
        let dismissed = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: name)
        wait(for: [dismissed], timeout: 5)
        let currentName = app.textFields["spotEditorName"]
        reveal(currentName, in: app, towardTop: true)
        XCTAssertEqual(currentName.value as? String, "합성 미술관", "대안을 입력해도 현재 장소 이름은 바뀌지 않는다")
        XCTAssertTrue(app.staticTexts["저장 원본 · 합성 미술관 | revision 1"].exists,
                      "안쪽 편집기 완료는 초안만 바꾸고 문서를 서버에 저장하지 않는다")
        reveal(app.buttons["chooseAlternativePlace"], in: app)
        captureTravelUX(app, "pending-two-place-slot")
        save(app)
        let state = app.staticTexts["choiceSavedState"]
        let pending = expectation(for: NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "PENDING", "Riverside walk"), evaluatedWith: state)
        wait(for: [pending], timeout: 10)
        XCTAssertEqual(state.label, "현재 · 합성 미술관 | 다른 곳 · Riverside walk | PENDING | 행 1 | revision 2",
                       "대안 저장 뒤에도 원래 장소 이름과 한 개의 일정 칸을 정확히 보존한다")
        captureTravelUX(app, "choice-pending-saved")
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
        captureTravelUX(app, "choice-alternative-selected")
        app.buttons["choiceOpenEditor"].tap()
        let reopen = app.buttons["다시 미정으로 두기"]
        reveal(reopen, in: app)
        reopen.tap()
        save(app)
        let pending = expectation(for: NSPredicate(format: "label CONTAINS %@", "PENDING"), evaluatedWith: state)
        wait(for: [pending], timeout: 10)
        XCTAssertTrue(state.label.contains("다른 곳 · 합성 미술관"))
        captureTravelUX(app, "choice-reopened-retains-original")
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
        let unlocked = expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: app.buttons["spotEditorSave"].firstMatch)
        wait(for: [unlocked], timeout: 10)
        reveal(app.staticTexts["spotEditorError"], in: app, towardTop: true)
        save(app)
        let state = app.staticTexts["choiceSavedState"]
        let saved = expectation(for: NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "현재 · Riverside walk", "revision 3"), evaluatedWith: state)
        wait(for: [saved], timeout: 10)
        XCTAssertTrue(state.label.contains("행 1"))
    }
}
