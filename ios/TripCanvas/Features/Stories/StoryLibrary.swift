import CryptoKit
import Foundation
import Observation

/// 음성을 받다가 생긴 일. 화면 문구는 웹(`app.js` `playStoryTrack`)과 같다.
enum StoryLibraryError: Error, Equatable {
    /// 받은 파일의 지문이 카탈로그와 다르다 — 받다 끊긴 파일을 담아 두면 오프라인에서 계속 끊긴다.
    case integrity
    /// 받지 못했다(오프라인·서버 오류).
    case unavailable
}

/// With J 이야기의 카탈로그와 음성 파일(docs/with-j-stories.md).
///
/// - 콘텐츠는 **웹 주소의 정적 파일**이다(`stories/catalog.json`+mp3). API·NAS·로그인과 무관하다 —
///   그래서 `APIClient`(NAS 토큰을 붙인다)를 쓰지 않고 전용 세션으로 받는다. 토큰이 다른 호스트로 나가면 안 된다.
/// - 담는 곳은 `Application Support/WithJStories/`이고 이름은 **지문**(`<sha256>.mp3`)이다. Caches는 저장 공간이
///   모자라면 OS가 지워 '비행기 모드에서도 들린다'는 약속이 깨진다. 지문을 이름으로 쓰면 같은 경로에 새 음성이
///   올라와도 옛 음성을 틀지 않는다.
/// - 계정과 무관한 공개 콘텐츠라 계정을 바꿔도 지우지 않는다(웹 `withj-stories-v1` 캐시와 같다).
/// - ⚠️ 앱 전체에 **하나**다(`shared`). `AppEnvironment`는 Siri 동작이 따로 만들기도 해서 거기에 두면 둘이 된다.
@Observable
@MainActor
final class StoryLibrary {
    static let shared = StoryLibrary()

    enum State: Equatable { case idle, loading, ready, unavailable }

    private(set) var catalog: StoryCatalog = .empty
    private(set) var state: State = .idle
    /// 이 기기에 담긴 음성의 지문. 화면이 '저장됨'을 말할 때마다 디스크를 뒤지지 않게 들고 있다.
    private(set) var savedHashes: Set<String> = []

    @ObservationIgnored private let base: URL
    @ObservationIgnored private let session: URLSession
    @ObservationIgnored private let directory: URL
    @ObservationIgnored private var loading: Task<Void, Never>?
    @ObservationIgnored private var downloads: [String: Task<URL, Error>] = [:]

    init(base: URL = AppConfig.webBaseURL, session: URLSession? = nil, directory: URL? = nil) {
        self.base = base
        if let session {
            self.session = session
        } else {
            // 음성이 URLCache에 한 벌 더 쌓이지 않게 — 담는 곳은 아래 폴더 하나다.
            let config = URLSessionConfiguration.ephemeral
            config.urlCache = nil
            config.requestCachePolicy = .reloadIgnoringLocalCacheData
            self.session = URLSession(configuration: config)
        }
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("WithJStories", isDirectory: true)
    }

    private var catalogFile: URL { directory.appendingPathComponent("catalog.json") }
    private var audioDirectory: URL { directory.appendingPathComponent("audio", isDirectory: true) }
    private func audioFile(_ sha256: String) -> URL { audioDirectory.appendingPathComponent(sha256 + ".mp3") }

    /// 카탈로그를 한 번 받는다. 못 받으면 지난번에 받아 둔 것을 읽는다(웹 `loadStories`).
    /// 둘 다 없으면 `unavailable`이고 다음에 부르면 다시 해 본다.
    func loadIfNeeded() async {
        if state == .ready { return }
        if let loading { await loading.value; return }
        let task = Task { await self.load() }
        loading = task
        await task.value
        loading = nil
    }

    private func load() async {
        state = .loading
        var raw: JSONValue?
        var fresh = false
        var request = URLRequest(url: StoryRules.catalogURL(base: base), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.httpShouldHandleCookies = false
        if let result = try? await session.data(for: request),
           (result.1 as? HTTPURLResponse)?.statusCode == 200,
           let json = try? JSONDecoder().decode(JSONValue.self, from: result.0), json.objectValue != nil {
            let data = result.0
            raw = json
            fresh = true
            prepareDirectory()
            try? data.write(to: catalogFile, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
        if raw == nil, let data = try? Data(contentsOf: catalogFile) {
            raw = try? JSONDecoder().decode(JSONValue.self, from: data)
        }
        guard let raw else { state = .unavailable; return }
        catalog = StoryCatalog(raw: raw)
        savedHashes = scanSaved()
        // 새 카탈로그에 없는 음성은 지운다 — 오프라인에서 읽은 옛 카탈로그로는 지우지 않는다.
        if fresh { prune(keeping: Set(catalog.places.flatMap(\.tracks).map(\.sha256))) }
        state = .ready
    }

    func isSaved(_ track: StoryTrack) -> Bool { savedHashes.contains(track.sha256) }

    func savedCount(_ place: StoryPlace) -> Int { place.tracks.filter(isSaved).count }

    /// 들을 파일 — 담아 둔 사본이 먼저, 없으면 받아서 지문을 확인하고 담는다(웹 `storyBlob`).
    /// 같은 음성을 동시에 두 번 받지 않는다.
    func file(for track: StoryTrack) async throws -> URL {
        let target = audioFile(track.sha256)
        if savedHashes.contains(track.sha256), FileManager.default.fileExists(atPath: target.path) { return target }
        if let running = downloads[track.sha256] { return try await running.value }
        let task = Task { try await self.download(track, to: target) }
        downloads[track.sha256] = task
        defer { downloads[track.sha256] = nil }
        let url = try await task.value
        savedHashes.insert(track.sha256)
        return url
    }

    private func download(_ track: StoryTrack, to target: URL) async throws -> URL {
        // 정규화가 이미 걸렀지만, 밖으로 나가는 주소는 받는 자리에서도 다시 본다.
        guard StoryRules.isSafeSource(track.src) else { throw StoryLibraryError.unavailable }
        var request = URLRequest(url: StoryRules.trackURL(track, base: base), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60)
        request.httpShouldHandleCookies = false
        let data: Data
        do {
            let (body, response) = try await session.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw StoryLibraryError.unavailable }
            data = body
        } catch let error as StoryLibraryError {
            throw error
        } catch {
            throw StoryLibraryError.unavailable
        }
        guard data.count == track.bytes, Self.sha256Hex(data) == track.sha256 else { throw StoryLibraryError.integrity }
        prepareDirectory()
        try? FileManager.default.createDirectory(at: audioDirectory, withIntermediateDirectories: true)
        // ⚠️ `.completeFileProtection`이면 잠긴 화면에서 다음 이야기를 열 수 없다 — 첫 잠금 해제 뒤로 둔다.
        do {
            try data.write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            throw StoryLibraryError.unavailable
        }
        return target
    }

    /// 지문(소문자 16진수) — 카탈로그의 `sha256`과 같은 모양.
    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// 다시 받을 수 있는 파일이라 iCloud 백업에 넣지 않는다(최대 십수 MB).
    private func prepareDirectory() {
        guard !FileManager.default.fileExists(atPath: directory.path) else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var folder = directory
        try? folder.setResourceValues(values)
    }

    private func scanSaved() -> Set<String> {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: audioDirectory.path)) ?? []
        return Set(names.filter { $0.hasSuffix(".mp3") }.map { String($0.dropLast(4)) })
    }

    private func prune(keeping wanted: Set<String>) {
        for sha in savedHashes where !wanted.contains(sha) && downloads[sha] == nil {
            try? FileManager.default.removeItem(at: audioFile(sha))
            savedHashes.remove(sha)
        }
    }
}
