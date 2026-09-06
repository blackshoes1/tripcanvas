import XCTest
@testable import TripCanvas

/// 여행을 열었을 때 무엇이 먼저 보이는가.
///
/// 뷰가 아니라 **판정 함수**를 본다 — 규칙이 한 곳에 있어야 나중에 화면을 바꿔도 답이 안 바뀐다.
final class TripHomeTabTests: XCTestCase {

    /// 출발 전에 여는 여행은 대부분 "계획을 마저 짜려고" 여는 것이고, 그때 `지금`은 할 말이 없다.
    func testBeforeTheTripStartsThePlanComesFirst() {
        XCTAssertEqual(TripHomeTab.initial(isLive: false, requested: nil), .plan)
    }

    func testDuringTheTripNowComesFirst() {
        XCTAssertEqual(TripHomeTab.initial(isLive: true, requested: nil), .today)
    }

    /// 알림을 눌렀는데 일정 편집 화면이 뜨면 안 된다 — 목적지가 규칙을 이긴다.
    func testARequestedDestinationBeatsTheRule() {
        XCTAssertEqual(TripHomeTab.initial(isLive: false, requested: .today), .today,
                       "여행 기간 밖이어도 알림이 '지금'을 가리켰으면 그리로 간다")
        XCTAssertEqual(TripHomeTab.initial(isLive: true, requested: .plan), .plan)
    }

    /// 끝난 여행·날짜 없는 여행은 서버가 todayIndex를 -1로 준다 → isLive == false → 일정.
    /// (앱이 `start` 문자열을 오늘과 비교하지 않는 이유: 시간대 판단은 엔진에 있다)
    func testFinishedAndUndatedTripsAreNotLiveSoTheyShowThePlan() {
        let finished = TripSummary.stub(todayIndex: -1)
        XCTAssertFalse(finished.isLive)
        XCTAssertEqual(TripHomeTab.initial(isLive: finished.isLive, requested: nil), .plan)

        let undated = TripSummary.stub(start: "", todayIndex: -1)
        XCTAssertEqual(TripHomeTab.initial(isLive: undated.isLive, requested: nil), .plan)
    }

    func testFirstDayCountsAsLive() {
        let firstDay = TripSummary.stub(todayIndex: 0)
        XCTAssertTrue(firstDay.isLive, "시작일 당일은 여행 중이다")
        XCTAssertEqual(TripHomeTab.initial(isLive: firstDay.isLive, requested: nil), .today)
    }

    func testLabelsUseProductWordsNotInternalOnes() {
        XCTAssertEqual(TripHomeTab.today.label, "지금")
        XCTAssertEqual(TripHomeTab.plan.label, "일정")
    }
}

private extension TripSummary {
    static func stub(start: String = "2026-10-01", todayIndex: Int) -> TripSummary {
        TripSummary(id: "t1", name: "테스트 여행", start: start, dayCount: 5, revision: 1,
                    updatedAt: "2026-09-06T00:00:00Z", timeZone: "Asia/Seoul", cities: [],
                    todayIndex: todayIndex, role: nil, memberCount: nil)
    }
}
