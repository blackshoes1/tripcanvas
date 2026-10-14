import XCTest
@testable import TripCanvas

@MainActor
private final class OrderedSearch: PlaceSearching {
    var pending: [String: CheckedContinuation<[PlaceHit], Error>] = [:]
    var region: PlaceSearchRegion?
    func search(_ query: String, near: GeoPoint?) async throws -> [PlaceHit] {
        try await withCheckedThrowingContinuation { pending[query] = $0 }
    }
    func search(_ query: String, near: GeoPoint?, region: PlaceSearchRegion?) async throws -> [PlaceHit] {
        self.region = region
        return try await search(query, near: near)
    }
}

@MainActor
final class IOSReviewRegressionTests: XCTestCase {
    private func hit(_ name: String) -> PlaceHit {
        PlaceHit(id: name, name: name, city: "파리", address: "파리 주소", point: GeoPoint(lat: 48.85, lng: 2.35), category: .sight, placeId: nil)
    }
    private func waitUntil(_ ready: () -> Bool) async {
        for _ in 0..<1000 { if ready() { return }; await Task.yield() }
        XCTFail("비동기 작업이 시작되지 않았어요")
    }

    func testEmptyForeignTripChoosesInternationalRegardlessOfQueryLanguage() {
        XCTAssertEqual(PlaceSearchScope.initial(near: nil, timeZone: "Europe/Paris"), .international)
        XCTAssertEqual(PlaceSearchScope.initial(near: nil, timeZone: "Asia/Seoul"), .korea)
        XCTAssertEqual(PlaceSearchScope.initial(near: nil, timeZone: nil), .automatic)
        XCTAssertEqual(PlaceSearchScope.initial(near: GeoPoint(lat: 35.6, lng: 139.7), timeZone: "Asia/Seoul"), .international)
        XCTAssertFalse(PlaceSearchService.nameMatches("에펠탑 카페", "에펠탑"))
        XCTAssertTrue(PlaceSearchService.nameMatches("에펠 탑", "에펠탑"))
    }

    func testLateOlderSearchCannotReplaceLatestResultsOrStopItsLoading() async throws {
        let source = OrderedSearch(), model = PlaceSearchViewModel(source: source)
        let first = Task { await model.search("A", near: nil, scope: .international) }
        await waitUntil { source.pending["A"] != nil }
        let second = Task { await model.search("B", near: nil, scope: .international) }
        await waitUntil { source.pending["B"] != nil }
        source.pending.removeValue(forKey: "A")?.resume(returning: [hit("A")])
        await first.value
        XCTAssertTrue(model.isSearching)
        source.pending.removeValue(forKey: "B")?.resume(returning: [hit("B")])
        await second.value
        XCTAssertEqual(model.hits.map(\.name), ["B"])
        XCTAssertEqual(model.searchedQuery, "B"); XCTAssertEqual(source.region, .international)
        XCTAssertFalse(model.isSearching)
    }

    func testClosedSearchDoesNotAdoptLateResult() async {
        let source = OrderedSearch(), model = PlaceSearchViewModel(source: source)
        let work = Task { await model.search("A", near: nil, scope: .automatic) }
        await waitUntil { source.pending["A"] != nil }
        model.invalidate()
        source.pending.removeValue(forKey: "A")?.resume(returning: [hit("A")])
        await work.value
        XCTAssertTrue(model.hits.isEmpty); XCTAssertFalse(model.searched)
    }

    private func fixture(_ revision: Int = 1) throws -> (TripDocument, TripCostsResponse) {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "cost-overview", withExtension: "json"))
        var raw = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        var costs = try XCTUnwrap(raw["costs"] as? [String: Any]); costs["revision"] = revision; raw["costs"] = costs
        let decoded = try JSONDecoder().decode(CostOverviewTests.Fixture.self, from: JSONSerialization.data(withJSONObject: raw))
        return (TripDocument(raw: try XCTUnwrap(decoded.document.objectValue)), decoded.costs)
    }

    func testCostSaveCompletesBeforeRecalculationAndCalculationFailureDoesNotUndoSave() async throws {
        let (document, costs) = try fixture()
        let source = FakeDocumentService(snapshot: .init(document: document, revision: 1, role: .owner))
        let memory = TripCostsMemory(); memory.remember(snapshot: source.snapshot, response: costs)
        var pending: CheckedContinuation<TripCostsResponse, Error>?
        let model = TripCostsViewModel(tripId: "t1", documents: source, memory: memory) {
            try await withCheckedThrowingContinuation { pending = $0 }
        }
        let saved = await model.save(expected: 1) { $0.name = "저장됨" }
        XCTAssertTrue(saved); XCTAssertEqual(model.snapshot?.document.name, "저장됨")
        XCTAssertEqual(model.snapshot?.revision, 2)
        await waitUntil { pending != nil }
        pending?.resume(throwing: APIError.offline); pending = nil
        await waitUntil { !model.isCalculating }
        XCTAssertEqual(model.snapshot?.document.name, "저장됨")
        XCTAssertNil(model.store.saveErrorMessage); XCTAssertNotNil(model.error)
    }

    func testRemoteInvalidationKeepsEditorBasisAndPreventsStaleSave() async throws {
        let (document, costs) = try fixture()
        let source = FakeDocumentService(snapshot: .init(document: document, revision: 1, role: .owner))
        let memory = TripCostsMemory(); memory.remember(snapshot: source.snapshot, response: costs)
        let (_, freshCosts) = try fixture(2)
        let model = TripCostsViewModel(tripId: "t1", documents: source, memory: memory) { freshCosts }
        source.snapshot = .init(document: document, revision: 2, role: .owner)
        memory.invalidate(); await model.invalidate(editing: true)
        XCTAssertEqual(model.snapshot?.revision, 1)
        let saved = await model.save(expected: 1) { $0.name = "고치면 안 됨" }
        XCTAssertFalse(saved); XCTAssertTrue(source.saves.isEmpty)
        await model.load()
        XCTAssertEqual(model.snapshot?.revision, 2); XCTAssertEqual(model.response?.revision, 2)
        XCTAssertTrue(model.canEdit); XCTAssertTrue(memory.isFresh())
    }

    func testUnknownFilterIncludesPartialAndExcludesConfirmedFree() throws {
        let (_, costs) = try fixture()
        let rows = try XCTUnwrap(costs.overview?.items)
        let filtered = rows.filter { TripCostsView.OverviewFilter.unconfirmed.includes($0) }
        XCTAssertTrue(filtered.contains { $0.line.state == "UNKNOWN" })
        XCTAssertTrue(filtered.contains { $0.line.state == "PARTIAL" })
        XCTAssertFalse(filtered.contains { $0.line.state == "FREE" })
    }

    func testOwnSaveInvalidationDoesNotMarkTheJustSavedDocumentStale() async throws {
        let (document, costs) = try fixture()
        let (_, updated) = try fixture(2)
        let source = FakeDocumentService(snapshot: .init(document: document, revision: 1, role: .owner))
        let memory = TripCostsMemory(); memory.remember(snapshot: source.snapshot, response: costs)
        let model = TripCostsViewModel(tripId: "t1", documents: source, memory: memory) { updated }
        let saved = await model.save(expected: 1) { $0.name = "내 변경" }
        XCTAssertTrue(saved)
        memory.invalidate(revision: 2)
        await model.invalidate(editing: false)
        XCTAssertFalse(model.needsReload); XCTAssertTrue(model.canEdit)
    }
}
