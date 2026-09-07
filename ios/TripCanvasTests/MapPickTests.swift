import XCTest
@testable import TripCanvas

/// 지도에서 고른 자리를 장소로 옮길 때.
///
/// 여기서 지키는 것: **지어내지 않는다.** 해외(구글)는 이름과 placeId가 오지만
/// 국내(카카오)는 POI 신원을 주지 않는다 — 그때 이름을 만들어 넣으면 엉뚱한 상호가 일정에 들어간다.
final class MapPickTests: XCTestCase {

    func testOverseasPoiBringsItsNameAndIdentity() {
        let pick = MapPick(point: GeoPoint(lat: 35.681, lng: 139.767),
                           name: "Tokyo Station", placeId: "ChIJC3Cf2PuLGGAROO00ukl8JwA")
        let spot = SpotEditorTarget.spotFromMap(pick, fallbackCity: "도쿄")

        XCTAssertEqual(spot.name, "Tokyo Station")
        XCTAssertEqual(spot.placeId, "ChIJC3Cf2PuLGGAROO00ukl8JwA", "호텔 시세 추적이 이 id로 같은 곳인지 본다")
        XCTAssertEqual(spot.point?.lat, 35.681)
        XCTAssertEqual(spot.city, "도쿄")
    }

    /// 국내 지도는 이름을 주지 않는다 — 비워 둔다. 편집기에서 사람이 적는다.
    func testDomesticTapKeepsTheNameEmpty() {
        let pick = MapPick(point: GeoPoint(lat: 37.5665, lng: 126.978), name: nil, placeId: nil)
        let spot = SpotEditorTarget.spotFromMap(pick, fallbackCity: "서울")

        XCTAssertEqual(spot.name, "")
        XCTAssertNil(spot.placeId)
        XCTAssertEqual(spot.point?.lng, 126.978, "좌표는 담긴다")
    }

    /// 그 날에 장소가 하나도 없으면 도시를 모른다 — 웹과 같은 기본값을 쓴다.
    func testFallsBackToTheDefaultCity() {
        let pick = MapPick(point: GeoPoint(lat: 0, lng: 0), name: nil, placeId: nil)
        XCTAssertEqual(SpotEditorTarget.spotFromMap(pick, fallbackCity: nil).city, "기타")
    }

    /// 편집기는 **미리 채워진 채로 열린다** — 바로 저장하지 않는다(확인은 사람이 한다).
    func testTheEditorOpensPrefilledInsteadOfSavingSilently() {
        let pick = MapPick(point: GeoPoint(lat: 1, lng: 2), name: "어떤 곳", placeId: nil)
        let target = SpotEditorTarget.createFromMap(SpotEditorTarget.spotFromMap(pick, fallbackCity: nil))

        XCTAssertEqual(target.spot.name, "어떤 곳")
        XCTAssertNil(target.index, "새 장소이므로 고칠 대상이 없다")
    }
}
