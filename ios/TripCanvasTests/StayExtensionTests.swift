import XCTest
@testable import TripCanvas

@MainActor
final class StayExtensionTests: XCTestCase {
    func testLatePreviewCannotReplaceNewestDuration() async {
        let source = StayFakeSource()
        source.suspendFirst = true
        let model = StayExtensionModel(tripID: "parity", activityID: "d0s0", revision: 2, source: source)
        let old = Task { await model.select(10) }
        while source.pending == nil { await Task.yield() }
        await model.select(30)
        source.pending?.resume(returning: StayExtensionReviewSource.preview(10)); source.pending = nil
        await old.value
        XCTAssertEqual(model.minutes, 30)
        XCTAssertEqual(model.preview?.extraMinutes, 30)
        XCTAssertFalse(model.isLoading)
    }
    func testLostResponseCannotBeResentBlindly() async {
        let source = StayFakeSource()
        let model = StayExtensionModel(tripID: "parity", activityID: "d0s0", revision: 2, source: source)
        await model.select(20)
        let result = await model.apply()
        XCTAssertNil(result)
        XCTAssertTrue(model.requiresReopen)
        XCTAssertNil(model.preview)
        await model.select(30)
        _ = await model.apply()
        XCTAssertEqual(source.writes, 1)
        XCTAssertNotNil(model.error)
    }
    func testSuccessfulApplyUsesExactlyConfirmedPreview() async throws {
        let source = StayFakeSource()
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "today", withExtension: "json"))
        let today = try JSONDecoder().decode(TodayResponse.self, from: Data(contentsOf: url))
        source.response = .init(schemaVersion: 1, applied: true, alreadyApplied: false, revision: 3, today: today)
        let model = StayExtensionModel(tripID: "parity", activityID: "d0s0", revision: 2, source: source)
        await model.select(20)
        let result = await model.apply()
        XCTAssertNotNil(result)
        XCTAssertEqual(source.confirmed?.previewKey, "synthetic-20")
        XCTAssertEqual(source.confirmed?.revision, 2)
    }
    func testOfflinePreviewHasNoApplicableStaleResult() async {
        let source = StayFakeSource()
        let model = StayExtensionModel(tripID: "parity", activityID: "d0s0", revision: 2, source: source)
        await model.select(10)
        source.readFails = true
        await model.select(30)
        XCTAssertNil(model.preview)
        _ = await model.apply()
        XCTAssertEqual(source.writes, 0)
    }
    func testAccountChangeAfterPreviewCannotStartWrite() async {
        let source = StayFakeSource()
        var current = true
        let model = StayExtensionModel(tripID: "parity", activityID: "d0s0", revision: 2, source: source, isCurrent: { current })
        await model.select(10)
        current = false
        _ = await model.apply()
        XCTAssertEqual(source.writes, 0)
    }
}

@MainActor private final class StayFakeSource: StayExtensionSource {
    var suspendFirst = false
    var pending: CheckedContinuation<StayExtensionPreview, Error>?
    var reads = 0
    var writes = 0
    var readFails = false
    var confirmed: StayExtensionPreview?
    var response: MutationResponse?
    func previewStay(tripId: String, activityId: String, minutes: Int, revision: Int) async throws -> StayExtensionPreview {
        reads += 1
        if readFails { throw APIError.offline }
        if suspendFirst && reads == 1 { return try await withCheckedThrowingContinuation { pending = $0 } }
        return StayExtensionReviewSource.preview(minutes)
    }
    func applyStay(tripId: String, preview: StayExtensionPreview) async throws -> MutationResponse {
        writes += 1; confirmed = preview
        guard let response else { throw APIError.offline }
        return response
    }
}
