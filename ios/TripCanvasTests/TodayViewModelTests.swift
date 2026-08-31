import XCTest
@testable import TripCanvas

/// 서버를 세우지 않고 ViewModel의 배선만 본다.
/// 특히 "두 기기가 부딪혔을 때 사용자에게 실패 화면을 보여주지 않는가"를 확인한다.
@MainActor
final class TodayViewModelTests: XCTestCase {

    // MARK: 가짜 데이터 소스

    final class StubDataSource: TripDataSource {
        var todayResponse: TodayResponse
        var mutationResult: Result<MutationResponse, Error>?
        var todayCallCount = 0
        var lastActivityCall: (id: String, action: TripService.ActivityAction, revision: Int)?
        var lastSuggestionCall: (id: String, decision: TripService.SuggestionDecision)?
        var cachedAt: Date?

        init(todayResponse: TodayResponse) { self.todayResponse = todayResponse }

        func trips() async throws -> TripService.Fetched<[TripSummary]> {
            TripService.Fetched(value: [todayResponse.trip], cachedAt: cachedAt)
        }
        func today(tripId: String, dayIndex: Int?) async throws -> TripService.Fetched<TodayResponse> {
            todayCallCount += 1
            return TripService.Fetched(value: todayResponse, cachedAt: cachedAt)
        }
        func bookings(tripId: String) async throws -> TripService.Fetched<[BookingSummary]> {
            TripService.Fetched(value: [], cachedAt: nil)
        }
        func setActivity(tripId: String, activityId: String, action: TripService.ActivityAction,
                         expectedRevision: Int, expectedName: String?) async throws -> MutationResponse {
            lastActivityCall = (activityId, action, expectedRevision)
            return try result()
        }
        func decideSuggestion(tripId: String, suggestionId: String, decision: TripService.SuggestionDecision,
                              expectedRevision: Int) async throws -> MutationResponse {
            lastSuggestionCall = (suggestionId, decision)
            return try result()
        }
        private func result() throws -> MutationResponse {
            switch mutationResult {
            case .success(let value): return value
            case .failure(let error): throw error
            case nil: throw APIError.server(status: 500, message: "stub 미설정")
            }
        }
    }

    private func fixture() throws -> TodayResponse {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "today", withExtension: "json"))
        return try JSONDecoder().decode(TodayResponse.self, from: Data(contentsOf: url))
    }

    private func makeModel(_ stub: StubDataSource, from today: TodayResponse) -> TodayViewModel {
        TodayViewModel(trip: today.trip, service: stub)
    }

    // MARK: 테스트

    func testLoadPopulatesTodayAndStatus() async throws {
        let today = try fixture()
        let stub = StubDataSource(todayResponse: today)
        let model = makeModel(stub, from: today)
        await model.load()
        XCTAssertNotNil(model.today)
        XCTAssertEqual(model.revision, today.trip.revision)
        XCTAssertNotEqual(model.status, .unknown)
        XCTAssertFalse(model.isOffline)
    }

    func testCompleteSendsExpectedRevisionAndSwapsInReturnedToday() async throws {
        let today = try fixture()
        let stub = StubDataSource(todayResponse: today)
        let model = makeModel(stub, from: today)
        await model.load()

        let activity = try XCTUnwrap(today.activities.first)
        stub.mutationResult = .success(MutationResponse(
            schemaVersion: 1, applied: true, alreadyApplied: false, revision: today.trip.revision + 1, today: today))
        await model.complete(activity)

        XCTAssertEqual(stub.lastActivityCall?.id, activity.id)
        XCTAssertEqual(stub.lastActivityCall?.action, .complete)
        XCTAssertEqual(stub.lastActivityCall?.revision, today.trip.revision)
        XCTAssertNotNil(model.toast)
        XCTAssertNil(model.errorMessage)
    }

    /// 두 번 눌러도 오류로 보이지 않는다 — 서버가 alreadyApplied로 알려준다(§27).
    func testAlreadyAppliedIsNotAnError() async throws {
        let today = try fixture()
        let stub = StubDataSource(todayResponse: today)
        let model = makeModel(stub, from: today)
        await model.load()
        stub.mutationResult = .success(MutationResponse(
            schemaVersion: 1, applied: false, alreadyApplied: true, revision: today.trip.revision, today: today))
        await model.complete(try XCTUnwrap(today.activities.first))
        XCTAssertEqual(model.toast, "이미 반영돼 있었어요.")
        XCTAssertNil(model.errorMessage)
    }

    /// 다른 기기가 먼저 바꿨을 때 — 실패 화면 대신 최신을 다시 받아 온다(§27).
    func testRevisionConflictReloadsInsteadOfShowingError() async throws {
        let today = try fixture()
        let stub = StubDataSource(todayResponse: today)
        let model = makeModel(stub, from: today)
        await model.load()
        let loadsBefore = stub.todayCallCount

        stub.mutationResult = .failure(APIError.revisionConflict(message: "먼저 바뀜", revision: 9))
        await model.complete(try XCTUnwrap(today.activities.first))

        XCTAssertEqual(stub.todayCallCount, loadsBefore + 1, "충돌이면 조용히 다시 불러온다")
        XCTAssertNil(model.errorMessage, "여행 중에 실패 화면을 띄우지 않는다")
        XCTAssertNotNil(model.toast)
    }

    func testStaleSuggestionAlsoReloads() async throws {
        let today = try fixture()
        let stub = StubDataSource(todayResponse: today)
        let model = makeModel(stub, from: today)
        await model.load()
        let loadsBefore = stub.todayCallCount

        stub.mutationResult = .failure(APIError.stale("상황이 바뀜"))
        await model.accept(try XCTUnwrap(today.suggestions.first))

        XCTAssertEqual(stub.todayCallCount, loadsBefore + 1)
        XCTAssertNil(model.errorMessage)
    }

    func testOfflineWriteTellsUserItWasNotSaved() async throws {
        let today = try fixture()
        let stub = StubDataSource(todayResponse: today)
        let model = makeModel(stub, from: today)
        await model.load()
        stub.mutationResult = .failure(APIError.offline)
        await model.complete(try XCTUnwrap(today.activities.first))
        // 반영되지 않은 변경을 반영된 것처럼 보여주지 않는다.
        XCTAssertNotNil(model.errorMessage)
    }

    func testCachedTodayIsMarkedAsOffline() async throws {
        let today = try fixture()
        let stub = StubDataSource(todayResponse: today)
        stub.cachedAt = Date(timeIntervalSince1970: 1_800_000_000)
        let model = makeModel(stub, from: today)
        await model.load()
        XCTAssertTrue(model.isOffline)
        XCTAssertNotNil(model.cachedAt)
    }

    func testNextActivityIsNotRepeatedInRemainingList() async throws {
        let today = try fixture()
        let stub = StubDataSource(todayResponse: today)
        let model = makeModel(stub, from: today)
        await model.load()
        if let nextId = today.nextAction?.activityId {
            XCTAssertFalse(model.upcomingAfterNext.contains { $0.id == nextId })
        }
    }
}
