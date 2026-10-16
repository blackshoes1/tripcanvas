import XCTest
@testable import TripCanvas

@MainActor
final class SpotChoiceTests: XCTestCase {
    func testEditingAlternativePreservesExplicitDecisionAndDeadline() {
        var spot = pending(); spot.selectChoice(alternative: false)
        var alternate = spot.choice!.alternative; alternate.desc = "메모만 변경"
        spot.choice = spot.choice!.replacingAlternative(alternate)
        XCTAssertEqual(spot.choice?.state, .selected)
        XCTAssertEqual(spot.choice?.decideBy, "13:30")
        XCTAssertEqual(spot.name, "미술관")
        XCTAssertEqual(spot.choice?.alternative.desc, "메모만 변경")
    }
    func testDecodesActualServerChoiceRangeFixture() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "choice-day-plan", withExtension: "json"))
        let response = try JSONDecoder().decode(DayPlanResponse.self, from: Data(contentsOf: url))
        let choice = try XCTUnwrap(response.day.spots.first?.choice)
        XCTAssertEqual(choice.state, "PENDING")
        XCTAssertEqual(choice.alternativeName, "강변 산책")
        XCTAssertEqual(choice.stayMinutes?.min, 30)
        XCTAssertEqual(choice.stayMinutes?.max, 60)
        XCTAssertEqual(choice.cost?.min, 0)
        XCTAssertEqual(choice.cost?.max, 1200)
        XCTAssertEqual(choice.totalsBasis, "CURRENT_OPTION")
        XCTAssertEqual(response.day.spots.count, 1)
    }

    private func pending() -> TripSpot {
        var current = TripSpot(name: "미술관", city: "교토")
        current.arriveAt = "14:00"
        current.stayMinutes = 60
        current.cost = 1000
        current.setField("futurePrimary", .string("preserve"))
        current.participants = ["traveler-a"]
        current.setField("split", .string("afternoon"))
        var alternate = TripSpot(name: "강변 산책", city: "교토")
        alternate.stayMinutes = 30
        alternate.cost = 0
        alternate.setField("futureAlternate", .string("preserve too"))
        current.choice = SpotChoice(alternative: alternate, state: .pending, decideBy: "13:30")
        return current
    }

    func testSelectingAlternativePreservesSlotAndBothRawPlaces() throws {
        var spot = pending()
        spot.setField("reunion", .bool(true))
        var choiceObject = try XCTUnwrap(spot.raw["choice"]?.objectValue)
        choiceObject["futureChoiceMetadata"] = .string("keep")
        spot.setField("choice", .object(choiceObject))
        let before = spot
        spot.selectChoice(alternative: true)

        XCTAssertEqual(spot.name, "강변 산책")
        XCTAssertEqual(spot.cost, 0)
        XCTAssertEqual(spot.arriveAt, "14:00")
        XCTAssertEqual(spot.participants, ["traveler-a"])
        XCTAssertEqual(spot.raw["split"], .string("afternoon"))
        XCTAssertEqual(spot.raw["reunion"], .bool(true))
        XCTAssertEqual(spot.raw["futureAlternate"], .string("preserve too"))
        XCTAssertEqual(spot.choice?.alternative.name, "미술관")
        XCTAssertEqual(spot.choice?.alternative.raw["futurePrimary"], .string("preserve"))
        XCTAssertNil(spot.choice?.alternative.raw["choice"])
        XCTAssertNil(spot.choice?.alternative.arriveAt)
        XCTAssertEqual(spot.choice?.state, .selected)
        XCTAssertEqual(spot.choice?.decideBy, "13:30")
        XCTAssertEqual(spot.raw["choice"]?["futureChoiceMetadata"], .string("keep"))
        XCTAssertEqual(before.name, "미술관", "미리 선택하는 초안은 저장된 장소를 바꾸지 않는다")
        spot.selectChoice(alternative: true)
        XCTAssertEqual(spot.name, "미술관")
        XCTAssertEqual(spot.arriveAt, "14:00")
    }

    func testSelectingCurrentAndReopeningNeverAddsASecondScheduleRow() {
        var spot = pending()
        spot.selectChoice(alternative: false)
        XCTAssertEqual(spot.choice?.state, .selected)
        XCTAssertEqual(spot.name, "미술관")
        var choice = spot.choice!
        choice.state = .pending
        spot.choice = choice
        var document = TripDocument(raw: ["days": .array([.object(["spots": .array([.object(spot.raw)])])])])
        document.updateSpot(dayIndex: 0, at: 0, with: spot)
        XCTAssertEqual(document.days[0].spots.count, 1)
        XCTAssertEqual(document.days[0].spots[0].choice?.alternative.name, "강변 산책")
        XCTAssertNotNil(document.days[0].spots[0].pendingChoiceLabel)
    }

    func testChoiceCannotDisplaceAnAnchorOrLinkedBooking() {
        for key in ["bookingId", "carPickupId", "carReturnId"] {
            var spot = pending()
            spot.setField(key, .string("booking-original"))
            XCTAssertNotNil(spot.choice?.validationError(current: spot))
            let before = spot
            spot.selectChoice(alternative: true)
            XCTAssertEqual(spot, before)
        }
        var spot = pending()
        spot.isStay = true
        XCTAssertNotNil(spot.choice?.validationError(current: spot))
        var paid = pending()
        paid.setField("payState", .string("PAID"))
        XCTAssertNotNil(paid.choice?.validationError(current: paid))
        let before = paid
        paid.selectChoice(alternative: true)
        XCTAssertEqual(paid, before, "이미 낸 비용을 다른 선택지 안으로 숨기지 않는다")
    }

    func testChosenPlaceCanCompleteButCannotSwapACompletedVisit() {
        var spot = pending()
        spot.selectChoice(alternative: false)
        spot.status = .completed
        XCTAssertNil(spot.choice?.validationError(current: spot))
        let before = spot
        spot.selectChoice(alternative: true)
        XCTAssertEqual(spot, before)
        var unresolved = pending()
        unresolved.status = .completed
        XCTAssertNotNil(unresolved.choice?.validationError(current: unresolved))
    }

    func testInvalidDeadlinesDuplicateAndNestedAlternativesAreRejected() {
        var spot = pending()
        for time in ["24:00", "12:60", "9:00", "오후 1시"] {
            var choice = spot.choice!
            choice.decideBy = time
            XCTAssertNotNil(choice.validationError(current: spot))
        }
        XCTAssertTrue(SpotChoice.validTime(nil))
        XCTAssertTrue(SpotChoice.validTime("00:00"))
        XCTAssertTrue(SpotChoice.validTime("23:59"))
        var same = spot
        same.choice = nil
        XCTAssertNotNil(SpotChoice(alternative: same, state: .pending).validationError(current: spot))
        var malformed = spot.choice!
        malformed.alternative.setField("choice", .object([:]))
        XCTAssertNotNil(malformed.validationError(current: spot))
        spot.choice = nil
        XCTAssertNil(spot.choice)
        XCTAssertEqual(spot.name, "미술관")
        var a = TripSpot(name: "같은 곳")
        a.placeId = "google-a"; a.kakaoId = "1234"
        var b = a; b.placeId = "google-b"
        XCTAssertTrue(SpotChoice.samePlace(a, b), "Google ID가 달라도 동일 카카오 ID는 같은 곳이다")
    }

    func testReservationAndDeadlineStayVisibleWithoutCancellingTheOriginal() {
        var spot = pending()
        var choice = spot.choice!
        choice.alternative.bookedAt = "15:00"
        choice.alternative.bookUrl = "https://example.com/ticket"
        spot.choice = choice
        spot.selectChoice(alternative: true)
        XCTAssertEqual(spot.bookedAt, "15:00")
        XCTAssertEqual(spot.bookUrl, "https://example.com/ticket")
        XCTAssertEqual(spot.choice?.decideBy, "13:30")
        XCTAssertEqual(spot.choice?.alternative.cost, 1000)
        var late = spot.choice!
        late.decideBy = "16:00"
        XCTAssertNotNil(late.validationError(current: spot))
    }

    func testOfflineSaveRollsBackAndRetrySavesTheSameSingleSlotWithCAS() async {
        let original = TripDocument(raw: ["days": .array([.object(["spots": .array([.object(pending().raw)])])])])
        let service = FakeDocumentService(snapshot: .init(document: original, revision: 7, role: .owner))
        let model = TripPlanViewModel(tripId: "choice-offline", service: service, loadsPlans: false)
        await model.load()
        var chosen = pending()
        chosen.selectChoice(alternative: true)
        service.failure = .offline
        let saved = await model.updateSpot(at: 0, with: chosen, expectedRevision: 7)
        XCTAssertFalse(saved)
        XCTAssertEqual(model.document, original)
        XCTAssertTrue(model.canRetrySave)
        service.failure = nil
        await model.retryFailedSave()
        XCTAssertEqual(model.revision, 8)
        XCTAssertEqual(model.day?.spots.count, 1)
        XCTAssertEqual(model.day?.spots[0].name, "강변 산책")
        XCTAssertEqual(service.saves.map(\.expectedRevision), [7, 7])
    }

    func testStaleChoiceEditorCannotReplaceNewerDocument() async {
        let original = TripDocument(raw: ["days": .array([.object(["spots": .array([.object(pending().raw)])])])])
        let service = FakeDocumentService(snapshot: .init(document: original, revision: 7, role: .owner))
        let model = TripPlanViewModel(tripId: "choice-stale", service: service, loadsPlans: false)
        await model.load()
        var newer = original
        newer.name = "다른 기기의 제목"
        model.acceptSaved(.init(document: newer, revision: 8, role: .owner))
        var chosen = pending()
        chosen.selectChoice(alternative: true)
        let saved = await model.updateSpot(at: 0, with: chosen, expectedRevision: 7)
        XCTAssertFalse(saved)
        XCTAssertTrue(service.saves.isEmpty)
        XCTAssertEqual(model.document, newer)
    }

    func testServerRangesDistinguishExplicitFreeAndUnknownCosts() {
        let known = DayPlanSpotChoice(state: "PENDING", alternativeName: "산책", decideBy: nil,
                                     stayMinutes: .init(min: 30, max: 60),
                                     cost: .init(min: 0, max: 1000, currency: "KRW"), totalsBasis: "CURRENT_OPTION")
        XCTAssertTrue(SpotChoiceSummaryView.rangeLine(known).contains("₩0"))
        let unknown = DayPlanSpotChoice(state: "PENDING", alternativeName: "산책", decideBy: nil,
                                       stayMinutes: nil, cost: nil, totalsBasis: "CURRENT_OPTION")
        XCTAssertFalse(SpotChoiceSummaryView.rangeLine(unknown).contains("₩0"))
        XCTAssertTrue(SpotChoiceSummaryView.rangeLine(unknown).contains("미정"))
    }
}
