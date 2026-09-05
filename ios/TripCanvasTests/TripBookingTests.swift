import XCTest
@testable import TripCanvas

/// 예약 편집. 장소와 같은 두 규칙(모르는 필드 보존 · 기본값 미기록)에 더해 셋을 지킨다 —
/// **검증은 웹 `bkSave`와 같다**, **연결은 한 예약당 한 곳이다**, **비면 키를 지운다**.
final class TripBookingTests: XCTestCase {
    /// 웹이 실제로 쓰는 모양. 시세 조회가 남긴 `ptoken`·`enName`·`saved`를 일부러 섞었다.
    private let json = """
    {
      "name": "마요르카",
      "start": "2026-10-01",
      "days": [
        { "title": "도착", "mode": "car", "spots": [
          { "name": "팔마공항", "city": "팔마", "lat": 39.55, "lng": 2.73, "cat": "transport" },
          { "name": "Cap Rocat", "city": "팔마", "lat": 39.5, "lng": 2.7, "stay": true, "nights": 2, "cost": 900, "cur": "EUR",
            "bookingId": "bkOld1" }
        ] },
        { "title": "소예르", "mode": "car", "spots": [
          { "name": "소예르 항구", "city": "소예르", "lat": 39.79, "lng": 2.69, "carReturnId": "bkCar1" }
        ] }
      ],
      "bookings": [
        { "id": "bkOld1", "type": "hotel", "title": "Cap Rocat", "provider": "Booking.com", "price": 900, "cur": "EUR",
          "start": "2026-10-01", "end": "2026-10-03", "adults": 2, "rooms": 1, "refundable": true, "track": true,
          "ptoken": "abc_123", "enName": "Cap Rocat Hotel", "saved": 40 },
        { "id": "bkCar1", "type": "car", "title": "Hertz", "provider": "Hertz", "price": 210000,
          "start": "2026-10-01", "end": "2026-10-02", "carPickup": "Palma Airport", "carPickupCode": "PMI",
          "carPickupTime": "10:00", "carReturnTime": "09:30", "carClass": "compact", "transmission": "manual", "track": true },
        { "id": "bad id!", "type": "hotel", "title": "버려진다" }
      ]
    }
    """

    private func load() throws -> TripDocument {
        let raw = try JSONDecoder().decode([String: JSONValue].self, from: Data(json.utf8))
        return TripDocument(raw: raw)
    }

    private func encoded(_ document: TripDocument) throws -> [String: JSONValue] {
        try JSONDecoder().decode([String: JSONValue].self, from: JSONValue.data(from: document.raw))
    }

    // MARK: 읽기

    func testReadsBookingsAndDropsBadIds() throws {
        let trip = try load()
        XCTAssertEqual(trip.bookings.map(\.id), ["bkOld1", "bkCar1"])   // 불량 id는 없는 것으로 본다

        let hotel = try XCTUnwrap(trip.booking(id: "bkOld1"))
        XCTAssertEqual(hotel.type, .hotel)
        XCTAssertEqual(hotel.price, 900)
        XCTAssertEqual(hotel.currency, .eur)
        XCTAssertEqual(hotel.adults, 2)
        XCTAssertTrue(hotel.refundable)
        XCTAssertTrue(hotel.track)

        let car = try XCTUnwrap(trip.booking(id: "bkCar1"))
        XCTAssertEqual(car.type, .car)
        XCTAssertNil(car.currency)                     // KRW
        XCTAssertEqual(car.currencyCode, "KRW")
        XCTAssertEqual(car.transmission, .manual)
        XCTAssertEqual(car.carClass, "compact")
        XCTAssertFalse(car.refundable)                 // 기한도 없고 표시도 없다

        // 반납 지점은 (장소, 코드) 한 쌍 — 둘 다 비었을 때만 픽업과 같다.
        XCTAssertEqual(car.returnPoint.place, "Palma Airport")
        XCTAssertEqual(car.returnPoint.code, "PMI")
    }

    func testOldBookingWithOnlyFreeCancelDateReadsAsRefundable() {
        let booking = TripBooking(raw: ["id": .string("b1"), "freeCancelUntil": .string("2026-09-20")])
        XCTAssertTrue(booking.refundable)
    }

    // MARK: 링크 조회

    func testFindsCurrentLinks() throws {
        let trip = try load()
        XCTAssertEqual(trip.links(forBooking: "bkOld1").stay, SpotRef(day: 0, index: 1))
        XCTAssertNil(trip.links(forBooking: "bkOld1").carPickup)
        XCTAssertEqual(trip.links(forBooking: "bkCar1").carReturn, SpotRef(day: 1, index: 0))
        XCTAssertEqual(trip.stayRefs, [SpotRef(day: 0, index: 1)])     // 숙소로 표시된 장소만
        XCTAssertEqual(trip.spotRefs.count, 3)
        XCTAssertEqual(trip.date(ofDay: 1), "2026-10-02")
    }

    // MARK: 저장 — 모르는 필드 보존 · 기본값 미기록

    func testEditKeepsPriceTrackingFieldsItDoesNotKnow() throws {
        var trip = try load()
        var hotel = try XCTUnwrap(trip.booking(id: "bkOld1"))
        hotel.provider = "Agoda"                        // 이름·기간은 그대로
        trip.upsertBooking(hotel, links: BookingLinks(stay: SpotRef(day: 0, index: 1)), now: Date(timeIntervalSince1970: 0))

        let out = try encoded(trip)
        let saved = try XCTUnwrap(out["bookings"]?.arrayValue?.first?.objectValue)
        XCTAssertEqual(saved["provider"]?.stringValue, "Agoda")
        XCTAssertEqual(saved["ptoken"]?.stringValue, "abc_123")       // identity가 같으면 매핑을 지킨다
        XCTAssertEqual(saved["enName"]?.stringValue, "Cap Rocat Hotel")
        XCTAssertEqual(saved["saved"]?.intValue, 40)
        XCTAssertEqual(saved["updatedAt"]?.stringValue, "1970-01-01T00:00:00.000Z")
    }

    func testChangingIdentityForgetsPropertyToken() throws {
        var trip = try load()
        var hotel = try XCTUnwrap(trip.booking(id: "bkOld1"))
        hotel.end = "2026-10-04"
        trip.upsertBooking(hotel)
        XCTAssertNil(trip.booking(id: "bkOld1")?.raw["ptoken"])
        XCTAssertEqual(trip.booking(id: "bkOld1")?.raw["enName"]?.stringValue, "Cap Rocat Hotel")
    }

    func testDefaultsAreNotWritten() {
        var booking = TripBooking(type: .hotel, id: "b1", createdAt: Date(timeIntervalSince1970: 0))
        XCTAssertEqual(booking.raw["createdAt"]?.stringValue, "1970-01-01T00:00:00.000Z")
        XCTAssertEqual(booking.raw["track"]?.boolValue, true)          // 웹도 항상 써 넣는다

        booking.currency = .krw
        XCTAssertNil(booking.raw["cur"])                                // KRW는 기본값
        booking.currency = .jpy
        XCTAssertEqual(booking.raw["cur"]?.stringValue, "JPY")

        booking.cancelFee = 0
        XCTAssertNil(booking.raw["cancelFee"])
        booking.url = ""
        XCTAssertNil(booking.raw["url"])
        booking.roomName = "   "
        XCTAssertNil(booking.raw["roomName"])
        booking.breakfast = false
        XCTAssertEqual(booking.raw["breakfast"]?.boolValue, false)     // '없음'은 뜻이 있어 남는다
        booking.breakfast = nil
        XCTAssertNil(booking.raw["breakfast"])                          // '모름'은 키가 없다

        booking.adults = 20
        XCTAssertEqual(booking.adults, 8)                               // normalizeBooking과 같은 한계
        booking.rooms = 0
        XCTAssertEqual(booking.rooms, 1)
    }

    func testCarFieldsFollowTheNormalizer() {
        var booking = TripBooking(type: .car, id: "c1")
        booking.carPickupCode = "pmi"
        XCTAssertEqual(booking.carPickupCode, "PMI")
        booking.carReturnCode = "PALMA"
        XCTAssertNil(booking.carReturnCode)                             // 세 글자가 아니면 버린다
        booking.carPickupTime = "9:05"
        XCTAssertEqual(booking.carPickupTime, "9:05")                   // _hm은 H:MM도 받는다
        booking.carReturnTime = "25:00"
        XCTAssertNil(booking.carReturnTime)
        booking.carReturn = "  "
        XCTAssertNil(booking.carReturn)

        booking.carPickup = "Palma Airport"
        booking.carReturnCode = "BCN"
        // 코드만 있어도 내가 정한 반납 지점이다 — 반쪽만 픽업에서 물려받지 않는다.
        XCTAssertEqual(booking.returnPoint.place, "")
        XCTAssertEqual(booking.returnPoint.code, "BCN")
    }

    func testNewIdPassesTheWebIdRule() {
        for _ in 0..<20 {
            let id = TripBooking.newId()
            XCTAssertTrue(TripBooking.isValidId(id), id)
            XCTAssertTrue(id.hasPrefix("bk"))
        }
        XCTAssertFalse(TripBooking.isValidId(""))
        XCTAssertFalse(TripBooking.isValidId("has space"))
        XCTAssertFalse(TripBooking.isValidId(String(repeating: "a", count: 41)))
        XCTAssertTrue(TripBooking.isValidId("a_b-9"))
    }

    // MARK: 연결 — 한 예약당 한 곳

    func testRelinkingMovesTheLinkAndClearsTheOldOne() throws {
        var trip = try load()
        // 숙소 표시를 공항에도 켜서 옮길 곳을 만든다
        var airport = trip.days[0].spots[0]
        airport.isStay = true
        trip.updateSpot(dayIndex: 0, at: 0, with: airport)

        let hotel = try XCTUnwrap(trip.booking(id: "bkOld1"))
        trip.upsertBooking(hotel, links: BookingLinks(stay: SpotRef(day: 0, index: 0)))
        XCTAssertEqual(trip.days[0].spots[0].bookingId, "bkOld1")
        XCTAssertNil(trip.days[0].spots[1].bookingId)                   // 옛 연결은 풀린다
        XCTAssertEqual(trip.days[0].spots[1].raw["nights"]?.intValue, 2)  // 그 장소의 다른 값은 그대로

        // 종류가 숙박이 아니면 숙소 연결을 맺지 않는다
        var car = try XCTUnwrap(trip.booking(id: "bkCar1"))
        car.carReturn = "Sóller"
        trip.upsertBooking(car, links: BookingLinks(stay: SpotRef(day: 0, index: 1), carPickup: SpotRef(day: 0, index: 0), carReturn: nil))
        XCTAssertNil(trip.days[0].spots[1].bookingId)
        XCTAssertEqual(trip.days[0].spots[0].carPickupId, "bkCar1")
        XCTAssertNil(trip.days[1].spots[0].carReturnId)                 // 연결을 비우면 풀린다
    }

    func testInsertAppendsAndRemoveClearsReferences() throws {
        var trip = try load()
        var flight = TripBooking(type: .flight, id: "bkF1")
        flight.title = "KE001"
        flight.price = 1_200_000
        trip.upsertBooking(flight)
        XCTAssertEqual(trip.bookings.map(\.id), ["bkOld1", "bkCar1", "bkF1"])

        trip.removeBooking(id: "bkCar1")
        XCTAssertNil(trip.days[1].spots[0].carReturnId)
        trip.removeBooking(id: "bkOld1")
        XCTAssertNil(trip.days[0].spots[1].bookingId)
        XCTAssertEqual(trip.days[0].spots[1].isStay, true)              // 연결만 풀고 숙소 표시는 둔다

        trip.removeBooking(id: "bkF1")
        XCTAssertNil(try encoded(trip)["bookings"])                     // 비면 키를 지운다(웹과 같다)
    }

    // MARK: 검증 — 웹 bkSave와 같은 규칙

    func testValidationMatchesTheWeb() {
        var booking = TripBooking(type: .hotel, id: "v1")
        XCTAssertEqual(booking.validate(), .titleRequired)
        booking.title = "호텔"
        XCTAssertEqual(booking.validate(), .priceRequired)
        booking.price = 100
        XCTAssertEqual(booking.validate(), .trackNeedsDates)            // 추적 on이면 기간 필수
        booking.track = false
        XCTAssertNil(booking.validate())

        booking.start = "2026-10-03"
        booking.end = "2026-10-03"
        XCTAssertEqual(booking.validate(), .checkoutNotAfterCheckin)   // 당일 체크아웃 없음
        booking.end = "2026-10-04"
        XCTAssertNil(booking.validate())

        // 렌터카: 당일 대여는 정상 — 시각이 앞뒤를 가른다
        booking.type = .car
        booking.end = "2026-10-03"
        XCTAssertEqual(booking.validate(), .sameDayNeedsTimes)
        booking.carPickupTime = "10:00"
        booking.carReturnTime = "10:00"
        XCTAssertEqual(booking.validate(), .sameDayNeedsTimes)
        booking.carReturnTime = "18:00"
        XCTAssertNil(booking.validate())
        booking.end = "2026-10-02"
        XCTAssertEqual(booking.validate(), .returnBeforePickup)
    }

    func testDateTextRoundTrip() {
        XCTAssertTrue(ISODateText.isValid("2026-10-01"))
        XCTAssertFalse(ISODateText.isValid("2026-1-01"))
        XCTAssertFalse(ISODateText.isValid("20261001"))
        let date = ISODateText.date(from: "2026-10-01")
        XCTAssertNotNil(date)
        XCTAssertEqual(ISODateText.text(from: date!), "2026-10-01")
        XCTAssertNil(ISODateText.date(from: nil))

        var booking = TripBooking(id: "d1")
        booking.start = "10/01"
        XCTAssertNil(booking.start)                                     // 형식이 아니면 저장하지 않는다
    }

    func testClockValidation() {
        XCTAssertTrue(ClockText.isValid("09:05"))
        XCTAssertTrue(ClockText.isValid("9:05"))
        XCTAssertTrue(ClockText.isValid("23:59"))
        XCTAssertFalse(ClockText.isValid("24:00"))
        XCTAssertFalse(ClockText.isValid("9:5"))
        XCTAssertFalse(ClockText.isValid(""))
        XCTAssertEqual(ClockText.minutes("10:30"), 630)
    }
}
