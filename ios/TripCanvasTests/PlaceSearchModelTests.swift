import XCTest
@testable import TripCanvas

/// 지도·검색의 순수 규칙. 전부 `lib.js`의 복사본이라, 여기 기대값은 웹의 테스트(test/pure.test.js)와 같아야 한다.
final class PlaceSearchModelTests: XCTestCase {
    func testKoreaBoundsMatchLib() {
        XCTAssertTrue(MapRegion.isKorea(GeoPoint(lat: 37.5665, lng: 126.9780)))   // 서울
        XCTAssertTrue(MapRegion.isKorea(GeoPoint(lat: 33.4996, lng: 126.5312)))   // 제주
        XCTAssertFalse(MapRegion.isKorea(GeoPoint(lat: 34.6937, lng: 135.5023)))  // 오사카
        XCTAssertFalse(MapRegion.isKorea(nil))
    }

    /// 앵커가 있으면 위치가, 없으면 한글 여부가 가른다 — 웹과 같은 순서.
    func testSearchRoutingMatchesLib() {
        XCTAssertTrue(MapRegion.isKoreanSearch("스타벅스", near: nil))
        XCTAssertFalse(MapRegion.isKoreanSearch("Starbucks", near: nil))
        XCTAssertFalse(MapRegion.isKoreanSearch("스타벅스", near: GeoPoint(lat: 34.69, lng: 135.50)))   // 오사카에서 한글로 찾아도 구글
        XCTAssertTrue(MapRegion.isKoreanSearch("Starbucks", near: GeoPoint(lat: 37.56, lng: 126.97)))
    }

    func testGoogleRequestBody() {
        let body = GooglePlaces.requestBody(query: "ramen", near: GeoPoint(lat: 34.69, lng: 135.50), limit: 99, languageCode: "ko")
        XCTAssertEqual(body["textQuery"] as? String, "ramen")
        XCTAssertEqual(body["maxResultCount"] as? Int, 20)
        let circle = (body["locationBias"] as? [String: Any])?["circle"] as? [String: Any]
        XCTAssertEqual(circle?["radius"] as? Double, 20_000)
        XCTAssertNil(GooglePlaces.requestBody(query: "x", near: nil, limit: 5, languageCode: "ko")["locationBias"])
    }

    func testGoogleResponseBecomesHits() throws {
        let json = """
        {"places":[
          {"id":"ChIJabc123_-","displayName":{"text":"Ichiran Dotonbori"},"formattedAddress":"1 Chome Dotonbori, Chuo Ward, Osaka",
           "location":{"latitude":34.6687,"longitude":135.5013},"types":["ramen_restaurant","restaurant","food"],"primaryType":"ramen_restaurant",
           "addressComponents":[{"longText":"Osaka","shortText":"Osaka","types":["locality"]},{"longText":"Osaka Prefecture","types":["administrative_area_level_1"]}]},
          {"id":"ChIJnoloc","displayName":{"text":"좌표 없음"}},
          {"id":"x","displayName":{"text":""},"formattedAddress":"Namba Station, Osaka","location":{"latitude":34.66,"longitude":135.50},"types":["train_station"]}
        ]}
        """
        let response = try JSONDecoder().decode(GooglePlaces.Response.self, from: Data(json.utf8))
        let hits = GooglePlaces.hits(from: response)
        XCTAssertEqual(hits.count, 2)

        let ramen = hits[0]
        XCTAssertEqual(ramen.name, "Ichiran Dotonbori")
        XCTAssertEqual(ramen.city, "Osaka")
        XCTAssertEqual(ramen.category, .food)          // primaryType은 표에 없고 types의 restaurant가 잡힌다
        XCTAssertEqual(ramen.placeId, "ChIJabc123_-")

        let station = hits[1]
        XCTAssertEqual(station.name, "Namba Station")  // displayName이 비면 주소 앞부분
        XCTAssertEqual(station.category, .transport)
        XCTAssertNil(station.placeId)                  // 너무 짧은 id는 버린다(lib.js와 같은 규칙)
    }

    /// 도쿄 특별구(Minato City 등)는 '도쿄'로 묶고, 한국 지명 접미사는 뗀다.
    func testCityFromGoogleMatchesLib() {
        typealias C = GooglePlaces.Response.AddressComponent
        XCTAssertEqual(GooglePlaces.cityFromGoogle([
            C(longText: "Minato City", shortText: nil, types: ["locality"]),
            C(longText: "Tokyo", shortText: nil, types: ["administrative_area_level_1"])
        ]), "Tokyo")
        XCTAssertEqual(GooglePlaces.cityFromGoogle([
            C(longText: "성남시", shortText: nil, types: ["locality"])
        ]), "성남")
        XCTAssertEqual(GooglePlaces.cityFromGoogle([
            C(longText: "부산광역시", shortText: nil, types: ["administrative_area_level_1"])
        ]), "부산")
        XCTAssertEqual(GooglePlaces.cityFromGoogle([]), "")
    }

    func testCategoryPriorityMatchesLib() {
        XCTAssertEqual(GooglePlaces.catFromGoogle(types: ["store", "cafe"], primary: nil), .cafe)
        XCTAssertEqual(GooglePlaces.catFromGoogle(types: ["restaurant"], primary: "hotel"), .stay)   // primaryType이 이긴다
        XCTAssertNil(GooglePlaces.catFromGoogle(types: ["point_of_interest"], primary: nil))
    }

    func testHitMakesASpotWithCoordinates() {
        let hit = PlaceHit(id: "k", name: "스타벅스", city: "제주", address: "…", point: GeoPoint(lat: 33.5, lng: 126.5), category: .cafe, placeId: nil)
        let spot = hit.makeSpot()
        XCTAssertEqual(spot.name, "스타벅스")
        XCTAssertEqual(spot.city, "제주")
        XCTAssertEqual(spot.point?.lat, 33.5)
        XCTAssertEqual(spot.category, .cafe)
        XCTAssertNil(spot.placeId)
    }

    func testDayPinsKeepListNumbering() {
        var day = TripDay()
        var a = TripSpot(name: "A"); a.point = GeoPoint(lat: 1, lng: 1)
        let b = TripSpot(name: "B")                      // 좌표 없음
        var c = TripSpot(name: "C"); c.point = GeoPoint(lat: 2, lng: 2)
        day.spots = [a, b, c]
        XCTAssertEqual(day.pins.map(\.order), [1, 3])    // B를 건너뛰어도 번호는 목록과 같다
    }
}
