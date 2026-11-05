import XCTest

/// 편집 모드 밖의 길게 눌러 끌기를 장소 줄의 수정자가 막지 않는지(`ReorderGestureMatrixHarness`).
/// 2026-11-05 진단에서는 `tap`(UIKit 탭 표면)만 끌기를 막았다 — 그 표면이 터치를 직접 받았기 때문이다.
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
    func testOnMoveWithEverything() { run("all") }
    // 2026-11-05 진단 기록: 컨텍스트 메뉴(menu)·목록 드래그 제스처(swipe)·옛 날짜 넘기기(oldswipe — 드래그마다
    // 상태를 쓴다)는 각각 얹어도 끌기가 됐다. `all`이 앞의 둘을 함께 덮으므로 따로 두지 않는다(잡 50분 제한).
    /// 진단: 일정 목록에만 있는 것들을 줄 수정자 위에 하나씩 얹는다 — 어느 것이 끌기를 들쭉날쭉하게 하는지.
    func testInsetSectionsDiagnostic() { run("all-inset", diagnostic: true) }
    func testRefreshableDiagnostic() { run("all-refresh", diagnostic: true) }
    func testSpinnerDiagnostic() { run("all-spinner", diagnostic: true) }
    func testProductLikeDiagnostic() { run("all-product", diagnostic: true) }
}
