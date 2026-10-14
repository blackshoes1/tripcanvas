import XCTest
@testable import TripCanvas

/// 예약 결제 금액의 한 목록(`PaymentRow`)과 확인한 결제 표시 — 웹 `paymentRows`·`costPayStateOf`와 같은 답.
final class PaymentLedgerTests: XCTestCase {
    func testPaymentRowKeepsConfirmedStateRegardlessOfPaymentDate() {
        let reserved = PaymentRow(source: .booking(TripBooking(raw: ["id": .string("r"), "paidOn": .string("2020-01-01"), "payState": .string("RESERVED")])))
        let paid = PaymentRow(source: .booking(TripBooking(raw: ["id": .string("p"), "paidOn": .string("2099-01-01"), "payState": .string("PAID")])))
        let unset = PaymentRow(source: .item(CostEntry(raw: ["id": .string("n"), "paidOn": .string("2020-01-01")])))
        XCTAssertEqual(reserved.manualPayState, .reserved, "예정일이 지나도 실제 결제를 단정하지 않는다")
        XCTAssertEqual(paid.manualPayState, .paid, "날짜보다 사용자가 확인한 표시가 우선한다")
        XCTAssertEqual(unset.manualPayState, .none, "날짜만 적힌 비용은 결제 확인으로 바꾸지 않는다")
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

/// 결제 상태의 이름이 웹 `PAY_STATE_LABEL`과 **글자까지 같은지**.
///
/// 2026-09-20 전에는 같은 `NONE` 값이 요약에서는 '미구분', 고르는 칸에서는 '고르지 않음'이라
/// 앱 안에서도 두 말이었다. 이름은 하나고, **말할지 말지**는 쓰는 쪽이 정한다.
final class CostPayStateLabelTests: XCTestCase {
    func testLabelsMatchTheWeb() {
        XCTAssertEqual(CostPayState.reserved.label, "결제 예정")
        XCTAssertEqual(CostPayState.paid.label, "결제 완료")
        XCTAssertEqual(CostPayState.none.label, "고르지 않음")
    }

    /// 세 상태 모두 이름이 있어야 고르는 칸에 쓸 수 있다 — 빈 이름으로 숨기기를 대신하지 않는다.
    func testEveryStateHasAName() {
        for state in CostPayState.allCases {
            XCTAssertFalse(state.label.isEmpty, state.rawValue)
        }
    }

    /// 고르지 않은 것은 **요약에 담지 않는다** — 이름이 생겼다고 찍히지는 않는다.
    /// 서버가 `payTotals`에 NONE을 실어 보내도 `paySplit`은 예약·결제만 낸다.
    func testUnsetStateIsNotCountedInASplit() {
        let cost = DayPlanCost(total: 7000, parts: [],
                               payTotals: ["PAID": 3000, "RESERVED": 0, "NONE": 4000])
        XCTAssertEqual(cost.paySplit.map(\.state), [.paid], "값이 0인 예약도, 미구분도 줄을 만들지 않는다")
        XCTAssertFalse(cost.paySplit.contains { $0.state == .none })
    }
}
