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
        var activityCallCount = 0
        var todayError: Error?
        var todayHandler: (() async throws -> TripService.Fetched<TodayResponse>)?
        var lastActivityCall: (id: String, action: TripService.ActivityAction, revision: Int)?
        var lastSuggestionCall: (id: String, decision: TripService.SuggestionDecision)?
        var cachedAt: Date?
        /// 디스크에 남아 있던 지난번 오늘 화면. 테스트가 직접 넣어 준다.
        var cachedToday: TodayResponse?
        private(set) var cachedTodayReads = 0

        init(todayResponse: TodayResponse) { self.todayResponse = todayResponse }

        func cachedToday(tripId: String) async -> TodayResponse? {
            cachedTodayReads += 1
            return cachedToday
        }

        func trips() async throws -> TripService.Fetched<[TripSummary]> {
            TripService.Fetched(value: [todayResponse.trip], cachedAt: cachedAt)
        }
        func today(tripId: String, dayIndex: Int?) async throws -> TripService.Fetched<TodayResponse> {
            todayCallCount += 1
            if let todayError { throw todayError }
            if let todayHandler { return try await todayHandler() }
            return TripService.Fetched(value: todayResponse, cachedAt: cachedAt)
        }
        func bookings(tripId: String) async throws -> TripService.Fetched<[BookingSummary]> {
            TripService.Fetched(value: [], cachedAt: nil)
        }
        /// 오늘 화면 테스트는 만들지도 지우지도 않는다 — 프로토콜을 채우기만 한다.
        func createTrip(_ draft: NewTripDraft) async throws -> TripSummary { throw APIError.offline }
        func createTrip(document: [String: JSONValue]) async throws -> TripSummary { throw APIError.offline }
        func parseItinerary(text: String) async throws -> ItineraryDraft { throw APIError.offline }
        func deleteTrip(tripId: String, expectedRevision: Int) async throws {}
        func leaveTrip(tripId: String) async throws {}

        /// 오늘 화면 테스트는 일자 계획을 쓰지 않는다 — 프로토콜을 채우기만 한다.
        var dayPlanResponse: DayPlanResponse?
        func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse> {
            guard let dayPlanResponse else { throw APIError.notFound("일자 계획 스텁이 없습니다") }
            return TripService.Fetched(value: dayPlanResponse, cachedAt: cachedAt)
        }
        func setActivity(tripId: String, activityId: String, action: TripService.ActivityAction,
                         expectedRevision: Int, expectedName: String?) async throws -> MutationResponse {
            activityCallCount += 1
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

    /// 탭을 오갈 때마다 서버를 다시 묻지 않는다 — 방금 받은 것이면 그대로다(2026-09-17 "탭마다 로딩" 보고).
    func testEnteringTheTabAgainDoesNotAskTheServerWhileFresh() async throws {
        let today = try fixture()
        let stub = StubDataSource(todayResponse: today)
        let model = makeModel(stub, from: today)
        let first = await model.loadIfStale()
        XCTAssertTrue(first, "처음에는 받는다")
        let second = await model.loadIfStale()
        XCTAssertFalse(second, "방금 받았으면 묻지 않는다")
        let third = await model.loadIfStale()
        XCTAssertFalse(third, "몇 번을 들어와도 같다")
        XCTAssertEqual(stub.todayCallCount, 1)
        let later = await model.loadIfStale(now: Date().addingTimeInterval(120))
        XCTAssertTrue(later, "오래됐으면 뒤에서 새로 받는다")
        XCTAssertEqual(stub.todayCallCount, 2)
        XCTAssertNotNil(model.today, "새로 받는 동안에도 내용은 비지 않는다")
    }

    /// 오프라인 캐시로 그린 화면은 신선한 것이 아니다 — 다음 진입에서 다시 시도한다.
    func testOfflineContentIsNeverConsideredFresh() async throws {
        let today = try fixture()
        let stub = StubDataSource(todayResponse: today)
        stub.cachedAt = Date().addingTimeInterval(-600)
        let model = makeModel(stub, from: today)
        _ = await model.loadIfStale()
        XCTAssertTrue(model.isOffline)
        let again = await model.loadIfStale()
        XCTAssertTrue(again, "캐시로 그린 것은 다시 묻는다")
        XCTAssertEqual(stub.todayCallCount, 2)
    }

    /// 서버를 기다리는 동안 지난번 화면을 먼저 보여 준다 — 단, 문서가 그때 그대로일 때만.
    func testCachedTodayIsShownBeforeTheServerAnswersWhenTheRevisionMatches() async throws {
        let today = try fixture()
        let stub = StubDataSource(todayResponse: today)
        stub.cachedToday = today
        stub.todayError = APIError.server(status: 500, message: "잠깐 고장")
        let model = makeModel(stub, from: today)
        await model.load()
        XCTAssertNotNil(model.today, "서버가 실패해도 지난번 화면은 남는다")
        XCTAssertFalse(model.isOffline, "캐시 선표시는 오프라인이 아니다 — 그 표시를 붙이지 않는다")
        XCTAssertNotNil(model.loadErrorMessage, "새로 받지 못한 사실은 말한다")
        XCTAssertEqual(stub.cachedTodayReads, 1)
    }

    func testStaleCachedTodayIsNotShownWhenTheDocumentChanged() async throws {
        let today = try fixture()
        let stub = StubDataSource(todayResponse: today)
        stub.cachedToday = today
        stub.todayError = APIError.server(status: 500, message: "잠깐 고장")
        let newer = TripSummary(id: today.trip.id, name: today.trip.name, start: today.trip.start, dayCount: today.trip.dayCount,
                                revision: today.trip.revision + 1, updatedAt: today.trip.updatedAt, timeZone: today.trip.timeZone,
                                cities: today.trip.cities, todayIndex: today.trip.todayIndex, daysUntilStart: today.trip.daysUntilStart,
                                role: today.trip.role, memberCount: today.trip.memberCount)
        let model = TodayViewModel(trip: newer, service: stub)
        await model.load()
        XCTAssertNil(model.today, "편집한 뒤의 옛 화면을 잠깐이라도 보여 주지 않는다")
    }

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
        XCTAssertNil(model.loadErrorMessage)
        XCTAssertNotNil(model.actionErrorMessage, "충돌한 선택이 저장되지 않았음을 알린다")
        XCTAssertFalse(model.canRetryAction, "순서가 바뀐 활동을 자동 재시도하지 않는다")
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
        XCTAssertNotNil(model.actionErrorMessage)
        XCTAssertFalse(model.canRetryAction)
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
    private func changing(_ response: TodayResponse, tripValue key: String, to value: Any) throws -> TodayResponse {
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(response)) as? [String: Any])
        var trip = try XCTUnwrap(object["trip"] as? [String: Any])
        trip[key] = value
        object["trip"] = trip
        return try JSONDecoder().decode(TodayResponse.self, from: JSONSerialization.data(withJSONObject: object))
    }

    func testFailedActionRetriesTheWriteAfterCheckingTheOriginalRevision() async throws {
        let today = try fixture()
        let stub = StubDataSource(todayResponse: today)
        let model = makeModel(stub, from: today)
        await model.load()
        let activity = try XCTUnwrap(today.activities.first)
        stub.mutationResult = .failure(APIError.offline)
        await model.complete(activity)
        XCTAssertNil(model.loadErrorMessage)
        XCTAssertEqual(model.actionErrorTitle, "완료 표시를 저장하지 못했어요")
        XCTAssertTrue(model.canRetryAction)

        stub.mutationResult = .success(MutationResponse(schemaVersion: 1, applied: true, alreadyApplied: false,
                                                       revision: today.trip.revision + 1, today: today))
        await model.retryAction()
        XCTAssertEqual(stub.activityCallCount, 2)
        XCTAssertEqual(stub.todayCallCount, 2)
        XCTAssertEqual(stub.lastActivityCall?.id, activity.id)
        XCTAssertEqual(stub.lastActivityCall?.action, .complete)
        XCTAssertEqual(stub.lastActivityCall?.revision, today.trip.revision)
        XCTAssertNil(model.actionErrorMessage)
    }

    func testAnUncertainWriteIsNotRepeatedWhenTheRevisionChanged() async throws {
        let today = try fixture()
        let stub = StubDataSource(todayResponse: today)
        let model = makeModel(stub, from: today)
        await model.load()
        stub.mutationResult = .failure(APIError.offline)
        await model.complete(try XCTUnwrap(today.activities.first))
        stub.todayResponse = try changing(today, tripValue: "revision", to: today.trip.revision + 1)
        await model.retryAction()
        XCTAssertEqual(stub.activityCallCount, 1, "이미 저장됐거나 다른 사람이 바꿨을 수 있어 다시 쓰지 않는다")
        XCTAssertEqual(model.revision, today.trip.revision + 1)
        XCTAssertFalse(model.canRetryAction)
        XCTAssertNotNil(model.actionErrorMessage)
    }

    func testOfflineCacheCannotAuthorizeAWriteRetry() async throws {
        let today = try fixture()
        let stub = StubDataSource(todayResponse: today)
        let model = makeModel(stub, from: today)
        await model.load()
        stub.mutationResult = .failure(APIError.offline)
        await model.complete(try XCTUnwrap(today.activities.first))
        stub.cachedAt = Date()
        await model.retryAction()
        XCTAssertEqual(stub.activityCallCount, 1)
        XCTAssertTrue(model.canRetryAction)
        XCTAssertNotNil(model.actionErrorMessage)
    }

    func testRefreshFailureKeepsContentAndTheFailedAction() async throws {
        let today = try fixture()
        let stub = StubDataSource(todayResponse: today)
        let model = makeModel(stub, from: today)
        await model.load()
        stub.mutationResult = .failure(APIError.offline)
        await model.complete(try XCTUnwrap(today.activities.first))
        let actionError = model.actionErrorMessage
        stub.todayError = APIError.server(status: 503, message: "잠시 연결되지 않아요")
        await model.load()
        XCTAssertEqual(model.today, today)
        XCTAssertEqual(model.actionErrorMessage, actionError)
        XCTAssertNotNil(model.loadErrorMessage)
        XCTAssertTrue(model.canRetryAction)
    }

    func testViewerCannotCompleteSkipUndoOrAcceptSuggestions() async throws {
        let today = try changing(fixture(), tripValue: "role", to: "VIEWER")
        let stub = StubDataSource(todayResponse: today)
        let model = makeModel(stub, from: today)
        await model.load()
        XCTAssertFalse(model.canEdit)
        let activity = try XCTUnwrap(today.activities.first)
        await model.complete(activity)
        await model.skip(activity)
        await model.undo(activity)
        let suggestion = try XCTUnwrap(today.suggestions.first)
        await model.accept(suggestion)
        await model.dismiss(suggestion)
        XCTAssertEqual(stub.activityCallCount, 0)
        XCTAssertNil(stub.lastSuggestionCall)
    }

    func testRefreshStartedBeforeAWriteCannotReplaceItsResult() async throws {
        let today = try fixture()
        let updated = try changing(today, tripValue: "revision", to: today.trip.revision + 1)
        let stub = StubDataSource(todayResponse: today)
        let model = makeModel(stub, from: today)
        await model.load()
        var continuation: CheckedContinuation<TripService.Fetched<TodayResponse>, Error>?
        stub.todayHandler = { try await withCheckedThrowingContinuation { continuation = $0 } }
        let refresh = Task { await model.load() }
        for _ in 0..<100 where continuation == nil { await Task.yield() }
        XCTAssertNotNil(continuation)
        XCTAssertEqual(model.today, today, "앱 복귀 조회 중 기존 내용을 유지한다")
        stub.mutationResult = .success(MutationResponse(schemaVersion: 1, applied: true, alreadyApplied: false,
                                                       revision: updated.trip.revision, today: updated))
        await model.complete(try XCTUnwrap(today.activities.first))
        continuation?.resume(returning: TripService.Fetched(value: today, cachedAt: nil))
        await refresh.value
        XCTAssertEqual(model.today, updated)
    }

    func testNavigationIsPrimaryUntilTheServerSaysTheVisitStarted() {
        XCTAssertFalse(NextActionCard.prioritizesCompletion(.upcoming))
        XCTAssertFalse(NextActionCard.prioritizesCompletion(.readyToLeave))
        XCTAssertFalse(NextActionCard.prioritizesCompletion(.traveling))
        XCTAssertTrue(NextActionCard.prioritizesCompletion(.arrived))
        XCTAssertTrue(NextActionCard.prioritizesCompletion(.inProgress))
    }

}
