import Foundation

// With J 이야기 — 웹 `stories.js`의 **복사본**이다(카탈로그 정규화 · 장소 매칭 · 표기).
//
// ⚠️ 규칙을 바꾸려면 `stories.js`를 먼저 고친다. `next`의 `storyRulesParity.test.ts`가 원본으로
//    `story-rules.json` 픽스처를 다시 쓰고 `StoryRulesParityTests`가 여기와 대조한다 — 복사본은 조용히 갈라진다.
// ⚠️ 이름만으로 붙이지 않는다 — '스페인 광장'은 마드리드에도, '알카사르'는 세고비아·코르도바에도 있다.
//    Google placeId가 같거나, 좌표가 반경 안이면서 이름이 맞을 때만이다(docs/with-j-stories.md).
// 콘텐츠는 정적 파일(웹의 `stories/catalog.json`+mp3)이고 여행 문서·API·DB와 무관하다 — NAS가 꺼져도 들린다.

enum StoryRole: String, CaseIterable, Sendable {
    case core = "CORE"
    case more = "MORE"
    case stop = "STOP"

    /// 웹 `ROLE_LABEL`과 글자까지 같다.
    var label: String {
        switch self {
        case .core: "핵심"
        case .more: "더 듣기"
        case .stop: "관람 지점"
        }
    }
}

struct StoryStop: Equatable, Sendable {
    let n: Int
    let find: [String]
    let localName: String
}

struct StoryTrack: Identifiable, Equatable, Sendable {
    let id: String
    let role: StoryRole
    let title: String
    /// `stories/` 아래 상대 경로(`seville/x.mp3`). 밖으로 나가는 주소는 정규화가 받지 않는다.
    let src: String
    let seconds: Int
    let bytes: Int
    /// 받은 파일을 담기 전에 대조하는 지문(소문자 16진수 64자). 기기에 담는 이름도 이것이다.
    let sha256: String
    let sources: [String]
    let stop: StoryStop?
}

enum StoryKind: String, Sendable {
    case place = "PLACE"
    case city = "CITY"
}

struct StoryPlace: Identifiable, Equatable, Sendable {
    let id: String
    let kind: StoryKind
    let name: String
    let localName: String
    let city: String
    let lat: Double
    let lng: Double
    let radiusM: Double
    let placeIds: [String]
    let aliases: [String]
    let tracks: [StoryTrack]

    var totalSeconds: Int { tracks.reduce(0) { $0 + $1.seconds } }
    var totalBytes: Int { tracks.reduce(0) { $0 + $1.bytes } }
}

struct StorySource: Equatable, Sendable {
    let id: String
    let title: String
    let url: String
}

/// 매칭에 쓰는 장소의 세 값. 문서 장소(`TripSpot`)와 '지금'의 `ActivitySummary`가 같은 모양으로 넘긴다.
/// ⚠️ 일정 계산 결과(`DayPlanSpot`)와 `NextAction`에는 placeId가 없다 — 그걸로 만들지 않는다.
struct StorySpot: Equatable, Sendable {
    var name: String
    var point: GeoPoint?
    var placeId: String?
}

extension StorySpot {
    init(_ spot: TripSpot) { self.init(name: spot.name, point: spot.point, placeId: spot.placeId) }
    init(_ activity: ActivitySummary) { self.init(name: activity.name, point: activity.location, placeId: activity.placeId) }
}

/// 받은 카탈로그를 믿을 수 있는 모양으로 거른 것 — 웹 `normalizeCatalog`.
struct StoryCatalog: Equatable, Sendable {
    let version: Int
    let updated: String
    let disclosure: String
    let places: [StoryPlace]
    let sources: [String: StorySource]

    static let empty = StoryCatalog(version: 0, updated: "", disclosure: StoryRules.disclosure, places: [], sources: [:])

    init(version: Int, updated: String, disclosure: String, places: [StoryPlace], sources: [String: StorySource]) {
        self.version = version
        self.updated = updated
        self.disclosure = disclosure
        self.places = places
        self.sources = sources
    }

    /// 모르는 값은 버리고, 같은 id는 앞의 것만.
    init(raw: JSONValue?) {
        let object = raw?.objectValue ?? [:]
        var ids = Set<String>()
        var places: [StoryPlace] = []
        for item in object["places"]?.arrayValue ?? [] {
            guard let place = StoryRules.normalizePlace(item), !ids.contains(place.id) else { continue }
            ids.insert(place.id)
            places.append(place)
        }
        var sources: [String: StorySource] = [:]
        for (key, value) in object["sources"]?.objectValue ?? [:] {
            guard let source = value.objectValue else { continue }
            let url = StoryRules.str(source["url"]), title = StoryRules.str(source["title"])
            if !title.isEmpty, StoryRules.isHTTPSURL(url) { sources[key] = StorySource(id: key, title: title, url: url) }
        }
        let voice = object["voice"]?.objectValue ?? [:]
        let disclosure = StoryRules.str(voice["disclosure"])
        let version = StoryRules.num(object["version"]) ?? 0
        self.init(version: abs(version) < 1e9 ? Int(version) : 0, updated: StoryRules.str(object["updated"]),
                  disclosure: disclosure.isEmpty ? StoryRules.disclosure : disclosure, places: places, sources: sources)
    }

    func place(id: String) -> StoryPlace? { places.first { $0.id == id } }

    /// 일정의 장소에 붙는 이야기 — 없으면 nil(웹 `storyForSpot`).
    /// 1) Google placeId가 같으면 그 장소 2) 좌표가 반경 안이면서 이름이 맞으면 그 장소(가장 가까운 것).
    /// 좌표 없는 장소·이름만 같은 장소에는 붙이지 않는다.
    func story(for spot: StorySpot) -> StoryPlace? {
        let candidates = places.filter { $0.kind == .place }
        let pid = (spot.placeId ?? "").trimmingCharacters(in: StoryRules.jsWhitespace)
        if !pid.isEmpty, let hit = candidates.first(where: { $0.placeIds.contains(pid) }) { return hit }
        guard let point = StoryRules.usablePoint(spot.point) else { return nil }
        var best: StoryPlace?
        var bestDistance = Double.infinity
        for place in candidates {
            let distance = StoryRules.distanceM(point.lat, point.lng, place.lat, place.lng)
            if distance <= place.radiusM, distance < bestDistance, StoryRules.nameMatches(spot.name, place) {
                best = place
                bestDistance = distance
            }
        }
        return best
    }

    /// 날에 붙는 도시 이야기 — 그날 위치 있는 장소 중 하나라도 도시 반경 안이면 그 도시(웹 `cityStoryForDay`).
    func cityStory(for points: [GeoPoint?]) -> StoryPlace? {
        let cities = places.filter { $0.kind == .city }
        guard !cities.isEmpty else { return nil }
        for raw in points {
            guard let point = StoryRules.usablePoint(raw) else { continue }
            if let hit = cities.first(where: { StoryRules.distanceM(point.lat, point.lng, $0.lat, $0.lng) <= $0.radiusM }) {
                return hit
            }
        }
        return nil
    }

    /// 트랙이 기댄 출처 — 카탈로그에 있는 것만, 처음 나온 순서대로(웹 `placeSources`).
    func sources(of place: StoryPlace) -> [StorySource] {
        var seen = Set<String>()
        var out: [StorySource] = []
        for id in place.tracks.flatMap(\.sources) where !seen.contains(id) {
            seen.insert(id)
            if let source = sources[id] { out.append(source) }
        }
        return out
    }
}

enum StoryRules {
    static let disclosure = "AI 음성으로 읽었어요"
    static let maxRadiusM: Double = 50_000
    static let minAliasLength = 3

    /// JS `String.prototype.trim()`과 `\s`가 보는 **같은 집합**(`ShareQueue.jsWhitespace`와 같다).
    /// Foundation의 `.whitespacesAndNewlines`는 U+FEFF를 남기고 U+0085를 벗겨 JS와 갈린다.
    static let jsWhitespace: CharacterSet = {
        var set = CharacterSet(charactersIn: "\u{0009}\u{000A}\u{000B}\u{000C}\u{000D}\u{0020}")
        set.insert(charactersIn: "\u{00A0}\u{1680}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}")
        set.insert(charactersIn: Unicode.Scalar(0x2000)!...Unicode.Scalar(0x200A)!)
        return set
    }()

    static func str(_ value: JSONValue?) -> String {
        value?.stringValue?.trimmingCharacters(in: jsWhitespace) ?? ""
    }

    static func num(_ value: JSONValue?) -> Double? {
        guard let number = value?.doubleValue, number.isFinite else { return nil }
        return number
    }

    static func strs(_ value: JSONValue?) -> [String] {
        (value?.arrayValue ?? []).map { str($0) }.filter { !$0.isEmpty }
    }

    /// `^https://[^\s]+$` — 공백 없는 https 주소만.
    static func isHTTPSURL(_ url: String) -> Bool {
        guard url.hasPrefix("https://"), url.unicodeScalars.count > "https://".unicodeScalars.count else { return false }
        return !url.unicodeScalars.contains { jsWhitespace.contains($0) }
    }

    /// `stories/` 아래 상대 경로의 mp3만 — `^[a-z0-9][a-z0-9-]*(/[a-z0-9][a-z0-9-]*)*\.mp3$`이고 `..`이 없다.
    static func isSafeSource(_ src: String) -> Bool {
        guard src.hasSuffix(".mp3"), !src.contains("..") else { return false }
        let body = src.dropLast(4)
        let segments = body.split(separator: "/", omittingEmptySubsequences: false)
        guard !segments.isEmpty else { return false }
        for segment in segments {
            let scalars = Array(segment.unicodeScalars)
            guard let first = scalars.first, isLowerAlnum(first) else { return false }
            if scalars.contains(where: { !isLowerAlnum($0) && $0 != "-" }) { return false }
        }
        return true
    }

    private static func isLowerAlnum(_ scalar: Unicode.Scalar) -> Bool {
        ("a"..."z").contains(scalar) || ("0"..."9").contains(scalar)
    }

    private static func isSHA256Hex(_ value: String) -> Bool {
        value.unicodeScalars.count == 64 && value.unicodeScalars.allSatisfy { isLowerAlnum($0) && !("g"..."z").contains($0) }
    }

    /// 트랙 하나 — 검수(reviewedAt)를 거치지 않았거나 파일이 없는 트랙은 내보내지 않는다(웹 `normalizeTrack`).
    static func normalizeTrack(_ raw: JSONValue) -> StoryTrack? {
        guard let object = raw.objectValue else { return nil }
        let id = str(object["id"]), roleText = str(object["role"]), title = str(object["title"]), src = str(object["src"])
        guard !id.isEmpty, !title.isEmpty, let role = StoryRole(rawValue: roleText), isSafeSource(src) else { return nil }
        guard !str(object["reviewedAt"]).isEmpty else { return nil }
        guard let seconds = num(object["seconds"]), seconds > 0, let bytes = num(object["bytes"]), bytes > 0 else { return nil }
        // Swift만의 울타리 — 터무니없이 큰 수를 Int로 바꾸면 앱이 죽는다(JS는 그냥 큰 수로 둔다).
        guard seconds < 1e9, bytes < 1e15 else { return nil }
        let sha = str(object["sha256"]).lowercased()
        guard isSHA256Hex(sha) else { return nil }
        var stop: StoryStop?
        if role == .stop {
            let s = object["stop"]?.objectValue ?? [:]
            guard let n = num(s["n"]), n >= 1, n == n.rounded(.towardZero), n <= Double(Int.max / 2) else { return nil }
            stop = StoryStop(n: Int(n), find: Array(strs(s["find"]).prefix(5)), localName: str(s["localName"]))
        }
        return StoryTrack(id: id, role: role, title: title, src: src,
                          seconds: Int(seconds.rounded(.toNearestOrAwayFromZero)), bytes: Int(bytes.rounded(.toNearestOrAwayFromZero)),
                          sha256: sha, sources: strs(object["sources"]), stop: stop)
    }

    /// 장소 하나. 위치·반경이 없거나 들을 트랙이 하나도 없으면 버린다(웹 `normalizePlace`).
    static func normalizePlace(_ raw: JSONValue) -> StoryPlace? {
        guard let object = raw.objectValue else { return nil }
        let id = str(object["id"]), name = str(object["name"])
        guard !id.isEmpty, !name.isEmpty, let kind = StoryKind(rawValue: str(object["kind"])) else { return nil }
        guard let lat = num(object["lat"]), let lng = num(object["lng"]), abs(lat) <= 90, abs(lng) <= 180 else { return nil }
        guard let radius = num(object["radiusM"]), radius > 0, radius <= maxRadiusM else { return nil }
        var seen = Set<String>()
        var tracks: [StoryTrack] = []
        for item in object["tracks"]?.arrayValue ?? [] {
            guard let track = normalizeTrack(item), !seen.contains(track.id) else { continue }
            seen.insert(track.id)
            tracks.append(track)
        }
        guard !tracks.isEmpty else { return nil }
        // 핵심 → 더 듣기 → 관람 지점(번호 순). ⚠️ 웹의 sort는 안정 정렬이다 — 같은 자리끼리는 원래 순서를 지킨다.
        let roles = StoryRole.allCases
        let ordered = tracks.enumerated().sorted { a, b in
            let ra = roles.firstIndex(of: a.element.role) ?? 0, rb = roles.firstIndex(of: b.element.role) ?? 0
            if ra != rb { return ra < rb }
            let na = a.element.stop?.n ?? 0, nb = b.element.stop?.n ?? 0
            if na != nb { return na < nb }
            return a.offset < b.offset
        }.map(\.element)
        return StoryPlace(id: id, kind: kind, name: name, localName: str(object["localName"]), city: str(object["city"]),
                          lat: lat, lng: lng, radiusM: radius, placeIds: strs(object["placeIds"]), aliases: strs(object["aliases"]),
                          tracks: ordered)
    }

    /// 미터 — 하버사인(웹 `distanceM`과 같은 식).
    static func distanceM(_ lat1: Double, _ lng1: Double, _ lat2: Double, _ lng2: Double) -> Double {
        let r = 6_371_000.0, rad = Double.pi / 180
        let dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad
        let s1 = sin(dLat / 2), s2 = sin(dLng / 2)
        let a = s1 * s1 + cos(lat1 * rad) * cos(lat2 * rad) * s2 * s2
        return 2 * r * asin(min(1, a.squareRoot()))
    }

    /// 매칭에 쓸 수 있는 좌표 — 범위 밖이거나 (0,0)이면 없는 것으로 친다(웹 `coordOf`).
    static func usablePoint(_ point: GeoPoint?) -> GeoPoint? {
        guard let point, point.lat.isFinite, point.lng.isFinite, abs(point.lat) <= 90, abs(point.lng) <= 180 else { return nil }
        if point.lat == 0 && point.lng == 0 { return nil }
        return point
    }

    /// 이름 비교용 열쇠 — 대소문자·악센트·공백·문장부호를 뗀다('Alcázar de Sevilla' → 'alcazardesevilla').
    /// ⚠️ NFKD는 한글도 자모로 쪼갠다 — 악센트만 뗀 뒤 NFC로 다시 붙여야 '광장'이 두 글자로 남는다.
    static func nameKey(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: jsWhitespace)
        let decomposed = trimmed.decomposedStringWithCompatibilityMapping
        var stripped = String.UnicodeScalarView()
        stripped.append(contentsOf: decomposed.unicodeScalars.filter { !(0x300...0x36F).contains($0.value) })
        let lowered = String(stripped).precomposedStringWithCanonicalMapping.lowercased()
        var kept = String.UnicodeScalarView()
        kept.append(contentsOf: lowered.unicodeScalars.filter(isLetterOrNumber))
        return String(kept)
    }

    /// JS 정규식의 `\p{L}`·`\p{N}`.
    private static func isLetterOrNumber(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber:
            return true
        default:
            return false
        }
    }

    /// 장소 이름이 이야기의 이름 중 하나를 담고 있는가(또는 그 반대). 세 글자 미만의 이름으로는 맞추지 않는다.
    /// ⚠️ 길이와 '담고 있는가'는 **UTF-16 코드 단위**로 본다 — JS의 `length`·`includes`가 그렇게 센다.
    static func nameMatches(_ spotName: String, _ place: StoryPlace) -> Bool {
        let n = Array(nameKey(spotName).utf16)
        guard n.count >= 2 else { return false }
        return ([place.name, place.localName] + place.aliases).map { Array(nameKey($0).utf16) }.contains { a in
            a.count >= minAliasLength && (n == a || contains(n, a) || (n.count >= minAliasLength && contains(a, n)))
        }
    }

    private static func contains(_ haystack: [UInt16], _ needle: [UInt16]) -> Bool {
        guard !needle.isEmpty else { return true }
        guard haystack.count >= needle.count else { return false }
        for start in 0...(haystack.count - needle.count) where haystack[start] == needle[0] {
            if Array(haystack[start..<(start + needle.count)]) == needle { return true }
        }
        return false
    }

    /// '1분 45초' · '45초' · '1시간 2분'(웹 `durationText`).
    static func durationText(_ seconds: Int) -> String {
        let s = max(0, seconds), h = s / 3600, m = s % 3600 / 60, r = s % 60
        if h > 0 { return m > 0 ? "\(h)시간 \(m)분" : "\(h)시간" }
        if m > 0 { return r > 0 ? "\(m)분 \(r)초" : "\(m)분" }
        return "\(r)초"
    }

    /// '1.4MB' · '820KB'(웹 `sizeText`). ⚠️ `String(format: "%.1f")`는 딱 반인 값을 짝수 쪽으로 내려
    /// JS `toFixed(1)`과 갈린다(1.25MB → 1.2 vs 1.3) — 열 배 해서 반올림한다.
    static func sizeText(_ bytes: Int) -> String {
        let value = Double(bytes)
        if value >= 1024 * 1024 {
            let tenths = Int((value / 1024 / 1024 * 10).rounded(.toNearestOrAwayFromZero))
            return "\(tenths / 10).\(tenths % 10)MB"
        }
        return "\(max(1, Int((value / 1024).rounded(.toNearestOrAwayFromZero))))KB"
    }

    /// 트랙 파일의 주소 — 웹 주소 기준 `stories/<src>`(웹 `trackUrl`).
    static func trackURL(_ track: StoryTrack, base: URL) -> URL {
        base.appending(path: "stories/" + track.src)
    }

    static func catalogURL(base: URL) -> URL {
        base.appending(path: "stories/catalog.json")
    }
}
