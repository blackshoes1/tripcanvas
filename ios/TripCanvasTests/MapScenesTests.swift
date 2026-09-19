import XCTest
@testable import TripCanvas

/// 도시를 건너는 날은 장면으로 나뉜다.
///
/// 여기서 지키는 것: 25km 이상 벌어지면 다른 장면이고 · 도시 안 하루는 장면이 하나고 ·
/// 주 장면은 장소가 가장 많은 묶음(같으면 뒤쪽)이고 · 이름표는 도시(다수결) 아니면 번호고 ·
/// 장면 사이 이동은 서버 구간이 있으면 그 값, 없으면 직선 거리에 "약"이다.
final class MapScenesTests: XCTestCase {

    private let madrid = GeoPoint(lat: 40.4168, lng: -3.7038)
    private let sevilla = GeoPoint(lat: 37.3891, lng: -5.9845)
    private let toledo = GeoPoint(lat: 39.8628, lng: -4.0273)

    private func spot(_ index: Int, _ point: GeoPoint, city: String = "", dLat: Double = 0, dLng: Double = 0) -> SceneSpot {
        SceneSpot(index: index, point: GeoPoint(lat: point.lat + dLat, lng: point.lng + dLng), city: city)
    }

    /// 마드리드 1곳 → 세비야 3곳: 두 장면, 세비야가 주 장면.
    func testSplitsAtACityHop() {
        let scenes = MapScenes.split([
            spot(0, madrid, city: "Madrid"),
            spot(1, sevilla, city: "Sevilla"), spot(2, sevilla, city: "Sevilla", dLat: 0.01), spot(3, sevilla, city: "Sevilla", dLng: 0.02)
        ])
        XCTAssertEqual(scenes.map(\.spotIndexes), [[0], [1, 2, 3]])
        XCTAssertEqual(scenes.map(\.label), ["Madrid", "Sevilla"])
        XCTAssertEqual(MapScenes.mainScene(in: scenes), 1)
    }

    /// 도시 안 하루(서울 10km)는 장면이 하나 — 예전과 똑같이 동작한다.
    func testACityDayIsOneScene() {
        let seoul = GeoPoint(lat: 37.55, lng: 126.95)
        let scenes = MapScenes.split([spot(0, seoul), spot(1, seoul, dLat: 0.05, dLng: 0.10), spot(2, seoul, dLat: 0.02)])
        XCTAssertEqual(scenes.count, 1)
        XCTAssertEqual(scenes[0].spotIndexes, [0, 1, 2])
        XCTAssertTrue(MapScenes.transfers(between: scenes) { _ in nil }.isEmpty)
    }

    /// 장소 수가 같으면 뒤쪽이 주 장면이다 — 그날 잠드는 곳.
    func testTieGoesToTheLaterScene() {
        let scenes = MapScenes.split([spot(0, madrid), spot(1, madrid, dLat: 0.01), spot(2, sevilla), spot(3, sevilla, dLat: 0.01)])
        XCTAssertEqual(scenes.count, 2)
        XCTAssertEqual(MapScenes.mainScene(in: scenes), 1)
        XCTAssertNil(MapScenes.mainScene(in: []))
    }

    /// 마드리드 → 톨레도(67km) → 마드리드: 세 장면. 되돌아와도 앞 장면과 합치지 않는다 — 순서가 동선이다.
    func testGoingBackMakesANewScene() {
        let scenes = MapScenes.split([spot(0, madrid), spot(1, toledo), spot(2, madrid, dLat: 0.01)])
        XCTAssertEqual(scenes.map(\.spotIndexes), [[0], [1], [2]])
    }

    /// 이름표 — 도시는 다수결(같으면 먼저 나온 것), 도시가 없으면 번호 범위, 하나면 번호.
    func testLabels() {
        XCTAssertEqual(MapScenes.label(for: [spot(0, sevilla, city: "Sevilla"), spot(1, sevilla, city: " Triana "), spot(2, sevilla, city: "Sevilla")]), "Sevilla")
        XCTAssertEqual(MapScenes.label(for: [spot(1, sevilla, city: "A"), spot(2, sevilla, city: "B")]), "A")
        XCTAssertEqual(MapScenes.label(for: [spot(1, sevilla), spot(2, sevilla), spot(3, sevilla)]), "2–4번")
        XCTAssertEqual(MapScenes.label(for: [spot(4, sevilla)]), "5번")
        XCTAssertEqual(MapScenes.label(for: [spot(0, sevilla, city: ""), spot(1, sevilla, city: "Sevilla")]), "Sevilla")
    }

    /// 서버 구간이 없으면 직선 거리에 "약" — 마드리드·세비야는 약 390km.
    func testTransferFallsBackToStraightDistance() {
        let scenes = MapScenes.split([spot(0, madrid), spot(1, sevilla)])
        let transfers = MapScenes.transfers(between: scenes) { _ in nil }
        XCTAssertEqual(transfers.count, 1)
        XCTAssertEqual(transfers[0].id, 0)
        XCTAssertTrue(transfers[0].estimated)
        XCTAssertNil(transfers[0].minutes)
        XCTAssertEqual(transfers[0].distanceKm, 390, accuracy: 3)
        XCTAssertEqual(MapScenes.text(for: transfers[0]), "약 390km")
    }

    /// 서버 구간이 있으면 그 수단·시간·거리를 그대로 쓴다 — 도착 장면 첫 장소의 구간이다.
    func testTransferUsesTheServerLegWhenKnown() {
        let scenes = MapScenes.split([spot(0, madrid), spot(1, sevilla), spot(2, sevilla, dLat: 0.01)])
        var asked: [Int] = []
        let transfers = MapScenes.transfers(between: scenes) { arriving in
            asked.append(arriving)
            return (mode: .train, minutes: 150, distanceKm: 471)
        }
        XCTAssertEqual(asked, [1])
        XCTAssertEqual(transfers[0].mode, .train)
        XCTAssertEqual(transfers[0].minutes, 150)
        XCTAssertEqual(transfers[0].distanceKm, 471)
        XCTAssertFalse(transfers[0].estimated)
        XCTAssertEqual(MapScenes.text(for: transfers[0]), "\(TimeFormat.duration(150)) · 471km")
    }

    /// 거리 0의 구간(추정 실패)은 직선으로 되돌린다 — 0km라고 말하지 않는다.
    func testZeroDistanceLegFallsBack() {
        let scenes = MapScenes.split([spot(0, madrid), spot(1, sevilla)])
        let transfers = MapScenes.transfers(between: scenes) { _ in (mode: .car, minutes: 0, distanceKm: 0) }
        XCTAssertTrue(transfers[0].estimated)
        XCTAssertEqual(transfers[0].mode, .car)
        XCTAssertEqual(transfers[0].distanceKm, 390, accuracy: 3)
    }

    func testDistance() {
        XCTAssertEqual(MapScenes.distanceKm(madrid, toledo), 67.5, accuracy: 0.5)
        XCTAssertEqual(MapScenes.distanceKm(madrid, madrid), 0)
    }
}
