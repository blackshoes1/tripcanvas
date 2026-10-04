import XCTest
@testable import TripCanvas

/// 여행 총예산(C-1, 2026-10-05) — 문서 읽기·쓰기는 `lib.js` `tripBudgetOf`와 같고, 남은 예산은 서버가 계산해 보낸다.
final class TripBudgetTests: XCTestCase {
    func testReadsBudgetLikeTheWeb() {
        XCTAssertNil(TripDocument(raw: [:]).budgetAmount)
        XCTAssertNil(TripDocument(raw: ["budget": .object(["cur": .string("EUR")])]).budgetAmount, "금액 없는 예산은 없다")
        let krw = TripDocument(raw: ["budget": .object(["amount": .number(3_000_000)])])
        XCTAssertEqual(krw.budgetAmount, 3_000_000)
        XCTAssertEqual(krw.budgetCurrency, .krw, "통화가 없으면 원화")
        XCTAssertEqual(TripDocument(raw: ["budget": .object(["amount": .number(1), "cur": .string("XYZ")])]).budgetCurrency, .krw)
    }

    func testWritesBudgetWithoutKRWCurrency() {
        var doc = TripDocument(raw: [:])
        doc.setBudget(amount: 2000, currency: .eur)
        XCTAssertEqual(doc.raw["budget"], .object(["amount": .number(2000), "cur": .string("EUR")]))
        doc.setBudget(amount: 500_000, currency: .krw)
        XCTAssertEqual(doc.raw["budget"], .object(["amount": .number(500_000)]), "원화면 통화를 적지 않는다")
        doc.setBudget(amount: nil, currency: .krw)
        XCTAssertNil(doc.raw["budget"])
    }

    func testBudgetLineSaysRemainingOrOverWithoutHiding() {
        let under = TripBudgetStatus(amount: 2000, currency: "EUR", totalKRW: 3_000_000, costKRW: 1_800_000, remainingKRW: 1_200_000, perDayKRW: 750_000)
        let line = TripCostsView.budgetLine(under)
        XCTAssertFalse(line.over)
        XCTAssertTrue(line.title.hasPrefix("남은 예산"), line.title)
        XCTAssertTrue(line.detail.contains("하루 평균"), line.detail)
        XCTAssertTrue(line.detail.contains("≈"), "외화 예산은 원화 환산을 함께 말한다")
        let over = TripCostsView.budgetLine(TripBudgetStatus(amount: 1_000_000, currency: "KRW", totalKRW: 1_000_000, costKRW: 1_250_000, remainingKRW: -250_000, perDayKRW: nil))
        XCTAssertTrue(over.over)
        XCTAssertTrue(over.title.hasPrefix("예산보다") && over.title.hasSuffix("많아요"), over.title)
        XCTAssertFalse(over.detail.contains("하루 평균"))
    }

    /// 실제 응답 픽스처(`swiftParity.test.ts`가 예산을 넣어 만든다)를 디코딩한다.
    func testCostsFixtureCarriesBudget() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "trip-costs", withExtension: "json"))
        let costs = try JSONDecoder().decode(TripCostsResponse.self, from: Data(contentsOf: url))
        let budget = try XCTUnwrap(costs.budget)
        XCTAssertEqual(budget.costKRW, costs.totalKRW)
        XCTAssertEqual(budget.remainingKRW, budget.totalKRW - costs.totalKRW)
    }
}
