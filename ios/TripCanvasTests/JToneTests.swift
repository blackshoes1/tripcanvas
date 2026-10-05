import XCTest
@testable import TripCanvas

@MainActor
final class JToneTests: XCTestCase {
    private func defaults() -> UserDefaults { UserDefaults(suiteName: "JToneTests.\(UUID())")! }

    func testSaveAndAccountIsolation() async {
        let disk = defaults()
        let store = JToneStore(accountID: "a", defaults: disk,
            fetch: { .init(jTone: .friendly) }, persist: { .init(jTone: $0) })
        await store.select(.casual)
        XCTAssertEqual(store.selected, .casual)
        XCTAssertFalse(store.pending)
        store.useAccount("b")
        XCTAssertEqual(store.selected, .friendly)
        store.useAccount("a")
        XCTAssertEqual(store.selected, .casual)
        XCTAssertEqual(JCopy.text("pulse.complete", tone: .casual), "오늘 계획한 일정은 다 마쳤어")
    }

    func testFailedSaveKeepsDraftAndDoesNotLetReadOverwriteIt() async {
        let store = JToneStore(accountID: "a", defaults: defaults(),
            fetch: { .init(jTone: .friendly) }, persist: { _ in throw APIError.offline })
        await store.select(.polite)
        await store.load()
        XCTAssertEqual(store.selected, .polite)
        XCTAssertTrue(store.pending)
        XCTAssertNotNil(store.message)
    }

    func testLateReadCannotReplaceAnotherAccountOrNewChoice() async {
        for switchAccount in [true, false] {
            var waiting: CheckedContinuation<JTonePreferences, Error>?
            let store = JToneStore(accountID: "a", defaults: defaults(),
                fetch: { try await withCheckedThrowingContinuation { waiting = $0 } }, persist: { .init(jTone: $0) })
            let load = Task { await store.load() }
            while waiting == nil { await Task.yield() }
            if switchAccount { store.useAccount("b") } else { await store.select(.casual) }
            waiting?.resume(returning: .init(jTone: .polite))
            await load.value
            XCTAssertEqual(store.selected, switchAccount ? .friendly : .casual)
        }
    }

    func testLateSaveCannotTouchNewAccount() async {
        var waiting: CheckedContinuation<JTonePreferences, Error>?
        let disk = defaults()
        let store = JToneStore(accountID: "a", defaults: disk,
            fetch: { .init(jTone: .friendly) }, persist: { _ in try await withCheckedThrowingContinuation { waiting = $0 } })
        let save = Task { await store.select(.casual) }
        while waiting == nil { await Task.yield() }
        store.useAccount("b")
        waiting?.resume(returning: .init(jTone: .casual))
        await save.value
        XCTAssertEqual(store.selected, .friendly)
        XCTAssertFalse(store.isSaving)
        XCTAssertNil(disk.string(forKey: "tripcanvas_j_tone_v1.b"))
    }

    func testVariableValuesAreNotExpandedAgain() {
        XCTAssertEqual(JCopy.text("intent.echo", params: ["reasons": "{place} $&"], tone: .casual), "이렇게 이해했어 — {place} $&")
    }
}
