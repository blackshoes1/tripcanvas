import XCTest
@testable import TripCanvas

// 앱이 웹에서 **복사해 든 표시 규칙**이 원본과 같은 답을 내는지.
//
// 픽스처는 `next`의 `labelParity.test.ts`가 웹 원본(`lib.js`·`app.js`)으로 만든다. 원본을 바꾸면
// 그 테스트가 파일을 새로 쓰고 여기가 깨진다 — 그게 목적이다. 같은 글자를 손으로 적은 대조
// (`TripDocumentTests.testPriorityLabelsMatchWeb` · `CostPayStateLabelTests`)는 웹이 바뀌어도 초록이었다.

/// 장소 우선순위 3단 — 웹 `SPOT_PRIORITIES`·`spotPriorityOf`·`applySpotPriority`와 같은 목록·같은 읽기·같은 쓰기.
final class SpotPriorityParityTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Priority: Decodable { let id: String; let label: String }
        struct Read: Decodable { let name: String; let spot: [String: JSONValue]; let priority: String }
        struct Write: Decodable {
            let name: String
            let before: [String: JSONValue]
            let level: String
            let after: [String: JSONValue]
        }
        let priorities: [Priority]
        let reads: [Read]
        let writes: [Write]
    }

    private func load() throws -> Fixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "spot-priority", withExtension: "json"),
                                "spot-priority.json 픽스처를 테스트 번들에 포함시켜야 합니다")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    func testListMatchesTheWebInOrder() throws {
        let fixture = try load()
        XCTAssertEqual(SpotPriority.allCases.map(\.rawValue), fixture.priorities.map(\.id))
        XCTAssertEqual(SpotPriority.allCases.map(\.label), fixture.priorities.map(\.label))
    }

    /// 두 플래그를 한 값으로 읽는다 — 둘 다 켜진 옛 문서는 지키는 쪽(must)이다.
    func testReadingMatchesTheWebRule() throws {
        let fixture = try load()
        XCTAssertGreaterThan(fixture.reads.count, 0)
        for r in fixture.reads {
            XCTAssertEqual(TripSpot(raw: r.spot).priority.rawValue, r.priority, r.name)
        }
    }

    /// 쓰면 문서 모양까지 같다 — 기본값('보통')은 저장하지 않고, 둘이 함께 켜지지 않고, 다른 칸은 그대로다.
    func testWritingProducesTheSameDocument() throws {
        let fixture = try load()
        XCTAssertGreaterThan(fixture.writes.count, 0)
        for w in fixture.writes {
            var spot = TripSpot(raw: w.before)
            spot.priority = try XCTUnwrap(SpotPriority(rawValue: w.level), w.name)
            XCTAssertEqual(spot.raw, w.after, w.name)
        }
    }
}

/// 결제 상태·비용 분류의 이름 — 웹 `PAY_STATE_LABEL`·`COST_KIND`와 **글자까지 같다**. 순서는 `lib.js`가 정한다.
final class CostLabelParityTests: XCTestCase {
    private struct Fixture: Decodable {
        let payStates: [String]
        let payStateLabels: [String: String]
        let categories: [String]
        let categoryNames: [String: String]
    }

    private func load() throws -> Fixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "cost-labels", withExtension: "json"),
                                "cost-labels.json 픽스처를 테스트 번들에 포함시켜야 합니다")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    func testPayStateLabelsMatchTheWeb() throws {
        let fixture = try load()
        XCTAssertEqual(CostPayState.allCases.map(\.rawValue), fixture.payStates)
        XCTAssertEqual(Set(fixture.payStateLabels.keys), Set(CostPayState.allCases.map(\.rawValue)))
        for state in CostPayState.allCases {
            XCTAssertEqual(state.label, fixture.payStateLabels[state.rawValue], state.rawValue)
        }
    }

    func testCostCategoryNamesMatchTheWeb() throws {
        let fixture = try load()
        XCTAssertEqual(CostCategory.allCases.map(\.rawValue), fixture.categories)
        XCTAssertEqual(Set(fixture.categoryNames.keys), Set(CostCategory.allCases.map(\.rawValue)))
        for category in CostCategory.allCases {
            XCTAssertEqual(category.label, fixture.categoryNames[category.rawValue], category.rawValue)
        }
    }
}
