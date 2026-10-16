import XCTest
@testable import TripCanvas

final class AudioGuideStoreTests: XCTestCase {
    func testPlaceKeysUseProviderThenCoordinatesAndIgnoreScheduleEdits() {
        var spot = TripSpot(name: "세비야 대성당", city: "세비야")
        spot.placeId = " Google/ID "
        spot.kakaoId = "other"
        spot.point = GeoPoint(lat: 37.3858333, lng: -5.9930556)
        XCTAssertEqual(AudioGuidePlace.key(spot), "[\"google\",\"Google/ID\"]")
        spot.placeId = nil
        XCTAssertEqual(AudioGuidePlace.key(spot), "[\"kakao\",\"other\"]")
        spot.kakaoId = nil
        let original = AudioGuidePlace.key(spot)
        XCTAssertEqual(original, "[\"point\",\"37.385833\",\"-5.993056\"]")
        spot.name = "대성당 이름 수정"
        spot.bookedAt = "15:00"
        XCTAssertEqual(AudioGuidePlace.key(spot), original)
        spot.point = nil
        spot.name = " Cathedral "
        spot.city = " SEVILLE "
        XCTAssertEqual(AudioGuidePlace.key(spot), "[\"name\",\"seville\",\"cathedral\"]")
        XCTAssertFalse(AudioGuidePlace.canIdentify(TripSpot(name: " \n ", city: "세비야")))
        XCTAssertTrue(AudioGuidePlace.canIdentify(spot))
    }

    func testTodaySelectionRejectsChangedRevisionAndChangedPlace() throws {
        let spot = TripSpot(name: "대성당")
        let document = TripDocument(raw: ["days": .array([.object(["spots": .array([.object(spot.raw)])])])])
        XCTAssertEqual(try AudioGuidePlace.resolve(document: document, documentRevision: 8,
            activityID: "d0s0", expectedName: "대성당", expectedRevision: 8), spot)
        XCTAssertThrowsError(try AudioGuidePlace.resolve(document: document, documentRevision: 9,
            activityID: "d0s0", expectedName: "대성당", expectedRevision: 8))
        XCTAssertThrowsError(try AudioGuidePlace.resolve(document: document, documentRevision: 8,
            activityID: "d0s0", expectedName: "다른 장소", expectedRevision: 8))
        XCTAssertThrowsError(try AudioGuidePlace.resolve(document: document, documentRevision: 8,
            activityID: "d0s1", expectedName: "대성당", expectedRevision: 8))
    }

    func testImportCopiesOriginalPersistsMultipleGuidesAndIsolatesAccountsTripsAndPlaces() async throws {
        let root = try tempDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("이야기.wav")
        try wave().write(to: source)
        let directory = root.appendingPathComponent("store")
        let store = AudioGuideStore(directory: directory)
        let scope = AudioGuideScope(accountID: "account-a", tripID: "trip-a")
        let first = try await store.add(url: source, scope: scope, placeKey: "cathedral")
        let second = try await store.add(url: source, scope: scope, placeKey: "cathedral")
        let copied = try await store.fileURL(id: first.id, scope: scope)
        XCTAssertNotEqual(copied, source)
        XCTAssertEqual(try Data(contentsOf: copied), try Data(contentsOf: source))
        XCTAssertEqual(first.title, "이야기.wav")
        XCTAssertEqual(first.duration, 1, accuracy: 0.05)
        try FileManager.default.removeItem(at: source)
        let reopened = AudioGuideStore(directory: directory)
        let saved = try await reopened.list(scope: scope, placeKey: "cathedral")
        XCTAssertEqual(saved.map(\.id), [first.id, second.id])
        let otherAccount = try await store.list(scope: AudioGuideScope(accountID: "account-b", tripID: "trip-a"), placeKey: "cathedral")
        let otherTrip = try await store.list(scope: AudioGuideScope(accountID: "account-a", tripID: "trip-b"), placeKey: "cathedral")
        let otherPlace = try await store.list(scope: scope, placeKey: "alcazar")
        XCTAssertTrue(otherAccount.isEmpty)
        XCTAssertTrue(otherTrip.isEmpty)
        XCTAssertTrue(otherPlace.isEmpty)
        try await store.remove(id: first.id, scope: scope)
        XCTAssertFalse(FileManager.default.fileExists(atPath: copied.path))
        let remaining = try await store.list(scope: scope, placeKey: "cathedral")
        XCTAssertEqual(remaining.map(\.id), [second.id])
    }

    func testUnsupportedAndBrokenAudioDoNotCreateAnEntry() async throws {
        let root = try tempDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = AudioGuideStore(directory: root.appendingPathComponent("store"))
        let scope = AudioGuideScope(accountID: "a", tripID: "t")
        for name in ["document.txt", "broken.mp3"] {
            let source = root.appendingPathComponent(name)
            try Data("not audio".utf8).write(to: source)
            do {
                _ = try await store.add(url: source, scope: scope, placeKey: "place")
                XCTFail("Unsupported or broken audio was accepted")
            } catch {}
        }
        let saved = try await store.list(scope: scope, placeKey: "place")
        XCTAssertTrue(saved.isEmpty)
    }

    func testOversizedAudioIsRejectedBeforeDecodingOrCopying() async throws {
        let root = try tempDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("large.wav")
        XCTAssertTrue(FileManager.default.createFile(atPath: source.path, contents: Data()))
        let handle = try FileHandle(forWritingTo: source)
        try handle.truncate(atOffset: UInt64(AudioGuideStore.maxBytes + 1))
        try handle.close()
        let store = AudioGuideStore(directory: root.appendingPathComponent("store"))
        let scope = AudioGuideScope(accountID: "a", tripID: "t")
        do {
            _ = try await store.add(url: source, scope: scope, placeKey: "place")
            XCTFail("Oversized audio was accepted")
        } catch AudioGuideStore.Failure.tooLarge {} catch { XCTFail("Unexpected failure: \(error)") }
        let saved = try await store.list(scope: scope, placeKey: "place")
        XCTAssertTrue(saved.isEmpty)
    }

    func testCorruptIndexIsReportedAndPreserved() async throws {
        let root = try tempDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = AudioGuideStore(directory: root)
        let folder = root.appendingPathComponent("61").appendingPathComponent("74")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let index = folder.appendingPathComponent("index.json"), broken = Data("corrupt index".utf8)
        try broken.write(to: index)
        do {
            _ = try await store.list(scope: AudioGuideScope(accountID: "a", tripID: "t"), placeKey: "place")
            XCTFail("A corrupt index must not be treated as an empty list")
        } catch AudioGuideStore.Failure.invalidIndex {} catch { XCTFail("Unexpected failure: \(error)") }
        XCTAssertEqual(try Data(contentsOf: index), broken)
    }

    private func tempDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("audio-guide-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    /// 1초짜리 무음 PCM WAV. 네트워크·외부 오디오 픽스처 없이 실제 디코딩 경계를 검증한다.
    private func wave() -> Data {
        var data = Data()
        func text(_ value: String) { data.append(contentsOf: value.utf8) }
        func u16(_ value: UInt16) { var little = value.littleEndian; withUnsafeBytes(of: &little) { data.append(contentsOf: $0) } }
        func u32(_ value: UInt32) { var little = value.littleEndian; withUnsafeBytes(of: &little) { data.append(contentsOf: $0) } }
        text("RIFF"); u32(16036); text("WAVEfmt "); u32(16); u16(1); u16(1)
        u32(8000); u32(16000); u16(2); u16(16); text("data"); u32(16000)
        data.append(Data(repeating: 0, count: 16000))
        return data
    }
}
