import XCTest
@testable import TripCanvas

/// 예약 결제 금액의 한 목록(`PaymentRow`)과 결제일 규칙(`CostPayState.resolved`) — 웹 `paymentRows`·`costPayStateOf`와 같은 답.
final class PaymentLedgerTests: XCTestCase {
    func testDateDecidesStateLikeTheEngine() {
        XCTAssertEqual(CostPayState.resolved(paidOn: "2026-09-18", manual: .reserved, today: "2026-09-18"), .paid, "결제일 당일부터 결제")
        XCTAssertEqual(CostPayState.resolved(paidOn: "2026-09-19", manual: .paid, today: "2026-09-18"), .reserved, "손으로 결제라고 해도 날짜가 이긴다")
        XCTAssertEqual(CostPayState.resolved(paidOn: nil, manual: .paid, today: "2026-09-18"), .paid, "결제일이 없으면 손으로 고른 값")
        XCTAssertEqual(CostPayState.resolved(paidOn: "언젠가", manual: .none, today: "2026-09-18"), .none, "날짜 모양이 아니면 없는 것")
    }

    func testRowsSortByPaidOnThenKeepOrder() {
        var a = TripBooking(type: .hotel, id: "a"); a.paidOn = "2026-09-01"
        let b = TripBooking(type: .flight, id: "b")
        var c = CostEntry(raw: ["id": .string("c"), "kind": .string("OTHER")]); c.paidOn = "2026-09-10"
        let d = CostEntry(raw: ["id": .string("d")])
        let rows = PaymentRow.rows(bookings: [a, b], items: [c, d])
        XCTAssertEqual(rows.map(\.key), ["c", "a", "b", "d"], "결제일 최근 순, 없는 것은 뒤에 등록 순(예약 → 비용)")
        XCTAssertEqual(rows.map(\.lineSource), ["TRIP", "BOOKING", "BOOKING", "TRIP"])
        XCTAssertEqual(rows.map(\.id), ["TRIP:c", "BOOKING:a", "BOOKING:b", "TRIP:d"])
        XCTAssertEqual(rows[0].kind, .other)
        XCTAssertEqual(rows[1].kind, .stay)
        XCTAssertEqual(rows[2].kind, .flight)
        XCTAssertEqual(rows[1].title, "예약", "이름이 비면 예약")
        XCTAssertEqual(rows[3].title, "비용")
        XCTAssertNil(rows[1].amount, "0원 예약은 금액 미정")
    }

    func testCategoryMapsToBookingTypeBothWays() {
        XCTAssertEqual(CostCategory(bookingType: .car), .rent)
        XCTAssertEqual(CostCategory(bookingType: .hotel), .stay)
        XCTAssertEqual(CostCategory.rent.bookingType, .car)
        XCTAssertNil(CostCategory.food.bookingType)
        XCTAssertEqual(CostCategory.bookingKinds.count + CostCategory.itemKinds.count, CostCategory.allCases.count)
        XCTAssertEqual(CostCategory.allCases.map(\.rawValue), ["FLIGHT", "STAY", "RENT", "TRANSIT", "FOOD", "SHOPPING", "TICKET", "TRANSPORT", "OTHER"],
                       "웹 셀렉트박스와 같은 순서")
    }

    func testFxLineRoundsToWonAndQuotesYenPerHundred() {
        XCTAssertEqual(TripCostsView.fxLine(currency: "USD", rate: 1398.52), "1 USD ≈ 1,399원")
        XCTAssertEqual(TripCostsView.fxLine(currency: "JPY", rate: 9.3149), "100 JPY ≈ 931원")
        XCTAssertEqual(TripCostsView.fxLine(currency: "EUR", rate: 1550), "1 EUR ≈ 1,550원")
    }
}
