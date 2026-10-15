import XCTest
@testable import TripCanvas

@MainActor
final class DailyMomentsTests: XCTestCase {
    func testSavedResponseWinsAndWithdrawOnlyClearsMyChoice() async {
        let source = DailyMomentsFakeSource(), model = DailyMomentsViewModel(tripId: "trip", dayIndex: 0, service: source)
        await model.load()
        await model.choose(source.response.options[0])
        XCTAssertEqual(source.writes.count, 1)
        XCTAssertEqual(source.writes[0].revision, 4)
        XCTAssertEqual(model.response?.moments.map(\.spotName), ["카페", "노을"])
        await model.choose(nil)
        XCTAssertEqual(model.response?.moments.map(\.spotName), ["노을"])
        XCTAssertEqual(model.confirmation, "내 선택을 거뒀어요")
    }

    func testOfflineAndConflictPreserveConfirmedChoiceAndReturnRecoveryError() async {
        let source = DailyMomentsFakeSource(), model = DailyMomentsViewModel(tripId: "trip", dayIndex: 0, service: source)
        await model.load(); await model.choose(source.response.options[0])
        let confirmed = model.response
        source.failure = APIError.offline
        await model.choose(nil)
        XCTAssertEqual(model.response, confirmed)
        XCTAssertNotNil(model.errorMessage)
        XCTAssertNil(model.confirmation)
        source.failure = APIError.revisionConflict(message: "일정이 바뀌었어요", revision: 5)
        await model.choose(nil)
        XCTAssertEqual(model.response, confirmed)
        XCTAssertEqual(model.errorMessage, "일정이 바뀌었어요")
        source.failure = nil
        await model.load()
        XCTAssertNil(model.errorMessage)
    }

    func testAmbiguousOrForeignOptionDoesNotWrite() async {
        let source = DailyMomentsFakeSource(), model = DailyMomentsViewModel(tripId: "trip", dayIndex: 0, service: source)
        await model.load()
        await model.choose(.init(key: "unknown", name: "없는 곳", activityId: "d0s3", selectable: true))
        await model.choose(.init(key: "duplicate", name: "카페", activityId: "d0s1", selectable: false))
        XCTAssertTrue(source.writes.isEmpty)
    }

    func testAccessEndedClearsPreviousCompanionData() async {
        let source = DailyMomentsFakeSource(), model = DailyMomentsViewModel(tripId: "trip", dayIndex: 0, service: source)
        await model.load()
        XCTAssertNotNil(model.response)
        source.failure = APIError.unauthorized
        await model.load()
        XCTAssertNil(model.response)
        XCTAssertNotNil(model.errorMessage)
    }

    func testLatePreviousDayResponseCannotReplaceCurrentDay() async {
        let source = DailyMomentsFakeSource()
        source.delayFirstRead = true
        let model = DailyMomentsViewModel(tripId: "trip", dayIndex: 0, service: source)
        let oldRequest = Task { await model.load() }
        while source.pendingRead == nil { await Task.yield() }
        await model.load(dayIndex: 1)
        source.pendingRead?.resume(returning: source.response)
        source.pendingRead = nil
        await oldRequest.value
        XCTAssertEqual(model.response?.dayIndex, 1)
        XCTAssertEqual(model.dayIndex, 1)
    }

    func testImpactTextOnlyNamesActualAffectedWishesAndNeverCallsThemAgreement() {
        let source = DailyMomentsFakeSource()
        let rows = [DailyMoment(userId: "a", label: "나", mine: true, spotKey: "cafe", spotName: "카페", activityId: "d0s0", status: "ACTIVE"), source.response.moments[0]]
        let text = DailyMomentImpactText.make(rows, changed: ["d0s0"], removed: ["d0s1"])
        XCTAssertEqual(text.count, 2)
        XCTAssertTrue(text[0].contains("시간이나 순서"))
        XCTAssertTrue(text[1].contains("영희"))
        XCTAssertTrue(text[1].contains("빠져요"))
        XCTAssertFalse(text.joined().contains("합의"))
        XCTAssertTrue(DailyMomentImpactText.make(rows, changed: [], removed: []).isEmpty)
    }
}

@MainActor
private final class DailyMomentsFakeSource: DailyMomentsSource {
    var response = DailyMomentsResponse(dayIndex: 0, dayKey: "date:2026-10-15", revision: 4,
        options: [.init(key: "cafe", name: "카페", activityId: "d0s0", selectable: true)],
        moments: [.init(userId: "b", label: "영희", mine: false, spotKey: "sunset", spotName: "노을", activityId: "d0s1", status: "ACTIVE")])
    var failure: Error?
    var writes: [(revision: Int, key: String?)] = []
    var delayFirstRead = false
    var pendingRead: CheckedContinuation<DailyMomentsResponse, Error>?

    func dailyMoments(tripId: String, dayIndex: Int) async throws -> DailyMomentsResponse {
        if let failure { throw failure }
        if delayFirstRead { delayFirstRead = false; return try await withCheckedThrowingContinuation { pendingRead = $0 } }
        return .init(dayIndex: dayIndex, dayKey: response.dayKey, revision: response.revision, options: response.options, moments: response.moments)
    }
    func saveDailyMoment(tripId: String, dayIndex: Int, expectedRevision: Int, spotKey: String?) async throws -> DailyMomentsResponse {
        writes.append((expectedRevision, spotKey))
        if let failure { throw failure }
        var rows = response.moments.filter { !$0.mine }
        if let spotKey { rows.insert(.init(userId: "a", label: "나", mine: true, spotKey: spotKey, spotName: "카페", activityId: "d0s0", status: "ACTIVE"), at: 0) }
        response = .init(dayIndex: dayIndex, dayKey: response.dayKey, revision: response.revision, options: response.options, moments: rows)
        return response
    }
}
