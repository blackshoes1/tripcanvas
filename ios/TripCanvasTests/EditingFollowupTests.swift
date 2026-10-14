import XCTest
@testable import TripCanvas

@MainActor
final class EditingFollowupTests: XCTestCase {
    private func parsedItinerary() -> ItineraryDraft {
        ItineraryDraft(name: "파리 여행", start: "2026-10-15", startAmbiguous: false,
                       days: [.init(index: 0, title: "파리", date: "2026-10-15", note: "", items: [])])
    }

    func testPasteInvalidInputCannotUseThePreviousValidStart() {
        let form = PasteItineraryFormState()
        form.draft = parsedItinerary(); form.start = "2026-10-15"
        XCTAssertFalse(form.canCreate(startInputInvalid: true), "날짜 칸의 입력이 잘못됐으면 마지막 유효 날짜로 생성하지 않는다")
        XCTAssertTrue(form.canCreate(startInputInvalid: false))
    }

    func testPasteAllowsUndatedTravelAndRejectsInvalidCanonicalDates() {
        let form = PasteItineraryFormState()
        XCTAssertFalse(form.canCreate(startInputInvalid: false), "읽어 보기 전에는 생성하지 않는다")
        form.draft = parsedItinerary()
        XCTAssertTrue(form.canCreate(startInputInvalid: false), "날짜 없는 일정은 만들 수 있다")
        for start in ["2026-02-30", "2026-13-01", "20261015", "2026-10-1"] {
            form.start = start
            XCTAssertFalse(form.canCreate(startInputInvalid: false), start)
        }
        form.start = "2028-02-29"
        XCTAssertTrue(form.canCreate(startInputInvalid: false))
    }

    func testStayPrefillPreservesEnteredMoneyEvenWhenTheSpotUsesAnotherCurrency() {
        let spot = TripSpot(raw: ["name": .string("숙소"), "cost": .number(100000)])
        let filled = BookingStayPrefill.money(from: spot, priceText: "100", currency: .eur, currencyEdited: true)
        XCTAssertEqual(filled.priceText, "100"); XCTAssertEqual(filled.currency, .eur)
        let incomplete = BookingStayPrefill.money(from: spot, priceText: "12.", currency: .eur, currencyEdited: false)
        XCTAssertEqual(incomplete.priceText, "12."); XCTAssertEqual(incomplete.currency, .eur, "입력 중인 금액도 자동입력으로 바꾸지 않는다")
    }

    func testStayPrefillUsesPerPersonTotalForTheBooking() {
        let spot = TripSpot(raw: ["name": .string("숙소"), "cost": .number(100), "cur": .string("EUR"),
                                 "costBasis": .string("PER_PERSON"), "costPeople": .number(2)])
        let filled = BookingStayPrefill.money(from: spot, priceText: "", currency: .krw, currencyEdited: false)
        XCTAssertEqual(filled.priceText, "200"); XCTAssertEqual(filled.currency, .eur)
        let sameCurrency = BookingStayPrefill.money(from: spot, priceText: "", currency: .eur, currencyEdited: true)
        XCTAssertEqual(sameCurrency.priceText, "200")
    }

    func testStayPrefillDoesNotGuessAnExchangeRateForTheChosenCurrency() {
        let spot = TripSpot(raw: ["name": .string("숙소"), "cost": .number(100), "cur": .string("EUR")])
        let filled = BookingStayPrefill.money(from: spot, priceText: "", currency: .usd, currencyEdited: true)
        XCTAssertEqual(filled.priceText, ""); XCTAssertEqual(filled.currency, .usd)
    }

    func testStayPrefillUsesKRWForASpotWithoutAnExplicitCurrency() {
        let spot = TripSpot(raw: ["name": .string("숙소"), "cost": .number(100000)])
        let filled = BookingStayPrefill.money(from: spot, priceText: "", currency: .eur, currencyEdited: false)
        XCTAssertEqual(filled.priceText, "100000"); XCTAssertEqual(filled.currency, .krw)
    }

    func testCostTotalMatchesExplicitPerPersonAndCurrencyMinorUnits() {
        var entry = CostEntry(raw: ["amount": .number(12.55), "cur": .string("EUR"), "costPeople": .number(3)])
        XCTAssertEqual(entry.totalAmount, 12.55, "적힌 인원만으로 1인 금액을 추측하지 않는다")
        entry.basis = .total
        XCTAssertEqual(entry.totalAmount, 12.55)
        entry.basis = .perPerson
        XCTAssertEqual(entry.totalAmount, 37.65)
        entry.raw["costPeople"] = .number(1.5)
        XCTAssertEqual(entry.totalAmount, 12.55, "공통 엔진처럼 정수인 인원만 곱한다")
        entry.raw["costPeople"] = .number(0)
        XCTAssertEqual(entry.totalAmount, 12.55)
    }

    func testPricedLinkedHotelUsesAnAdditionalCostWithoutChangingTheReservation() {
        let spot = TripSpot(raw: ["name": .string("호텔"), "stay": .bool(true), "bookingId": .string("h"), "cost": .number(0)])
        let hotel = TripBooking(raw: ["id": .string("h"), "type": .string("hotel"), "price": .number(200), "cur": .string("EUR")])
        XCTAssertTrue(SpotExpensePolicy.bookingPaysSpot(spot, bookings: [hotel]))
        var day = TripDay(); day.spots = [spot]
        let expense = QuickSpendEditor.entry(amount: 50, title: "호텔 별도 비용", kind: .other, currency: .eur, photos: [])
        day.costItems = [expense]
        XCTAssertEqual(day.spots, [spot], "숙박 예약이 계산하는 금액은 덮어 쓰지 않는다")
        XCTAssertEqual(day.costItems.first?.amount, 50)
        XCTAssertEqual(day.costItems.first?.payState, .paid)
        XCTAssertNil(day.costItems.first?.raw["bookingId"], "현장 비용은 예약이 계산에서 제외하는 장소 비용이 아니다")
        XCTAssertEqual(hotel.price, 200)
    }

    func testUnpricedHotelKeepsTheOriginalSpotCostFallback() {
        let spot = TripSpot(raw: ["name": .string("호텔"), "bookingId": .string("h")])
        for rawPrice in [JSONValue.null, .number(0)] {
            let hotel = TripBooking(raw: ["id": .string("h"), "type": .string("hotel"), "price": rawPrice])
            XCTAssertFalse(SpotExpensePolicy.bookingPaysSpot(spot, bookings: [hotel]))
        }
        let car = TripBooking(raw: ["id": .string("h"), "type": .string("car"), "price": .number(200)])
        XCTAssertFalse(SpotExpensePolicy.bookingPaysSpot(spot, bookings: [car]))
        let unrelated = TripBooking(raw: ["id": .string("other"), "type": .string("hotel"), "price": .number(200)])
        XCTAssertFalse(SpotExpensePolicy.bookingPaysSpot(spot, bookings: [unrelated]))
    }
}
