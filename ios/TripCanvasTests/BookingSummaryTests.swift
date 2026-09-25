import XCTest
@testable import TripCanvas

final class BookingSummaryTests: XCTestCase {
    func testItineraryReservationDecodesWithoutPriceOrTracking() throws {
        let json = #"""
        {"id":"reservation:SPOT:0:1","type":"restaurant","title":"저녁 예약",
         "provider":"","url":"https://example.com","price":0,"currency":"EUR",
         "start":"2026-10-25","end":null,"refundable":null,"freeCancelUntil":null,
         "confirmation":"R123","place":"세비야","startTime":"19:00","endTime":null,
         "priceStatus":null,"source":"SPOT","dayIndex":0,"note":"창가 좌석","priceKnown":false}
        """#
        let booking = try JSONDecoder().decode(BookingSummary.self, from: Data(json.utf8))
        XCTAssertEqual(booking.type, .restaurant)
        XCTAssertEqual(booking.source, "SPOT")
        XCTAssertEqual(booking.dayIndex, 0)
        XCTAssertEqual(booking.note, "창가 좌석")
        XCTAssertEqual(booking.priceKnown, false)
        XCTAssertEqual(booking.confirmation, "R123")
        XCTAssertNil(booking.priceStatus)
    }

    func testOlderBookingResponseStillDecodes() throws {
        let json = #"""
        {"id":"hotel","type":"hotel","title":"호텔","provider":"","price":100,"currency":"EUR"}
        """#
        let booking = try JSONDecoder().decode(BookingSummary.self, from: Data(json.utf8))
        XCTAssertEqual(booking.type, .hotel)
        XCTAssertNil(booking.source)
        XCTAssertNil(booking.priceKnown)
        XCTAssertEqual(booking.price, 100)
    }
}
