import XCTest
@testable import TripCanvas

final class SharedTripFileStoreTests: XCTestCase {
    private func file(id: String = UUID().uuidString, name: String = "ticket.pdf") -> SharedTripFile {
        SharedTripFile(id: id, kind: "DOCUMENT", placeKey: "", name: name, title: "입장 티켓",
                       mime: "application/pdf", size: 6, position: 0, createdAt: "2026-10-22T00:00:00Z")
    }
    func testDownloadedBytesAndMetadataSurviveReopenAndStayAccountScoped() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = SharedTripFileStore(directory: root), file = self.file(), bytes = Data("%PDF-a".utf8)
        try await store.saveList([file], account: "a", trip: "t")
        let url = try await store.save(bytes, file: file, account: "a", trip: "t")
        XCTAssertEqual(try Data(contentsOf: url), bytes)
        let reopened = SharedTripFileStore(directory: root)
        let saved = try await reopened.list(account: "a", trip: "t")
        XCTAssertEqual(saved, [file])
        let other = try await reopened.localURL(file, account: "b", trip: "t")
        XCTAssertNil(other)
        try await reopened.remove(file, account: "a", trip: "t")
        let removed = try await reopened.localURL(file, account: "a", trip: "t")
        XCTAssertNil(removed)
    }
    func testPartialDownloadsAndUnsafeIDsAreRejected() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = SharedTripFileStore(directory: root)
        do { _ = try await store.save(Data("bad".utf8), file: file(), account: "a", trip: "t"); XCTFail("Partial download accepted") } catch {}
        do { _ = try await store.save(Data("%PDF-a".utf8), file: file(id: "../escape"), account: "a", trip: "t"); XCTFail("Unsafe id accepted") } catch {}
    }
}
