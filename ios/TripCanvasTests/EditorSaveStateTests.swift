import XCTest
@testable import TripCanvas

@MainActor
final class EditorSaveStateTests: XCTestCase {
    func testFailureKeepsEditorOpenAndRetryClearsError() async {
        let state = EditorSaveState()
        let first = await state.perform { "연결 실패" }
        XCTAssertFalse(first)
        XCTAssertEqual(state.error, "연결 실패")
        XCTAssertFalse(state.isWorking)
        let retry = await state.perform { nil }
        XCTAssertTrue(retry)
        XCTAssertNil(state.error)
    }

    func testDoubleTapDoesNotStartAnotherSave() async {
        let state = EditorSaveState()
        var extraCalls = 0
        let saved = await state.perform {
            XCTAssertTrue(state.isWorking)
            let duplicate = await state.perform { extraCalls += 1; return nil }
            XCTAssertFalse(duplicate)
            return nil
        }
        XCTAssertTrue(saved)
        XCTAssertEqual(extraCalls, 0)
    }
}
