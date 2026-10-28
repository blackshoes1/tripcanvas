import XCTest

final class TodayPlaceChangeUITests: XCTestCase {
    func testManualReplacementPreservesTimeReviewsConflictAndSavesOnlyAfterConfirmationThenUndoes() {
        let app = launch()
        openChange(app)
        reviewManual(app, name: "새 공원")
        let warning = app.staticTexts["예약보다 30분 늦게 도착할 수 있어요"]
        reveal(warning, in: app)
        XCTAssertTrue(warning.exists, "서버가 준 다음 예약의 충돌을 저장 전에 표시한다")
        save(app)
        XCTAssertTrue(app.descendants(matching: .any)["todayPlaceChangeSaved"].firstMatch.waitForExistence(timeout: 5))
        let undo = app.buttons["todayPlaceChangeUndo"]
        reveal(undo, in: app); undo.tap()
        app.navigationBars.buttons["닫기"].tap()
        let state = app.staticTexts["placeReviewServerState"]
        XCTAssertTrue(state.waitForExistence(timeout: 5))
        XCTAssertTrue(state.label.contains("저장 2회"), state.label)
        XCTAssertTrue(state.label.contains("도착 14:00"), state.label)
        XCTAssertTrue(state.label.contains("원문일치 true"), "되돌리기는 보관 장소를 포함한 원문을 복원한다")
        captureTravelUX(app, "today-place-change-undo")
    }

    func testCancellingAfterPreviewLeavesTheCurrentScheduleUnchanged() {
        let app = launch()
        openChange(app)
        reviewManual(app, name: "저장하지 않을 곳")
        app.navigationBars.buttons["닫기"].tap()
        let state = app.staticTexts["placeReviewServerState"]
        XCTAssertTrue(state.waitForExistence(timeout: 5))
        XCTAssertTrue(state.label.contains("저장 0회 · 검토 1회 · 시도 0회"), state.label)
        XCTAssertTrue(state.label.contains("원문일치 true"), state.label)
    }

    func testSearchSelectionOpensAFreshEditorWithTheSameSlotBeforeReview() {
        let app = launch()
        openChange(app)
        app.buttons["todayPlaceChangeSearch"].tap()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap(); search.typeText("검색한 공원\n")
        let result = app.buttons.containing(.staticText, identifier: "검색한 공원").firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 5)); result.tap()
        let name = app.textFields["alternativeSpotEditorName"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        XCTAssertEqual(name.value as? String, "검색한 공원")
        XCTAssertTrue(app.staticTexts["도착 14:00 · 같은 시간대"].exists)
        XCTAssertFalse((name.value as? String ?? "").contains("현재 미술관"))
        app.navigationBars.buttons["완료"].tap()
        waitForEditorToClose(name)
        app.navigationBars.buttons["닫기"].tap()
        XCTAssertTrue(app.staticTexts["placeReviewServerState"].label.contains("저장 0회 · 검토 1회"))
    }

    func testArchivedPlaceRequiresItsOwnPreviewAndExplicitSaveToRestore() {
        let app = launch(["--review-place-selected"])
        openChange(app)
        XCTAssertTrue(app.buttons["todayPlaceChangeManual"].exists, "보관한 장소를 유지하며 새 장소를 고를 수도 있다")
        app.buttons["todayPlaceChangeRestore"].tap()
        save(app)
        app.navigationBars.buttons["닫기"].tap()
        let state = app.staticTexts["placeReviewServerState"]
        XCTAssertTrue(state.waitForExistence(timeout: 5))
        XCTAssertTrue(state.label.contains("저장 1회"), state.label)
        XCTAssertTrue(state.label.contains("보관한 공원 · 도착 14:00 · 보관 현재 미술관"), state.label)
        captureTravelUX(app, "today-place-change-restore")
    }

    func testCASConflictShowsTheFailureAndDoesNotOverwriteTheSchedule() {
        let app = launch(["--review-place-conflict"])
        openChange(app)
        reviewManual(app, name: "충돌한 새 장소")
        save(app)
        let error = app.staticTexts["todayPlaceChangeError"]
        XCTAssertTrue(error.waitForExistence(timeout: 10))
        XCTAssertTrue(error.label.contains("최신 일정"), error.label)
        app.navigationBars.buttons["닫기"].tap()
        let state = app.staticTexts["placeReviewServerState"]
        XCTAssertTrue(state.label.contains("저장 0회 · 검토 1회 · 시도 1회"), state.label)
        XCTAssertTrue(state.label.contains("원문일치 true"), state.label)
    }

    func testAnotherReplacementKeepsTheArchivedPlace() {
        let app = launch(["--review-place-selected"])
        openChange(app)
        reviewManual(app, name: "세 번째 강변")
        save(app)
        app.navigationBars.buttons["닫기"].tap()
        let state = app.staticTexts["placeReviewServerState"]
        XCTAssertTrue(state.label.contains("세 번째 강변 · 도착 14:00 · 보관 보관한 공원"), state.label)
        XCTAssertTrue(state.label.contains("저장 1회"), state.label)
    }

    func testOpeningTheScheduleAfterSavingUsesTheNewPlaceInsteadOfThePreviousName() {
        let app = launch()
        openChange(app)
        reviewManual(app, name: "새로 고른 강변")
        save(app)
        let openPlan = app.buttons["todayPlaceChangeOpenPlan"]
        reveal(openPlan, in: app); openPlan.tap()
        let opened = app.staticTexts["placeReviewOpenedActivity"]
        XCTAssertTrue(opened.waitForExistence(timeout: 5))
        XCTAssertEqual(opened.label, "Day 1 · 새로 고른 강변")
        XCTAssertTrue(app.staticTexts["placeReviewServerState"].label.contains("저장 1회"))
        captureTravelUX(app, "today-place-change-open-saved")
    }

    func testViewerCannotStartAPlaceReplacement() { checkBlocked(["--review-place-viewer"]) }
    func testOfflineCachedTodayCannotStartAPlaceReplacement() { checkBlocked(["--review-place-offline"]) }

    private func checkBlocked(_ flags: [String]) {
        let app = launch(flags)
        XCTAssertTrue(app.staticTexts["현재 미술관"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["현재 미술관 작업"].exists)
        XCTAssertTrue(app.staticTexts["placeReviewServerState"].label.contains("저장 0회 · 검토 0회 · 시도 0회"))
    }
    private func openChange(_ app: XCUIApplication) {
        let menu = app.buttons["현재 미술관 작업"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        reveal(menu, in: app); menu.tap()
        app.buttons["다른 장소로 바꾸기"].tap()
        XCTAssertTrue(app.navigationBars["다른 장소로 바꾸기"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["도착 14:00 · 같은 시간대의 장소를 바꿔요."].waitForExistence(timeout: 5))
    }
    private func reviewManual(_ app: XCUIApplication, name: String) {
        app.buttons["todayPlaceChangeManual"].tap()
        let field = app.textFields["alternativeSpotEditorName"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        XCTAssertTrue(["", "장소 이름"].contains(field.value as? String ?? ""), "원래 장소의 이름을 새 입력에 복사하지 않는다")
        field.tap(); field.typeText(name)
        app.navigationBars.buttons["완료"].tap()
        waitForEditorToClose(field)
    }
    private func save(_ app: XCUIApplication) {
        let button = app.buttons["todayPlaceChangeSave"]
        reveal(button, in: app)
        XCTAssertTrue(button.isEnabled); button.tap()
        let finished = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: button)
        XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 10), .completed)
    }
    private func waitForEditorToClose(_ field: XCUIElement) {
        let closed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: field)
        XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 10), .completed)
    }
    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<8 where !element.isHittable { app.swipeUp() }
        XCTAssertTrue(element.isHittable)
    }
    private func launch(_ flags: [String] = []) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ios-review-ui", "--review-place-change", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"] + flags
        app.launch()
        return app
    }
}
