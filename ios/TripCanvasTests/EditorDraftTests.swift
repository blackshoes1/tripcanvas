import XCTest
@testable import TripCanvas

final class EditorDraftTests: XCTestCase {
    func testDraftSurvivesRelaunchAndIsIsolatedByAccountTripAndEditor() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let key = try XCTUnwrap(EditorDraftKey(accountID: "a", tripID: "t", editor: "spot-0-1"))
        let draft = SpotInputDraft(original: TripSpot(name: "A").raw, edited: TripSpot(name: "edited").raw, costText: "1,2.")
        EditorDraftStore(directory: directory).save(draft, key: key)
        let relaunched = EditorDraftStore(directory: directory)
        XCTAssertEqual(relaunched.load(SpotInputDraft.self, key: key), draft)
        for different in [EditorDraftKey(accountID: "b", tripID: "t", editor: "spot-0-1"),
                          EditorDraftKey(accountID: "a", tripID: "other", editor: "spot-0-1"),
                          EditorDraftKey(accountID: "a", tripID: "t", editor: "spot-1-1")] {
            XCTAssertNil(relaunched.load(SpotInputDraft.self, key: different))
        }
        XCTAssertFalse(draft.canRestore(over: TripSpot(name: "different place")))
        XCTAssertTrue(draft.canRestore(over: TripSpot(name: "A")))
        relaunched.remove(key)
        XCTAssertNil(relaunched.load(SpotInputDraft.self, key: key))
    }

    func testIncompleteSpendKeepsExactInputAndStableIdentity() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let key = EditorDraftKey(accountID: "a", tripID: "t", editor: "spend-0")
        let draft = SpendInputDraft(id: "stable-id", amount: "12.", title: "coffee", kind: "FOOD", currency: "USD", photos: ["local-photo"])
        let store = EditorDraftStore(directory: directory)
        store.save(draft, key: key)
        XCTAssertEqual(store.load(SpendInputDraft.self, key: key), draft)
        XCTAssertNil(EditorDraftKey(accountID: nil, tripID: "t", editor: "spend-0"))
    }
}
