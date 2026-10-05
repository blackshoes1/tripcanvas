import XCTest
@testable import TripCanvas

final class DayCostTests: XCTestCase {
    func testTripCostKeepsItsScheduleDateSeparateFromPaymentDate() {
        var entry = CostEntry(raw: ["id": .string("ticket"), "title": .string("입장권")])
        entry.scheduledOn = "2026-10-02"
        entry.paidOn = "2026-09-20"
        var document = TripDocument(raw: [:])
        document.costItems = [entry]
        XCTAssertEqual(document.costItems[0].scheduledOn, "2026-10-02")
        XCTAssertEqual(document.costItems[0].paidOn, "2026-09-20")
        entry.scheduledOn = nil
        XCTAssertNil(entry.raw["scheduledOn"])
    }

    func testSpotCostRoundTripAndClearingKeepTheSameSource() {
        let original = TripSpot(raw: ["name": .string("미술관"), "cost": .number(12.5), "cur": .string("EUR"),
                                     "paidOn": .string("2026-10-01"), "photos": .array([.string("receipt")]), "custom": .string("keep")])
        var entry = CostEntry(spot: original)
        XCTAssertEqual(entry.amount, 12.5)
        XCTAssertEqual(entry.paidOn, "2026-10-01")
        entry.amount = 15.25
        entry.paidOn = "2026-10-02"
        let updated = entry.applying(to: original)
        XCTAssertEqual(updated.raw["paidOn"], .string("2026-10-02"))
        XCTAssertEqual(updated.cost, 15.25)
        let cleared = CostEntry.clearing(updated)
        XCTAssertNil(cleared.cost)
        XCTAssertNil(cleared.raw["paidOn"])
        XCTAssertNil(cleared.raw["photos"])
        XCTAssertEqual(cleared.raw["custom"], .string("keep"))
    }

    func testDeleteBookingCostHasTwoScopesAcrossDays() {
        let original = TripDocument(raw: ["bookings": .array([.object(["id": .string("car"), "price": .number(50)])]),
            "days": .array([
                .object(["spots": .array([.object(["name": .string("픽업"), "carPickupId": .string("car"), "cost": .number(50)]), .object(["name": .string("관광")])])]),
                .object(["spots": .array([.object(["name": .string("반납"), "carReturnId": .string("car")])])])])])
        var costOnly = original
        costOnly.deleteSpotCost(day: 0, index: 0, includingSource: false)
        XCTAssertEqual(costOnly.days[0].spots.count, 2)
        XCTAssertNil(costOnly.days[0].spots[0].cost)
        XCTAssertEqual(costOnly.bookings[0].raw["price"], .null)
        var all = original
        all.deleteSpotCost(day: 0, index: 0, includingSource: true)
        XCTAssertTrue(all.bookings.isEmpty)
        XCTAssertEqual(all.days[0].spots.map(\.name), ["관광"])
        XCTAssertTrue(all.days[1].spots.isEmpty)
    }

    func testTripCostsDecodesActualServerContract() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "trip-costs", withExtension: "json"))
        let costs = try JSONDecoder().decode(TripCostsResponse.self, from: Data(contentsOf: url))
        XCTAssertEqual(costs.revision, 2)
        XCTAssertEqual(costs.days.count, 2)
        XCTAssertEqual(costs.categories.count, 9)
        XCTAssertEqual(costs.categories.reduce(0) { $0 + $1.totalKRW }, costs.totalKRW)
        XCTAssertEqual(costs.fxSource, "FALLBACK")
        XCTAssertTrue(costs.categories.flatMap(\.items).contains { $0.source == "BOOKING" })
        // 결제일은 모든 줄에 실린다(없으면 null) — 화면이 문서를 다시 읽지 않게. 옛 응답(키 없음)도 nil로 읽힌다.
        XCTAssertTrue(costs.categories.flatMap(\.items).allSatisfy { $0.paidOn == nil })
        let overview = try XCTUnwrap(costs.overview)
        XCTAssertEqual(overview.items.reduce(0) { $0 + ($1.line.totalKRW ?? 0) }, costs.totalKRW)
        XCTAssertEqual(Set(overview.items.map(\.id)).count, overview.items.count)
    }

    /// 일정 밖으로 넘친 연박의 몫은 현지 결제 금액에만 있고 날짜별 줄에는 없다 — 예약 하루치가 없어도 그 차이를 말한다(2026-10-02).
    /// 2일 일정: 1일차 점심 12,000 · 2일차 3박 숙소 300,000 → 머리글 312,000, 날짜별 줄 12,000 + 100,000.
    func testDayRowsNoteExplainsStayOverflowWithoutBookingShare() throws {
        let json = """
        [{"source":"STAY","key":"1.0","title":"호텔 (2–3/3박 · 일정 밖)","kind":"STAY","amount":200000,"currency":"KRW","basis":"ENTERED","people":1,"payState":"NONE","paidOn":null,"photos":[],"totalKRW":200000,"state":"KNOWN","dayIndex":null},
         {"source":"BOOKING","key":"b1","title":"렌터카 (일정 밖)","kind":"RENT","amount":50000,"currency":"KRW","basis":"ENTERED","people":1,"payState":"RESERVED","paidOn":null,"photos":[],"totalKRW":50000,"state":"KNOWN","dayIndex":null}]
        """
        let lines = try JSONDecoder().decode([TripCostLine].self, from: Data(json.utf8))
        let overflow = TripCostsView.stayOverflowTotal(lines)
        XCTAssertEqual(overflow, 200000, "날짜 없는 예약 잔액은 현지 결제가 아니라 세지 않는다")

        let note = try XCTUnwrap(TripCostsView.dayRowsNote(share: 0, overflow: overflow, dayRows: 112000))
        XCTAssertTrue(note.contains(TimeFormat.money(200000, currency: "KRW")), note)
        XCTAssertTrue(note.contains("날짜별 합계 \(TimeFormat.money(112000, currency: "KRW"))"), note)
        XCTAssertFalse(note.contains("예약 하루치"), "없는 차이는 말하지 않는다")

        let both = try XCTUnwrap(TripCostsView.dayRowsNote(share: 50000, overflow: overflow, dayRows: 162000))
        XCTAssertTrue(both.contains("예약 하루치") && both.contains("일정 밖"), both)
        XCTAssertNil(TripCostsView.dayRowsNote(share: 0, overflow: 0, dayRows: 112000), "머리글과 날짜별 줄이 같은 돈이면 말하지 않는다")
    }

    /// '장소 분류에 따름'(AUTO)은 없앴다(2026-10-05) — 종류에서 고른 분류로 열고, 다르게 고르면 그 분류를 적는다.
    /// 한 번 적은 분류는 종류의 분류와 같은 값으로 바꿔도 적힌 채로 둔다(웹과 같다 — 계산 결과는 같다).
    func testManualCostCategoryPreservesSpotAndKeepsWrittenKind() {
        var spot = TripSpot(raw: ["name": .string("장소"), "cat": .string("food"), "custom": .string("keep")])
        var entry = CostEntry(spot: spot)
        XCTAssertEqual(entry.kind, "FOOD")
        entry.kind = "SHOPPING"
        spot = entry.applying(to: spot)
        XCTAssertEqual(spot.raw["costKind"], .string("SHOPPING"))
        XCTAssertEqual(spot.raw["cat"], .string("food"))
        XCTAssertEqual(spot.raw["custom"], .string("keep"))
        entry.kind = "FOOD"
        XCTAssertEqual(entry.applying(to: spot).raw["costKind"], .string("FOOD"))
    }

    func testMoneyInputPreservesFreeAndForeignMinorUnits() {
        XCTAssertNil(MoneyInput.amount(from: ""))
        XCTAssertEqual(MoneyInput.amount(from: "0"), 0)
        XCTAssertEqual(MoneyInput.amount(from: "12,000원"), 12000)
        XCTAssertEqual(MoneyInput.amount(from: "12.55", currency: .eur), 12.55)
        XCTAssertNil(MoneyInput.amount(from: "12.555", currency: .eur))
        XCTAssertNil(MoneyInput.amount(from: "12.55", currency: .krw))
        XCTAssertNil(MoneyInput.amount(from: "-12"))
        XCTAssertNil(MoneyInput.amount(from: "무료"))
        XCTAssertNil(MoneyInput.amount(from: "12abc"))
        XCTAssertEqual(MoneyInput.text(amount: 0), "0")
        XCTAssertEqual(MoneyInput.text(amount: 12.55), "12.55")
    }

    func testCostEditingPreservesUnrelatedSpotAndDayFields() throws {
        var day = TripDay(raw: ["unfamiliar": .string("keep"), "spots": .array([
            .object(["name": .string("미술관"), "cost": .number(12.55), "cur": .string("EUR"),
                     "bookingId": .string("ticket"), "hours": .array([.string("keep")])])])])
        var entry = CostEntry(spot: day.spots[0])
        XCTAssertEqual(entry.amount, 12.55)
        entry.amount = 0
        entry.basis = .perPerson
        entry.people = 2
        day.spots = [entry.applying(to: day.spots[0])]
        day.budget = CostEntry(raw: ["amount": .number(0), "costBasis": .string("TOTAL")])
        let decoded = try JSONDecoder().decode(JSONValue.self, from: JSONValue.data(from: day.raw))
        let restored = TripDay(raw: try XCTUnwrap(decoded.objectValue))
        XCTAssertEqual(restored.budget?.amount, 0)
        XCTAssertEqual(restored.spots[0].cost, 0)
        XCTAssertEqual(restored.spots[0].bookingId, "ticket")
        XCTAssertEqual(restored.spots[0].raw["hours"], .array([.string("keep")]))
        XCTAssertEqual(restored.raw["unfamiliar"], .string("keep"))
    }

    func testOlderCostResponseStillDecodesWithoutNewDetails() throws {
        let data = Data(#"{"total":12000,"parts":[{"label":"장소","amount":12000}]}"#.utf8)
        let cost = try JSONDecoder().decode(DayPlanCost.self, from: data)
        XCTAssertEqual(cost.total, 12000)
        XCTAssertNil(cost.details)
    }

    func testDecodesLargeCostFromRealServerWithoutIntegerOverflow() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "day-cost-extreme", withExtension: "json"))
        let cost = try JSONDecoder().decode(DayPlanCost.self, from: Data(contentsOf: url))
        XCTAssertEqual(cost.total, 9.6e18)
        XCTAssertGreaterThan(cost.total, Double(Int64.max))
        XCTAssertEqual(cost.parts.first?.amount, cost.total)
        let details = try XCTUnwrap(cost.details)
        XCTAssertEqual(details.items.count, 64)
        XCTAssertEqual(details.items.first?.amount, 1e12)
        XCTAssertEqual(details.items.first?.totalKRW, 1.5e17)
        let budget = try XCTUnwrap(details.budget)
        XCTAssertEqual(budget.totalKRW, 0)
        XCTAssertEqual(budget.differenceKRW, -cost.total)
        XCTAssertEqual(details.fxSource, "FALLBACK")
    }

    func testForeignMoneyDisplayKeepsCents() {
        XCTAssertTrue(TimeFormat.money(12.55, currency: "EUR").contains("12.55"))
    }

    @MainActor
    func testSpotSaveAndMoveValidationPreservesUnknownFreeAndDecimalAmounts() {
        var spot = TripSpot(name: "입장권")
        spot.currency = .eur
        XCTAssertNil(SpotEditorView.validationError(for: spot, costText: ""))
        XCTAssertNil(SpotEditorView.validationError(for: spot, costText: "0"))
        XCTAssertNil(SpotEditorView.validationError(for: spot, costText: "12.55"))
        XCTAssertNotNil(SpotEditorView.validationError(for: spot, costText: "12.555"))
        XCTAssertNotNil(SpotEditorView.validationError(for: spot, costText: "-12"))
        spot.currency = .krw
        XCTAssertNotNil(SpotEditorView.validationError(for: spot, costText: "12.55"))
        XCTAssertNil(spot.cost, "검증이 초안을 무료나 다른 금액으로 바꾸면 안 된다")
    }
}
