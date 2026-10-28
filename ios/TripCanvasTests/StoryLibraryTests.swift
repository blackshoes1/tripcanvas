import XCTest
@testable import TripCanvas

/// 카탈로그·음성을 주는 가짜 웹. 경로마다 돌려줄 바이트를 정하고, 몇 번 불렸는지 센다.
private final class StoryWebProtocol: URLProtocol {
    @MainActor static var files: [String: Data] = [:]
    @MainActor static var offline = false
    @MainActor static var hits: [String: Int] = [:]
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Task { @MainActor in
            let path = request.url?.path ?? ""
            Self.hits[path, default: 0] += 1
            if Self.offline {
                client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
                return
            }
            let data = Self.files[path]
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: data == nil ? 404 : 200,
                                                                  httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data ?? Data())
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() {}
}

@MainActor
final class StoryLibraryTests: XCTestCase {
    private var directory: URL!
    private var session: URLSession!
    private let base = URL(string: "https://stories.example/")!
    private let audio = Data("ID3 이야기 한 편".utf8)

    override func setUp() {
        super.setUp()
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StoryWebProtocol.self]
        session = URLSession(configuration: config)
        StoryWebProtocol.files = [:]
        StoryWebProtocol.hits = [:]
        StoryWebProtocol.offline = false
    }

    override func tearDown() {
        session.invalidateAndCancel()
        try? FileManager.default.removeItem(at: directory)
        StoryWebProtocol.files = [:]
        StoryWebProtocol.offline = false
        super.tearDown()
    }

    private func catalog(sha: String, bytes: Int) -> Data {
        let raw: [String: Any] = [
            "version": 1,
            "places": [[
                "id": "seville-plaza-espana", "kind": "PLACE", "name": "스페인 광장", "localName": "Plaza de España",
                "lat": 37.3772, "lng": -5.9869, "radiusM": 300, "aliases": [], "placeIds": [],
                "tracks": [["id": "core", "role": "CORE", "title": "광장, 핵심만", "src": "seville/plaza-espana-core.mp3",
                            "seconds": 2, "bytes": bytes, "sha256": sha, "sources": ["P01"], "reviewedAt": "2026-10-22"]],
            ]],
            "sources": ["P01": ["title": "세비야 관광청", "url": "https://visitasevilla.es/"]],
        ]
        return try! JSONSerialization.data(withJSONObject: raw)
    }

    private func library() -> StoryLibrary {
        StoryLibrary(base: base, session: session, directory: directory)
    }

    /// 받은 음성은 지문을 확인한 뒤 담기고, 다시 들을 때는 네트워크를 부르지 않는다.
    func testDownloadsVerifiesAndReusesTheSavedFile() async throws {
        StoryWebProtocol.files["/stories/catalog.json"] = catalog(sha: StoryLibrary.sha256Hex(audio), bytes: audio.count)
        StoryWebProtocol.files["/stories/seville/plaza-espana-core.mp3"] = audio
        let library = library()
        await library.loadIfNeeded()
        XCTAssertEqual(library.state, .ready)
        let place = try XCTUnwrap(library.catalog.place(id: "seville-plaza-espana"))
        let track = try XCTUnwrap(place.tracks.first)
        XCTAssertEqual(library.savedCount(place), 0)

        let file = try await library.file(for: track)
        XCTAssertEqual(try Data(contentsOf: file), audio)
        XCTAssertEqual(file.lastPathComponent, track.sha256 + ".mp3", "이름은 지문이다 — 같은 경로에 새 음성이 올라와도 옛 것을 틀지 않게")
        XCTAssertEqual(library.savedCount(place), 1)

        _ = try await library.file(for: track)
        XCTAssertEqual(StoryWebProtocol.hits["/stories/seville/plaza-espana-core.mp3"], 1, "담아 둔 사본이 먼저다")
    }

    /// 받다 끊긴 파일(지문이 다름)은 담지 않는다 — 담아 두면 오프라인에서 계속 끊긴다.
    func testRejectsAFileWhoseFingerprintDiffers() async throws {
        StoryWebProtocol.files["/stories/catalog.json"] = catalog(sha: StoryLibrary.sha256Hex(audio), bytes: audio.count)
        StoryWebProtocol.files["/stories/seville/plaza-espana-core.mp3"] = audio.prefix(4)
        let library = library()
        await library.loadIfNeeded()
        let track = try XCTUnwrap(library.catalog.places.first?.tracks.first)
        do {
            _ = try await library.file(for: track)
            XCTFail("지문이 다르면 실패해야 해요")
        } catch {
            XCTAssertEqual(error as? StoryLibraryError, .integrity)
        }
        XCTAssertFalse(library.isSaved(track))
    }

    /// 오프라인이면 지난번에 받아 둔 카탈로그와 음성으로 그대로 들린다.
    func testOfflineUsesTheLastCatalogAndSavedAudio() async throws {
        StoryWebProtocol.files["/stories/catalog.json"] = catalog(sha: StoryLibrary.sha256Hex(audio), bytes: audio.count)
        StoryWebProtocol.files["/stories/seville/plaza-espana-core.mp3"] = audio
        let first = library()
        await first.loadIfNeeded()
        let track = try XCTUnwrap(first.catalog.places.first?.tracks.first)
        _ = try await first.file(for: track)

        StoryWebProtocol.offline = true
        let later = library()
        await later.loadIfNeeded()
        XCTAssertEqual(later.state, .ready, "받아 둔 카탈로그로 붙는다")
        XCTAssertTrue(later.isSaved(track))
        let file = try await later.file(for: track)
        XCTAssertEqual(try Data(contentsOf: file), audio)
    }

    /// 처음부터 오프라인이고 받아 둔 것도 없으면 '없음'이다 — 다음에 다시 해 본다.
    func testOfflineWithNothingSavedIsUnavailableAndRetries() async throws {
        StoryWebProtocol.offline = true
        let library = library()
        await library.loadIfNeeded()
        XCTAssertEqual(library.state, .unavailable)
        XCTAssertTrue(library.catalog.places.isEmpty)

        StoryWebProtocol.offline = false
        StoryWebProtocol.files["/stories/catalog.json"] = catalog(sha: StoryLibrary.sha256Hex(audio), bytes: audio.count)
        await library.loadIfNeeded()
        XCTAssertEqual(library.state, .ready)
    }

    /// 방금 받은 카탈로그는 다시 받지 않고, 오래되면(`maxAge`) 다시 받는다.
    func testFreshCatalogIsReusedUntilItAges() async throws {
        StoryWebProtocol.files["/stories/catalog.json"] = catalog(sha: StoryLibrary.sha256Hex(audio), bytes: audio.count)
        let library = library()
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        await library.loadIfNeeded(now: start)
        await library.loadIfNeeded(now: start.addingTimeInterval(StoryLibrary.maxAge - 1))
        XCTAssertEqual(StoryWebProtocol.hits["/stories/catalog.json"], 1, "창을 열 때마다 묻지 않는다")
        await library.loadIfNeeded(now: start.addingTimeInterval(StoryLibrary.maxAge))
        XCTAssertEqual(StoryWebProtocol.hits["/stories/catalog.json"], 2, "며칠 살아 있는 앱도 새 지문을 받는다")
    }

    /// 오프라인에서 지난 카탈로그로 붙었으면, 연결된 뒤 다시 받는다. 못 받는 동안에도 지난 것은 그대로다.
    func testDiskCatalogIsReplacedOnceOnline() async throws {
        let renewed = Data("ID3 다시 만든 이야기".utf8)
        StoryWebProtocol.files["/stories/catalog.json"] = catalog(sha: StoryLibrary.sha256Hex(audio), bytes: audio.count)
        await library().loadIfNeeded()

        StoryWebProtocol.offline = true
        let later = library()
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        await later.loadIfNeeded(now: start)
        XCTAssertEqual(later.state, .ready)
        await later.loadIfNeeded(now: start.addingTimeInterval(StoryLibrary.retryInterval))
        XCTAssertEqual(later.catalog.places.first?.tracks.first?.sha256, StoryLibrary.sha256Hex(audio), "못 받아도 지난 것을 지운다")

        StoryWebProtocol.offline = false
        StoryWebProtocol.files["/stories/catalog.json"] = catalog(sha: StoryLibrary.sha256Hex(renewed), bytes: renewed.count)
        await later.loadIfNeeded(now: start.addingTimeInterval(StoryLibrary.retryInterval * 2))
        XCTAssertEqual(later.catalog.places.first?.tracks.first?.sha256, StoryLibrary.sha256Hex(renewed))
    }

    /// 같은 경로에 음성을 다시 만들어 올렸다 — 옛 지문으로는 맞지 않으니 카탈로그를 한 번 다시 받아 새 트랙으로 받는다.
    func testRebuiltAudioAtTheSamePathIsFetchedWithTheNewFingerprint() async throws {
        let renewed = Data("ID3 다시 만든 이야기".utf8)
        StoryWebProtocol.files["/stories/catalog.json"] = catalog(sha: StoryLibrary.sha256Hex(audio), bytes: audio.count)
        let library = library()
        await library.loadIfNeeded()
        let stale = try XCTUnwrap(library.catalog.places.first?.tracks.first)

        StoryWebProtocol.files["/stories/catalog.json"] = catalog(sha: StoryLibrary.sha256Hex(renewed), bytes: renewed.count)
        StoryWebProtocol.files["/stories/seville/plaza-espana-core.mp3"] = renewed
        let (track, file) = try await library.file(for: stale, placeID: "seville-plaza-espana")
        XCTAssertEqual(track.sha256, StoryLibrary.sha256Hex(renewed))
        XCTAssertEqual(try Data(contentsOf: file), renewed)
        XCTAssertEqual(StoryWebProtocol.hits["/stories/catalog.json"], 2)
    }

    /// 다시 받아도 지문이 같으면(받다 끊김) 그대로 실패다 — 같은 파일을 두 번 받지 않는다.
    func testIntegrityFailureWithoutANewFingerprintStillFails() async throws {
        StoryWebProtocol.files["/stories/catalog.json"] = catalog(sha: StoryLibrary.sha256Hex(audio), bytes: audio.count)
        StoryWebProtocol.files["/stories/seville/plaza-espana-core.mp3"] = audio.prefix(4)
        let library = library()
        await library.loadIfNeeded()
        let track = try XCTUnwrap(library.catalog.places.first?.tracks.first)
        do {
            _ = try await library.file(for: track, placeID: "seville-plaza-espana")
            XCTFail("지문이 다르면 실패해야 해요")
        } catch {
            XCTAssertEqual(error as? StoryLibraryError, .integrity)
        }
        XCTAssertEqual(StoryWebProtocol.hits["/stories/seville/plaza-espana-core.mp3"], 1)
    }

    /// 지문은 소문자 16진수 64자 — 카탈로그의 `sha256`과 같은 모양.
    func testFingerprintIsLowercaseHex() {
        XCTAssertEqual(StoryLibrary.sha256Hex(Data("abc".utf8)),
                       "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }
}
