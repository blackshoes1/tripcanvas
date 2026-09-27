import Foundation

/// 입력 도중 앱이 닫혀도 남는 기기 초안. 계정·여행·편집 대상을 모두 구분하며 서버로 보내지 않는다.
struct EditorDraftKey: Hashable {
    let accountID: String
    let tripID: String
    let editor: String

    init?(accountID: String?, tripID: String, editor: String) {
        guard let accountID, !accountID.isEmpty else { return nil }
        self.accountID = accountID
        self.tripID = tripID
        self.editor = editor
    }
}
struct EditorDraftStore {
    static let shared = EditorDraftStore()
    let directory: URL

    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("WithJEditorDrafts", isDirectory: true)
    }

    private func url(_ key: EditorDraftKey) -> URL {
        let components = [key.accountID, key.tripID, key.editor].map { value in
            value.utf8.map { String(format: "%02x", $0) }.joined()
        }
        return components.reduce(directory) { $0.appendingPathComponent($1) }.appendingPathExtension("json")
    }

    func save<T: Encodable>(_ draft: T, key: EditorDraftKey?) {
        guard let key, let data = try? JSONEncoder().encode(draft) else { return }
        let target = url(key)
        try? FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func load<T: Decodable>(_ type: T.Type, key: EditorDraftKey?) -> T? {
        guard let key, let data = try? Data(contentsOf: url(key)) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
    func remove(_ key: EditorDraftKey?) {
        guard let key else { return }
        try? FileManager.default.removeItem(at: url(key))
    }
}

struct SpotInputDraft: Codable, Equatable {
    let original: [String: JSONValue]
    let edited: [String: JSONValue]
    let costText: String

    func canRestore(over spot: TripSpot) -> Bool { original == spot.raw }
}
struct SpendInputDraft: Codable, Equatable {
    let id: String
    let amount: String
    let title: String
    let kind: String
    let currency: String
    let photos: [String]
}
