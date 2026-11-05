import XCTest

/// 편집 모드 밖의 길게 눌러 끌기를 장소 줄의 수정자가 막지 않는지(`ReorderGestureMatrixHarness` — 진단 기록은 거기).
/// 각 테스트는 첫 줄을 길게 눌러 셋째 줄 아래쪽으로 끈다 — 성공이면 `둘,셋,하나,넷`.
final class ReorderGestureMatrixUITests: XCTestCase {
    private func run(_ variant: String, diagnostic: Bool = false, file: StaticString = #filePath, line: UInt = #line) {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ios-review-ui", "--review-reorder-variant=\(variant)", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"]
        app.launch()
        let state = app.staticTexts["matrixState"]
        XCTAssertTrue(state.waitForExistence(timeout: 10), file: file, line: line)
        let list = app.collectionViews.firstMatch
        let first = list.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "행 하나")).firstMatch
        let third = list.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "행 셋")).firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 5), file: file, line: line)
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let from = origin.withOffset(CGVector(dx: first.frame.midX, dy: first.frame.midY))
        let to = origin.withOffset(CGVector(dx: first.frame.midX, dy: third.frame.minY + third.frame.height * 0.8))
        from.press(forDuration: 1.2, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.8)
        let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "matrix=\(variant); order=둘,셋,하나,넷"), object: state)
        let ok = XCTWaiter.wait(for: [done], timeout: 5) == .completed
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "matrix-\(variant)"; shot.lifetime = .keepAlways; add(shot)
        print("REORDER-MATRIX \(variant) => \(ok ? "MOVED" : "NOT MOVED") (\(state.label))")
        if !diagnostic { XCTAssertTrue(ok, "\(variant): \(state.label)", file: file, line: line) }
    }

    func testPlainOnMove() { run("plain") }
    func testOnMoveWithTapSurface() { run("tap") }
    /// 일정 줄과 같은 모양(탭 표면 · 줄 끝 ⋯ · 날짜 넘기기 제스처).
    func testOnMoveWithPlanRowShape() { run("all") }
    /// 진단: 컨텍스트 메뉴는 길게 누르기를 끌기와 다퉈 실행마다 갈린다 — 일정 줄에 두지 않는 이유. 실패로 세지 않는다.
    func testContextMenuCompetesWithDragDiagnostic() { run("menu", diagnostic: true) }
}
