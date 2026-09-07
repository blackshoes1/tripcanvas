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
                    updatedAt: "", timeZone: "Asia/Seoul", cities: [], todayIndex: -1, daysUntilStart: nil,
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
    /// 만들기는 서버가 id를 정한다 — 가짜도 그렇게 흉내 낸다.
    var created: [NewTripDraft] = []
    func createTrip(_ draft: NewTripDraft) async throws -> TripSummary {
        if let failure { throw failure }
        created.append(draft)
        let made = TripSummary(
            id: "made-\(created.count)", name: draft.name, start: draft.start, dayCount: draft.dayCount,
            revision: 1, updatedAt: "", timeZone: "Asia/Seoul", cities: [], todayIndex: -1,
            daysUntilStart: nil, role: .owner, memberCount: 1)
        stored.insert(made, at: 0)
        return made
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

// MARK: - 여행 만들기
//
// 여기서 지키는 것: **앱만 설치한 사람도 시작할 수 있다.**
// 그리고 삭제와 반대 방향이라 규칙도 반대다 — id는 서버가 정하므로 **낙관적으로 먼저 넣지 않는다.**

extension TripListRemovalTests {

    func testCreateAddsTheTripTheServerMade() async {
        let (model, service) = await loaded([])
        let draft = NewTripDraft(name: "가루이자와 여행", start: "2026-07-21", dayCount: 4, city: "가루이자와")

        let created = await model.create(draft)

        XCTAssertEqual(service.created.count, 1)
        XCTAssertEqual(service.created.first, draft, "고친 값 그대로 보낸다")
        XCTAssertEqual(created?.name, "가루이자와 여행")
        XCTAssertEqual(model.trips.first?.id, created?.id, "만든 여행이 목록 맨 앞에 온다")
        XCTAssertNil(model.errorMessage)
    }

    func testCreateFailureLeavesNoPhantomRow() async {
        let (model, service) = await loaded([])
        service.failure = APIError.offline

        let created = await model.create(NewTripDraft(name: "제주", start: "2026-07-21", dayCount: 2, city: nil))

        XCTAssertNil(created)
        XCTAssertTrue(model.trips.isEmpty, "실패했으면 목록에 아무것도 남기지 않는다 — 열 수 없는 줄을 만들지 않는다")
        XCTAssertEqual(model.errorMessage, "서버에 닿지 못했어요 — 연결을 확인하고 다시 시도해 주세요.")
    }

    func testCreateSaysWhatToDoWhenSignedOut() async {
        let (model, service) = await loaded([])
        service.failure = APIError.unauthorized

        _ = await model.create(NewTripDraft(name: "제주", start: "2026-07-21", dayCount: 2, city: nil))

        XCTAssertEqual(model.errorMessage, "로그인이 필요해요 — 다시 로그인한 뒤 만들어 주세요.")
    }

    /// 만들 수 없는 값으로는 버튼이 눌리지 않아야 한다 — 판정은 화면이 아니라 값이 들고 있다.
    func testDraftValidity() {
        XCTAssertTrue(NewTripDraft(name: "제주", start: "2026-07-21", dayCount: 1, city: nil).isValid)
        XCTAssertFalse(NewTripDraft(name: "  ", start: "2026-07-21", dayCount: 3, city: nil).isValid, "이름이 비면 못 만든다")
        XCTAssertFalse(NewTripDraft(name: "제주", start: "", dayCount: 3, city: nil).isValid)
        XCTAssertFalse(NewTripDraft(name: "제주", start: "2026-07-21", dayCount: 0, city: nil).isValid)
        XCTAssertFalse(NewTripDraft(name: "제주", start: "2026-07-21", dayCount: NewTripDraft.maxDays + 1, city: nil).isValid,
                       "앱에서 한 번에 만드는 길이에는 상한이 있다 — 더 긴 여행은 만든 뒤 웹에서 늘린다")
    }
}
