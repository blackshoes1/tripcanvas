import XCTest
@testable import TripCanvas

@MainActor private final class ImportSource: SharedImportSource {
    let documents: FakeDocumentService
    var loseReply = false
    init(document: TripDocument, role: MemberRole = .owner, cachedAt: Date? = nil) {
        documents = FakeDocumentService(snapshot: .init(document: document, revision: 1, role: role, cachedAt: cachedAt))
    }
    func previewShare(_ input: SharedTravelInput) async throws -> ImportPreviewResponse { throw APIError.offline }
    func document(tripId: String) async throws -> TripDocumentSnapshot { try await documents.document(tripId: tripId) }
    func saveDocument(tripId: String, document: TripDocument, expectedRevision: Int) async throws -> TripDocumentSnapshot {
        let result = try await documents.saveDocument(tripId: tripId, document: document, expectedRevision: expectedRevision)
        if loseReply { throw APIError.offline }
        return result
    }
    func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse> { throw APIError.offline }
    func cachedDayPlan(tripId: String, dayIndex: Int) async -> DayPlanResponse? { nil }
    func tripRoutes(tripId: String) async throws -> TripRoutesResponse { throw APIError.offline }
}

@MainActor final class CompleteJourneyTests: XCTestCase {
    private var input: SharedTravelInput { .init(id: "sh123", sourceType: .text, url: nil, text: "원문", title: "메모") }
    private var document: TripDocument { .init(raw: ["days": .array([.object(["spots": .array([])])]), "webOnly": .string("보존")]) }
    private func addImportedNote(_ doc: inout TripDocument) {
        doc.setField("notes", .array([.object(["id": .string("n1"), "importKey": .string("sh123"), "title": .string("메모")])]))
    }

    func testImportDoesNotSaveBeforeConfirmationAndRetriesLostReplyWithoutDuplicate() async {
        let source = ImportSource(document: document)
        let model = SharedImportModel(input: input, service: source)
        await model.previewInput()
        await model.selectTrip("t1")
        XCTAssertTrue(source.documents.saves.isEmpty)
        XCTAssertEqual(model.input.text, "원문")
        source.loseReply = true
        let failure = await model.save(addImportedNote)
        XCTAssertNotNil(failure)
        XCTAssertFalse(model.saved)
        let success = await model.save(addImportedNote)
        XCTAssertNil(success)
        XCTAssertTrue(model.saved)
        XCTAssertEqual(source.documents.saves.count, 1)
        XCTAssertEqual(source.documents.snapshot.document.raw["webOnly"], .string("보존"))
    }

    func testImportRequiresReviewAfterRemoteChangeAndRejectsOfflineOrViewer() async {
        let source = ImportSource(document: document)
        let model = SharedImportModel(input: input, service: source)
        await model.selectTrip("t1")
        source.documents.snapshot = .init(document: document, revision: 2, role: .owner)
        let conflict = await model.save(addImportedNote)
        XCTAssertNotNil(conflict)
        XCTAssertTrue(source.documents.saves.isEmpty)
        for snapshot in [TripDocumentSnapshot(document: document, revision: 2, role: .viewer),
                         TripDocumentSnapshot(document: document, revision: 2, role: .owner, cachedAt: Date())] {
            source.documents.snapshot = snapshot
            await model.selectTrip("t1")
            let rejected = await model.save(addImportedNote)
            XCTAssertNotNil(rejected)
        }
        XCTAssertTrue(source.documents.saves.isEmpty)
    }

    func testFullQueueNeverDropsUnreviewedOriginals() {
        var pending = (0..<50).map { SharedTravelInput(id: "sh\($0)", sourceType: .text, url: nil, text: "원문", title: nil) }
        XCTAssertNil(ShareQueue.roomForInput(in: pending))
        pending[10].state = .saved
        let available = ShareQueue.roomForInput(in: pending)
        XCTAssertEqual(available?.count, 49)
        XCTAssertEqual(available?.first?.id, "sh0")
        XCTAssertFalse(available?.contains(where: { $0.id == "sh10" }) ?? true)
    }

    func testLoginKeepsPublicIntentButAccountSwitchClearsIt() {
        let router = ActionRouter()
        for target in [ActionRouter.Destination.join(token: "abcdefghijklmnop"), .inbox(shareKey: "sh123")] {
            router.open(target); router.accountChanged(from: nil, to: "a")
            XCTAssertEqual(router.destination, target)
            router.accountChanged(from: "a", to: "b")
            XCTAssertNil(router.destination)
        }
        router.open(.trip(tripId: "private")); router.accountChanged(from: nil, to: "a")
        XCTAssertNil(router.destination)
        XCTAssertEqual(ActionRouter.parse(URL(string: "tripcanvas://join/abcdefghijklmnop")!), .join(token: "abcdefghijklmnop"))
        XCTAssertNil(ActionRouter.parse(URL(string: "tripcanvas://join/short")!))
    }

    func testNotesPreserveUnknownFieldsAndRollbackFailedCheck() async {
        var doc = document
        doc.setField("notes", .array([.object(["id": .string("n1"), "title": .string("준비"), "cat": .string("VISA"), "webOnly": .string("유지")])]))
        let source = FakeDocumentService(snapshot: .init(document: doc, revision: 1, role: .owner))
        let model = TripPlanViewModel(tripId: "t1", service: source, loadsPlans: false)
        await model.load()
        let checked = await model.setNoteDone(id: "n1", done: true)
        XCTAssertTrue(checked)
        XCTAssertEqual(model.document?.raw["notes"]?.arrayValue?.first?.objectValue?["webOnly"], .string("유지"))
        source.failure = .offline
        let failed = await model.setNoteDone(id: "n1", done: false)
        XCTAssertFalse(failed)
        XCTAssertTrue(TripNote.notes(in: model.document)[0].done)
        source.failure = nil
        let unchecked = await model.setNoteDone(id: "n1", done: false)
        XCTAssertTrue(unchecked)
        XCTAssertNil(model.document?.raw["notes"]?.arrayValue?.first?.objectValue?["done"])
        let added = await model.addNote(title: "충전기", body: "USB-C", category: "PACKING")
        XCTAssertTrue(added)
        XCTAssertEqual(TripNote.notes(in: model.document).count, 2)
        let invalid = await model.addNote(title: String(repeating: "a", count: 121), body: "", category: "ETC")
        XCTAssertFalse(invalid)
        XCTAssertEqual(TripNote.notes(in: model.document).count, 2)
    }
}
