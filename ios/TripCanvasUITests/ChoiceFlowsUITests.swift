import XCTest

final class ChoiceFlowsUITests: XCTestCase {
    private var launchedApp: XCUIApplication?
    private var recordingFailure = false

    override func record(_ issue: XCTIssue) {
        if !recordingFailure, let app = launchedApp {
            recordingFailure = true
            captureTravelUX(app, "choice-failure")
            let tree = XCTAttachment(string: app.debugDescription)
            tree.name = "choice-failure-hierarchy"; tree.lifetime = .keepAlways; add(tree)
            recordingFailure = false
        }
        super.record(issue)
    }

    private func launch() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        launchedApp = app
        app.launchArguments = ["--ios-review-ui", "--review-choice", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"]
        app.launch()
        XCTAssertTrue(app.buttons["choiceOpenEditor"].waitForExistence(timeout: 10))
        return app
    }

    private func editorFrame(_ form: XCUIElement, in app: XCUIApplication) -> CGRect {
        var visible = form.frame.intersection(app.windows.firstMatch.frame)
        guard !visible.isNull, !visible.isEmpty else { return .zero }
        let bottom = visible.maxY
        for bar in app.navigationBars.allElementsBoundByIndex {
            let frame = bar.frame
            if frame.intersects(visible), frame.minY < visible.midY {
                visible.origin.y = max(visible.minY, frame.maxY)
                visible.size.height = max(0, bottom - visible.minY)
            }
        }
        if app.keyboards.firstMatch.exists {
            visible.size.height = max(0, min(visible.maxY, app.keyboards.firstMatch.frame.minY) - visible.minY)
        }
        return visible.insetBy(dx: 0, dy: min(12, visible.height * 0.02))
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication, towardTop: Bool = false, centered: Bool = false) {
        let identifier = element.exists ? element.identifier : "현재 편집기의 화면 밖 항목"
        let formID = identifier.hasPrefix("alternativeSpotEditor") ? "alternativeSpotEditorForm" : "spotEditorForm"
        let form = app.collectionViews[formID]
        XCTAssertTrue(form.waitForExistence(timeout: 5), "실제 장소 편집기 Form이 있어야 한다: \(formID)")
        for _ in 0..<10 {
            let visible = editorFrame(form, in: app)
            XCTAssertFalse(visible.isEmpty, "편집기에서 조작할 영역이 있어야 한다")
            let target = centered ? visible.insetBy(dx: 0, dy: visible.height * 0.25) : visible
            if element.exists, target.contains(element.frame), element.isHittable {
                // 기존 실패의 원인은 미확정이다. 한 번의 탭 전 노출·정지 조건을 명시하며 재탭하지 않는다.
                var previous = element.frame, stableSamples = 0
                let stable = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                    guard element.exists, element.isHittable else { stableSamples = 0; return false }
                    let frame = element.frame
                    guard target.contains(frame) else { stableSamples = 0; return false }
                    let unchanged = abs(frame.minX - previous.minX) < 1 && abs(frame.minY - previous.minY) < 1
                        && abs(frame.width - previous.width) < 1 && abs(frame.height - previous.height) < 1
                    stableSamples = unchanged ? stableSamples + 1 : 0
                    previous = frame
                    return stableSamples >= 2
                }, object: element)
                if XCTWaiter.wait(for: [stable], timeout: 3) == .completed { return }
            }
            // 앱 전체가 아닌 현재 편집기만 스크롤한다. 거리는 보이는 영역과 대상 위치로 정한다.
            let distance: CGFloat
            if element.exists, !element.frame.isEmpty { distance = target.midY - element.frame.midY }
            else { distance = visible.height * (towardTop ? 0.3 : -0.3) }
            let bounded = min(max(distance, -visible.height * 0.35), visible.height * 0.35)
            guard abs(bounded) >= max(20, visible.height * 0.03) else {
                XCTFail("스크롤로 교정할 위치 차이 없이 노출·정지 확인이 실패했어요. 대상은 다시 누르지 않아요: \(identifier)")
                return
            }
            let origin = app.coordinate(withNormalizedOffset: .zero)
            let start = origin.withOffset(CGVector(dx: visible.midX, dy: visible.midY - bounded / 2))
            let end = origin.withOffset(CGVector(dx: visible.midX, dy: visible.midY + bounded / 2))
            start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.1)
        }
        let frame = element.exists ? String(describing: element.frame) : "<missing>"
        XCTFail("편집기 안에 완전히 노출되고 정지해야 할 항목: \(identifier), frame: \(frame)")
    }

    private func chooseAlternativeOnce(_ app: XCUIApplication) {
        let choose = app.buttons["chooseAlternativePlace"]
        reveal(choose, in: app, centered: true)
        XCTAssertTrue(choose.isEnabled)
        captureTravelUX(app, "choice-before-single-selection-tap")
        choose.tap()
        let selected = app.collectionViews["spotEditorForm"].staticTexts["선택한 곳"]
        XCTAssertTrue(selected.waitForExistence(timeout: 5), "한 번 선택한 직후 초안에 선택 표시가 있어야 한다")
        let name = app.textFields["spotEditorName"]
        reveal(name, in: app, towardTop: true)
        XCTAssertEqual(name.value as? String, "Riverside walk", "외부 완료 전에 선택한 장소가 초안 이름에 반영돼야 한다")
        captureTravelUX(app, "choice-selected-draft-before-save")
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
