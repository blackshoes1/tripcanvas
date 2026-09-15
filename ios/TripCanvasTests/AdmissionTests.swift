import XCTest
@testable import TripCanvas

final class AdmissionTests: XCTestCase {
    func testAppointmentTimeAndHotelBookingNeverImplyAdmissionBooking() {
        var spot = TripSpot(raw: ["name": .string("합성 명소"), "bookAt": .string("12:07"), "bookingId": .string("hotel-1")])
        XCTAssertEqual(spot.admission.requirement, .unknown)
        XCTAssertFalse(spot.admission.isBooked)
        XCTAssertFalse(spot.needsReservation)
        spot.admission.requirement = .required
        XCTAssertTrue(spot.needsReservation)
        spot.admission.isBooked = true
        XCTAssertFalse(spot.needsReservation)
        XCTAssertEqual(spot.bookedAt, "12:07")
        XCTAssertEqual(spot.raw["bookingId"], .string("hotel-1"))
    }
    func testManualConfirmationPreservesOtherSpotFieldsAndRequiresExplicitTime() {
        var spot = TripSpot(raw: ["name": .string("합성 명소"), "hours": .array([.number(1)]), "cost": .number(12.55), "cur": .string("USD")])
        spot.admission.officialURL = "https://example.test/tickets"
        spot.admission.requirement = .recommended
        XCTAssertNil(spot.admission.checkedAt)
        XCTAssertFalse(spot.admission.isBooked, "공식 링크를 적어도 완료로 바꾸지 않음")
        spot.admission.confirm(now: Date(timeIntervalSince1970: 0))
        XCTAssertEqual(spot.admission.checkedAt, "1970-01-01T00:00:00Z")
        XCTAssertEqual(spot.admission.raw["source"], .string("USER"))
        XCTAssertEqual(spot.raw["hours"], .array([.number(1)]))
        XCTAssertEqual(spot.cost, 12.55)
    }
    func testUnsafeOrCredentialedLinksAreNotOpened() {
        XCTAssertNil(SpotAdmission.safeURL("javascript:alert(1)"))
        XCTAssertNil(SpotAdmission.safeURL("https://user:secret@example.test"))
        XCTAssertNil(SpotAdmission.safeURL("http://example.test"))
        XCTAssertNotNil(SpotAdmission.safeURL("https://example.test/tickets"))
    }
}
