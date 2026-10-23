import XCTest
@testable import TripCanvas

final class StaffShowTests: XCTestCase {
    func testTypingOriginalOneCharacterAtATimePreservesSpacesAndNewlines() {
        var details = StaffShowDetails()
        for character in "John Doe" { details.bookingName += String(character) }
        for character in "10 Rue Exemple\nParis" { details.address += String(character) }
        XCTAssertEqual(details.bookingName, "John Doe")
        XCTAssertEqual(details.address, "10 Rue Exemple\nParis")
        details.localName = "Hôtel "
        XCTAssertEqual(details.localName, "Hôtel ")
        details.localName += "de Paris"
        XCTAssertEqual(details.localName, "Hôtel de Paris")
    }
    func testLocalNameIsOnlyTheExplicitOriginalAndNeverAnAutomaticTranslation() {
        let spot = TripSpot(name: "센소지", city: "도쿄")
        let card = StaffShowCard(spot: spot)
        XCTAssertEqual(card.title, "센소지")
        XCTAssertFalse(card.hasLocalName)
        XCTAssertNil(card.address)
        XCTAssertTrue(card.facts.isEmpty, "여행 인원이나 기본 예약 인원을 지어내지 않는다")
    }

    func testVerifiedOriginalAndExplicitReservationFactsSurviveDocumentRoundTrip() throws {
        var spot = TripSpot(raw: ["name": .string("저녁 식당"), "bookAt": .string("19:00"),
            "who": .array([.string("u1")]), "future": .object(["source": .string("keep")]),
            "admission": .object(["source": .string("USER"), "personalStatus": .string("BOOKED"), "people": .number(3)])])
        spot.staffDetails.localName = "  Restaurant d’essai  "
        spot.staffDetails.address = "1 Rue Exemple\nParis"
        spot.staffDetails.bookingName = "J KIM"
        let encoded = try JSONValue.data(from: spot.raw)
        let restored = TripSpot(raw: try XCTUnwrap(JSONDecoder().decode(JSONValue.self, from: encoded).objectValue))
        let card = StaffShowCard(spot: restored)
        XCTAssertEqual(card.title, "Restaurant d’essai")
        XCTAssertEqual(card.address, "1 Rue Exemple\nParis")
        XCTAssertTrue(card.hasLocalName)
        XCTAssertTrue(card.isReservation)
        XCTAssertEqual(card.facts.map(\.value), ["19:00", "3", "J KIM"])
        XCTAssertEqual(restored.raw["who"], spot.raw["who"])
        XCTAssertEqual(restored.raw["future"], spot.raw["future"])
    }

    func testBookingMetadataPreservesProviderAndUnknownNestedFields() {
        var booking = TripBooking(raw: ["id": .string("b1"), "title": .string("호텔"), "type": .string("hotel"),
            "ptoken": .string("provider-mapping"), "confirmation": .string("PRIVATE-123"),
            "staffShow": .object(["future": .string("preserved")])])
        booking.staffDetails.localName = "Hotel Original"
        booking.staffDetails.bookingName = "J KIM"
        XCTAssertEqual(booking.raw["ptoken"], .string("provider-mapping"))
        XCTAssertEqual(booking.staffDetails.raw["future"], .string("preserved"))
        let card = StaffShowCard(booking: booking)
        XCTAssertEqual(card.title, "Hotel Original")
        XCTAssertEqual(card.confirmation, "PRIVATE-123")
        XCTAssertFalse(card.facts.contains { $0.value.contains("PRIVATE") }, "예약번호는 공개용 일반 항목과 분리한다")
        XCTAssertFalse(card.facts.contains { $0.label.hasPrefix("Adults") }, "가격 비교의 기본 2명을 사실로 표시하지 않는다")
    }

    func testCoordinateValidationAndUserFactsDoNotPromoteCorruptOrGuessedValues() {
        let spot = TripSpot(raw: ["name": .string("저장된 장소"), "lat": .number(91), "lng": .number(2),
            "bookAt": .string("29:90"), "admission": .object(["personalStatus": .string("BOOKED"), "people": .number(2)])])
        let card = StaffShowCard(spot: spot)
        XCTAssertNil(card.point)
        XCTAssertTrue(card.facts.isEmpty)
        let huge = TripSpot(raw: ["name": .string("인원 미정"),
            "admission": .object(["source": .string("USER"), "personalStatus": .string("BOOKED"), "people": .number(1e100)])])
        XCTAssertTrue(StaffShowCard(spot: huge).facts.isEmpty)
    }

    func testSummaryCityDoesNotReplaceDestinationAndSpotConfirmationIsSeparated() {
        let summary = BookingSummary(id: "reservation:SPOT:0:1", type: .restaurant, title: "예약한 식당", provider: "",
            url: nil, price: 0, currency: "EUR", start: nil, end: nil, refundable: nil, freeCancelUntil: nil,
            confirmation: nil, place: "파리", startTime: nil, endTime: nil, priceStatus: nil)
        XCTAssertEqual(StaffShowCard(summary: summary).title, "예약한 식당")
        let spot = TripSpot(raw: ["name": .string("예약한 식당"), "confirmationNumber": .string("SPOT-PRIVATE")])
        XCTAssertEqual(StaffShowCard(spot: spot).confirmation, "SPOT-PRIVATE")
        XCTAssertTrue(StaffShowCard(spot: spot).facts.isEmpty)
    }

    func testLinkedBookingSuppliesOnlyActuallySavedDatesAndParty() {
        var booking = TripBooking(raw: ["id": .string("b1"), "title": .string("숙박"), "type": .string("hotel"),
            "start": .string("2026-10-15"), "end": .string("2026-10-17"), "adults": .number(2)])
        booking.staffDetails.address = "Saved address"
        let spot = TripSpot(raw: ["name": .string("일정 호텔"), "lat": .number(48.1), "lng": .number(2.1)])
        let card = StaffShowCard(booking: booking, linkedSpot: spot)
        XCTAssertEqual(card.address, "Saved address")
        XCTAssertEqual(card.point, GeoPoint(lat: 48.1, lng: 2.1))
        XCTAssertEqual(card.facts.map(\.value), ["2026-10-15", "2026-10-17", "2"])
    }

    func testInputBoundsUseUTF16WithoutSplittingEmojiAndEmptyDoesNotAddMetadata() {
        var details = StaffShowDetails()
        details.localName = String(repeating: "✈️", count: 200)
        XCTAssertLessThanOrEqual(details.localName.utf16.count, 240)
        XCTAssertTrue(details.localName.hasSuffix("✈️"))
        details.localName = " \n "
        XCTAssertTrue(details.raw.isEmpty)
        var spot = TripSpot(name: "그대로")
        spot.staffDetails = details
        XCTAssertNil(spot.raw["staffShow"])
    }

    func testTodaySelectionRequiresExactRevisionPositionAndNameIncludingCachedDocuments() throws {
        let document = TripDocument(raw: ["days": .array([.object(["spots": .array([
            .object(["name": .string("최초 장소")]), .object(["name": .string("다음 장소"),
                "staffShow": .object(["localName": .string("Saved original")])])
        ])])])])
        let selected = try StaffShowSelection.card(document: document, documentRevision: 7,
            activityID: "d0s1", expectedName: "다음 장소", expectedRevision: 7)
        XCTAssertEqual(selected.title, "Saved original")
        XCTAssertThrowsError(try StaffShowSelection.card(document: document, documentRevision: 8,
            activityID: "d0s1", expectedName: "다음 장소", expectedRevision: 7)) { error in
            XCTAssertEqual(error as? StaffShowSelection.Failure, .changed)
        }
        XCTAssertThrowsError(try StaffShowSelection.card(document: document, documentRevision: 7,
            activityID: "d0s1", expectedName: "원격에서 사라진 이름", expectedRevision: 7))
        for invalid in ["d0s-1", "d-1s0", "d0s99999999999999999999999999999999999", "d0s1anything", "d0s2", "d1s0", "d٠s١"] {
            XCTAssertThrowsError(try StaffShowSelection.card(document: document, documentRevision: 7,
                activityID: invalid, expectedName: "다음 장소", expectedRevision: 7), invalid)
        }
    }

    func testDeletedCostReservationDoesNotReappearFromAnOldSummary() {
        var summary = BookingSummary(id: "reservation:TRIP_COST:trip:c1", type: .other, title: "예약한 체험", provider: "",
            url: nil, price: 10, currency: "EUR", start: nil, end: nil, refundable: nil, freeCancelUntil: nil,
            confirmation: nil, place: nil, startTime: nil, endTime: nil, priceStatus: nil)
        summary.source = "TRIP_COST"
        let document = TripDocument(raw: ["costItems": .array([.object(["id": .string("c1"), "title": .string("예약한 체험")])])])
        XCTAssertTrue(StaffShowSelection.summaryExists(document: document, summary: summary))
        XCTAssertFalse(StaffShowSelection.summaryExists(document: TripDocument(raw: [:]), summary: summary))
        let changed = TripDocument(raw: ["costItems": .array([.object(["id": .string("c1"), "title": .string("다른 체험")])])])
        XCTAssertFalse(StaffShowSelection.summaryExists(document: changed, summary: summary))
    }
}
