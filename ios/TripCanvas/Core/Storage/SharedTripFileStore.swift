import Foundation

struct SharedTripFile: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let kind: String
    let placeKey: String
    let name: String
    let title: String
    let mime: String
    let size: Int
    let position: Int
    let createdAt: String
}
struct SharedTripFilesResponse: Codable {
    let files: [SharedTripFile]
    let canEdit: Bool
}

/// Downloads are private to one account and trip. Travel JSON contains neither bytes nor local URLs.
actor SharedTripFileStore {
    static let shared = SharedTripFileStore()
    private let directory: URL
    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("WithJSharedFiles", isDirectory: true)
    }
    private func folder(account: String, trip: String) -> URL {
        [account, trip].reduce(directory) { url, part in
            url.appendingPathComponent(part.utf8.map { String(format: "%02x", $0) }.joined(), isDirectory: true)
        }
    }
    private func fileURL(_ file: SharedTripFile, account: String, trip: String) throws -> URL {
        guard UUID(uuidString: file.id) != nil else { throw APIError.badRequest("파일 정보를 확인해 주세요.") }
        let ext = URL(fileURLWithPath: file.name).pathExtension.lowercased()
        guard ["mp3", "m4a", "wav", "ogg", "oga", "opus", "flac", "pdf", "jpg", "jpeg", "png", "webp", "txt"].contains(ext) else {
            throw APIError.badRequest("지원하지 않는 파일이에요.")
        }
        return folder(account: account, trip: trip).appendingPathComponent(file.id + "." + ext)
    }
    private func write(_ data: Data, to url: URL) throws {
        var folder = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try folder.setResourceValues(values)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func saveList(_ files: [SharedTripFile], account: String, trip: String) throws {
        try write(JSONEncoder().encode(files), to: folder(account: account, trip: trip).appendingPathComponent("index.json"))
    }
    func list(account: String, trip: String) throws -> [SharedTripFile] {
        let url = folder(account: account, trip: trip).appendingPathComponent("index.json")
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        return try JSONDecoder().decode([SharedTripFile].self, from: Data(contentsOf: url))
    }
    func localURL(_ file: SharedTripFile, account: String, trip: String) throws -> URL? {
        let url = try fileURL(file, account: account, trip: trip)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize
        return size == file.size ? url : nil
    }
    func save(_ data: Data, file: SharedTripFile, account: String, trip: String) throws -> URL {
        guard data.count == file.size, data.count > 0, data.count <= 25 * 1024 * 1024 else {
            throw APIError.badRequest("파일을 끝까지 내려받지 못했어요. 다시 시도해 주세요.")
        }
        let url = try fileURL(file, account: account, trip: trip)
        try write(data, to: url); return url
    }
    func remove(_ file: SharedTripFile, account: String, trip: String) throws {
        let url = try fileURL(file, account: account, trip: trip)
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }
}
