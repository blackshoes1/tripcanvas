import XCTest
@testable import TripCanvas

@MainActor final class CalmTravelTests: XCTestCase {
    func testDecodesActualChoiceComparisonAPIResponse() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "choice-comparison", withExtension: "json"))
        let result = try JSONDecoder().decode(ChoiceComparison.self, from: Data(contentsOf: url))
        XCTAssertEqual(result.revision, 2); XCTAssertEqual(result.choices.count, 2)
        XCTAssertGreaterThan(try XCTUnwrap(result.choices[1].travel?.minutes), try XCTUnwrap(result.choices[0].travel?.minutes))
    }
    func testActivityFocusMovesToExactDayAndRejectsChangedRevision() async {
        let source = QuickChoiceFakeSource(), model = TripPlanViewModel(tripId: "trip", service: QuickChoiceFakeSource(), loadsPlans: false)
        await model.load()
        model.selectedDay = 0
        model.requestFocus(Self.activity, day: 1, revision: 3)
        XCTAssertEqual(model.selectedDay, 1)
        XCTAssertEqual(model.takeFocusedSpot()?.spot.name, "미술관")
        XCTAssertNil(model.takeFocusedSpot())
        model.requestFocus(Self.activity, day: 1, revision: source.snapshot.revision + 1)
        XCTAssertTrue(model.needsRemoteReload)
        XCTAssertNil(model.takeFocusedSpot())
    }
    func testExpiredOfflineAndInvalidAssuranceRequiresNewCheck() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-16T12:00:00Z"))
        let moment = CalmMoment(state: "RELAX", text: "여유 30분", expiresAt: "2026-10-16T12:01:00.000Z")
        XCTAssertEqual(CalmMomentPresentation.text(moment, offline: false, now: now), "여유 30분")
        for (offline, date) in [(true, now), (false, now.addingTimeInterval(60))] {
            XCTAssertTrue(CalmMomentPresentation.text(moment, offline: offline, now: date).contains("다시 확인"))
        }
        XCTAssertTrue(CalmMomentPresentation.text(.init(state: "RELAX", text: "old", expiresAt: "bad"), offline: false, now: now).contains("다시 확인"))
    }
    func testDayLabelUsesCalendarDateAcrossMonthBoundary() {
        let trip = TripSummary(id: "trip", name: "", start: "2026-10-31", dayCount: 3, revision: 1,
            updatedAt: "", timeZone: "Europe/Madrid", cities: [], todayIndex: 0, daysUntilStart: nil, role: nil, memberCount: nil)
        XCTAssertEqual(trip.dayLabel(1), "Day 2 · 11월 1일")
    }
    func testQuickChoiceSavesOneSlotAndUndoUsesConfirmedRevision() async {
        let source = QuickChoiceFakeSource(), model = make(source)
        await model.load(); await model.choose(alternative: true)
        XCTAssertEqual(source.revisions, [3])
        XCTAssertTrue(model.isSaved); XCTAssertEqual(model.spot?.name, "강변 산책")
        XCTAssertEqual(source.snapshot.document.days[1].spots.count, 1)
        XCTAssertEqual(model.spot?.choice?.alternative.name, "미술관")
        await model.undo(); await model.load()
        XCTAssertEqual(source.revisions, [3, 4])
        XCTAssertEqual(model.spot?.name, "미술관"); XCTAssertEqual(model.spot?.choice?.state, .pending)
        XCTAssertEqual(source.snapshot.document.days[0].spots[0].name, "실제 다른 날")
    }
    func testLostResponseBlocksBlindSecondChoice() async {
        let source = QuickChoiceFakeSource(), model = make(source)
        await model.load(); source.loseResponse = true
        await model.choose(alternative: true); await model.choose(alternative: false)
        XCTAssertTrue(model.requiresRefresh); XCTAssertFalse(model.isSaved)
        XCTAssertEqual(source.revisions.count, 1)
        XCTAssertEqual(source.snapshot.document.days[1].spots[0].name, "강변 산책")
    }
    func testUndoCannotOverwriteAnotherEdit() async {
        let source = QuickChoiceFakeSource(), model = make(source)
        await model.load(); await model.choose(alternative: true)
        source.snapshot = .init(document: source.snapshot.document, revision: 9, role: .owner)
        await model.undo()
        XCTAssertTrue(model.requiresRefresh)
        XCTAssertEqual(source.snapshot.revision, 9)
        XCTAssertEqual(source.snapshot.document.days[1].spots[0].name, "강변 산책")
    }
    func testStaleOrOfflineDocumentsCannotChoose() async {
        for offline in [false, true] {
            let source = QuickChoiceFakeSource()
            source.snapshot = .init(document: source.snapshot.document, revision: offline ? 3 : 4, role: .owner, cachedAt: offline ? Date() : nil)
            let model = make(source); await model.load(); await model.choose(alternative: true)
            XCTAssertTrue(model.requiresRefresh); XCTAssertTrue(source.revisions.isEmpty)
        }
    }
    private func make(_ source: QuickChoiceFakeSource) -> QuickChoiceModel {
        QuickChoiceModel(tripID: "trip", day: 1, activity: Self.activity, revision: 3, source: source)
    }
    static let activity = ActivitySummary(id: "d1s0", name: "미술관", city: "서울", desc: "", status: .planned,
        flexibility: .flexible, type: .other, etaMinutes: 840, startMinutes: 840, endMinutes: 900,
        stayMinutes: 60, travelInMinutes: 0, fixedAtMinutes: nil, location: nil, mustVisit: false,
        optional: false, bookingId: nil, bookUrl: nil, placeId: nil, choiceState: "PENDING")
}

@MainActor private final class QuickChoiceFakeSource: TripDocumentSource {
    var snapshot: TripDocumentSnapshot
    var revisions: [Int] = []
    var loseResponse = false
    init() {
        var spot = TripSpot(name: "미술관", city: "서울")
        spot.choice = .init(alternative: TripSpot(name: "강변 산책", city: "서울"), state: .pending)
        snapshot = .init(document: TripDocument(raw: ["days": .array([
            .object(["spots": .array([.object(TripSpot(name: "실제 다른 날").raw)])]),
            .object(["spots": .array([.object(spot.raw)])])])]), revision: 3, role: .owner)
    }
    func document(tripId: String) async throws -> TripDocumentSnapshot { snapshot }
    func saveDocument(tripId: String, document: TripDocument, expectedRevision: Int) async throws -> TripDocumentSnapshot {
        revisions.append(expectedRevision)
        guard expectedRevision == snapshot.revision else { throw APIError.revisionConflict(message: "충돌", revision: snapshot.revision) }
        snapshot = .init(document: document, revision: expectedRevision + 1, role: .owner)
        if loseResponse { throw APIError.offline }
        return snapshot
    }
    func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse> { throw APIError.offline }
    func cachedDayPlan(tripId: String, dayIndex: Int) async -> DayPlanResponse? { nil }
    func tripRoutes(tripId: String) async throws -> TripRoutesResponse { throw APIError.offline }
}
