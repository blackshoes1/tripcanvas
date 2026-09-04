import Foundation

/// 여행 문서를 **원문 그대로** 들고 다니기 위한 최소 JSON 트리.
///
/// 아는 필드만 담은 구조체로 디코딩해서 다시 인코딩하면, 모르는 필드가 조용히 사라진다.
/// 여행 문서에는 웹이 쓰고 앱이 아직 모르는 것들이 실제로 들어 있다(`who`·`split`·`reunion`·
/// `hours`·`flight`…). 그것들이 앱에서 한 번 저장할 때마다 지워지면 웹에서 만든 계획이 망가진다.
/// 그래서 문서는 트리로 들고, 아는 필드만 위에서 읽고 쓴다(`TripDocument`).
enum JSONValue: Codable, Hashable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null; return }
        // Bool을 Double보다 먼저 본다 — 순서가 바뀌면 true가 1로 굳는다.
        if let value = try? container.decode(Bool.self) { self = .bool(value); return }
        if let value = try? container.decode(Double.self) { self = .number(value); return }
        if let value = try? container.decode(String.self) { self = .string(value); return }
        if let value = try? container.decode([JSONValue].self) { self = .array(value); return }
        if let value = try? container.decode([String: JSONValue].self) { self = .object(value); return }
        throw DecodingError.dataCorruptedError(in: container, debugDescription: "알 수 없는 JSON 값")
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}

extension JSONValue {
    var stringValue: String? { if case .string(let value) = self { return value } else { return nil } }
    var doubleValue: Double? { if case .number(let value) = self { return value } else { return nil } }
    var boolValue: Bool? { if case .bool(let value) = self { return value } else { return nil } }
    var objectValue: [String: JSONValue]? { if case .object(let value) = self { return value } else { return nil } }
    var arrayValue: [JSONValue]? { if case .array(let value) = self { return value } else { return nil } }

    /// 정수로 쓰는 값(분·비용·연박). 서버·웹이 소수로 보내 와도 반올림해 받는다.
    var intValue: Int? {
        guard let value = doubleValue, value.isFinite else { return nil }
        return Int(value.rounded())
    }

    var isNull: Bool { if case .null = self { return true } else { return false } }

    subscript(key: String) -> JSONValue? {
        objectValue?[key]
    }

    static func number(_ value: Int) -> JSONValue { .number(Double(value)) }

    /// 사전을 JSON 데이터로. 저장 요청 본문을 만들 때 쓴다.
    static func data(from object: [String: JSONValue]) throws -> Data {
        try JSONEncoder().encode(JSONValue.object(object))
    }
}
