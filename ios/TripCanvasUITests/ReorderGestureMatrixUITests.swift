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
    func testOnMoveWithContextMenu() { run("menu") }
    func testOnMoveWithTapSurface() { run("tap") }
    func testOnMoveWithListDragGesture() { run("swipe") }
    func testOnMoveWithEverything() { run("all") }
    /// 진단: 2026-11-05 전 날짜 넘기기(드래그마다 상태를 쓴다)와 그것에 줄 수정자를 모두 얹은 것.
    /// 막히면 그 방식이 원인이라는 증거다 — 결과를 로그에 남기고 실패로 세지 않는다.
    func testOldStatefulDaySwipeDiagnostic() { run("oldswipe", diagnostic: true) }
    func testOldStatefulDaySwipeWithEverythingDiagnostic() { run("oldswipe-all", diagnostic: true) }
}
