import XCTest
@testable import TripCanvas

/// 가고 싶은 곳의 분류 — 웹 `collab.js`와 같은 목록·같은 순서, 표시와 거르기만 한다.
final class CandidateCategoryTests: XCTestCase {
    func testListMatchesTheWebInOrder() {
        XCTAssertEqual(CandidateCategory.allCases.map(\.rawValue),
                       ["RESTAURANT", "CAFE", "DESSERT", "SIGHT", "LANDMARK", "NATURE", "SHOPPING", "ACTIVITY", "STAY", "ETC"])
        for category in CandidateCategory.allCases {
            XCTAssertFalse(category.label.isEmpty)
            XCTAssertTrue(category.symbol.allSatisfy { $0.isASCII }, "벡터 아이콘 이름")
        }
    }

    func testReadsLooseValuesAndDropsUnknownOnes() {
        XCTAssertEqual(CandidateCategory.of("cafe"), .cafe)
        XCTAssertEqual(CandidateCategory.of(" SIGHT "), .sight)
        XCTAssertNil(CandidateCategory.of("BOGUS"), "모르는 값은 고르지 않음이다 — 담기를 실패시키지 않는다")
        XCTAssertNil(CandidateCategory.of(nil))
    }

    func testFilterIsDisplayOnly() {
        XCTAssertTrue(CandidateCategoryFilter.all.matches(nil))
        XCTAssertTrue(CandidateCategoryFilter.all.matches(.cafe))
        XCTAssertTrue(CandidateCategoryFilter.none.matches(nil))
        XCTAssertFalse(CandidateCategoryFilter.none.matches(.etc), "'고르지 않음'과 '기타'는 다른 상태")
        XCTAssertTrue(CandidateCategoryFilter.only(.cafe).matches(.cafe))
        XCTAssertFalse(CandidateCategoryFilter.only(.cafe).matches(.dessert))
        XCTAssertEqual(CandidateCategoryFilter.only(.activity).label, "체험·액티비티")
    }

    func testLooseDateParsingAcceptsEightDigitsOnly() {
        XCTAssertEqual(ISODateText.parseLoose("20261025"), "2026-10-25")
        XCTAssertEqual(ISODateText.parseLoose("2026-10-25"), "2026-10-25")
        XCTAssertEqual(ISODateText.parseLoose("2026.10.25"), "2026-10-25")
        XCTAssertEqual(ISODateText.parseLoose("2026/10/25"), "2026-10-25")
        XCTAssertNil(ISODateText.parseLoose("1025"), "연도를 추측하지 않는다")
        XCTAssertNil(ISODateText.parseLoose("20260230"), "없는 날은 받지 않는다")
        XCTAssertNil(ISODateText.parseLoose(""))
    }
}
