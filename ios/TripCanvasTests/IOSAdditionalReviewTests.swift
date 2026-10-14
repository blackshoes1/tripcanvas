import AppIntents
import XCTest
@testable import TripCanvas

@MainActor
final class IOSAdditionalReviewTests: XCTestCase {
    private func summary(_ id: String = "trip1") -> TripSummary {
        TripSummary(id: id, name: id, start: "2026-10-15", dayCount: 3, revision: 1,
                    updatedAt: "", timeZone: "Asia/Seoul", cities: [], todayIndex: -1,
                    daysUntilStart: nil, role: .owner, memberCount: 1)
    }
    private func item(city: String = "") -> ItineraryDraftItem {
        ItineraryDraftItem(raw: "원문", name: "장소", city: city, desc: "메모", at: "15:00", endAt: nil,
                           stayMinutes: 60, url: "https://example.com/ticket", cost: 12.5, currency: "EUR",
                           optional: true, stay: false, location: nil, kind: .place, reasons: [])
    }
    private func hit(_ name: String, city: String, category: SpotCategory = .sight) -> PlaceHit {
        PlaceHit(id: name, name: name, city: city, address: "찾은 주소", point: .init(lat: 35, lng: 135),
                 category: category, placeId: nil, provider: "kakao", providerId: "123")
    }
    private func until(_ ready: () -> Bool) async {
        for _ in 0..<1000 { if ready() { return }; await Task.yield() }
        XCTFail("비동기 요청이 시작되지 않았어요")
    }
    private func travelFixture() throws -> TravelStateResponse {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "travel-state", withExtension: "json"))
        return try JSONDecoder().decode(TravelStateResponse.self, from: Data(contentsOf: url))
    }

    func testPasteStoresFractionalCostOptionalLinkAddressAndProviderIdentity() throws {
        let source = item(city: "파리")
        let draft = ItineraryDraft(name: "여행", start: nil, startAmbiguous: false,
                                   days: [.init(index: 0, title: "", date: nil, note: "", items: [source])])
        let raw = ItineraryDocument.make(draft: draft, lines: [.init(dayIndex: 0, item: source, include: true,
                                                                  found: hit("이름", city: "파리"))], name: "여행", start: "")
        let spot = try XCTUnwrap(TripDocument(raw: raw).days.first?.spots.first)
        XCTAssertEqual(spot.cost, 12.5); XCTAssertEqual(spot.currency, .eur)
        XCTAssertEqual(spot.priority, .optional); XCTAssertEqual(spot.bookUrl, "https://example.com/ticket")
        XCTAssertEqual(spot.raw["addr"], .string("찾은 주소")); XCTAssertEqual(spot.kakaoId, "123")
    }

    func testIOSItineraryContractAcceptsFractionalForeignAmounts() throws {
        let encoded = try JSONEncoder().encode(item())
        XCTAssertEqual(try JSONDecoder().decode(ItineraryDraftItem.self, from: encoded).cost, 12.5)
    }

    func testPasteAnchorsStayWithinDayAndExcludeAirportsAndUnselectedRows() {
        let airport = PasteItineraryView.Row(dayIndex: 0, item: item(), include: true,
                                            found: hit("간사이 공항", city: "이즈미사노", category: .transport))
        let osaka = PasteItineraryView.Row(dayIndex: 0, item: item(), include: true, found: hit("도톤보리", city: "오사카"))
        let target = PasteItineraryView.Row(dayIndex: 1, item: item(), include: true)
        XCTAssertNil(PasteItineraryView.searchContext(for: target, rows: [airport, osaka, target]).near)
        let kyoto = PasteItineraryView.Row(dayIndex: 1, item: item(), include: true, found: hit("기요미즈데라", city: "교토"))
        XCTAssertEqual(PasteItineraryView.searchContext(for: target, rows: [airport, osaka, kyoto, target]).city, "교토")
        let day0 = PasteItineraryView.Row(dayIndex: 0, item: item(), include: true)
        XCTAssertEqual(PasteItineraryView.searchContext(for: day0, rows: [airport, osaka, day0]).city, "오사카")
        let explicit = PasteItineraryView.Row(dayIndex: 1, item: item(city: "도쿄"), include: true)
        XCTAssertNil(PasteItineraryView.searchContext(for: explicit, rows: [kyoto, explicit]).near)
    }

    func testPasteDraftRoundTripKeepsRowChoicesLocationsAndCreationIdentity() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = EditorDraftStore(directory: directory)
        let key = try XCTUnwrap(EditorDraftKey(accountID: "a", tripID: "new-trip", editor: "paste-itinerary"))
        let form = PasteItineraryFormState()
        form.text = "원문"; form.tripName = "직접 이름"; form.start = "2026-10-15"; form.fillGaps = false
        form.rows = [.init(dayIndex: 1, item: item(), include: false, found: hit("찾은 곳", city: "교토"), searched: true)]
        store.save(form.inputDraft, key: key)
        let restored = PasteItineraryFormState()
        restored.restore(try XCTUnwrap(store.load(PasteItineraryInputDraft.self, key: key)))
        XCTAssertEqual(restored.inputDraft, form.inputDraft)
        XCTAssertNil(store.load(PasteItineraryInputDraft.self, key: EditorDraftKey(accountID: "b", tripID: "new-trip", editor: "paste-itinerary")))
    }

    func testShortenedTripWarnsAboutCheckoutAndReturnDatesEvenWhenStartIsInside() {
        let booking = TripBooking(raw: ["id": .string("hotel"), "start": .string("2026-10-16"), "end": .string("2026-10-20")])
        XCTAssertEqual(PlanCalendarChange.misalignedBookings([booking], start: "2026-10-15", count: 3).map(\.id), ["hotel"])
        XCTAssertTrue(PlanCalendarChange.misalignedBookings([booking], start: "2026-10-15", count: 6).isEmpty)
        let returnOnly = TripBooking(raw: ["id": .string("return"), "end": .string("2026-10-20")])
        XCTAssertEqual(PlanCalendarChange.misalignedBookings([returnOnly], start: "2026-10-15", count: 3).map(\.id), ["return"])
    }

    func testForegroundReloadPreservesAnOpenEditorAndLoadsAfterClosing() async {
        let old = TripDocument(raw: ["name": .string("이전"), "days": .array([.object([:])])])
        let service = FakeDocumentService(snapshot: .init(document: old, revision: 1, role: .owner))
        let model = TripPlanViewModel(tripId: "trip1", service: service, loadsPlans: false)
        await model.load()
        await model.setPresentingEditor(true)
        var fresh = old; fresh.name = "최신"
        service.snapshot = .init(document: fresh, revision: 2, role: .viewer)
        await model.resumeAfterBackground()
        XCTAssertEqual(model.revision, 1); XCTAssertEqual(model.document?.name, "이전")
        XCTAssertTrue(model.needsRemoteReload)
        await model.setPresentingEditor(false)
        XCTAssertEqual(model.revision, 2); XCTAssertEqual(model.document?.name, "최신")
        XCTAssertFalse(model.canEdit); XCTAssertFalse(model.needsRemoteReload)
    }

    func testOldTripListReadCannotRestoreDeletedTrip() async {
        let source = ReviewTrips([summary()]), model = TripListViewModel(service: source)
        await model.load(); source.delayList = true
        let read = Task { await model.load() }
        await until { source.pendingList != nil }
        await model.remove(summary())
        source.pendingList?.resume(returning: .init(value: [summary()], cachedAt: nil)); source.pendingList = nil
        await read.value
        XCTAssertTrue(model.trips.isEmpty)
    }

    func testOldTripListReadCannotHideNewlyCreatedTrip() async {
        let source = ReviewTrips([]), model = TripListViewModel(service: source)
        await model.load(); source.delayList = true
        let read = Task { await model.load() }
        await until { source.pendingList != nil }
        _ = await model.create(.init(name: "새 여행", start: "2026-10-15"))
        source.pendingList?.resume(returning: .init(value: [], cachedAt: nil)); source.pendingList = nil
        await read.value
        XCTAssertEqual(model.trips.map(\.id), ["created"])
    }

    func testBookingSaveRefreshDoesNotWaitForDelayedSummaryAndCoalescesCloseRefresh() async {
        let source = ReviewTrips([]), model = BookingListViewModel(tripId: "t", service: source)
        source.delayBookings = true
        model.refreshAfterSave()
        await until { source.pendingBookings != nil }
        XCTAssertTrue(model.isLoading)
        await model.loadIfStale()
        XCTAssertEqual(source.bookingCalls, 1)
        source.pendingBookings?.resume(returning: .init(value: [], cachedAt: nil)); source.pendingBookings = nil
        await until { !model.isLoading }
        XCTAssertNil(model.errorMessage)
    }

    func testSiriAndExistingAppSynchronizeStopAndStartWithoutRevivingOldResponse() async throws {
        SharedStore.clear(); defer { SharedStore.clear() }
        let response = try travelFixture()
        let source = ReviewTravel(response), activity = ReviewActivity()
        let app = TravelModeController(service: source, location: LocationProvider(), push: ReviewPush(), liveActivity: activity)
        await app.start(trip: response.today.trip)
        XCTAssertTrue(app.isActive)
        source.delay = true
        let read = Task { await app.refresh(tripId: response.today.trip.id, reason: .foreground) }
        await until { source.pending != nil }
        let siri = TravelModeController(service: ReviewTravel(response), location: LocationProvider(), push: ReviewPush(), liveActivity: ReviewActivity())
        await siri.stop()
        source.pending?.resume(returning: .init(value: response, cachedAt: nil)); source.pending = nil
        await read.value
        XCTAssertFalse(app.isActive); XCTAssertNil(app.travelState)
        XCTAssertEqual(activity.synced, 1)
        await siri.start(trip: response.today.trip)
        await app.synchronizePersistedState()
        XCTAssertTrue(app.isActive)
    }

    func testTravelStartWaitsForLiveActivityBeforeReturningToSiri() async throws {
        SharedStore.clear(); defer { SharedStore.clear() }
        let response = try travelFixture(), activity = ReviewActivity()
        activity.delay = true
        let app = TravelModeController(service: ReviewTravel(response), location: LocationProvider(), push: ReviewPush(), liveActivity: activity)
        var finished = false
        let start = Task { await app.start(trip: response.today.trip); finished = true }
        await until { activity.pending != nil }
        XCTAssertFalse(finished)
        activity.pending?.resume(); activity.pending = nil
        await start.value
        XCTAssertTrue(finished); XCTAssertTrue(app.isActive)
    }

    func testLiveActivityRecoveryReusesMatchingSystemActivityAndEndsDuplicates() {
        let existing: [LiveActivityRecovery.Existing] = [
            .init(id: "old", tripId: "other", tripName: "다른 여행", dayLabel: "Day 1"),
            .init(id: "keep", tripId: "t", tripName: "여행", dayLabel: "Day 2"),
            .init(id: "duplicate", tripId: "t", tripName: "여행", dayLabel: "Day 2")]
        XCTAssertEqual(LiveActivityRecovery.decide(existing, tripId: "t", tripName: "여행", dayLabel: "Day 2"),
                       .init(reuseID: "keep", endIDs: ["old", "duplicate"]))
        XCTAssertNil(LiveActivityRecovery.decide(existing, tripId: "t", tripName: "여행", dayLabel: "Day 3").reuseID)
        func acceptsLiveIntent<T: LiveActivityIntent>(_: T) {}
        acceptsLiveIntent(StartTravelModeIntent()); acceptsLiveIntent(StopTravelModeIntent())
    }
}

@MainActor private final class ReviewTrips: TripDataSource {
    var stored: [TripSummary]
    var delayList = false
    var delayBookings = false
    var bookingCalls = 0
    var pendingList: CheckedContinuation<TripService.Fetched<[TripSummary]>, Error>?
    var pendingBookings: CheckedContinuation<TripService.Fetched<[BookingSummary]>, Error>?
    init(_ stored: [TripSummary]) { self.stored = stored }
    func trips() async throws -> TripService.Fetched<[TripSummary]> {
        if delayList { return try await withCheckedThrowingContinuation { pendingList = $0 } }
        return .init(value: stored, cachedAt: nil)
    }
    func deleteTrip(tripId: String, expectedRevision: Int) async throws { stored.removeAll { $0.id == tripId } }
    func leaveTrip(tripId: String) async throws { stored.removeAll { $0.id == tripId } }
    func createTrip(_ draft: NewTripDraft) async throws -> TripSummary {
        let made = TripSummary(id: "created", name: draft.name, start: draft.start, dayCount: draft.dayCount, revision: 1,
                               updatedAt: "", timeZone: "", cities: [], todayIndex: -1, daysUntilStart: nil, role: .owner, memberCount: 1)
        stored.insert(made, at: 0); return made
    }
    func bookings(tripId: String) async throws -> TripService.Fetched<[BookingSummary]> {
        bookingCalls += 1
        if delayBookings { return try await withCheckedThrowingContinuation { pendingBookings = $0 } }
        return .init(value: [], cachedAt: nil)
    }
    func createTrip(document: [String: JSONValue]) async throws -> TripSummary { throw APIError.offline }
    func parseItinerary(text: String) async throws -> ItineraryDraft { throw APIError.offline }
    func today(tripId: String, dayIndex: Int?, intent: String?, energy: EnergyLevel?) async throws -> TripService.Fetched<TodayResponse> { throw APIError.offline }
    func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse> { throw APIError.offline }
    func setActivity(tripId: String, activityId: String, action: TripService.ActivityAction, expectedRevision: Int, expectedName: String?) async throws -> MutationResponse { throw APIError.offline }
    func decideSuggestion(tripId: String, suggestionId: String, decision: TripService.SuggestionDecision, expectedRevision: Int) async throws -> MutationResponse { throw APIError.offline }
}
@MainActor private final class ReviewTravel: TravelStateSource {
    let response: TravelStateResponse
    var delay = false
    var pending: CheckedContinuation<TripService.Fetched<TravelStateResponse>, Error>?
    init(_ response: TravelStateResponse) { self.response = response }
    func travelState(tripId: String, location: GeoPoint?, locationUpdatedAt: String?, travelMode: Bool,
                     suppressUntil: String?, markSent: Bool) async throws -> TripService.Fetched<TravelStateResponse> {
        if delay { return try await withCheckedThrowingContinuation { pending = $0 } }
        return .init(value: response, cachedAt: nil)
    }
}
@MainActor private final class ReviewPush: PushScheduling { func present(_ item: NotificationPlanItem) {} }
@MainActor private final class ReviewActivity: LiveActivityControlling {
    var synced = 0
    var delay = false
    var pending: CheckedContinuation<Void, Never>?
    func sync(_ response: TravelStateResponse, changed: Bool) async {
        synced += 1
        if delay { await withCheckedContinuation { pending = $0 } }
    }
    func end() async {}
}
