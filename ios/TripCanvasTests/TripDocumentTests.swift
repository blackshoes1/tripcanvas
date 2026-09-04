import XCTest
@testable import TripCanvas

/// 여행 문서 편집. 여기서 지켜야 하는 것은 둘이다 —
/// **모르는 필드를 잃지 않는다**, **기본값을 새로 써 넣지 않는다.**
/// 둘 중 하나만 어겨도 앱에서 한 번 저장하는 순간 웹에서 만든 일정이 달라진다.
final class TripDocumentTests: XCTestCase {
    /// 웹이 실제로 쓰는 모양. 앱이 아직 모르는 필드(who·split·reunion·hours·flight)를 일부러 섞었다.
    private let json = """
    {
      "name": "오사카",
      "start": "2026-10-01",
      "colorBy": "city",
      "schemaVersion": 2,
      "days": [
        {
          "title": "도착",
          "mode": "transit",
          "flight": { "code": "KE001", "dep": "ICN", "arr": "KIX", "depAt": "09:00" },
          "spots": [
            { "name": "간사이공항", "city": "오사카", "desc": "", "lat": 34.4342, "lng": 135.2328,
              "cat": "transport", "who": ["u1", "u2"], "split": "a", "reunion": true },
            { "name": "도톤보리", "city": "오사카", "desc": "", "lat": null, "lng": null,
              "at": "18:00", "must": true, "hours": [{ "d": 1, "o": 600, "c": 1320 }] }
          ]
        },
        { "title": "교토", "mode": "train", "startPolicy": "none", "spots": [] }
      ]
    }
    """

    private func load() throws -> TripDocument {
        let raw = try JSONDecoder().decode([String: JSONValue].self, from: Data(json.utf8))
        return TripDocument(raw: raw)
    }

    private func encoded(_ document: TripDocument) throws -> [String: JSONValue] {
        let data = try JSONValue.data(from: document.raw)
        return try JSONDecoder().decode([String: JSONValue].self, from: data)
    }

    // MARK: 읽기

    func testReadsKnownFields() throws {
        let trip = try load()
        XCTAssertEqual(trip.name, "오사카")
        XCTAssertEqual(trip.start, "2026-10-01")
        XCTAssertEqual(trip.days.count, 2)

        let first = trip.days[0]
        XCTAssertEqual(first.title, "도착")
        XCTAssertEqual(first.mode, .transit)
        XCTAssertTrue(first.carriesPreviousAnchor)
        XCTAssertEqual(first.spots.count, 2)

        let airport = first.spots[0]
        XCTAssertEqual(airport.name, "간사이공항")
        XCTAssertEqual(airport.category, .transport)
        XCTAssertEqual(airport.point?.lat, 34.4342)
        XCTAssertEqual(airport.status, .planned)
        XCTAssertFalse(airport.isMust)

        // 좌표가 null인 장소는 '위치 없음'이지 (0,0)이 아니다 — 여기서 틀리면 동선이 오염된다.
        XCTAssertNil(first.spots[1].point)
        XCTAssertEqual(first.spots[1].arriveAt, "18:00")
        XCTAssertTrue(first.spots[1].isMust)

        XCTAssertFalse(trip.days[1].carriesPreviousAnchor)   // startPolicy: none
    }

    // MARK: 모르는 필드 보존

    func testKeepsUnknownFieldsThroughAnEdit() throws {
        var trip = try load()
        var spot = trip.days[0].spots[0]
        spot.name = "간사이 국제공항"
        trip.updateSpot(dayIndex: 0, at: 0, with: spot)

        let out = try encoded(trip)
        XCTAssertEqual(out["colorBy"]?.stringValue, "city")                       // 문서 수준
        let day = out["days"]?.arrayValue?[0].objectValue
        XCTAssertEqual(day?["flight"]?["code"]?.stringValue, "KE001")             // 일자 수준
        let edited = day?["spots"]?.arrayValue?[0].objectValue
        XCTAssertEqual(edited?["name"]?.stringValue, "간사이 국제공항")
        XCTAssertEqual(edited?["who"]?.arrayValue?.count, 2)                      // 장소 수준
        XCTAssertEqual(edited?["split"]?.stringValue, "a")
        XCTAssertEqual(edited?["reunion"]?.boolValue, true)
        // 손대지 않은 장소도 그대로다
        let untouched = day?["spots"]?.arrayValue?[1].objectValue
        XCTAssertEqual(untouched?["hours"]?.arrayValue?.count, 1)
    }

    // MARK: 기본값을 쓰지 않는다

    func testDefaultsAreNotWritten() throws {
        var spot = TripSpot(name: "새 장소")
        spot.status = .planned
        spot.isMust = false
        spot.stayMinutes = nil
        XCTAssertNil(spot.raw["status"])
        XCTAssertNil(spot.raw["must"])
        XCTAssertNil(spot.raw["stayMin"])

        spot.status = .completed
        spot.isMust = true
        XCTAssertEqual(spot.raw["status"]?.stringValue, "COMPLETED")
        XCTAssertEqual(spot.raw["must"]?.boolValue, true)

        // 되돌리면 키가 다시 없어진다 — false·PLANNED를 남겨 두지 않는다.
        spot.status = .planned
        spot.isMust = false
        XCTAssertNil(spot.raw["status"])
        XCTAssertNil(spot.raw["must"])
    }

    func testClearingCoordinatesWritesNullNotZero() throws {
        var spot = TripSpot(name: "어딘가")
        spot.point = GeoPoint(lat: 37.5, lng: 127.0)
        XCTAssertEqual(spot.point?.lng, 127.0)
        spot.point = nil
        XCTAssertNil(spot.point)
        XCTAssertEqual(spot.raw["lat"]?.isNull, true)
        XCTAssertEqual(spot.raw["lng"]?.isNull, true)
    }

    // MARK: 편집

    func testInsertsAfterTheSelectedSpot() throws {
        var trip = try load()
        trip.insertSpot(TripSpot(name: "우메다"), dayIndex: 0, after: 0)
        XCTAssertEqual(trip.days[0].spots.map(\.name), ["간사이공항", "우메다", "도톤보리"])

        trip.insertSpot(TripSpot(name: "신사이바시"), dayIndex: 0)
        XCTAssertEqual(trip.days[0].spots.last?.name, "신사이바시")
    }

    func testRemovesAndMovesWithinADay() throws {
        var trip = try load()
        trip.insertSpot(TripSpot(name: "우메다"), dayIndex: 0)
        trip.moveSpots(dayIndex: 0, from: IndexSet(integer: 2), to: 0)
        XCTAssertEqual(trip.days[0].spots.map(\.name), ["우메다", "간사이공항", "도톤보리"])

        trip.moveSpots(dayIndex: 0, from: IndexSet(integer: 0), to: 3)   // 맨 뒤로
        XCTAssertEqual(trip.days[0].spots.map(\.name), ["간사이공항", "도톤보리", "우메다"])

        trip.removeSpot(dayIndex: 0, at: 1)
        XCTAssertEqual(trip.days[0].spots.map(\.name), ["간사이공항", "우메다"])
    }

    /// 다른 날로 옮길 때 최적 위치를 추측하지 않는다 — 고른 날 맨 뒤다(§79).
    func testMovingToAnotherDayAppends() throws {
        var trip = try load()
        trip.moveSpot(from: (day: 0, index: 1), toDay: 1)
        XCTAssertEqual(trip.days[0].spots.map(\.name), ["간사이공항"])
        XCTAssertEqual(trip.days[1].spots.map(\.name), ["도톤보리"])
        // 옮겨도 그 장소의 모르는 필드는 그대로다
        XCTAssertEqual(trip.days[1].spots[0].raw["hours"]?.arrayValue?.count, 1)
    }

    func testOutOfRangeEditsDoNothing() throws {
        let before = try load()
        var trip = before
        trip.insertSpot(TripSpot(name: "없는 날"), dayIndex: 9)
        trip.removeSpot(dayIndex: 0, at: 9)
        trip.updateSpot(dayIndex: 9, at: 0, with: TripSpot(name: "x"))
        trip.moveSpot(from: (day: 0, index: 9), toDay: 1)
        XCTAssertEqual(trip, before)
    }

    // MARK: JSON 트리

    func testJSONValueRoundTripKeepsTypes() throws {
        let source = #"{"s":"a","n":3,"f":1.5,"b":true,"z":null,"arr":[1,"x"],"o":{"k":false}}"#
        let value = try JSONDecoder().decode([String: JSONValue].self, from: Data(source.utf8))
        let again = try JSONDecoder().decode([String: JSONValue].self, from: JSONValue.data(from: value))
        XCTAssertEqual(again["s"]?.stringValue, "a")
        XCTAssertEqual(again["n"]?.intValue, 3)
        XCTAssertEqual(again["f"]?.doubleValue, 1.5)
        XCTAssertEqual(again["b"]?.boolValue, true)      // true가 1로 굳지 않는다
        XCTAssertEqual(again["z"]?.isNull, true)
        XCTAssertEqual(again["arr"]?.arrayValue?.count, 2)
        XCTAssertEqual(again["o"]?["k"]?.boolValue, false)
        XCTAssertEqual(again, value)
    }
}
