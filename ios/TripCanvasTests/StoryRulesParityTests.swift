import XCTest
@testable import TripCanvas

// With J 이야기 규칙의 복사본(`StoryRules.swift`)이 웹 원본(`stories.js`)과 같은 답을 내는지.
//
// 픽스처는 `next`의 `storyRulesParity.test.ts`가 원본으로 만든다. 원본을 바꾸면 그 테스트가 파일을 새로 쓰고
// 여기가 깨진다 — 그게 목적이다. 이야기는 서버를 거치지 않고 앱이 카탈로그를 직접 받아 붙이는 예외라
// (정적 콘텐츠라 NAS가 꺼져도 들린다) 복사본이 생겼다.
final class StoryRulesParityTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Stop: Decodable { let n: Int; let find: [String]; let localName: String }
        struct Track: Decodable {
            let id: String
            let role: String
            let title: String
            let src: String
            let seconds: Int
            let bytes: Int
            let sha256: String
            let sources: [String]
            let stop: Stop?
        }
        struct Place: Decodable {
            let id: String
            let kind: String
            let name: String
            let localName: String
            let city: String
            let lat: Double
            let lng: Double
            let radiusM: Double
            let placeIds: [String]
            let aliases: [String]
            let tracks: [Track]
        }
        struct Source: Decodable { let title: String; let url: String }
        struct Normalized: Decodable {
            let disclosure: String
            let places: [Place]
            let sources: [String: Source]
        }
        struct NameKey: Decodable { let input: String; let key: String }
        struct SpotInput: Decodable { let name: String; let lat: Double?; let lng: Double?; let placeId: String? }
        struct Match: Decodable { let name: String; let spot: SpotInput; let story: String? }
        struct Point: Decodable { let lat: Double; let lng: Double }
        struct CityDay: Decodable { let name: String; let points: [Point?]; let story: String? }
        struct Duration: Decodable { let seconds: Int; let text: String }
        struct Size: Decodable { let bytes: Int; let text: String }
        struct PlaceSources: Decodable { let place: String; let ids: [String] }

        let catalog: JSONValue
        let normalized: Normalized
        let nameKeys: [NameKey]
        let matches: [Match]
        let cities: [CityDay]
        let durations: [Duration]
        let sizes: [Size]
        let placeSources: [PlaceSources]
    }

    private func load() throws -> Fixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "story-rules", withExtension: "json"),
                                "story-rules.json 픽스처를 테스트 번들에 포함시켜야 합니다")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    /// 버릴 것은 버리고(검수 안 됨·위험한 경로·지문 이상·같은 id…), 남은 것은 같은 순서·같은 값이다.
    func testNormalizationKeepsWhatTheWebKeeps() throws {
        let fixture = try load()
        let catalog = StoryCatalog(raw: fixture.catalog)
        XCTAssertEqual(catalog.disclosure, fixture.normalized.disclosure)
        XCTAssertEqual(catalog.places.map(\.id), fixture.normalized.places.map(\.id))
        for (place, expected) in zip(catalog.places, fixture.normalized.places) {
            XCTAssertEqual(place.kind.rawValue, expected.kind, place.id)
            XCTAssertEqual(place.name, expected.name, place.id)
            XCTAssertEqual(place.localName, expected.localName, place.id)
            XCTAssertEqual(place.city, expected.city, place.id)
            XCTAssertEqual(place.lat, expected.lat, accuracy: 1e-9, place.id)
            XCTAssertEqual(place.lng, expected.lng, accuracy: 1e-9, place.id)
            XCTAssertEqual(place.radiusM, expected.radiusM, accuracy: 1e-9, place.id)
            XCTAssertEqual(place.placeIds, expected.placeIds, place.id)
            XCTAssertEqual(place.aliases, expected.aliases, place.id)
            XCTAssertEqual(place.tracks.map(\.id), expected.tracks.map(\.id), place.id)
            for (track, want) in zip(place.tracks, expected.tracks) {
                let label = "\(place.id)/\(track.id)"
                XCTAssertEqual(track.role.rawValue, want.role, label)
                XCTAssertEqual(track.title, want.title, label)
                XCTAssertEqual(track.src, want.src, label)
                XCTAssertEqual(track.seconds, want.seconds, label)
                XCTAssertEqual(track.bytes, want.bytes, label)
                XCTAssertEqual(track.sha256, want.sha256, label)
                XCTAssertEqual(track.sources, want.sources, label)
                XCTAssertEqual(track.stop?.n, want.stop?.n, label)
                XCTAssertEqual(track.stop?.find, want.stop?.find, label)
                XCTAssertEqual(track.stop?.localName, want.stop?.localName, label)
            }
        }
        XCTAssertEqual(Set(catalog.sources.keys), Set(fixture.normalized.sources.keys))
        for (id, source) in fixture.normalized.sources {
            XCTAssertEqual(catalog.sources[id]?.title, source.title, id)
            XCTAssertEqual(catalog.sources[id]?.url, source.url, id)
        }
    }

    /// 이름 열쇠 — 악센트·대소문자·공백·문장부호·전각·합자를 웹과 같은 글자로 줄인다.
    func testNameKeyMatchesTheWeb() throws {
        let fixture = try load()
        XCTAssertGreaterThan(fixture.nameKeys.count, 5)
        for c in fixture.nameKeys {
            XCTAssertEqual(StoryRules.nameKey(c.input), c.key, c.input)
        }
    }

    /// 이름만 같은 다른 도시(마드리드 스페인 광장·세고비아 알카사르)에는 붙지 않는다.
    func testSpotMatchingMatchesTheWeb() throws {
        let fixture = try load()
        let catalog = StoryCatalog(raw: fixture.catalog)
        XCTAssertGreaterThan(fixture.matches.count, 5)
        for c in fixture.matches {
            let point = c.spot.lat.flatMap { lat in c.spot.lng.map { GeoPoint(lat: lat, lng: $0) } }
            let spot = StorySpot(name: c.spot.name, point: point, placeId: c.spot.placeId)
            XCTAssertEqual(catalog.story(for: spot)?.id, c.story, c.name)
        }
    }

    /// 도시 이야기는 그날 **첫** 위치 장소가 들어가는 도시다(가장 가까운 도시가 아니다).
    func testCityStoryMatchesTheWeb() throws {
        let fixture = try load()
        let catalog = StoryCatalog(raw: fixture.catalog)
        for c in fixture.cities {
            let points = c.points.map { $0.map { GeoPoint(lat: $0.lat, lng: $0.lng) } }
            XCTAssertEqual(catalog.cityStory(for: points)?.id, c.story, c.name)
        }
    }

    /// 길이·크기 표기 — `1310720`바이트는 웹(`toFixed(1)`)처럼 1.3MB다(printf식이면 1.2MB).
    func testDurationAndSizeTextMatchTheWeb() throws {
        let fixture = try load()
        for c in fixture.durations { XCTAssertEqual(StoryRules.durationText(c.seconds), c.text, "\(c.seconds)초") }
        for c in fixture.sizes { XCTAssertEqual(StoryRules.sizeText(c.bytes), c.text, "\(c.bytes)바이트") }
    }

    /// 출처는 카탈로그에 있는 것만, 트랙에 처음 나온 순서대로.
    func testPlaceSourcesMatchTheWeb() throws {
        let fixture = try load()
        let catalog = StoryCatalog(raw: fixture.catalog)
        for c in fixture.placeSources {
            let place = try XCTUnwrap(catalog.place(id: c.place), c.place)
            XCTAssertEqual(catalog.sources(of: place).map(\.id), c.ids, c.place)
        }
    }
}
