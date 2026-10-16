import XCTest
@testable import TripCanvas

@MainActor
final class ReadCancellationTests: XCTestCase {
    private var cancellations: [Error] { [CancellationError(), URLError(.cancelled)] }
    private func document(_ name: String = "저장된 장소") -> TripDocument {
        TripDocument(raw: ["name": .string("합성 여행"), "days": .array([.object(["spots": .array([.object(["name": .string(name)])])])])])
    }
    private func snapshot(_ name: String = "저장된 장소", revision: Int = 7) -> TripDocumentSnapshot {
        .init(document: document(name), revision: revision, role: .owner)
    }
    private func fixture() throws -> TodayResponse {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "today", withExtension: "json"))
        return try JSONDecoder().decode(TodayResponse.self, from: Data(contentsOf: url))
    }
    private func sharedPlan(revision: Int = 7) -> DayPlanResponse {
        let trip = TripSummary(id: "t1", name: "합성 여행", start: "2026-10-16", dayCount: 1, revision: revision,
            updatedAt: "", timeZone: "Asia/Seoul", cities: [], todayIndex: 0, daysUntilStart: nil, role: .owner, memberCount: 2)
        let day = DayPlanDay(index: 0, date: trip.start, title: "", note: "", mode: "walk", startMinutes: 480,
            timeZone: "Asia/Seoul", carriedStay: nil, spots: [], carPickups: [], carReturns: [], back: nil,
            spotsWithoutLocation: 0, splits: [], flight: nil,
            totals: .init(distanceKm: 0, travelMinutes: 0, endMinutes: nil, overloaded: false, cost: .init(total: 0, parts: [])))
        return .init(schemaVersion: 1, generatedAt: "", travelTimeSource: .straightLineEstimate, legsPending: 0,
            trip: trip, dayCount: 1, days: [.init(index: 0, date: trip.start, title: "", spotCount: 1)], day: day)
    }

    func testOnlyCancellationErrorsAreIgnored() {
        for error in cancellations { XCTAssertTrue(ReadCancellation.shouldIgnore(error)) }
        XCTAssertTrue(ReadCancellation.shouldIgnore(NSError(domain: NSURLErrorDomain, code: -999)))
        XCTAssertFalse(ReadCancellation.shouldIgnore(APIError.offline))
        XCTAssertFalse(ReadCancellation.shouldIgnore(APIError.server(status: 503, message: "실제 실패")))
    }

    func testCancelledInitialDocumentReadReturnsFalseAndStopsLoadingWithoutAnError() async {
        for cancellation in cancellations {
            let source = FakeDocumentService(snapshot: snapshot())
            let store = TripDocumentStore(tripId: "t1", service: source)
            source.documentHandler = { throw cancellation }
            let accepted = await store.load()
            XCTAssertFalse(accepted)
            XCTAssertFalse(store.isLoading)
            XCTAssertNil(store.document)
            XCTAssertNil(store.loadedAt)
            XCTAssertNil(store.loadErrorMessage)
            source.documentHandler = nil
            await store.loadIfStale()
            XCTAssertEqual(store.document, source.snapshot.document)
            XCTAssertFalse(store.needsReloadAfterCancelledRead)
        }
    }

    func testPlanCancellationPreservesDocumentTimestampAndRealErrorAndSkipsPlanAndMembers() async {
        for cancellation in cancellations {
            let source = FakeDocumentService(snapshot: snapshot())
            source.dayPlanResponse = sharedPlan()
            let members = CancellationMembers()
            let model = TripPlanViewModel(tripId: "t1", service: source, memberSource: members)
            await model.load()
            let confirmed = model.document, loadedAt = model.loadedAt
            source.documentHandler = { throw APIError.server(status: 503, message: "앞서 발생한 실제 오류") }
            await model.load()
            let plans = source.dayPlanCalls.count, memberReads = members.reads
            source.documentHandler = { throw cancellation }
            await model.load()
            XCTAssertEqual(model.document, confirmed)
            XCTAssertEqual(model.revision, 7)
            XCTAssertEqual(model.loadedAt, loadedAt)
            XCTAssertEqual(model.loadErrorMessage, "앞서 발생한 실제 오류")
            XCTAssertEqual(source.dayPlanCalls.count, plans)
            XCTAssertEqual(members.reads, memberReads)
            XCTAssertFalse(model.isLoading)
            source.documentHandler = nil
            source.snapshot = snapshot("다시 받은 장소", revision: 8)
            source.dayPlanResponse = sharedPlan(revision: 8)
            await model.loadIfStale()
            XCTAssertEqual(model.revision, 8, "취소 후에는60초이내에도 다시 읽는다")
            XCTAssertEqual(model.day?.spots.first?.name, "다시 받은 장소")
            XCTAssertNil(model.loadErrorMessage)
            XCTAssertEqual(source.dayPlanCalls.count, plans + 1)
        }
    }

    func testCancelledTaskCannotApplyLateSuccessfulDocumentOrStartDerivedReads() async throws {
        let source = FakeDocumentService(snapshot: snapshot())
        source.dayPlanResponse = sharedPlan()
        let model = TripPlanViewModel(tripId: "t1", service: source)
        await model.load()
        let confirmed = model.document, loadedAt = model.loadedAt, plans = source.dayPlanCalls.count
        let started = expectation(description: "문서 응답 대기")
        var pending: CheckedContinuation<TripDocumentSnapshot, Error>?
        source.documentHandler = { try await withCheckedThrowingContinuation { pending = $0; started.fulfill() } }
        let read = Task { await model.load() }
        await fulfillment(of: [started], timeout: 2)
        let response = try XCTUnwrap(pending)
        read.cancel()
        response.resume(returning: snapshot("취소된 응답", revision: 8))
        await read.value
        XCTAssertEqual(model.document, confirmed)
        XCTAssertEqual(model.loadedAt, loadedAt)
        XCTAssertNil(model.loadErrorMessage)
        XCTAssertEqual(source.dayPlanCalls.count, plans)
        source.documentHandler = nil
        source.snapshot = snapshot("최신 응답", revision: 8)
        source.dayPlanResponse = sharedPlan(revision: 8)
        await model.loadIfStale()
        XCTAssertEqual(model.revision, 8)
    }

    func testInjectedFreshnessSkipsReadUntilCancellationRequiresRetry() async throws {
        let source = FakeDocumentService(snapshot: snapshot())
        var reads = 0
        source.documentHandler = { reads += 1; return source.snapshot }
        let model = TripPlanViewModel(tripId: "t1", service: source, loadsPlans: false, documentFreshness: 600)
        await model.load()
        let loadedAt = try XCTUnwrap(model.loadedAt)
        let later = loadedAt.addingTimeInterval(300)
        await model.loadIfStale(now: later)
        XCTAssertEqual(reads, 1, "주입한 600초 안에서는 재진입 조회를 생략한다")

        source.documentHandler = { reads += 1; throw URLError(.cancelled) }
        await model.load()
        XCTAssertEqual(reads, 2)
        XCTAssertEqual(model.loadedAt, loadedAt)
        XCTAssertNil(model.loadErrorMessage)

        source.snapshot = snapshot("최신 응답", revision: 8)
        source.documentHandler = { reads += 1; return source.snapshot }
        await model.loadIfStale(now: later)
        XCTAssertEqual(reads, 3, "동일한 fresh 시각에도 취소된 조회는 다시 시도한다")
        XCTAssertEqual(model.revision, 8)
        XCTAssertNil(model.loadErrorMessage)
    }

    func testCancelledDayPlanCannotStartMemberReadOrRemainLoading() async throws {
        let source = FakeDocumentService(snapshot: snapshot())
        let members = CancellationMembers()
        let model = TripPlanViewModel(tripId: "t1", service: source, memberSource: members)
        let started = expectation(description: "하루 계산 대기")
        var pending: CheckedContinuation<DayPlanResponse, Error>?
        source.dayPlanHandler = { _ in try await withCheckedThrowingContinuation { pending = $0; started.fulfill() } }
        let read = Task { await model.load() }
        await fulfillment(of: [started], timeout: 2)
        let response = try XCTUnwrap(pending)
        read.cancel(); response.resume(returning: sharedPlan())
        await read.value
        XCTAssertEqual(members.reads, 0)
        XCTAssertNil(model.plan)
        XCTAssertFalse(model.planAttempted(for: 0))
        XCTAssertFalse(model.isLoading)
        source.dayPlanHandler = nil
        source.dayPlanResponse = sharedPlan()
        await model.loadIfStale()
        XCTAssertNotNil(model.plan)
        XCTAssertEqual(members.reads, 1)
    }

    func testDayPlanCancellationErrorWithoutCancellingTaskIsRetriedOnNextEntry() async {
        for cancellation in cancellations {
            let source = FakeDocumentService(snapshot: snapshot())
            let members = CancellationMembers()
            let model = TripPlanViewModel(tripId: "t1", service: source, memberSource: members)
            source.dayPlanHandler = { _ in throw cancellation }
            await model.load()
            XCTAssertFalse(Task.isCancelled, "오류 값만 주고 호출 Task는 취소하지 않는다")
            XCTAssertFalse(model.isLoading)
            XCTAssertNil(model.loadErrorMessage)
            XCTAssertNil(model.plan)
            XCTAssertFalse(model.planAttempted(for: 0))
            XCTAssertEqual(members.reads, 0)
            XCTAssertTrue(model.needsRemoteReload)
            source.dayPlanHandler = nil
            source.dayPlanResponse = sharedPlan()
            await model.loadIfStale()
            XCTAssertEqual(source.dayPlanCalls, [0, 0], "fresh 문서 시각 때문에 취소된 계산 재조회를 건너뛰지 않는다")
            XCTAssertNotNil(model.plan)
            XCTAssertTrue(model.planAttempted(for: 0))
            XCTAssertFalse(model.needsRemoteReload)
            XCTAssertEqual(members.reads, 1)
        }
    }

    func testOlderCancelledDocumentReadCannotInvalidateNewerSuccess() async throws {
        let source = FakeDocumentService(snapshot: snapshot())
        let model = TripPlanViewModel(tripId: "t1", service: source, loadsPlans: false)
        await model.load()
        let started = expectation(description: "이전 읽기 대기")
        var pending: CheckedContinuation<TripDocumentSnapshot, Error>?
        source.documentHandler = { try await withCheckedThrowingContinuation { pending = $0; started.fulfill() } }
        let old = Task { await model.load() }
        await fulfillment(of: [started], timeout: 2)
        let response = try XCTUnwrap(pending)
        var newReads = 0
        source.documentHandler = { newReads += 1; return self.snapshot("최신", revision: 8) }
        await model.load()
        old.cancel(); response.resume(throwing: URLError(.cancelled)); await old.value
        await model.loadIfStale()
        XCTAssertEqual(newReads, 1, "오래된 취소가 최신 성공을 재조회 대상으로 바꾸지 않는다")
        XCTAssertEqual(model.revision, 8)
        XCTAssertNil(model.loadErrorMessage)
    }

    func testTodayCancellationPreservesConfirmedContentTimestampAndRealErrorThenRetries() async throws {
        for cancellation in cancellations {
            let today = try fixture(), source = TodayViewModelTests.StubDataSource(todayResponse: try fixture())
            let model = TodayViewModel(trip: today.trip, service: source)
            await model.load()
            let loadedAt = model.loadedAt
            source.todayError = APIError.server(status: 503, message: "실제 조회 오류")
            await model.load()
            source.todayError = cancellation
            let accepted = await model.loadIfStale(maxAge: -1)
            XCTAssertFalse(accepted)
            XCTAssertEqual(model.today, today)
            XCTAssertEqual(model.loadedAt, loadedAt)
            XCTAssertEqual(model.loadErrorMessage, "실제 조회 오류")
            XCTAssertFalse(model.isLoading)
            XCTAssertTrue(model.needsReloadAfterCancelledRead)
            source.todayError = nil
            let reads = source.todayCallCount
            let retried = await model.loadIfStale()
            XCTAssertTrue(retried)
            XCTAssertEqual(source.todayCallCount, reads + 1)
            XCTAssertNil(model.loadErrorMessage)
            XCTAssertFalse(model.needsReloadAfterCancelledRead)
        }
    }

    func testCancelledInitialTodayReadDoesNotAdoptCacheOrLeaveAnErrorOrSpinner() async throws {
        for cancellation in cancellations {
            let source = TodayViewModelTests.StubDataSource(todayResponse: try fixture())
            source.cachedToday = source.todayResponse
            source.todayError = cancellation
            let model = TodayViewModel(trip: source.todayResponse.trip, service: source)
            let accepted = await model.loadIfStale()
            XCTAssertFalse(accepted)
            XCTAssertNil(model.today, "취소된 읽기가 선표시한 캐시도 남기지 않는다")
            XCTAssertNil(model.loadedAt)
            XCTAssertNil(model.loadErrorMessage)
            XCTAssertFalse(model.isLoading)
            source.todayError = nil
            let retried = await model.loadIfStale()
            XCTAssertTrue(retried)
            XCTAssertEqual(model.today, source.todayResponse)
        }
    }

    func testAlreadyCancelledTaskDoesNotStartDocumentOrTodayQueries() async throws {
        let documentSource = FakeDocumentService(snapshot: snapshot())
        var documentReads = 0
        documentSource.documentHandler = { documentReads += 1; return documentSource.snapshot }
        let store = TripDocumentStore(tripId: "t1", service: documentSource)
        let source = TodayViewModelTests.StubDataSource(todayResponse: try fixture())
        let model = TodayViewModel(trip: source.todayResponse.trip, service: source)
        let read = Task { @MainActor in
            withUnsafeCurrentTask { $0?.cancel() }
            let doc = await store.load(), today = await model.loadIfStale()
            return (doc, today)
        }
        let result = await read.value
        XCTAssertFalse(result.0); XCTAssertFalse(result.1)
        XCTAssertEqual(documentReads, 0)
        XCTAssertEqual(source.todayCallCount, 0)
        XCTAssertEqual(source.cachedTodayReads, 0)
        XCTAssertFalse(store.isLoading); XCTAssertFalse(model.isLoading)
    }

    func testTodayReentryWhileCancelledRequestIsUnwindingGetsOneFreshRead() async throws {
        let source = TodayViewModelTests.StubDataSource(todayResponse: try fixture())
        let model = TodayViewModel(trip: source.todayResponse.trip, service: source)
        await model.load()
        let confirmed = model.today
        let started = expectation(description: "취소될 응답 대기"), retried = expectation(description: "복귀 후 새 읽기")
        var pending: CheckedContinuation<TripService.Fetched<TodayResponse>, Error>?
        source.todayHandler = { try await withCheckedThrowingContinuation { pending = $0; started.fulfill() } }
        let old = Task { await model.load() }
        await fulfillment(of: [started], timeout: 2)
        let response = try XCTUnwrap(pending)
        old.cancel()
        let immediate = await model.loadIfStale()
        XCTAssertFalse(immediate)
        source.todayHandler = {
            retried.fulfill()
            return .init(value: source.todayResponse, cachedAt: nil)
        }
        response.resume(returning: .init(value: source.todayResponse, cachedAt: nil))
        await old.value
        await fulfillment(of: [retried], timeout: 2)
        for _ in 0..<20 where model.isLoading { await Task.yield() }
        XCTAssertEqual(source.todayCallCount, 3, "기존 성공·취소된 읽기·새 진입이 요청한 한 번")
        XCTAssertEqual(model.today, confirmed)
        XCTAssertFalse(model.isLoading)
        XCTAssertFalse(model.needsReloadAfterCancelledRead)
        XCTAssertNil(model.loadErrorMessage)
    }

    func testRequestDuringNormalTodayLoadDoesNotDuplicateSuccessfulRead() async throws {
        let source = TodayViewModelTests.StubDataSource(todayResponse: try fixture())
        let model = TodayViewModel(trip: source.todayResponse.trip, service: source)
        let started = expectation(description: "정상 응답 대기")
        var pending: CheckedContinuation<TripService.Fetched<TodayResponse>, Error>?
        source.todayHandler = { try await withCheckedThrowingContinuation { pending = $0; started.fulfill() } }
        let first = Task { await model.load() }
        await fulfillment(of: [started], timeout: 2)
        let response = try XCTUnwrap(pending)
        let coalesced = await model.loadIfStale()
        XCTAssertFalse(coalesced)
        response.resume(returning: .init(value: source.todayResponse, cachedAt: nil))
        await first.value
        for _ in 0..<20 { await Task.yield() }
        XCTAssertEqual(source.todayCallCount, 1)
        XCTAssertFalse(model.isLoading)
    }

    func testFreshMutationClearsCancelledReadRetryState() async throws {
        let source = TodayViewModelTests.StubDataSource(todayResponse: try fixture())
        let model = TodayViewModel(trip: source.todayResponse.trip, service: source)
        await model.load()
        source.todayError = URLError(.cancelled)
        await model.load()
        XCTAssertTrue(model.needsReloadAfterCancelledRead)
        let today = source.todayResponse
        let response = MutationResponse(schemaVersion: 1, applied: true, alreadyApplied: false,
            revision: today.trip.revision, today: today)
        model.acceptStayExtension(response)
        XCTAssertFalse(model.needsReloadAfterCancelledRead)
        source.todayError = nil
        let reads = source.todayCallCount
        let refreshed = await model.loadIfStale()
        XCTAssertFalse(refreshed)
        XCTAssertEqual(source.todayCallCount, reads)
    }

    func testFailedMutationReleasesSupersededTodayLoadingOwnerAndAllowsAnotherRead() async throws {
        let source = TodayViewModelTests.StubDataSource(todayResponse: try fixture())
        let model = TodayViewModel(trip: source.todayResponse.trip, service: source)
        await model.load()
        let confirmed = model.today, loadedAt = model.loadedAt
        let started = expectation(description: "저장 전에 시작한 조회 대기")
        var pending: CheckedContinuation<TripService.Fetched<TodayResponse>, Error>?
        source.todayHandler = { try await withCheckedThrowingContinuation { pending = $0; started.fulfill() } }
        let old = Task { await model.load() }
        await fulfillment(of: [started], timeout: 2)
        let response = try XCTUnwrap(pending)
        source.mutationResult = .failure(APIError.offline)
        await model.complete(try XCTUnwrap(source.todayResponse.activities.first))
        XCTAssertFalse(model.isLoading, "쓰기 시작이 읽기 세대를 넘기면 이전 읽기의 로딩 소유도 끝난다")
        source.todayHandler = nil
        response.resume(returning: .init(value: source.todayResponse, cachedAt: nil))
        await old.value
        XCTAssertEqual(model.today, confirmed)
        XCTAssertEqual(model.loadedAt, loadedAt)
        XCTAssertNotNil(model.actionErrorMessage, "실제 저장 실패는 유지한다")
        let reads = source.todayCallCount
        await model.load()
        XCTAssertEqual(source.todayCallCount, reads + 1)
        XCTAssertFalse(model.isLoading)
        XCTAssertEqual(model.today, source.todayResponse)
        XCTAssertNotNil(model.actionErrorMessage)
    }
}

@MainActor
private final class CancellationMembers: MemberListing {
    private(set) var reads = 0
    func members(tripId: String) async throws -> [MemberView] { reads += 1; return [] }
}
