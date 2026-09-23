import SwiftUI
import UIKit
import XCTest
@testable import TripCanvas

/// 표시 크기를 직접 측정한다. 데이터 테스트만으로는 행의 과도한 확장을 잡지 못한다.
@MainActor
final class PlanSectionLayoutTests: XCTestCase {
    func testSummaryTimeTextKeepsHeightOnNarrowCardsAndWithLargeText() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "day-plan", withExtension: "json"))
        let plan = try JSONDecoder().decode(DayPlanResponse.self, from: Data(contentsOf: url))
        let totals = DayPlanTotals(distanceKm: 12, travelMinutes: 265, endMinutes: 1225,
                                   overloaded: false, cost: plan.day.totals.cost)
        XCTAssertEqual(PlanSpotList.summaryLine(totals), "이동 4시간 25분 · 종료 20:25")
        func measure(_ width: CGFloat, _ typeSize: DynamicTypeSize) -> CGSize {
            let host = UIHostingController(rootView:
                PlanSpotList.daySummary(totals)
                    .labelStyle(.iconOnly)
                    .environment(\.dynamicTypeSize, typeSize))
            return host.sizeThatFits(in: CGSize(width: width, height: 1200))
        }
        let normal = measure(288, .large)
        let narrow = measure(180, .large)
        let accessible = measure(288, .accessibility3)
        XCTAssertGreaterThan(normal.height, 0, "시간 문구 영역이 사라지면 안 된다")
        XCTAssertGreaterThan(narrow.height, normal.height, "좁은 카드에서는 시간 문구를 줄바꿈한다")
        XCTAssertGreaterThan(accessible.height, normal.height)
        XCTAssertLessThanOrEqual(narrow.width, 181)
        XCTAssertLessThanOrEqual(accessible.width, 289)
    }

    func testTravelRowDoesNotExpandToFillAvailableScreenHeight() {
        let spot = TripSpot(raw: ["name": .string("El Rastro"), "city": .string("Madrid")])
        let plan = DayPlanSpot(index: 0, name: "El Rastro", city: "Madrid", category: nil,
                               location: nil, etaMinutes: 601, fixed: false, conflict: false,
                               bookedAtMinutes: nil, waitMinutes: 0, stayMinutes: 60,
                               status: "PLANNED", participants: [], reunion: false,
                               incomingLeg: DayPlanLeg(mode: "walk", minutes: 7, distanceKm: 0.5,
                                                      path: nil, source: .straightLineEstimate))
        let host = UIHostingController(rootView:
            SpotRow(spot: spot, dayMode: .walk, plan: plan, split: nil)
                .environment(\.dynamicTypeSize, .large))
        let short = host.sizeThatFits(in: CGSize(width: 320, height: 300))
        let tall = host.sizeThatFits(in: CGSize(width: 320, height: 900))
        XCTAssertGreaterThan(short.height, 0)
        XCTAssertLessThan(tall.height, 240, "이동 줄이 남는 화면 높이를 차지하면 안 된다")
        XCTAssertEqual(short.height, tall.height, accuracy: 1)
    }

    func testErrorBannerFitsNarrowScreenAndGrowsForAccessibilityText() {
        func measure(_ typeSize: DynamicTypeSize) -> CGSize {
            let host = UIHostingController(rootView:
                InlineErrorBanner(message: "저장하지 못했어요",
                                  detail: "네트워크 연결을 확인하고 다시 시도해 주세요.",
                                  tint: Ink.danger, compact: true, retry: {})
                    .environment(\.dynamicTypeSize, typeSize))
            return host.sizeThatFits(in: CGSize(width: 288, height: 1200))
        }
        let normal = measure(.large)
        let accessible = measure(.accessibility3)
        XCTAssertGreaterThan(normal.height, 44)
        XCTAssertLessThanOrEqual(normal.width, 289)
        XCTAssertLessThanOrEqual(accessible.width, 289)
        XCTAssertGreaterThan(accessible.height, normal.height,
                             "큰 글씨에서는 버튼을 아래로 옮기고 배너 높이를 확보해야 한다")
    }
}
