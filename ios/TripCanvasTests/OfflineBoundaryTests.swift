import XCTest
@testable import TripCanvas

@MainActor
final class OfflineBoundaryTests: XCTestCase {
    private func document(_ names: [String]) -> TripDocument {
        var document = TripDocument(raw: [:])
        var day = TripDay()
        day.spots = names.map { TripSpot(name: $0) }
        document.days = [day, TripDay()]
        return document
    }

    func testOpenSpotEditorRejectsRemoteInsertionForSaveDeleteAndMove() async {
        for action in 0..<3 {
            let service = FakeDocumentService(snapshot: .init(document: document(["A", "B"]), revision: 1, role: .owner))
            let model = TripPlanViewModel(tripId: "t1", service: service, loadsPlans: false)
            await model.load()
            let openedRevision = model.revision
            var draft = model.document!.days[0].spots[1]
            draft.name = "B edited"
            service.snapshot = .init(document: document(["X", "A", "B"]), revision: 2, role: .owner)
            await model.load()
            let saved: Bool
            switch action {
            case 0: saved = await model.updateSpot(at: 1, with: draft, dayIndex: 0, expectedRevision: openedRevision)
            case 1: saved = await model.removeSpot(at: 1, dayIndex: 0, expectedRevision: openedRevision)
            default: saved = await model.moveSpot(at: 1, toDay: 1, with: draft, dayIndex: 0, expectedRevision: openedRevision)
            }
            XCTAssertFalse(saved)
            XCTAssertEqual(model.document?.days[0].spots.map(\.name), ["X", "A", "B"])
            XCTAssertEqual(service.snapshot.revision, 2)
        }
    }

    func testOfflineDocumentRemainsReadableButCannotBeEditedUntilRefreshed() async {
        let old = Date(timeIntervalSince1970: 1_800_000_000)
        var offlineDocument = document(["A", "B"])
        var nextDay = TripDay()
        nextDay.title = "아직 열지 않은 날"
        nextDay.note = "출입구에서 만나기"
        var nextSpot = TripSpot(name: "둘째 날 장소")
        nextSpot.desc = "예약 확인 메모"
        nextDay.spots = [nextSpot]
        offlineDocument.days = [offlineDocument.days[0], nextDay]
        let service = FakeDocumentService(snapshot: .init(document: offlineDocument, revision: 2, role: .owner, cachedAt: old))
        let model = TripPlanViewModel(tripId: "t1", service: service, loadsPlans: false)
        await model.load()
        XCTAssertEqual(model.document?.days[0].spots.map(\.name), ["A", "B"])
        XCTAssertEqual(model.documentCachedAt, old)
        XCTAssertFalse(model.canEdit)
        model.selectedDay = 1
        XCTAssertEqual(model.day?.title, "아직 열지 않은 날")
        XCTAssertEqual(model.day?.note, "출입구에서 만나기")
        XCTAssertEqual(model.day?.spots.first?.name, "둘째 날 장소")
        XCTAssertEqual(model.day?.spots.first?.desc, "예약 확인 메모")
        XCTAssertNil(model.plan)
        model.selectedDay = 0
        let saved = await model.removeSpot(at: 0)
        XCTAssertFalse(saved)
        service.snapshot = .init(document: document(["A", "B"]), revision: 2, role: .owner)
        await model.loadIfStale()
        XCTAssertTrue(model.canEdit)
        XCTAssertNil(model.documentCachedAt)
    }

    func testAccountCacheCannotReadOrWritePreviousAccountResponses() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let a = TripCache.Scope(accountID: "a", generation: 0)
        let b = TripCache.Scope(accountID: "b", generation: 2)
        let cache = TripCache(directory: directory, scope: a)
        await cache.save(["private-a"], key: TripCache.tripsKey, scope: a)
        await cache.activate(.init(accountID: nil, generation: 1))
        await cache.activate(b)
        await cache.activate(a)
        await cache.save(["late-private-a"], key: TripCache.tripsKey, scope: a)
        let wrong = await cache.load([String].self, key: TripCache.tripsKey, scope: b)
        let previous = await cache.load([String].self, key: TripCache.tripsKey, scope: a)
        XCTAssertNil(wrong)
        XCTAssertNil(previous)
        await cache.save(["b"], key: TripCache.tripsKey, scope: b)
        let mine = await cache.load([String].self, key: TripCache.tripsKey, scope: b)
        XCTAssertEqual(mine?.value, ["b"])
    }

    func testAccountCacheCanBeReadAfterAppRestartBySameAccountOnly() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let a = TripCache.Scope(accountID: "a", generation: 0)
        await TripCache(directory: directory, scope: a).save(["a"], key: "trips", scope: a)
        let same = await TripCache(directory: directory, scope: a).load([String].self, key: "trips", scope: a)
        XCTAssertEqual(same?.value, ["a"])
        let b = TripCache.Scope(accountID: "b", generation: 0)
        let other = await TripCache(directory: directory, scope: b).load([String].self, key: "trips", scope: b)
        XCTAssertNil(other)
    }
}

@MainActor
private final class CachedTravelSource: TravelStateSource {
    let result: TripService.Fetched<TravelStateResponse>
    var pending: CheckedContinuation<TripService.Fetched<TravelStateResponse>, Error>?
    var delays = false
    init(_ result: TripService.Fetched<TravelStateResponse>) { self.result = result }
    func travelState(tripId: String, location: GeoPoint?, locationUpdatedAt: String?, travelMode: Bool,
                     suppressUntil: String?, markSent: Bool) async throws -> TripService.Fetched<TravelStateResponse> {
        if delays { return try await withCheckedThrowingContinuation { pending = $0 } }
        return result
    }
}
@MainActor private final class BoundaryPush: PushScheduling {
    var presented = 0
    func present(_ item: NotificationPlanItem) { presented += 1 }
}
@MainActor private final class BoundaryActivity: LiveActivityControlling {
    var synced = 0
    func sync(_ response: TravelStateResponse, changed: Bool) async { synced += 1 }
    func end() async {}
}
@MainActor
final class TravelOfflineBoundaryTests: XCTestCase {
    private func fixture() throws -> TravelStateResponse {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "travel-state", withExtension: "json"))
        return try JSONDecoder().decode(TravelStateResponse.self, from: Data(contentsOf: url))
    }

    func testOfflineTravelPreservesTimestampAndDoesNotResendNotifications() async throws {
        SharedStore.clear()
        defer { SharedStore.clear() }
        let response = try fixture()
        let savedAt = Date(timeIntervalSince1970: 1_800_000_000)
        let source = CachedTravelSource(.init(value: response, cachedAt: savedAt))
        let push = BoundaryPush()
        let activity = BoundaryActivity()
        let model = TravelModeController(service: source, location: LocationProvider(), push: push, liveActivity: activity)
        await model.start(trip: response.today.trip)
        XCTAssertEqual(SharedStore.loadWidgetSnapshot()?.savedAt, savedAt)
        XCTAssertEqual(SharedStore.loadActivityState()?.savedAt, savedAt)
        XCTAssertNotNil(model.lastError)
        XCTAssertEqual(push.presented, 0)
        XCTAssertEqual(activity.synced, 0)
    }

    func testAccountResetDiscardsPendingTravelResponseAndSharedData() async throws {
        SharedStore.clear()
        defer { SharedStore.clear() }
        let response = try fixture()
        let source = CachedTravelSource(.init(value: response, cachedAt: nil))
        source.delays = true
        let model = TravelModeController(service: source, location: LocationProvider(), push: BoundaryPush(), liveActivity: BoundaryActivity())
        let request = Task { await model.start(trip: response.today.trip) }
        while source.pending == nil { await Task.yield() }
        model.resetForAccountChange()
        source.pending?.resume(returning: source.result)
        await request.value
        XCTAssertFalse(model.isActive)
        XCTAssertNil(model.travelState)
        XCTAssertNil(SharedStore.loadWidgetSnapshot())
        XCTAssertNil(SharedStore.loadTravelMode())
    }
}
