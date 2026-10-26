import XCTest

/// '여행 중 안내' 띠는 `지금`의 다음 일정 카드 **바로 아래**에 있는가(2026-10-26).
/// 전에는 제안·컨디션 뒤 지도 위라 화면 세 장을 내려야 나왔고, 여행 중인 사람이 "아예 없다"고 했다.
/// 합성 여행(오늘이 여행 중인 `today.json`)으로 실제 `TodayView`를 띄운다 — `TodayLiveReviewHarness`.
final class TravelInvitePlacementUITests: XCTestCase {
    func testTravelInviteSitsRightBelowTheNextActionCard() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ios-review-ui", "--review-today-live", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"]
        app.launch()

        let invite = app.buttons["여행 중 안내 켜기"]
        let directions = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "길찾기")).firstMatch
        let timeline = app.staticTexts["오늘 일정"]
        XCTAssertTrue(invite.waitForExistence(timeout: 10))
        XCTAssertTrue(directions.exists)
        XCTAssertTrue(timeline.exists)
        XCTAssertGreaterThan(invite.frame.minY, directions.frame.maxY, "다음 일정 카드보다 먼저 읽히면 안 된다")
        XCTAssertLessThan(invite.frame.maxY, timeline.frame.minY, "오늘 일정·제안 뒤로 묻히면 안 된다")
        captureTravelUX(app, "travel-invite-below-next-action")
    }
}
