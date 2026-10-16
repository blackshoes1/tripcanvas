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

    private func captureChoiceFailure(_ app: XCUIApplication, _ message: String) {
        let reason = XCTAttachment(string: message)
        reason.name = "choice-failure-reason"; reason.lifetime = .keepAlways; add(reason)
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "choice-failure-screen"; screenshot.lifetime = .keepAlways; add(screenshot)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = "choice-failure-hierarchy"; tree.lifetime = .keepAlways; add(tree)
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication, towardTop: Bool = false) {
        for _ in 0..<10 {
            if element.exists && element.isHittable { return }
            if towardTop { app.swipeDown() } else { app.swipeUp() }
        }
        let identifier = element.exists ? element.identifier : "<missing>"
        let hittable = element.exists && element.isHittable
        if !hittable { captureChoiceFailure(app, "보여야 할 항목: \(identifier)") }
        XCTAssertTrue(hittable, "보여야 할 항목: \(identifier)")
    }

    private func chooseAlternativeOnce(_ app: XCUIApplication) {
        let choose = app.buttons["chooseAlternativePlace"]
        reveal(choose, in: app)
        XCTAssertTrue(choose.isEnabled)
        // 기존 선택 탭 미반영의 원인은 미확정이다. 한 번 탭한 결과를 저장 전에 확인하고 재탭하지 않는다.
        choose.tap()
        let selected = app.staticTexts["선택한 곳"]
        let selectionAppeared = selected.waitForExistence(timeout: 5)
        if !selectionAppeared { captureChoiceFailure(app, "한 번 선택한 직후 초안의 선택 표시가 없어요.") }
        XCTAssertTrue(selectionAppeared, "한 번 선택한 직후 초안에 선택 표시가 있어야 한다")
        let name = app.textFields["spotEditorName"]
        reveal(name, in: app, towardTop: true)
        let actualName = name.value as? String
        if actualName != "Riverside walk" { captureChoiceFailure(app, "선택 후 초안 이름: \(actualName ?? "<missing>")") }
        XCTAssertEqual(actualName, "Riverside walk", "외부 완료 전에 선택한 장소가 초안 이름에 반영돼야 한다")
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
        captureTravelUX(app, "choice-alternative-editor-before-input")
        XCTAssertTrue(name.isHittable, "대안 이름 입력칸 frame: \(name.frame)\n\(app.debugDescription)")
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
        chooseAlternativeOnce(app)
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
        chooseAlternativeOnce(app)
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
