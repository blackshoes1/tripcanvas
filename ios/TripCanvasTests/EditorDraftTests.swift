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

    func testCostDraftRequiresOriginalAndRevisionAndPreservesIncompleteAmount() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let original = CostEntry(raw: ["id": .string("cost-1"), "title": .string("원본")])
        let draft = CostInputDraft(original: original.raw, edited: ["id": .string("cost-1"), "cur": .string("EUR")], amount: "12.", revision: 7)
        let key = EditorDraftKey(accountID: "a", tripID: "t", editor: "cost-1")
        let store = EditorDraftStore(directory: directory); store.save(draft, key: key)
        XCTAssertEqual(store.load(CostInputDraft.self, key: key), draft)
        XCTAssertTrue(draft.canRestore(over: original, revision: 7))
        XCTAssertFalse(draft.canRestore(over: original, revision: 8))
        XCTAssertFalse(draft.canRestore(over: CostEntry(raw: ["id": .string("other")]), revision: 7))
        XCTAssertNil(store.load(CostInputDraft.self, key: key?.appending("other")))
    }

    func testBookingDraftPreservesStableIdentityAndRejectsChangedLink() throws {
        let booking = TripBooking(id: "stable-booking")
        let links = BookingLinks(stay: SpotRef(day: 0, index: 1))
        let draft = BookingInputDraft(original: [:], originalLinks: .empty, revision: 3, booking: booking.raw,
            links: links, kind: "STAY", texts: ["price": "123."], photos: ["local"], segments: [["dep": .string("서울")]])
        let restored = try JSONDecoder().decode(BookingInputDraft.self, from: JSONEncoder().encode(draft))
        XCTAssertEqual(restored, draft)
        XCTAssertEqual(TripBooking(raw: restored.booking).id, "stable-booking")
        XCTAssertTrue(draft.canRestore(over: [:], links: .empty, revision: 3))
        XCTAssertFalse(draft.canRestore(over: [:], links: links, revision: 3))
        XCTAssertFalse(draft.canRestore(over: [:], links: .empty, revision: 4))
    }
}
