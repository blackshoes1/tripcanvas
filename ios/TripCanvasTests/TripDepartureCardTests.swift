import XCTest
@testable import TripCanvas

final class TripDepartureCardTests: XCTestCase {
    func testRangeIncludesLastDayAndDoesNotInventHotelNights() {
        let label = TripDepartureCard.dateRange(trip(start: "2026-10-25", days: 14))
        XCTAssertEqual(label, "2026. 10. 25. (일) – 11. 7. (토) · 14일")
        XCTAssertFalse(label.contains("박"))
    }

    func testRangeKeepsBothYearsAcrossNewYear() {
        XCTAssertEqual(TripDepartureCard.dateRange(trip(start: "2026-12-31", days: 2)),
                       "2026. 12. 31. (목) – 2027. 1. 1. (금) · 2일")
    }

    func testUndatedAndSingleDayTripsDoNotInventAnEndDate() {
        XCTAssertEqual(TripDepartureCard.dateRange(trip(start: "", days: 3)), "날짜 미정 · 3일")
        XCTAssertEqual(TripDepartureCard.dateRange(trip(start: "2026-10-25", days: 1)), "2026. 10. 25. (일) · 1일")
    }

    private func trip(start: String, days: Int) -> TripSummary {
        TripSummary(id: "departure-test", name: "테스트 여행", start: start, dayCount: days,
                    revision: 1, updatedAt: "", timeZone: "Europe/Madrid", cities: [],
                    todayIndex: -1, daysUntilStart: 33, role: .owner, memberCount: 1)
    }
}
