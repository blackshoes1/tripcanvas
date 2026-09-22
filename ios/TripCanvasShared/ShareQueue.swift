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

    /// JS `String.prototype.trim()`이 벗기는 것과 **같은 집합**.
    ///
    /// ⚠️ Foundation의 `.whitespacesAndNewlines`로는 안 된다 — U+FEFF(BOM)를 **남기고**
    /// U+0085(NEL)를 **벗겨** JS와 갈린다. 윈도우에서 복사한 글은 BOM으로 시작하는 일이 흔하다.
    private static let jsWhitespace: CharacterSet = {
        var set = CharacterSet(charactersIn: "\u{0009}\u{000A}\u{000B}\u{000C}\u{000D}\u{0020}")
        set.insert(charactersIn: "\u{00A0}\u{1680}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}")
        set.insert(charactersIn: Unicode.Scalar(0x2000)!...Unicode.Scalar(0x200A)!)
        return set
    }()

    /// 서버의 `shareIdempotencyKey`와 **같은 규칙**이어야 한다(`intake.js`).
    /// 여기서 다르게 만들면 같은 공유가 두 번 처리된다.
    ///
    /// ⚠️ 세는 단위는 처음부터 끝까지 **UTF-16 코드 단위**다 — JS의 `charCodeAt`과 `slice(0,500)`이
    /// 그렇게 센다. 2026-09-21 전에는 본문을 `prefix(500)`(**문자** = grapheme 묶음)으로 잘라,
    /// 이모지가 섞인 500자 넘는 글에서 앱과 서버가 **다른 키**를 만들었다. 붙여넣는 일정 글에는
    /// 이모지가 흔하다(§`stripDecor`). 잘린 자리가 서로게이트 쌍 가운데여도 JS와 같아야 하므로
    /// 문자열로 되돌리지 않고 코드 단위를 그대로 해시한다(되돌리면 U+FFFD로 바뀐다).
    static func makeId(url: String?, title: String?, text: String?) -> String {
        func trimmed(_ value: String?) -> String {
            (value ?? "").trimmingCharacters(in: jsWhitespace)
        }
        var units: [UInt16] = []
        units.append(contentsOf: trimmed(url).utf16)
        units.append(contentsOf: "|".utf16)
        units.append(contentsOf: trimmed(title).utf16)
        units.append(contentsOf: "|".utf16)
        units.append(contentsOf: trimmed(text).utf16.prefix(500))
        var hash: UInt32 = 5381
        for unit in units {
            hash = ((hash &* 33) ^ UInt32(unit)) & 0xFFFF_FFFF
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
