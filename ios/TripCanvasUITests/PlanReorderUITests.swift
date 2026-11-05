import XCTest

/// 일정 목록에서 장소를 **끌어서** 순서를 바꾼다 — 순서 편집의 손잡이와, 편집 모드 밖의 길게 눌러 끌기 둘 다.
/// 합성 문서(가·나·다·라)를 쓰고, 저장은 메모리에서 revision을 올린다(`PlanReorderReviewHarness`).
final class PlanReorderUITests: XCTestCase {
    private func launch() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ios-review-ui", "--review-plan-reorder", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"]
        app.launch()
        expectState(app, "order=가장소,나장소,다장소,라장소; saves=0")
        XCTAssertTrue(row(app, "가장소").waitForExistence(timeout: 10))
        return app
    }

    /// 장소 줄. 줄은 `.accessibilityElement(children: .combine)`이라 이름이 label 안에 들어 있다.
    private func row(_ app: XCUIApplication, _ name: String) -> XCUIElement {
        app.collectionViews.firstMatch.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@ AND elementType != %d", name, XCUIElement.ElementType.staticText.rawValue))
            .firstMatch
    }

    private func expectState(_ app: XCUIApplication, _ label: String, timeout: TimeInterval = 10,
                             file: StaticString = #filePath, line: UInt = #line) {
        let state = app.staticTexts["reorderState"]
        XCTAssertTrue(state.waitForExistence(timeout: timeout), file: file, line: line)
        let match = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", label), object: state)
        if XCTWaiter.wait(for: [match], timeout: timeout) != .completed {
            capture(app, "reorder-state-mismatch")
            XCTFail("기대: \(label) / 실제: \(state.label)", file: file, line: line)
        }
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name; shot.lifetime = .keepAlways; add(shot)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = name + "-hierarchy"; tree.lifetime = .keepAlways; add(tree)
    }

    func testEditModeHandleDragMovesSpotAndSaves() {
        let app = launch()
        let toggle = app.buttons["순서 편집"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        toggle.tap()
        XCTAssertTrue(app.buttons["완료"].waitForExistence(timeout: 5), "순서 편집에 들어가야 한다")
        capture(app, "reorder-edit-mode")

        // 손잡이는 줄의 오른쪽 끝이다. 라벨은 OS 언어마다 달라 좌표로 잡는다.
        let source = row(app, "가장소"), target = row(app, "다장소")
        let window = app.windows.firstMatch.frame
        let handleX = window.maxX - 30
        let from = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: handleX, dy: source.frame.midY))
        let to = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: handleX, dy: target.frame.maxY - 4))
        from.press(forDuration: 0.6, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.6)

        expectState(app, "order=나장소,다장소,가장소,라장소; saves=1")
        capture(app, "reorder-edit-mode-after")
    }

    func testLongPressDragMovesSpotWithoutEditMode() {
        let app = launch()
        let source = row(app, "가장소"), target = row(app, "다장소")
        let from = source.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let to = app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: source.frame.midX, dy: target.frame.maxY - 4))
        from.press(forDuration: 1.2, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.6)

        expectState(app, "order=나장소,다장소,가장소,라장소; saves=1")
        capture(app, "reorder-long-press-after")
    }
}
