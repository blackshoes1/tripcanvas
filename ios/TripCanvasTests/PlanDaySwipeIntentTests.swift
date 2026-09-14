import XCTest
@testable import TripCanvas

final class PlanDaySwipeIntentTests: XCTestCase {
    func testVerticalStartNeverTurnsIntoDayNavigation() {
        var intent = PlanDaySwipeIntent()
        intent.update(CGSize(width: 2, height: 15))
        intent.update(CGSize(width: -140, height: 25))
        XCTAssertEqual(intent.axis, .vertical)
        XCTAssertNil(intent.destination(translation: CGSize(width: -140, height: 25), selectedDay: 1, dayCount: 3, isEditing: false))
    }

    func testHorizontalStartKeepsItsAxisButVerticalReleaseDoesNotNavigate() {
        var intent = PlanDaySwipeIntent()
        intent.update(CGSize(width: -15, height: 2))
        intent.update(CGSize(width: -20, height: 90))
        XCTAssertEqual(intent.axis, .horizontal)
        XCTAssertNil(intent.destination(translation: CGSize(width: -20, height: 90), selectedDay: 1, dayCount: 3, isEditing: false))
    }

    func testShortDragAndReturnToStartDoNotNavigate() {
        var intent = PlanDaySwipeIntent()
        intent.update(CGSize(width: -100, height: 0))
        for width in [0.0, -10, -60] {
            XCTAssertNil(intent.destination(translation: CGSize(width: width, height: 0), selectedDay: 1, dayCount: 3, isEditing: false))
        }
    }

    func testNextPreviousBoundariesAndEditing() {
        var intent = PlanDaySwipeIntent()
        intent.update(CGSize(width: 15, height: 0))
        let left = CGSize(width: -100, height: 0), right = CGSize(width: 100, height: 0)
        XCTAssertEqual(intent.destination(translation: left, selectedDay: 1, dayCount: 3, isEditing: false), 2)
        XCTAssertEqual(intent.destination(translation: right, selectedDay: 1, dayCount: 3, isEditing: false), 0)
        XCTAssertNil(intent.destination(translation: left, selectedDay: 2, dayCount: 3, isEditing: false))
        XCTAssertNil(intent.destination(translation: right, selectedDay: 0, dayCount: 3, isEditing: false))
        XCTAssertNil(intent.destination(translation: left, selectedDay: 1, dayCount: 3, isEditing: true))
        XCTAssertNil(intent.destination(translation: left, selectedDay: 0, dayCount: 0, isEditing: false))
    }

    func testSmallMovementDoesNotLockAndDiagonalStartFavorsScrolling() {
        var intent = PlanDaySwipeIntent()
        intent.update(CGSize(width: 4, height: 3))
        XCTAssertEqual(intent.axis, .undecided)
        intent.update(CGSize(width: 12, height: 12))
        XCTAssertEqual(intent.axis, .vertical)
    }
}
