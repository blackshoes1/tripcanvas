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

    /// 서버 후보 응답의 `category`를 읽고, 키가 없는 옛 응답도 그대로 디코딩된다(2026-09-18 CI가 잡은 누락).
    func testCandidateViewDecodesCategoryAndToleratesItsAbsence() throws {
        let base = #"{"id":7,"title":"카사 바트요","place_id":null,"lat":null,"lng":null,"addr":null,"note":null,"url":null,"status":"OPEN","scheduled_ref":null,"proposed_by_label":"영희","mine":false,"my_reaction":null,"must_count":0,"ok_count":0,"pass_count":0,"reactions":[],"comment_count":0,"created_at":"2026-09-18T00:00:00Z""#
        let withCategory = try JSONDecoder().decode(CandidateView.self, from: Data((base + #","category":"CAFE"}"#).utf8))
        XCTAssertEqual(withCategory.category, "CAFE")
        XCTAssertEqual(CandidateCategory.of(withCategory.category), .cafe)
        let without = try JSONDecoder().decode(CandidateView.self, from: Data((base + "}").utf8))
        XCTAssertNil(without.category, "옛 서버 응답(키 없음)은 '아직 고르지 않음'이다")
        XCTAssertEqual(CollabModel.applyingReaction(.must, to: withCategory).category, "CAFE", "반응을 눌러도 분류가 사라지지 않는다")
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
