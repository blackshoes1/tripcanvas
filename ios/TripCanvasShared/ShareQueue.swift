import Foundation

/// Share Extension이 받은 원본. **먼저 그대로 저장하고** 해석은 나중에 한다(§12·§55).
/// 확장은 네트워크가 없을 수도 있고 수명이 짧다 — 여기서 파싱하려 들면 유실된다.
struct SharedTravelInput: Codable, Hashable, Sendable, Identifiable {
    enum SourceType: String, Codable, Sendable {
        case url, text, mixed, file, unknown
    }
    enum State: String, Codable, Sendable {
        case pending = "PENDING", processing = "PROCESSING", parsed = "PARSED"
        case needsReview = "NEEDS_REVIEW", failed = "FAILED", saved = "SAVED", discarded = "DISCARDED"
    }

    /// 내용으로 만든 키 — 같은 것을 두 번 공유해도 한 번만 처리된다(§57).
    let id: String
    let sourceType: SourceType
    let url: String?
    let text: String?
    let title: String?
    let receivedAt: Date
    var state: State
    var failureCount: Int
    var lastError: String?

    init(id: String, sourceType: SourceType, url: String?, text: String?, title: String?,
                receivedAt: Date = Date(), state: State = .pending, failureCount: Int = 0, lastError: String? = nil) {
        self.id = id
        self.sourceType = sourceType
        self.url = url
        self.text = text
        self.title = title
        self.receivedAt = receivedAt
        self.state = state
        self.failureCount = failureCount
        self.lastError = lastError
    }

    /// 서버의 shareIdempotencyKey와 **같은 규칙**이어야 한다(intake.js).
    /// 여기서 다르게 만들면 같은 공유가 두 번 처리된다.
    static func makeId(url: String?, title: String?, text: String?) -> String {
        let raw = [
            (url ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
            (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
            String((text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(500))
        ].joined(separator: "|")
        var hash: UInt32 = 5381
        for scalar in raw.unicodeScalars {
            // JS는 charCodeAt(UTF-16 단위)로 센다 — 같은 값을 만들려면 UTF-16으로 순회해야 한다.
            for unit in String(scalar).utf16 {
                hash = ((hash &* 33) ^ UInt32(unit)) & 0xFFFF_FFFF
            }
        }
        return "sh" + String(hash, radix: 36)
    }
}

/// 공유 대기열. 앱과 Share Extension이 App Group으로 함께 본다.
///
/// 확장은 **쓰기만** 하고, 파싱·저장은 앱이 켜졌을 때 한다. 네트워크가 없어도 원본은 남는다.
enum ShareQueue {
    private static let key = "share.queue.v1"
    private static let limit = 50

    private static var defaults: UserDefaults? { UserDefaults(suiteName: SharedStore.appGroupId) }
    private static let encoder: JSONEncoder = {
        let e = JSONEncoder(); e.dateEncodingStrategy = .iso8601; return e
    }()
    private static let decoder: JSONDecoder = {
        let d = JSONDecoder(); d.dateDecodingStrategy = .iso8601; return d
    }()

    static func load() -> [SharedTravelInput] {
        guard let data = defaults?.data(forKey: key) else { return [] }
        return (try? decoder.decode([SharedTravelInput].self, from: data)) ?? []
    }

    private static func save(_ items: [SharedTravelInput]) {
        let trimmed = items.suffix(limit)
        guard let data = try? encoder.encode(Array(trimmed)) else { return }
        defaults?.set(data, forKey: key)
    }

    /// 같은 공유는 다시 넣지 않는다. 이미 처리가 끝난 것도 되살리지 않는다.
    @discardableResult
    static func enqueue(_ input: SharedTravelInput) -> Bool {
        var items = load()
        if items.contains(where: { $0.id == input.id }) { return false }
        items.append(input)
        save(items)
        return true
    }

    static func update(id: String, transform: (inout SharedTravelInput) -> Void) {
        var items = load()
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        transform(&items[index])
        save(items)
    }

    static func remove(id: String) {
        save(load().filter { $0.id != id })
    }

    /// 아직 손대지 않았거나 실패해서 다시 시도할 것들.
    static func pending() -> [SharedTravelInput] {
        load().filter { $0.state == .pending || $0.state == .failed || $0.state == .needsReview }
    }

    static func clear() { defaults?.removeObject(forKey: key) }
}
