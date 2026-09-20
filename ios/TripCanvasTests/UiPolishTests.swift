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

    /// 요약 한 줄은 **이동과 종료 시각**만 말한다(2026-09-20 승인 시안).
    /// 비용은 오른쪽에 금액이 서는 제 줄로 빠졌고, 거리는 접힌 요약에만 있다.
    func testSummaryLineSaysTravelAndEndOnly() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "day-plan", withExtension: "json"))
        let plan = try JSONDecoder().decode(DayPlanResponse.self, from: Data(contentsOf: url))
        let totals = plan.day.totals
        let line = PlanSpotList.summaryLine(totals)
        if totals.travelMinutes > 0 {
            XCTAssertEqual(line?.contains("이동 \(TimeFormat.duration(totals.travelMinutes))"), true)
        }
        if let end = totals.endMinutes {
            XCTAssertEqual(line?.contains("종료 \(TimeFormat.clockAcrossMidnight(end))"), true)
        }
        if totals.travelMinutes == 0 && totals.endMinutes == nil {
            XCTAssertNil(line, "말할 것이 없으면 빈 줄을 만들지 않는다")
        }
        XCTAssertEqual(line?.contains("km"), false, "거리는 접힌 요약에만 있다")
        XCTAssertEqual(line?.contains("₩"), false, "비용은 제 줄로 빠졌다")
        XCTAssertEqual(line?.contains("예상 "), false, "비용 표현이 요약 줄에 남지 않는다")
    }

    /// 날짜 칩 아랫줄은 고른 날·안 고른 날이 **같은 모양**이다 — 달라지면 칩 높이가 오가며 스트립이 흔들린다.
    func testDayChipDateIsTheSameShapeForEveryDay() {
        XCTAssertEqual(TimeFormat.dayChipDate("2026-10-25"), "10.25 일")
        XCTAssertEqual(TimeFormat.dayChipDate("2026-10-26"), "10.26 월")
        XCTAssertNil(TimeFormat.dayChipDate(""), "날짜 없는 여행이면 줄이 빠진다")
        XCTAssertNil(TimeFormat.dayChipDate("언젠가"))
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
