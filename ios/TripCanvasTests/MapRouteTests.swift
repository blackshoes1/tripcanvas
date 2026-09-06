import XCTest
@testable import TripCanvas

/// 지도의 동선.
///
/// ⚠️ **실제 도로가 아니라 장소를 순서대로 이은 직선이다.** 서버가 경로 좌표열을 주지 않는다.
/// 여기서 지키는 것: 좌표 없는 장소는 선에서 빠지고 · 숙소 복귀는 따로(옅게) 그리고 ·
/// 그릴 것이 없으면 빈 배열이다.
final class MapRouteTests: XCTestCase {

    private func spot(_ name: String, _ lat: Double?, _ lng: Double?) -> DayPlanSpot {
        DayPlanSpot(index: 0, name: name, city: "제주", category: nil,
                    location: lat.flatMap { la in lng.map { GeoPoint(lat: la, lng: $0) } },
                    etaMinutes: 540, fixed: false, conflict: false, bookedAtMinutes: nil,
                    waitMinutes: 0, stayMinutes: nil, status: "PLANNED",
                    participants: [], reunion: false, incomingLeg: nil)
    }

    private func day(_ spots: [DayPlanSpot], back: DayPlanBack? = nil, index: Int = 0) -> DayPlanDay {
        DayPlanDay(index: index, date: "2026-10-01", title: "", note: "", mode: "car", startMinutes: 540,
                   timeZone: "Asia/Seoul", carriedStay: nil, spots: spots, carPickups: [], carReturns: [],
                   back: back, spotsWithoutLocation: spots.filter { $0.location == nil }.count, splits: [],
                   totals: .init(distanceKm: 0, travelMinutes: 0, endMinutes: nil, overloaded: false,
                                 cost: .init(total: 0, parts: [])))
    }

    private let leg = DayPlanLeg(mode: "car", minutes: 10, distanceKm: 3, path: nil, source: .straightLineEstimate)

    func testConnectsLocatedSpotsInOrder() {
        let d = day([spot("공항", 33.51, 126.49), spot("호텔", 33.50, 126.53), spot("성산", 33.46, 126.94)])
        let routes = d.mapRoutes

        XCTAssertEqual(routes.count, 1)
        XCTAssertEqual(routes[0].points.count, 3)
        XCTAssertEqual(routes[0].points.first?.lat, 33.51, "목록 순서를 그대로 잇는다")
        XCTAssertFalse(routes[0].synthetic)
    }

    /// 좌표 없는 장소가 선을 끊지 않는다 — 건너뛰고 이어진다.
    func testSkipsSpotsWithoutCoordinates() {
        let d = day([spot("공항", 33.51, 126.49), spot("미정", nil, nil), spot("성산", 33.46, 126.94)])
        XCTAssertEqual(d.mapRoutes.first?.points.count, 2)
    }

    /// 숙소 복귀는 자동으로 이어 붙인 구간이라 **따로** 그린다 — 내가 넣은 이동과 구분한다.
    func testDrawsTheReturnLegSeparately() {
        let back = DayPlanBack(name: "제주호텔", location: GeoPoint(lat: 33.50, lng: 126.53), leg: leg)
        let d = day([spot("공항", 33.51, 126.49), spot("성산", 33.46, 126.94)], back: back)
        let routes = d.mapRoutes

        XCTAssertEqual(routes.count, 2)
        XCTAssertFalse(routes[0].synthetic)
        XCTAssertTrue(routes[1].synthetic, "복귀는 옅게 그리려고 표시를 단다")
        XCTAssertEqual(routes[1].points.count, 2, "마지막 장소 → 숙소")
        XCTAssertEqual(routes[1].points.first?.lat, 33.46, "마지막 장소에서 출발한다")
    }

    /// 마지막 날에는 서버가 복귀를 주지 않는다 — 떠나는 날이다.
    func testNoReturnLegWhenTheServerGivesNone() {
        let d = day([spot("공항", 33.51, 126.49), spot("성산", 33.46, 126.94)])
        XCTAssertEqual(d.mapRoutes.count, 1)
    }

    func testNothingToDrawIsEmpty() {
        XCTAssertTrue(day([]).mapRoutes.isEmpty, "장소가 없으면 선도 없다")
        XCTAssertTrue(day([spot("한 곳", 33.5, 126.5)]).mapRoutes.isEmpty, "한 점으로는 선이 안 된다")
        XCTAssertTrue(day([spot("미정", nil, nil), spot("미정2", nil, nil)]).mapRoutes.isEmpty)
    }

    /// 좌표가 하나뿐이어도 숙소 복귀는 그릴 수 있다(그 한 곳 → 숙소).
    func testReturnLegWorksWithASingleLocatedSpot() {
        let back = DayPlanBack(name: "호텔", location: GeoPoint(lat: 33.50, lng: 126.53), leg: leg)
        let routes = day([spot("한 곳", 33.46, 126.94)], back: back).mapRoutes
        XCTAssertEqual(routes.count, 1)
        XCTAssertTrue(routes[0].synthetic)
    }
}
