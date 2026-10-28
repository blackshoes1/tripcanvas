import XCTest
@testable import TripCanvas

@MainActor final class TodayPlaceChangeTests: XCTestCase {
    func testReplacementKeepsOneSlotAndOriginalRawPlaceWithServerPreview() async throws {
        let source = try PlaceChangeSource(), model = make(source)
        await model.load()
        XCTAssertEqual(model.newPlaceDraft.stayMinutes, 60)
        XCTAssertEqual(model.slotTime, "14:00")
        await model.review(TripSpot(name: "강변 산책", city: "서울"))
        let document = try XCTUnwrap(model.reviewedDocument)
        let spot = document.days[0].spots[0]
        XCTAssertEqual(spot.name, "강변 산책")
        XCTAssertEqual(spot.stayMinutes, 60)
        XCTAssertEqual(spot.arriveAt, "14:00")
        for key in SpotChoice.slotKeys { XCTAssertEqual(spot.raw[key], source.snapshot.document.days[0].spots[0].raw[key], key) }
        XCTAssertNil(spot.raw["futurePrimary"])
        XCTAssertNil(spot.raw["candidateId"])
        XCTAssertEqual(spot.choice?.alternative.raw["futurePrimary"], .string("keep original"))
        XCTAssertEqual(spot.choice?.alternative.raw["candidateId"], .number(12))
        XCTAssertEqual(spot.choice?.alternative.bookedAt, "14:00")
        XCTAssertEqual(spot.choice?.alternative.cost, 1000)
        XCTAssertEqual(document.days[0].spots.count, 2)
        XCTAssertEqual(document.days[1], source.snapshot.document.days[1])
        XCTAssertEqual(document.raw["bookings"], source.snapshot.document.raw["bookings"])
        XCTAssertTrue(model.preview?.after.day.spots[1].conflict == true)
        XCTAssertEqual(model.preview?.after.day.spots[1].bookingLateMinutes, 30)
        XCTAssertTrue(source.saves.isEmpty)
        XCTAssertTrue(model.canSave)
        _ = await model.save()
        XCTAssertEqual(source.saves.map(\.revision), [7])
        XCTAssertEqual(source.saves.first?.document, document)
        XCTAssertTrue(model.isSaved)
        XCTAssertEqual(model.viewingRevision, 8)
    }

    func testUnfixedSlotUsesServerStartWithoutWrappingAcrossDays() async throws {
        let source = try PlaceChangeSource()
        source.changeOriginal { $0.arriveAt = nil }
        let model = make(source)
        await model.load(); await model.review(TripSpot(name: "새 장소"))
        XCTAssertEqual(model.replacement?.arriveAt, "14:00")
        let overnight = make(try PlaceChangeSource(), activity: Self.activity(start: 1500))
        await overnight.load()
        XCTAssertNotNil(overnight.blockedReason)
        XCTAssertFalse(overnight.canChooseNewPlace)
    }

    func testSamePlaceOrChangedSlotTimeCannotSilentlySave() async throws {
        let source = try PlaceChangeSource(), model = make(source)
        await model.load()
        var same = source.snapshot.document.days[0].spots[0]
        same.choice = nil
        await model.review(same)
        XCTAssertFalse(model.canSave)
        var different = TripSpot(name: "새 장소")
        different.arriveAt = "15:00"
        await model.review(different)
        XCTAssertFalse(model.canSave)
        XCTAssertNotNil(model.error)
        XCTAssertTrue(source.previews.isEmpty)
    }

    func testProtectedPlacesRemainAvailableForPlanHandoffWithoutWrites() async throws {
        for key in ["bookingId", "carPickupId", "carReturnId", "stay", "payState", "status"] {
            let source = try PlaceChangeSource()
            source.changeOriginal { spot in
                spot.setField(key, key == "stay" ? .bool(true) : .string(key == "payState" ? "PAID" : key == "status" ? "COMPLETED" : "linked"))
            }
            let model = make(source)
            await model.load(); await model.review(TripSpot(name: "새 장소"))
            XCTAssertNotNil(model.spot, key)
            XCTAssertNotNil(model.blockedReason, key)
            XCTAssertFalse(model.canSave, key)
            XCTAssertTrue(source.saves.isEmpty, key)
        }
        for type in [CommitmentType.flight, .train, .car, .hotel] {
            let model = make(try PlaceChangeSource(), activity: Self.activity(type: type))
            await model.load()
            XCTAssertNotNil(model.blockedReason)
        }
    }

    func testPendingChoiceHandsOffAndSelectedChoiceRestoresWithoutThirdPlaceLoss() async throws {
        let pending = try PlaceChangeSource()
        pending.changeOriginal { $0.choice = .init(alternative: TripSpot(name: "보관한 곳"), state: .pending) }
        let pendingModel = make(pending)
        await pendingModel.load()
        XCTAssertTrue(pendingModel.requiresQuickChoice)
        XCTAssertFalse(pendingModel.canChooseNewPlace)
        await pendingModel.review(TripSpot(name: "세 번째"))
        XCTAssertFalse(pendingModel.canSave)

        let selected = try PlaceChangeSource()
        selected.changeOriginal { $0.choice = .init(alternative: TripSpot(name: "보관한 곳"), state: .selected) }
        let model = make(selected)
        await model.load()
        XCTAssertTrue(model.canRestore)
        XCTAssertTrue(model.canChooseNewPlace)
        await model.review(TripSpot(name: "보관한 곳"))
        XCTAssertFalse(model.canSave)
        await model.restore()
        XCTAssertEqual(model.replacement?.name, "보관한 곳")
        XCTAssertEqual(model.replacement?.choice?.alternative.name, "미술관")
        XCTAssertTrue(selected.saves.isEmpty)
        XCTAssertTrue(model.canSave)
    }

    func testThirdPlaceKeepsStoredOriginalAndUndoRestoresPreviousSelection() async throws {
        let source = try PlaceChangeSource()
        source.changeOriginal { $0.choice = .init(alternative: TripSpot(name: "원래 보관한 곳"), state: .selected) }
        let original = source.snapshot.document, model = make(source)
        await model.load(); await model.review(TripSpot(name: "세 번째 장소"))
        XCTAssertEqual(model.replacement?.name, "세 번째 장소")
        XCTAssertEqual(model.replacement?.choice?.alternative.name, "원래 보관한 곳")
        XCTAssertEqual(model.replacement?.arriveAt, "14:00")
        _ = await model.save(); _ = await model.undo()
        XCTAssertEqual(source.snapshot.document, original)
        XCTAssertEqual(source.snapshot.document.days[0].spots[0].name, "미술관")
        XCTAssertEqual(source.saves.map(\.revision), [7, 8])
    }

    func testCanonicalPreviewDocumentIsExactlyWhatGetsSaved() async throws {
        let source = try PlaceChangeSource(), model = make(source)
        source.canonicalPreview = true
        await model.load(); await model.review(TripSpot(name: "새 장소"))
        XCTAssertEqual(model.reviewedDocument?.raw["schemaVersion"], .number(4))
        _ = await model.save()
        XCTAssertTrue(model.isSaved)
        XCTAssertEqual(source.saves.first?.document, model.reviewedDocument)
    }

    func testLegacyPreviewNormalizationCannotClaimSuccessOrRetryBlindly() async throws {
        let source = try PlaceChangeSource(), model = make(source)
        await model.load(); await model.review(TripSpot(name: "새 장소"))
        XCTAssertTrue(model.canSave)
        // 구서버 미리보기에는 canonical 원문이 없다. PUT 정규화가 기본 필드를 추가할 수 있다.
        var normalized = try XCTUnwrap(model.reviewedDocument)
        var spot = normalized.days[0].spots[0]
        spot.desc = ""; spot.point = nil
        normalized.updateSpot(dayIndex: 0, at: 0, with: spot)
        source.saveResponseDocument = normalized
        _ = await model.save(); _ = await model.save()
        XCTAssertEqual(source.saves.count, 1)
        XCTAssertTrue(model.requiresRefresh)
        XCTAssertFalse(model.isSaved)
        XCTAssertFalse(model.canUndo)
    }

    func testStaleOfflineAndNoLongerCurrentTargetsCannotReview() async throws {
        for failure in ["revision", "day", "id", "offline", "name", "viewer", "notLive"] {
            let source = try PlaceChangeSource()
            source.todayFailure = failure
            let model = make(source)
            await model.load(); await model.review(TripSpot(name: "새 장소"))
            XCTAssertTrue(model.requiresRefresh, failure)
            XCTAssertFalse(model.canSave, failure)
            XCTAssertTrue(source.saves.isEmpty, failure)
        }
    }

    func testNewerReviewWinsAndMetadataMismatchNeverEnablesSave() async throws {
        let source = try PlaceChangeSource(), model = make(source)
        await model.load()
        var delayed: CheckedContinuation<PlanChangePreview, Error>?
        source.previewHandler = { _ in try await withCheckedThrowingContinuation { delayed = $0 } }
        let first = Task { await model.review(TripSpot(name: "먼저 고른 곳")) }
        while delayed == nil { await Task.yield() }
        source.previewHandler = nil
        await model.review(TripSpot(name: "나중에 고른 곳"))
        delayed?.resume(returning: try source.makePreview(source.snapshot.document))
        await first.value
        XCTAssertEqual(model.replacement?.name, "나중에 고른 곳")
        XCTAssertTrue(model.canSave)
        source.previewWrongDay = true
        await model.review(TripSpot(name: "또 다른 곳"))
        XCTAssertFalse(model.canSave)
        XCTAssertTrue(model.requiresRefresh)
    }

    func testAccountChangeDuringReadDiscardsOldContent() async throws {
        let source = try PlaceChangeSource()
        var current = true
        let model = make(source, isCurrent: { current })
        source.beforeDocumentReturn = { current = false }
        await model.load()
        XCTAssertNil(model.spot)
        XCTAssertTrue(model.requiresRefresh)
        XCTAssertFalse(model.canSave)
    }

    func testCurrentTargetIsRecheckedBeforeCommitAndUnknownWriteNeverRepeats() async throws {
        let staleSource = try PlaceChangeSource(), stale = make(staleSource)
        await stale.load(); await stale.review(TripSpot(name: "새 장소"))
        staleSource.todayFailure = "id"
        _ = await stale.save()
        XCTAssertTrue(staleSource.saves.isEmpty)
        XCTAssertTrue(stale.requiresRefresh)

        let source = try PlaceChangeSource(), model = make(source)
        await model.load(); await model.review(TripSpot(name: "새 장소"))
        source.loseResponse = true
        _ = await model.save(); _ = await model.save()
        XCTAssertEqual(source.saves.count, 1)
        XCTAssertEqual(source.snapshot.document.days[0].spots[0].name, "새 장소")
        XCTAssertTrue(model.requiresRefresh)
        XCTAssertFalse(model.canSave)
    }

    func testLateAccountChangeAndDifferentSavedDocumentNeverClaimSuccess() async throws {
        let source = try PlaceChangeSource(), model = make(source)
        await model.load(); await model.review(TripSpot(name: "새 장소"))
        var wrong = try XCTUnwrap(model.reviewedDocument)
        wrong.name = "검토하지 않은 변경"
        source.saveResponseDocument = wrong
        _ = await model.save()
        XCTAssertFalse(model.isSaved)
        XCTAssertFalse(model.canUndo)
        XCTAssertTrue(model.requiresRefresh)

        let switchedSource = try PlaceChangeSource()
        var current = true
        let switched = make(switchedSource, isCurrent: { current })
        await switched.load(); await switched.review(TripSpot(name: "새 장소"))
        switchedSource.afterSave = { current = false }
        _ = await switched.save()
        XCTAssertFalse(switched.isSaved)
        XCTAssertTrue(switched.requiresRefresh)
    }

    func testAccountChangeDuringPreviewAndMissingTargetFailClosed() async throws {
        let source = try PlaceChangeSource()
        var current = true
        let model = make(source, isCurrent: { current })
        await model.load()
        var delayed: CheckedContinuation<PlanChangePreview, Error>?
        source.previewHandler = { _ in try await withCheckedThrowingContinuation { delayed = $0 } }
        let first = Task { await model.review(TripSpot(name: "새 장소")) }
        while delayed == nil { await Task.yield() }
        current = false
        await model.review(TripSpot(name: "다음 계정의 입력"))
        delayed?.resume(returning: try source.makePreview(source.snapshot.document))
        await first.value
        XCTAssertTrue(model.requiresRefresh)
        XCTAssertFalse(model.isWorking)
        XCTAssertNil(model.preview)

        let missingSource = try PlaceChangeSource()
        var document = missingSource.snapshot.document
        document.removeSpot(dayIndex: 0, at: 0)
        missingSource.snapshot = .init(document: document, revision: 7, role: .owner)
        let missing = make(missingSource)
        await missing.load()
        XCTAssertNil(missing.spot)
        XCTAssertTrue(missing.requiresRefresh)
    }

    func testUndoRestoresExactDocumentAndCannotOverwriteAnotherRevision() async throws {
        let source = try PlaceChangeSource(), model = make(source)
        let original = source.snapshot.document
        await model.load(); await model.review(TripSpot(name: "새 장소")); _ = await model.save()
        _ = await model.undo()
        XCTAssertEqual(source.snapshot.document, original)
        XCTAssertEqual(source.saves.map(\.revision), [7, 8])

        let changedSource = try PlaceChangeSource(), changed = make(changedSource)
        await changed.load(); await changed.review(TripSpot(name: "새 장소")); _ = await changed.save()
        changedSource.snapshot = .init(document: changedSource.snapshot.document, revision: 12, role: .owner)
        _ = await changed.undo(); _ = await changed.undo()
        XCTAssertEqual(changedSource.snapshot.revision, 12)
        XCTAssertEqual(changedSource.saves.map(\.revision), [7, 8])
        XCTAssertTrue(changed.requiresRefresh)
    }

    private func make(_ source: PlaceChangeSource, activity: ActivitySummary? = nil,
                      isCurrent: @escaping () -> Bool = { true }) -> TodayPlaceChangeModel {
        TodayPlaceChangeModel(tripID: "trip", day: 0, activity: activity ?? Self.activity(), revision: 7,
                              source: source, isCurrent: isCurrent)
    }
    fileprivate static func activity(start: Int = 840, type: CommitmentType = .other) -> ActivitySummary {
        .init(id: "d0s0", name: "미술관", city: "서울", desc: "", status: .inProgress,
              flexibility: .flexible, type: type, etaMinutes: 830, startMinutes: start, endMinutes: start + 60,
              stayMinutes: 60, travelInMinutes: 0, fixedAtMinutes: nil, location: nil, mustVisit: true,
              optional: false, bookingId: nil, bookUrl: nil, placeId: nil)
    }
}

@MainActor private final class PlaceChangeSource: TripDocumentSource, TripDataSource {
    var snapshot: TripDocumentSnapshot
    var saves: [(document: TripDocument, revision: Int)] = []
    var previews: [TripDocument] = []
    var todayFailure: String?
    var previewWrongDay = false
    var canonicalPreview = false
    var loseResponse = false
    var saveResponseDocument: TripDocument?
    var afterSave: (() -> Void)?
    var beforeDocumentReturn: (() -> Void)?
    var previewHandler: ((TripDocument) async throws -> PlanChangePreview)?
    init() throws {
        var spot = TripSpot(name: "미술관", city: "서울")
        spot.arriveAt = "14:00"; spot.stayMinutes = 60; spot.cost = 1000; spot.bookedAt = "14:00"
        spot.participants = ["person-a"]; spot.priority = .must
        spot.setField("split", .string("afternoon")); spot.setField("reunion", .bool(true))
        spot.setField("futurePrimary", .string("keep original")); spot.setField("candidateId", .number(12))
        let completed = TripSpot(raw: ["name": .string("이미 다녀온 곳"), "status": .string("COMPLETED")])
        snapshot = .init(document: TripDocument(raw: ["id": .string("trip"), "futureTrip": .string("keep"),
            "bookings": .array([.object(["id": .string("original-booking")])]), "days": .array([
                .object(["spots": .array([.object(spot.raw), .object(completed.raw)])]),
                .object(["spots": .array([.object(TripSpot(name: "다음 날").raw)])])])]), revision: 7, role: .owner)
    }
    func changeOriginal(_ change: (inout TripSpot) -> Void) {
        var document = snapshot.document, spot = document.days[0].spots[0]
        change(&spot); document.updateSpot(dayIndex: 0, at: 0, with: spot)
        snapshot = .init(document: document, revision: snapshot.revision, role: snapshot.role)
    }
    func document(tripId: String) async throws -> TripDocumentSnapshot { beforeDocumentReturn?(); return snapshot }
    func saveDocument(tripId: String, document: TripDocument, expectedRevision: Int) async throws -> TripDocumentSnapshot {
        saves.append((document, expectedRevision))
        guard expectedRevision == snapshot.revision else { throw APIError.revisionConflict(message: "충돌", revision: snapshot.revision) }
        snapshot = .init(document: document, revision: expectedRevision + 1, role: .owner)
        if loseResponse { throw APIError.offline }
        afterSave?()
        if let saveResponseDocument { return .init(document: saveResponseDocument, revision: snapshot.revision, role: .owner) }
        return snapshot
    }
    func today(tripId: String, dayIndex: Int?, intent: String?, energy: EnergyLevel?) async throws -> TripService.Fetched<TodayResponse> {
        var raw = try fixture("today")
        var trip = raw["trip"] as! [String: Any]
        trip["id"] = "trip"; trip["revision"] = todayFailure == "revision" ? 8 : snapshot.revision
        trip["role"] = todayFailure == "viewer" ? "VIEWER" : "OWNER"
        trip["todayIndex"] = todayFailure == "notLive" ? -1 : 0
        raw["trip"] = trip
        var day = raw["day"] as! [String: Any]; day["index"] = todayFailure == "day" ? 1 : 0; raw["day"] = day
        var current = raw["currentState"] as! [String: Any]; current["live"] = todayFailure != "notLive"; raw["currentState"] = current
        var next = raw["nextAction"] as! [String: Any]; next["activityId"] = todayFailure == "id" ? "d0s1" : "d0s0"; raw["nextAction"] = next
        var activity = try JSONSerialization.jsonObject(with: JSONEncoder().encode(TodayPlaceChangeTests.activity())) as! [String: Any]
        if todayFailure == "name" { activity["name"] = "다른 곳" }
        raw["activities"] = [activity]
        return .init(value: try decode(TodayResponse.self, raw), cachedAt: todayFailure == "offline" ? Date() : nil)
    }
    func planPreview(tripId: String, document: TripDocument, dayIndex: Int, revision: Int) async throws -> PlanChangePreview {
        previews.append(document)
        if let previewHandler { return try await previewHandler(document) }
        return try makePreview(document)
    }
    func makePreview(_ document: TripDocument) throws -> PlanChangePreview {
        var raw = try fixture("day-plan")
        var trip = raw["trip"] as! [String: Any]; trip["id"] = "trip"; trip["revision"] = 7; raw["trip"] = trip
        var day = raw["day"] as! [String: Any]; day["index"] = previewWrongDay ? 1 : 0
        var spots = day["spots"] as! [[String: Any]]
        spots[0]["name"] = document.days[0].spots[0].name
        spots[1]["conflict"] = true; spots[1]["bookingLateMinutes"] = 30
        day["spots"] = spots; raw["day"] = day
        let plan = try decode(DayPlanResponse.self, raw)
        var canonical = document.raw
        canonical["schemaVersion"] = .number(4)
        return .init(before: plan, after: plan, document: canonicalPreview ? canonical : nil)
    }
    private func fixture(_ name: String) throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle(for: TodayPlaceChangeTests.self).url(forResource: name, withExtension: "json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }
    private func decode<T: Decodable>(_ type: T.Type, _ raw: [String: Any]) throws -> T {
        try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: raw))
    }
    func trips() async throws -> TripService.Fetched<[TripSummary]> { throw APIError.offline }
    func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse> { throw APIError.offline }
    func cachedDayPlan(tripId: String, dayIndex: Int) async -> DayPlanResponse? { nil }
    func tripRoutes(tripId: String) async throws -> TripRoutesResponse { throw APIError.offline }
    func bookings(tripId: String) async throws -> TripService.Fetched<[BookingSummary]> { throw APIError.offline }
    func setActivity(tripId: String, activityId: String, action: TripService.ActivityAction, expectedRevision: Int, expectedName: String?) async throws -> MutationResponse { throw APIError.offline }
    func decideSuggestion(tripId: String, suggestionId: String, decision: TripService.SuggestionDecision, expectedRevision: Int) async throws -> MutationResponse { throw APIError.offline }
    func createTrip(_ draft: NewTripDraft) async throws -> TripSummary { throw APIError.offline }
    func createTrip(document: [String: JSONValue]) async throws -> TripSummary { throw APIError.offline }
    func parseItinerary(text: String) async throws -> ItineraryDraft { throw APIError.offline }
    func deleteTrip(tripId: String, expectedRevision: Int) async throws {}
    func leaveTrip(tripId: String) async throws {}
}
