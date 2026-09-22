import XCTest
@testable import TripCanvas

/// 공유 키(§57) — 같은 내용이면 앱과 서버가 **같은 키**를 만들어야 한다. 다르면 같은 공유가 두 번 처리된다.
///
/// 픽스처는 `next`의 `shareKeyParity.test.ts`가 **`intake.js`의 `shareIdempotencyKey`로** 만든다.
/// 규칙을 바꾸면 그 테스트가 파일을 새로 쓰고 여기가 깨진다 — 그게 목적이다.
///
/// ⚠️ 2026-09-21 전에는 이 파리티가 Swift 소스에서 **문자열을 grep** 하는 것이었다. 알고리즘이
/// 적혀 있는지만 봤지 같은 입력에 같은 키가 나오는지는 보지 않아, 실제로 갈라져 있던 두 군데를
/// 놓쳤다(본문 자르기 단위 · 앞뒤 공백 집합).
final class ShareKeyParityTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Case: Decodable {
            let name: String
            let url: String?
            let title: String?
            let text: String?
            let key: String
        }
        let cases: [Case]
    }

    private func load() throws -> Fixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "share-key", withExtension: "json"),
                                "share-key.json 픽스처를 테스트 번들에 포함시켜야 합니다")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    func testMakeIdMatchesTheServerForEveryCase() throws {
        let fixture = try load()
        XCTAssertGreaterThan(fixture.cases.count, 5, "경계값이 빠진 픽스처는 대조가 아니다")
        for row in fixture.cases {
            XCTAssertEqual(SharedTravelInput.makeId(url: row.url, title: row.title, text: row.text), row.key,
                           "서버와 키가 다르면 같은 공유가 두 번 처리된다 — \(row.name)")
        }
    }

    /// 키는 파일 이름·딕셔너리 키로 쓰이므로 모양이 흔들리면 안 된다.
    func testKeyShapeIsStable() throws {
        for row in try load().cases {
            XCTAssertTrue(row.key.hasPrefix("sh"), row.name)
            XCTAssertEqual(row.key.dropFirst(2).filter { $0.isLowercase || $0.isNumber }.count,
                           row.key.count - 2, "base36 소문자·숫자만 — \(row.name)")
        }
    }

    /// 500 코드 단위 뒤는 키에 들어가지 않는다. 이것이 **문자(grapheme)** 단위가 되면
    /// 이모지가 섞인 긴 글에서 서버와 갈린다.
    func testOnlyTheFirst500UTF16UnitsOfTextCount() {
        let long = String(repeating: "🌍 마드리드 → 세비야 · ", count: 40)
            .trimmingCharacters(in: .whitespaces)
        XCTAssertGreaterThan(long.utf16.count, 500)
        XCTAssertLessThan(long.count, long.utf16.count, "이모지가 있어야 두 세는 법이 갈린다")
        XCTAssertEqual(SharedTravelInput.makeId(url: nil, title: nil, text: long),
                       SharedTravelInput.makeId(url: nil, title: nil, text: long + " 이 꼬리는 키에 들어가지 않는다"))
    }
}
