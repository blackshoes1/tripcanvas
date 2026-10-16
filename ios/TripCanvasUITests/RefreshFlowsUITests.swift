import XCTest

final class RefreshFlowsUITests: XCTestCase {
    private func launch(cancellation: Bool = false) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ios-review-ui", "--review-refresh", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"]
            + (cancellation ? ["--review-refresh-cancel"] : [])
        app.launch()
        expectLabel(app.staticTexts["refreshReadCounts"], "started=1; completed=1; cancelled=0")
        expectLabel(app.staticTexts["refreshAppliedState"], "revision=1; first=합성 초기 장소; fresh=true")
        return app
    }

    private func expectLabel(_ element: XCUIElement, _ label: String, timeout: TimeInterval = 15,
                             file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), file: file, line: line)
        let expected = expectation(for: NSPredicate(format: "label == %@", label), evaluatedWith: element)
        wait(for: [expected], timeout: timeout)
        XCTAssertEqual(element.label, label, file: file, line: line)
    }

    private func pullActualPlanList(_ app: XCUIApplication) {
        // SwiftUI의 실제 List는 iOS 17+에서 UICollectionView를 쓴다. 테스트용 새로고침 버튼은 없다.
        let list = app.collectionViews.firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 5), "TripPlanView의 실제 일정 목록이 있어야 한다")
        let start = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12))
        let end = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9))
        start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
    }

    private func assertNoCancelledBanner(_ app: XCUIApplication) {
        XCTAssertEqual(app.staticTexts["refreshErrorState"].label, "load=none; save=none")
        XCTAssertFalse(app.staticTexts["일정을 새로 불러오지 못했어요"].exists)
        // 진단 계수의 'cancelled=1'은 오류 배너가 아니다.
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label ==[c] %@", "cancelled")).firstMatch.exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "NSURLErrorDomain")).firstMatch.exists)
    }

    private func assertActualPlanRow(_ app: XCUIApplication, contains name: String) {
        let row = app.collectionViews.firstMatch.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5), "진단값뿐 아니라 실제 일정 목록 행이 새 장소를 보여야 한다")
        XCTAssertTrue(row.isHittable)
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = name + "-hierarchy"; tree.lifetime = .keepAlways; add(tree)
    }

    func testActualPlanPullAwaitsDelayedReadAndAppliesNewDocumentWithoutCancelledBanner() {
        let app = launch()
        app.buttons["refreshArmDelayedRead"].tap()
        pullActualPlanList(app)
        expectLabel(app.staticTexts["refreshReadCounts"], "started=2; completed=1; cancelled=0", timeout: 5)
        XCTAssertTrue(app.staticTexts["refreshAppliedState"].label.contains("revision=1;"), "지연 GET가 끝나기 전에는 옛 문서가 남는다")
        expectLabel(app.staticTexts["refreshReadCounts"], "started=2; completed=2; cancelled=0", timeout: 15)
        expectLabel(app.staticTexts["refreshAppliedState"], "revision=2; first=합성 당김 최신 장소; fresh=true")
        assertActualPlanRow(app, contains: "합성 당김 최신 장소")
        assertNoCancelledBanner(app)
        capture(app, "refresh-delayed-read-applied")
    }

    func testLeavingActualRefreshingPlanCancelsReadThenFreshReturnFetchesLatestDocument() {
        let app = launch(cancellation: true)
        app.buttons["refreshArmDelayedRead"].tap()
        pullActualPlanList(app)
        expectLabel(app.staticTexts["refreshReadCounts"], "started=2; completed=1; cancelled=0", timeout: 5)
        app.buttons["refreshOtherTab"].tap()
        XCTAssertTrue(app.staticTexts["refreshOtherTabContent"].waitForExistence(timeout: 3))
        expectLabel(app.staticTexts["refreshReadCounts"], "started=2; completed=1; cancelled=1", timeout: 5)
        XCTAssertTrue(app.staticTexts["refreshAppliedState"].label.contains("revision=1;"), "취소된 응답은 원격 문서를 적용하면 안 된다")
        assertNoCancelledBanner(app)
        app.buttons["refreshPlanTab"].tap()
        expectLabel(app.staticTexts["refreshReadCounts"], "started=3; completed=2; cancelled=1", timeout: 10)
        expectLabel(app.staticTexts["refreshAppliedState"], "revision=2; first=합성 복귀 최신 장소; fresh=true")
        assertActualPlanRow(app, contains: "합성 복귀 최신 장소")
        assertNoCancelledBanner(app)
        capture(app, "refresh-cancelled-read-return-fetches-latest")
    }
}
