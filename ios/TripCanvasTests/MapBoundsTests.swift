import XCTest
@testable import TripCanvas

/// '이 날' 지도는 열 때 그날 동선이 **통째로** 보인다.
///
/// 여기서 지키는 것: 사각형은 핀과 선의 점을 전부 담고 · 담을 것이 없으면 nil이고 ·
/// 줌은 뷰 크기 안에 사각형이 들어가는 가장 가까운 값이며 넓을수록 낮고 ·
/// 한 점이면 동네 줌이고 · 뷰 크기를 모르면 근사값으로 간다.
final class MapBoundsTests: XCTestCase {

    private func pin(_ lat: Double, _ lng: Double, _ order: Int = 1) -> MapPin {
        MapPin(id: "p\(order)", title: "장소 \(order)", point: GeoPoint(lat: lat, lng: lng), order: order)
    }

    private let phone = CGSize(width: 390, height: 520)

    func testCoversEveryPin() {
        let bounds = MapBounds.covering(pins: [pin(37.55, 126.95, 1), pin(37.60, 127.05, 2), pin(37.57, 126.99, 3)])
        XCTAssertEqual(bounds, MapBounds(south: 37.55, west: 126.95, north: 37.60, east: 127.05))
        XCTAssertEqual(bounds?.center.lat ?? 0, 37.575, accuracy: 1e-9)
        XCTAssertEqual(bounds?.center.lng ?? 0, 127.0, accuracy: 1e-9)
    }

    /// 숙소 복귀 선처럼 핀 밖으로 나가는 동선도 사각형에 든다 — 핀만 맞추면 그 선이 잘린다.
    func testRoutesExtendTheBoundsBeyondThePins() {
        let back = MapRoute(id: "day-0-back", points: [GeoPoint(lat: 37.60, lng: 127.05), GeoPoint(lat: 37.70, lng: 127.20)],
                            synthetic: true)
        let bounds = MapBounds.covering(pins: [pin(37.55, 126.95, 1), pin(37.60, 127.05, 2)], routes: [back])
        XCTAssertEqual(bounds?.north, 37.70)
        XCTAssertEqual(bounds?.east, 127.20)
        XCTAssertEqual(bounds?.south, 37.55)
    }

    func testNothingToCoverIsNil() {
        XCTAssertNil(MapBounds.covering(pins: [], routes: []))
        XCTAssertNil(MapBounds.covering(pins: [], routes: [MapRoute(id: "empty", points: [], synthetic: false)]))
    }

    /// 서울 시내 하루(위도 0.05도 × 경도 0.10도)는 폰 화면에서 줌 12에 통째로 들어간다.
    func testZoomFitsTheWholeDayOnAPhone() {
        let bounds = MapBounds(south: 37.55, west: 126.95, north: 37.60, east: 127.05)
        XCTAssertEqual(bounds.zoomLevel(fitting: phone), 12)
        // 줌 12에서 경도 0.10도는 256·2^12·(0.10/360) ≈ 291pt — 여백 48pt를 뺀 294pt 안이다.
        let usable: Double = 390 - 96
        let widthAtZoom12 = 256.0 * Double(1 << 12) * (0.10 / 360)
        XCTAssertLessThanOrEqual(widthAtZoom12, usable)
        // 한 단계 더 당기면(13) 582pt라 잘린다 — 그래서 12가 '들어가는 가장 가까운 줌'이다.
        XCTAssertGreaterThan(widthAtZoom12 * 2, usable)
    }

    /// 넓을수록 낮다 — 제주 한 바퀴(0.3×0.5도)는 9, 스페인 종단(3×8.7도)은 하한 6.
    func testWiderDaysZoomOut() {
        XCTAssertEqual(MapBounds(south: 33.25, west: 126.30, north: 33.55, east: 126.80).zoomLevel(fitting: phone), 9)
        XCTAssertEqual(MapBounds(south: 37.4, west: -6.0, north: 40.4, east: 2.7).zoomLevel(fitting: phone), 6)
    }

    /// 세로로 긴 동선은 세로가 줌을 정한다 — 가로만 보면 남북이 잘린다.
    func testTheTighterAxisDecides() {
        let tall = MapBounds(south: 37.40, west: 127.00, north: 37.60, east: 127.02)
        XCTAssertEqual(tall.zoomLevel(fitting: phone), 11)
        // 화면이 넓어지면 더 당겨 볼 수 있다.
        XCTAssertEqual(MapBounds(south: 37.55, west: 126.95, north: 37.60, east: 127.05)
            .zoomLevel(fitting: CGSize(width: 800, height: 520)), 13)
    }

    /// 장소 하나(또는 같은 자리)는 동네가 보이는 줌이다 — bounds fit이 무한 줌으로 가지 않게.
    func testASinglePointGetsTheNeighbourhoodZoom() {
        let one = MapBounds(point: GeoPoint(lat: 37.55, lng: 126.95))
        XCTAssertTrue(one.isPoint)
        XCTAssertEqual(one.zoomLevel(fitting: phone), MapBounds.pointZoom)
        XCTAssertEqual(MapBounds.covering(pins: [pin(37.55, 126.95, 1), pin(37.55, 126.95, 2)])?.isPoint, true)
    }

    /// 첫 프레임 전에는 뷰가 0×0이다 — 그때는 퍼진 정도로 고른 근사값이고 상한·하한 안이다.
    func testUnknownViewSizeFallsBackToTheApproximation() {
        let city = MapBounds(south: 37.55, west: 126.95, north: 37.60, east: 127.05)
        XCTAssertEqual(city.zoomLevel(fitting: .zero), city.approximateZoom)
        XCTAssertEqual(city.approximateZoom, 12)
        XCTAssertEqual(MapBounds(south: 37.4, west: -6.0, north: 40.4, east: 2.7).approximateZoom, 7)
        XCTAssertEqual(MapBounds(south: 37.4, west: -6.0, north: 40.4, east: 2.7).zoomLevel(fitting: .zero, range: 8...16), 8)
    }
}
