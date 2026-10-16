import Foundation
import AVFoundation

/// 음성 원본·연결은 기기 안에만 둔다. 여행 원문이나 API에는 파일 경로를 기록하지 않는다.
enum AudioGuidePlace {
    static func canIdentify(_ spot: TripSpot) -> Bool {
        let trim: (String) -> String = { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        if let id = spot.placeId, !trim(id).isEmpty { return true }
        if let id = spot.kakaoId, !trim(id).isEmpty { return true }
        if let point = spot.point, point.lat.isFinite, point.lng.isFinite,
           (-90...90).contains(point.lat), (-180...180).contains(point.lng) { return true }
        return !trim(spot.name).isEmpty
    }

    static func key(_ spot: TripSpot) -> String {
        func clean(_ value: String) -> String { value.trimmingCharacters(in: .whitespacesAndNewlines) }
        let parts: [String]
        if let id = spot.placeId.map(clean), !id.isEmpty { parts = ["google", id] }
        else if let id = spot.kakaoId.map(clean), !id.isEmpty { parts = ["kakao", id] }
        else if let point = spot.point, point.lat.isFinite, point.lng.isFinite,
                (-90...90).contains(point.lat), (-180...180).contains(point.lng) {
            let locale = Locale(identifier: "en_US_POSIX")
            parts = ["point", String(format: "%.6f", locale: locale, point.lat), String(format: "%.6f", locale: locale, point.lng)]
        } else { parts = ["name", clean(spot.city).lowercased(), clean(spot.name).lowercased()] }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        // 문자열 배열은 JSON으로 항상 표현할 수 있다.
        return String(decoding: try! encoder.encode(parts), as: UTF8.self)
    }

    /// 화면의 인덱스는 같은 revision에서만 쓴다. 원격 정렬 후 다른 장소에 연결하지 않는다.
    static func resolve(document: TripDocument, documentRevision: Int, activityID: String,
                        expectedName: String, expectedRevision: Int) throws -> TripSpot {
        guard documentRevision == expectedRevision else { throw StaffShowSelection.Failure.changed }
        guard activityID.hasPrefix("d"), let marker = activityID.firstIndex(of: "s") else { throw StaffShowSelection.Failure.unavailable }
        let dayText = String(activityID[activityID.index(after: activityID.startIndex)..<marker])
        let spotText = String(activityID[activityID.index(after: marker)...])
        let digits: (String) -> Bool = { !$0.isEmpty && $0.utf8.allSatisfy { (48...57).contains($0) } }
        guard digits(dayText), digits(spotText), let day = Int(dayText), let index = Int(spotText),
              document.hasDay(day), document.days[day].spots.indices.contains(index) else { throw StaffShowSelection.Failure.unavailable }
        let spot = document.days[day].spots[index]
        guard spot.name == expectedName else { throw StaffShowSelection.Failure.changed }
        guard spot.choice?.state != .pending else { throw StaffShowSelection.Failure.unavailable }
        return spot
    }
}

struct LocalAudioGuide: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let placeKey: String
    let title: String
    let fileName: String
    let bytes: Int
    let duration: Double
    let createdAt: Date
}

struct AudioGuideScope: Hashable, Sendable {
    let accountID: String
    let tripID: String
}

actor AudioGuideStore {
    static let shared = AudioGuideStore()
    static let maxBytes = 100 * 1024 * 1024
    static let extensions: Set<String> = ["mp3", "m4a", "aac", "wav", "aif", "aiff", "caf", "flac", "ogg", "opus"]
    let directory: URL

    enum Failure: LocalizedError {
        case invalidFile, tooLarge, unplayable, missingFile, invalidIndex
        var errorDescription: String? {
            switch self {
            case .invalidFile: "음성 파일을 골라 주세요. MP3·M4A·WAV 등을 사용할 수 있어요."
            case .tooLarge: "음성 파일은 하나에 100MB까지 담을 수 있어요."
            case .unplayable: "이 기기에서 재생할 수 없는 음성이에요. MP3나 M4A로 변환한 뒤 다시 골라 주세요."
            case .missingFile: "저장한 음성 파일을 찾지 못했어요. 파일을 다시 추가해 주세요."
            case .invalidIndex: "저장한 음성 목록을 읽지 못했어요. 앱을 다시 연 뒤 확인해 주세요."
            }
        }
    }

    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("WithJAudioGuides", isDirectory: true)
    }

    private func folder(_ scope: AudioGuideScope) -> URL {
        [scope.accountID, scope.tripID].reduce(directory) { url, part in
            url.appendingPathComponent(part.utf8.map { String(format: "%02x", $0) }.joined(), isDirectory: true)
        }
    }
    private func records(_ scope: AudioGuideScope) throws -> [LocalAudioGuide] {
        let url = folder(scope).appendingPathComponent("index.json")
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        do { return try JSONDecoder().decode([LocalAudioGuide].self, from: Data(contentsOf: url)) }
        catch { throw Failure.invalidIndex }
    }
    private func save(_ records: [LocalAudioGuide], scope: AudioGuideScope) throws {
        let folder = folder(scope)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try JSONEncoder().encode(records).write(to: folder.appendingPathComponent("index.json"),
                                               options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func list(scope: AudioGuideScope, placeKey: String) throws -> [LocalAudioGuide] {
        try records(scope).filter { $0.placeKey == placeKey }.sorted { $0.createdAt < $1.createdAt }
    }

    /// security scope는 복사와 검증이 끝날 때까지 유지한다. 원본을 옮기거나 수정하지 않는다.
    func add(url: URL, scope: AudioGuideScope, placeKey: String) async throws -> LocalAudioGuide {
        guard !placeKey.isEmpty else { throw Failure.invalidFile }
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        let ext = url.pathExtension.lowercased()
        guard url.isFileURL, Self.extensions.contains(ext) else { throw Failure.invalidFile }
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        guard values.isRegularFile == true, let size = values.fileSize, size > 0 else { throw Failure.invalidFile }
        guard size <= Self.maxBytes else { throw Failure.tooLarge }
        let id = UUID(), fileName = "\(UUID().uuidString).\(ext)"
        let target = folder(scope).appendingPathComponent(fileName)
        try FileManager.default.createDirectory(at: folder(scope), withIntermediateDirectories: true)
        do {
            try FileManager.default.copyItem(at: url, to: target)
            let copied = try target.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard copied > 0 else { throw Failure.invalidFile }
            guard copied <= Self.maxBytes else { throw Failure.tooLarge }
            // 원본은 파일 제공자가 바꿀 수 있으므로 실제 보관할 복사본을 검증한다.
            let asset = AVURLAsset(url: target)
            guard try await asset.load(.isPlayable), !(try await asset.loadTracks(withMediaType: .audio)).isEmpty else {
                throw Failure.unplayable
            }
            let assetDuration = try await asset.load(.duration)
            let duration = assetDuration.seconds
            guard duration.isFinite, duration > 0 else { throw Failure.unplayable }
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: target.path)
            let guide = LocalAudioGuide(id: id, placeKey: placeKey, title: url.lastPathComponent,
                                       fileName: fileName, bytes: copied, duration: duration, createdAt: Date())
            // asset의 await 동안 다른 가져오기가 끝났을 수 있다. 최신 목록에 추가한다.
            var all = try records(scope)
            all.append(guide)
            try save(all, scope: scope)
            return guide
        } catch {
            try? FileManager.default.removeItem(at: target)
            throw error
        }
    }

    func fileURL(id: UUID, scope: AudioGuideScope) throws -> URL {
        guard let guide = try records(scope).first(where: { $0.id == id }),
              guide.fileName == URL(fileURLWithPath: guide.fileName).lastPathComponent,
              Self.extensions.contains(URL(fileURLWithPath: guide.fileName).pathExtension.lowercased()) else { throw Failure.missingFile }
        let url = folder(scope).appendingPathComponent(guide.fileName)
        guard FileManager.default.fileExists(atPath: url.path) else { throw Failure.missingFile }
        return url
    }
    func remove(id: UUID, scope: AudioGuideScope) throws {
        var all = try records(scope)
        guard let guide = all.first(where: { $0.id == id }) else { return }
        let file = try? fileURL(id: id, scope: scope)
        all.removeAll { $0.id == guide.id }
        try save(all, scope: scope)
        if let file { try? FileManager.default.removeItem(at: file) }
    }
}
