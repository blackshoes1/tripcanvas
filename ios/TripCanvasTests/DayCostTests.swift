import XCTest
@testable import TripCanvas

final class DayCostTests: XCTestCase {
    func testTripCostsDecodesActualServerContract() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "trip-costs", withExtension: "json"))
        let costs = try JSONDecoder().decode(TripCostsResponse.self, from: Data(contentsOf: url))
        XCTAssertEqual(costs.revision, 2)
        XCTAssertEqual(costs.days.count, 2)
        XCTAssertEqual(costs.categories.count, 9)
        XCTAssertEqual(costs.categories.reduce(0) { $0 + $1.totalKRW }, costs.totalKRW)
        XCTAssertEqual(costs.fxSource, "FALLBACK")
        let lodging = costs.categories.flatMap(\.items).first { $0.source == "BOOKING" }?.lodging
        XCTAssertEqual(lodging?.nights, 2)
        XCTAssertEqual(lodging?.totalAmount, 100000)
        XCTAssertEqual(lodging?.nightNumber, 1)
        XCTAssertTrue(costs.categories.flatMap(\.items).contains { $0.source == "BOOKING" })
    }

    func testManualCostCategoryPreservesSpotAndCanReturnToAutomatic() {
        var spot = TripSpot(raw: ["name": .string("장소"), "cat": .string("food"), "custom": .string("keep")])
        var entry = CostEntry(spot: spot)
        XCTAssertEqual(entry.kind, "AUTO")
        entry.kind = "SHOPPING"
        spot = entry.applying(to: spot)
        XCTAssertEqual(spot.raw["costKind"], .string("SHOPPING"))
        XCTAssertEqual(spot.raw["cat"], .string("food"))
        XCTAssertEqual(spot.raw["custom"], .string("keep"))
        entry.kind = "AUTO"
        XCTAssertNil(entry.applying(to: spot).raw["costKind"])
    }

    func testLodgingNightsEditingPreservesTotalAndUnknownFields() {
        let spot = TripSpot(raw: ["name": .string("숙소"), "stay": .bool(true), "nights": .number(3), "cost": .number(300000), "unknown": .string("keep")])
        var entry = CostEntry(spot: spot)
        XCTAssertTrue(entry.isLodging)
        XCTAssertEqual(entry.nights, 3)
        entry.nights = 4
        let edited = entry.applying(to: spot)
        XCTAssertEqual(edited.nights, 4)
        XCTAssertEqual(edited.cost, 300000)
        XCTAssertEqual(edited.raw["unknown"], .string("keep"))
        let extra = CostEntry(raw: ["kind": .string("STAY"), "nights": .number(3)])
        XCTAssertTrue(extra.isLodging)
        XCTAssertEqual(extra.nights, 3)
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
