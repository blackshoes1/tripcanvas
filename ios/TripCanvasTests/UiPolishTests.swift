import XCTest
@testable import TripCanvas

/// 2026-09-18 모바일 UI 정리 — 화면이 아니라 화면이 쓰는 **순수 함수**를 본다: 칩 날짜, 요약 한 줄, 다음 일정의 사실들, 아이콘 체계.
final class UiPolishTests: XCTestCase {
    func testShortDayChipDropsWeekdayAndYear() {
        XCTAssertEqual(TimeFormat.dayChipShort("2026-10-26"), "10/26")
        XCTAssertEqual(TimeFormat.dayChipLabel("2026-10-25"), "10/25 (일)", "고른 날은 요일까지")
        XCTAssertNil(TimeFormat.dayChipShort(""), "날짜 없는 여행이면 줄이 빠진다")
        XCTAssertNil(TimeFormat.dayChipShort("언젠가"))
    }

    func testSummaryLineSaysTravelAndCostOnly() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "day-plan", withExtension: "json"))
        let plan = try JSONDecoder().decode(DayPlanResponse.self, from: Data(contentsOf: url))
        let totals = plan.day.totals
        let line = PlanSpotList.summaryLine(totals)
        if totals.travelMinutes > 0 {
            XCTAssertEqual(line?.contains("이동 \(TimeFormat.duration(totals.travelMinutes))"), true)
        }
        if totals.cost.total > 0 {
            XCTAssertEqual(line?.contains("예상 "), true)
        }
        if totals.travelMinutes == 0 && totals.cost.total == 0 {
            XCTAssertNil(line, "말할 것이 없으면 빈 줄을 만들지 않는다")
        }
        XCTAssertEqual(line?.contains("km"), false, "거리는 접힌 요약에만 있다")
    }

    func testNextActionFactsFollowExecutionOrder() {
        let departure = DepartureAdvice(leaveMinutes: 8 * 60 + 40, slackMinutes: 10, level: .late, text: "지금 나서야 해요")
        let next = NextAction(activityId: "a1", title: "산 히네스", status: .upcoming, travelMinutes: 26, etaMinutes: 9 * 60 + 6,
                              startMinutes: 9 * 60, stayMinutes: 45, departure: departure, location: nil,
                              type: .restaurant, flexibility: .flexible, reasons: [])
        let facts = NextActionCard.facts(next, isEstimate: true)
        XCTAssertEqual(facts.map(\.text), ["출발 08:40", "도착 09:06", "이동 26분 예상", "45분 머무름"])
        XCTAssertTrue(facts.allSatisfy { !$0.symbol.isEmpty })

        // 도착 예정이 없으면 시작 시각을 대신 말하고, 없는 것은 말하지 않는다.
        let bare = NextAction(activityId: nil, title: "휴식", status: .upcoming, travelMinutes: 0, etaMinutes: nil,
                              startMinutes: 13 * 60, stayMinutes: nil, departure: nil, location: nil,
                              type: .other, flexibility: .flexible, reasons: [])
        XCTAssertEqual(NextActionCard.facts(bare, isEstimate: false).map(\.text), ["13:00"])
    }

    func testCategorySymbolsAreSFSymbolsNotEmoji() {
        for category in SpotCategory.allCases {
            XCTAssertFalse(category.symbol.isEmpty)
            XCTAssertTrue(category.symbol.allSatisfy { $0.isASCII }, "\(category): 벡터 아이콘 이름이어야 한다")
            XCTAssertFalse(category.icon.allSatisfy { $0.isASCII }, "\(category): 이모지는 글자용으로 남는다")
        }
        for mode in TravelMode.allCases { XCTAssertTrue(mode.symbol.allSatisfy { $0.isASCII }) }
    }
}
