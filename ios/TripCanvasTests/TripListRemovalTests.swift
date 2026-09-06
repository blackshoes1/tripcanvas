import XCTest
@testable import TripCanvas

/// 목록에서 여행을 빼는 일.
///
/// 여기서 지키는 것 셋:
///   1. **삭제와 나가기는 다른 일이다** — 합치면 남의 여행을 지우거나 내 여행에서 조용히 나가진다
///   2. 실패하면 **원래 자리로 되돌린다** — 삼키면 다음 새로고침에 되살아난다
///   3. 무엇이 사라지는지 **문구가 다르다**
@MainActor
final class TripListRemovalTests: XCTestCase {

    private func trip(_ id: String, role: MemberRole?, revision: Int = 7) -> TripSummary {
        TripSummary(id: id, name: "여행 \(id)", start: "2026-10-01", dayCount: 3, revision: revision,
                    updatedAt: "", timeZone: "Asia/Seoul", cities: [], todayIndex: -1,
                    role: role, memberCount: role == nil ? nil : 2)
    }

    private func loaded(_ trips: [TripSummary]) async -> (TripListViewModel, FakeTrips) {
        let service = FakeTrips(trips)
        let model = TripListViewModel(service: service)
        await model.load()
        return (model, service)
    }

    func testOwnerDeletesWithTheReadRevision() async {
        let (model, service) = await loaded([trip("t1", role: .owner, revision: 9)])
        await model.remove(trip("t1", role: .owner, revision: 9))

        XCTAssertEqual(service.deleted.map(\.tripId), ["t1"])
        XCTAssertEqual(service.deleted.first?.expectedRevision, 9, "CAS — 읽은 revision을 그대로 보낸다")
        XCTAssertTrue(service.left.isEmpty, "주최자는 나가는 것이 아니다")
        XCTAssertTrue(model.trips.isEmpty)
    }

    func testMemberLeavesInsteadOfDeleting() async {
        for role in [MemberRole.editor, .viewer] {
            let (model, service) = await loaded([trip("t1", role: role)])
            await model.remove(trip("t1", role: role))

            XCTAssertEqual(service.left, ["t1"], "\(role) 는 나가기다")
            XCTAssertTrue(service.deleted.isEmpty, "\(role) 가 여행을 지우면 안 된다")
            XCTAssertTrue(model.trips.isEmpty)
        }
    }

    /// 혼자 쓰는 여행은 역할이 안 올 수 있다(구버전 응답) — 그때는 소유자로 본다.
    func testMissingRoleCountsAsOwner() async {
        let (model, service) = await loaded([trip("t1", role: nil)])
        await model.remove(trip("t1", role: nil))
        XCTAssertEqual(service.deleted.map(\.tripId), ["t1"])
        XCTAssertNil(model.errorMessage)
    }

    func testFailurePutsTheTripBackWhereItWas() async {
        let trips = [trip("a", role: .owner), trip("b", role: .owner), trip("c", role: .owner)]
        let (model, service) = await loaded(trips)
        service.failure = .forbidden("권한 없음")

        await model.remove(trips[1])

        XCTAssertEqual(model.trips.map(\.id), ["a", "b", "c"], "원래 자리로 돌아온다")
        XCTAssertNotNil(model.errorMessage, "왜 안 됐는지 말한다")
    }

    /// 다른 기기가 먼저 바꿨으면 내 revision이 낡았다 — 되돌리고 목록을 새로 받는다.
    func testRevisionConflictReloadsTheList() async {
        let (model, service) = await loaded([trip("t1", role: .owner)])
        service.failure = .revisionConflict(message: "먼저 바뀜", revision: 12)

        await model.remove(trip("t1", role: .owner))

        XCTAssertEqual(model.trips.map(\.id), ["t1"])
        XCTAssertEqual(service.listCalls, 2, "목록을 다시 받는다")
        XCTAssertEqual(model.errorMessage?.contains("다른 기기"), true)
    }

    /// 무엇이 사라지는지가 다르다 — 문구를 합치면 사용자가 결과를 잘못 안다.
    func testTheWordingSaysWhatDisappears() {
        let owner = trip("t1", role: .owner)
        let member = trip("t2", role: .viewer)

        XCTAssertEqual(TripListView.removalTitle(for: owner), "삭제")
        XCTAssertEqual(TripListView.removalTitle(for: member), "나가기")
        XCTAssertTrue(TripListView.removalMessage(for: owner).contains("함께 보는 사람들"))
        XCTAssertTrue(TripListView.removalMessage(for: member).contains("내 목록에서만"))
    }
}

@MainActor
private final class FakeTrips: TripDataSource {
    private var stored: [TripSummary]
    var failure: APIError?
    private(set) var deleted: [(tripId: String, expectedRevision: Int)] = []
    private(set) var left: [String] = []
    private(set) var listCalls = 0

    init(_ trips: [TripSummary]) { self.stored = trips }

    func trips() async throws -> TripService.Fetched<[TripSummary]> {
        listCalls += 1
        return TripService.Fetched(value: stored, cachedAt: nil)
    }
    func deleteTrip(tripId: String, expectedRevision: Int) async throws {
        if let failure { throw failure }
        deleted.append((tripId, expectedRevision))
        stored.removeAll { $0.id == tripId }
    }
    func leaveTrip(tripId: String) async throws {
        if let failure { throw failure }
        left.append(tripId)
        stored.removeAll { $0.id == tripId }
    }

    // 이 테스트가 쓰지 않는 나머지
    func today(tripId: String, dayIndex: Int?) async throws -> TripService.Fetched<TodayResponse> {
        throw APIError.notFound("안 씀")
    }
    func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse> {
        throw APIError.notFound("안 씀")
    }
    func bookings(tripId: String) async throws -> TripService.Fetched<[BookingSummary]> {
        TripService.Fetched(value: [], cachedAt: nil)
    }
    func setActivity(tripId: String, activityId: String, action: TripService.ActivityAction,
                     expectedRevision: Int, expectedName: String?) async throws -> MutationResponse {
        throw APIError.notFound("안 씀")
    }
    func decideSuggestion(tripId: String, suggestionId: String, decision: TripService.SuggestionDecision,
                          expectedRevision: Int) async throws -> MutationResponse {
        throw APIError.notFound("안 씀")
    }
}
