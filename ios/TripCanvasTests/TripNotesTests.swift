import XCTest
@testable import TripCanvas

/// 웹이 쓴 준비 메모를 앱이 같은 규칙으로 읽는가 — `lib.js`의 `normalizeTripNote`와 같은 거름.
final class TripNotesTests: XCTestCase {
    func testReadsWebNotesWithTheSameFilteringRules() {
        let doc = TripDocument(raw: ["notes": .array([
            .object(["id": .string("n1"), "cat": .string("VISA"), "title": .string(" ESTA "), "body": .string("출발 72시간 전"), "done": .bool(true)]),
            .object(["id": .string("n2"), "cat": .string("UNKNOWN"), "title": .string("모르는 분류")]),
            .object(["id": .string("n3"), "cat": .string("MONEY"), "title": .string(""), "body": .string("   ")]),
            .object(["title": .string("id 없음")])
        ])])

        let notes = TripNote.notes(in: doc)

        XCTAssertEqual(notes.map(\.id), ["n1", "n2"])
        XCTAssertEqual(notes[0].title, "ESTA")
        XCTAssertTrue(notes[0].done)
        XCTAssertEqual(notes[1].category, "ETC", "모르는 분류는 기타로 떨어진다")
        XCTAssertEqual(TripNote.label("VISA"), "비자")
        XCTAssertTrue(TripNote.notes(in: nil).isEmpty)
    }
}
