import XCTest
@testable import TripCanvas

@MainActor final class LiveActivityLinkTests: XCTestCase {
    private let target = LiveActivityTarget(dayIndex: 1, activityId: "d1s1", revision: 7)

    func testDisplayedTargetRoundTripsIntoTheAppRouter() throws {
        let link = try XCTUnwrap(LiveActivityLink.url(tripId: "trip", target: target))
        let destination = ActionRouter.Destination.activity(tripId: "trip", target: target)
        XCTAssertEqual(ActionRouter.parse(link), destination)
        XCTAssertEqual(ActionRouter.link(destination), link)
        let router = ActionRouter()
        XCTAssertTrue(router.open(url: link))
        XCTAssertEqual(router.destination, destination, "목록이 아직 없어도 목적지는 처리할 때까지 남는다")
        router.clear()
        XCTAssertTrue(router.open(url: link), "앱을 열어 둔 채 같은 활동을 다시 터치해도 전달한다")
        XCTAssertEqual(router.destination, destination)
        router.accountChanged(from: "first", to: "second")
        XCTAssertNil(router.destination, "다른 계정으로 이전 여행 목적지를 넘기지 않는다")
    }

    func testLegacyLiveActivityAndTodayLinksStillOpenToday() throws {
        let link = try XCTUnwrap(LiveActivityLink.url(tripId: "trip", target: nil))
        XCTAssertEqual(ActionRouter.parse(link), .today(tripId: "trip", focusActivityId: nil))
        XCTAssertEqual(ActionRouter.parse(URL(string: "tripcanvas://trip/trip/today?focus=d1s1")!),
                       .today(tripId: "trip", focusActivityId: "d1s1"))
    }

    func testRejectsIncompleteAmbiguousAndMismatchedTargetLinks() {
        for query in ["day=1&focus=d1s1", "day=-1&focus=d1s1&revision=7",
                      "day=1&focus=d0s1&revision=7", "day=1&focus=d1s-1&revision=7",
                      "day=1&focus=d1s01&revision=7", "day=1&focus=d1s1&revision=-1",
                      "day=1&day=2&focus=d1s1&revision=7", "day=1&focus=d1s1&revision=7&revision=8"] {
            XCTAssertNil(ActionRouter.parse(URL(string: "tripcanvas://trip/trip/activity?\(query)")!), query)
        }
    }

    func testColdLoadRetainsTargetThenOpensExactDayWithoutSaving() async {
        let source = service(), model = TripPlanViewModel(tripId: "trip", service: source, loadsPlans: false)
        model.requestViewing(target)
        XCTAssertEqual(model.selectedDay, 1)
        XCTAssertNil(model.takeLinkedSpot(), "문서를 받기 전에 대상을 소비하지 않는다")
        XCTAssertEqual(model.viewingTarget, target)
        await model.loadIfStale()
        let found = model.takeLinkedSpot()
        XCTAssertEqual(found?.index, 1)
        XCTAssertEqual(found?.spot.name, "표시한 곳")
        XCTAssertNil(model.viewingTarget)
        XCTAssertTrue(source.saves.isEmpty)
        XCTAssertFalse(model.canEdit, "보기 권한에도 같은 읽기 전용 정보가 열린다")
    }

    func testWarmLinkCanOpenSameTargetAgainAfterChangingDays() async {
        let model = TripPlanViewModel(tripId: "trip", service: service(), loadsPlans: false)
        await model.load()
        for _ in 0..<2 {
            model.selectedDay = 0
            model.requestViewing(target)
            XCTAssertEqual(model.selectedDay, 1)
            XCTAssertEqual(model.takeLinkedSpot()?.spot.name, "표시한 곳")
        }
    }

    func testChangedRevisionNeverOpensTheNewOccupantOfTheOldPosition() async {
        let source = service(), model = TripPlanViewModel(tripId: "trip", service: source, loadsPlans: false)
        await model.load()
        var changed = source.snapshot.document
        var days = changed.days
        var spots = days[1].spots
        spots.swapAt(0, 1)
        days[1].spots = spots; changed.days = days
        source.snapshot = .init(document: changed, revision: 8, role: .viewer)
        model.acceptSaved(source.snapshot)
        model.requestViewing(target)
        await model.loadIfStale()
        XCTAssertNil(model.takeLinkedSpot())
        XCTAssertEqual(model.selectedDay, 1, "바뀐 대상 대신 그 날의 일정 목록에 머문다")
        XCTAssertEqual(model.errorMessage, "표시된 일정이 바뀌었어요. 이 날의 최신 일정을 확인해 주세요.")
        XCTAssertTrue(source.saves.isEmpty)
    }

    func testDeletedSpotOrDayFallsBackWithoutOpeningAnotherPlace() async {
        for missingDay in [false, true] {
            let source = service()
            var changed = source.snapshot.document
            var days = changed.days
            if missingDay { days.removeLast() } else { days[1].spots = [] }
            changed.days = days
            source.snapshot = .init(document: changed, revision: 7, role: .viewer)
            let model = TripPlanViewModel(tripId: "trip", service: source, loadsPlans: false)
            model.requestViewing(target)
            await model.load()
            XCTAssertNil(model.takeLinkedSpot())
            XCTAssertEqual(model.selectedDay, missingDay ? 0 : 1)
            XCTAssertTrue(source.saves.isEmpty)
        }
    }

    func testNewContentFieldsAreOptionalForPreviousLiveActivities() throws {
        let raw = Data(#"{"nextTitle":"이전 일정","status":"UPCOMING","pulseText":"안내","stateVersion":"old"}"#.utf8)
        let old = try JSONDecoder().decode(TripCanvasActivityAttributes.ContentState.self, from: raw)
        XCTAssertNil(old.target)
        XCTAssertNil(old.shouldEnd)
    }

    private func service() -> FakeDocumentService {
        FakeDocumentService(snapshot: .init(document: .init(raw: ["days": .array([
            .object(["spots": .array([.object(TripSpot(name: "첫날").raw)])]),
            .object(["spots": .array([.object(TripSpot(name: "다른 곳").raw), .object(TripSpot(name: "표시한 곳").raw)])])
        ])]), revision: 7, role: .viewer))
    }
}
