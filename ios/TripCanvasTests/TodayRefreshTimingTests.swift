import XCTest
@testable import TripCanvas

final class TodayRefreshTimingTests: XCTestCase {
    private func instant(_ text: String) throws -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return try XCTUnwrap(formatter.date(from: text))
    }

    /// 서버 응답의 시각만 바꾼다 — 어떤 활동을 다음으로 고를지는 앱에서 계산하지 않는다.
    private func response(at generatedAt: String, date: String = "2026-10-27", zone: String = "Asia/Seoul",
                          tripZone: String = "Europe/Madrid", live: Bool = true,
                          activities: [(Int, Int, ActivityStatus)] = [], leave: Int? = nil) throws -> TodayResponse {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "today", withExtension: "json"))
        var raw = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        raw["generatedAt"] = generatedAt
        var day = try XCTUnwrap(raw["day"] as? [String: Any])
        day["date"] = date; day["timeZone"] = zone; raw["day"] = day
        var trip = try XCTUnwrap(raw["trip"] as? [String: Any])
        trip["timeZone"] = tripZone; raw["trip"] = trip
        var state = try XCTUnwrap(raw["currentState"] as? [String: Any])
        state["live"] = live; raw["currentState"] = state
        let template = try XCTUnwrap((raw["activities"] as? [[String: Any]])?.first)
        raw["activities"] = activities.enumerated().map { index, value in
            var activity = template
            activity["id"] = "timing-\(index)"; activity["startMinutes"] = value.0
            activity["endMinutes"] = value.1; activity["status"] = value.2.rawValue
            return activity
        }
        if let leave {
            var next = try XCTUnwrap(raw["nextAction"] as? [String: Any])
            var departure = try XCTUnwrap(next["departure"] as? [String: Any])
            departure["leaveMinutes"] = leave; next["departure"] = departure; raw["nextAction"] = next
        } else { raw["nextAction"] = NSNull() }
        return try JSONDecoder().decode(TodayResponse.self, from: JSONSerialization.data(withJSONObject: raw))
    }

    func testUsesTheDaysSeoulClockBeforeTheTripsMadridClock() throws {
        let today = try response(at: "2026-10-27T00:59:30.000Z", activities: [(540, 600, .inProgress), (660, 720, .planned)])
        XCTAssertEqual(TodayRefreshTiming.nextBoundary(for: today), try instant("2026-10-27T01:00:00.000Z"))
    }

    func testDepartureBoundaryCanComeBeforeTheActivityStarts() throws {
        let today = try response(at: "2026-10-27T01:00:00.000Z", activities: [(660, 720, .planned)], leave: 615)
        XCTAssertEqual(TodayRefreshTiming.nextBoundary(for: today), try instant("2026-10-27T01:15:00.000Z"))
    }

    func testDoneAndElapsedBoundariesAreIgnoredButAFutureZeroDurationStartIsKept() throws {
        let today = try response(at: "2026-10-27T05:00:00.000Z", activities: [(600, 850, .completed), (660, 860, .skipped),
                                             (720, 870, .cancelled), (780, 780, .planned), (900, 900, .planned)])
        XCTAssertEqual(TodayRefreshTiming.nextBoundary(for: today), try instant("2026-10-27T06:00:00.000Z"))
    }

    func testAFutureBoundaryWithinHalfASecondIsKept() throws {
        for generated in ["2026-10-27T00:59:59.500Z", "2026-10-27T00:59:59.750Z"] {
            let today = try response(at: generated, activities: [(600, 660, .planned)])
            XCTAssertEqual(TodayRefreshTiming.nextBoundary(for: today), try instant("2026-10-27T01:00:00.000Z"))
        }
    }

    func testABoundaryCrossedWhileReceivingTheResponseIsStillReturned() throws {
        let today = try response(at: "2026-10-27T00:59:59.900Z", activities: [(600, 660, .planned)])
        let receivedAt = try instant("2026-10-27T01:00:02.000Z")
        let boundary = try XCTUnwrap(TodayRefreshTiming.nextBoundary(for: today))
        XCTAssertEqual(boundary, try instant("2026-10-27T01:00:00.000Z"))
        XCTAssertLessThan(boundary, receivedAt, "수신 시각이 아니라 서버가 계산한 시각부터 경계를 찾는다")
    }

    func testTheBoundaryAtTheGeneratedInstantIsNotReturnedAgain() throws {
        let today = try response(at: "2026-10-27T01:00:00.000Z", activities: [(600, 660, .planned)])
        XCTAssertEqual(TodayRefreshTiming.nextBoundary(for: today), try instant("2026-10-27T02:00:00.000Z"))
    }

    func testElapsedActivitiesLeaveOnlyTheNextLocalMidnight() throws {
        let today = try response(at: "2026-10-27T14:30:00.000Z", activities: [(540, 600, .planned)], leave: 500)
        XCTAssertEqual(TodayRefreshTiming.nextBoundary(for: today), try instant("2026-10-27T15:00:00.000Z"))
    }

    func testPreviewDoesNotScheduleARefresh() throws {
        let today = try response(at: "2026-10-27T01:00:00.000Z", live: false, activities: [(660, 720, .planned)], leave: 615)
        XCTAssertNil(TodayRefreshTiming.nextBoundary(for: today))
    }

    func testInvalidDayZoneFallsBackOnlyToAValidTripZone() throws {
        let fallback = try response(at: "2026-10-27T00:30:00.000Z", zone: "Invalid/Zone", tripZone: "Asia/Seoul", activities: [(600, 660, .planned)])
        XCTAssertEqual(TodayRefreshTiming.nextBoundary(for: fallback), try instant("2026-10-27T01:00:00.000Z"))
        let invalid = try response(at: "2026-10-27T00:30:00.000Z", zone: "Invalid/Zone", tripZone: "Also/Invalid")
        XCTAssertNil(TodayRefreshTiming.nextBoundary(for: invalid))
    }

    func testMadridMidnightFollowsBothDSTChanges() throws {
        for (day, expected) in [("2026-03-29", "2026-03-29T22:00:00.000Z"),
                                ("2026-10-25", "2026-10-25T23:00:00.000Z")] {
            let today = try response(at: "\(day)T12:00:00.000Z", date: day, zone: "Europe/Madrid")
            XCTAssertEqual(TodayRefreshTiming.nextBoundary(for: today), try instant(expected))
        }
    }

    func testMinutesPastMidnightUseCalendarDaysAcrossTheSpringDSTChange() throws {
        let today = try response(at: "2026-03-29T22:30:00.000Z", date: "2026-03-29", zone: "Europe/Madrid", activities: [(1560, 1560, .planned)])
        XCTAssertEqual(TodayRefreshTiming.nextBoundary(for: today), try instant("2026-03-30T00:00:00.000Z"))
    }

    func testMadridWallClockBoundaryAfterTheAutumnClockChange() throws {
        let today = try response(at: "2026-10-25T00:00:00.000Z", date: "2026-10-25", zone: "Europe/Madrid", activities: [(210, 240, .planned)])
        XCTAssertEqual(TodayRefreshTiming.nextBoundary(for: today), try instant("2026-10-25T02:30:00.000Z"))
    }

    func testGeneratedAtSupportsLegacyWholeSecondsAndRejectsAnUnknownClock() throws {
        let legacy = try response(at: "2026-10-27T00:30:00Z", activities: [(600, 660, .planned)])
        XCTAssertEqual(TodayRefreshTiming.nextBoundary(for: legacy), try instant("2026-10-27T01:00:00.000Z"))
        XCTAssertNil(TodayRefreshTiming.nextBoundary(for: try response(at: "invalid")))
    }
}
