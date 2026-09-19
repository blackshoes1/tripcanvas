import CoreGraphics
import Foundation

/// 지도에 그린 것 전부를 담는 사각형 — 핀과 동선의 점.
///
/// '이 날' 지도는 열 때 **그날 동선이 통째로** 보여야 한다(2026-09-19). 그전에는 첫 장소 하나에
/// 줌인해 두어 나머지 동선이 화면 밖에 있었고, 어디로 가는 하루인지 지도가 말하지 못했다.
/// 두 SDK가 같은 사각형을 쓴다 — 구글은 bounds를 그대로 fit하고, 카카오는 bounds fit이 없어
/// 중심과 `zoomLevel(fitting:)`로 간다. 이 파일은 SDK를 모르므로 XCTest가 그대로 검사한다.
///
/// ⚠️ 핀만이 아니라 **선의 점**도 넣는다. 조회된 도로는 두 핀 사이 밖으로 나갈 수 있고,
/// 숙소 복귀(`back`)는 핀이 아니라 선으로만 있다 — 핀만 맞추면 그 선이 잘린다.
struct MapBounds: Equatable {
    let south: Double
    let west: Double
    let north: Double
    let east: Double

    /// 핀과 동선을 전부 담는 사각형. 담을 점이 하나도 없으면 nil — 카메라를 움직일 근거가 없다.
    static func covering(pins: [MapPin], routes: [MapRoute] = []) -> MapBounds? {
        covering(points: pins.map(\.point) + routes.flatMap(\.points))
    }

    /// 점들을 전부 담는 사각형. 장면(`MapScenes`)처럼 핀이 아닌 점 묶음을 맞출 때 쓴다.
    static func covering(points: [GeoPoint]) -> MapBounds? {
        guard let first = points.first else { return nil }
        return points.dropFirst().reduce(MapBounds(point: first)) { $0.including($1) }
    }

    init(south: Double, west: Double, north: Double, east: Double) {
        self.south = south; self.west = west; self.north = north; self.east = east
    }

    init(point: GeoPoint) {
        self.init(south: point.lat, west: point.lng, north: point.lat, east: point.lng)
    }

    func including(_ point: GeoPoint) -> MapBounds {
        MapBounds(south: min(south, point.lat), west: min(west, point.lng),
                  north: max(north, point.lat), east: max(east, point.lng))
    }

    var center: GeoPoint { GeoPoint(lat: (south + north) / 2, lng: (west + east) / 2) }

    /// 위도·경도 중 더 넓게 퍼진 쪽(도). 0이면 한 점이다.
    var span: Double { max(north - south, east - west) }

    /// 한 점(또는 겹친 점들)인가 — bounds fit이 무한 줌으로 가지 않게 호출부가 가른다.
    var isPoint: Bool { span < 0.0001 }

    /// 한 점을 볼 때의 줌 — 동네가 보이는 정도. 장소 하나만 있는 날과 같다.
    static let pointZoom = 15

    /// 이 사각형이 `viewSize`(pt) 안에 `padding`(pt) 여백을 두고 **통째로** 들어가는 가장 가까운 줌.
    /// 타일 한 장이 256pt인 웹 메르카토르 줌 체계다(구글·카카오 SDK가 같다).
    /// 뷰 크기를 아직 모르면(0) 퍼진 정도로 고른 근사값(`approximateZoom`)으로 간다 —
    /// 첫 프레임 전에는 뷰가 0×0이라 정확한 값을 낼 수 없다.
    func zoomLevel(fitting viewSize: CGSize, padding: Double = 48, range: ClosedRange<Int> = 6...16) -> Int {
        if isPoint { return min(Self.pointZoom, range.upperBound) }
        let width = Double(viewSize.width) - padding * 2
        let height = Double(viewSize.height) - padding * 2
        guard width > 0, height > 0 else { return min(max(approximateZoom, range.lowerBound), range.upperBound) }
        let fractionX = (east - west) / 360
        let fractionY = (Self.mercator(north) - Self.mercator(south)) / (2 * Double.pi)
        let zoomX = fractionX > 0 ? log2(width / (256 * fractionX)) : Double.infinity
        let zoomY = fractionY > 0 ? log2(height / (256 * fractionY)) : Double.infinity
        let zoom = Int(floor(min(zoomX, zoomY)))
        return min(max(zoom, range.lowerBound), range.upperBound)
    }

    /// 뷰 크기를 모를 때의 근사 — 넓을수록 낮다. 도시 하나(0.05도≈5km)면 12, 도 단위(0.5도)면 9, 그 이상은 7.
    var approximateZoom: Int {
        isPoint ? Self.pointZoom : span > 1.5 ? 7 : span > 0.5 ? 9 : span > 0.15 ? 10 : span > 0.05 ? 12 : 13
    }

    private static func mercator(_ latitude: Double) -> Double {
        let clamped = min(max(latitude, -85), 85) * Double.pi / 180
        return log(tan(Double.pi / 4 + clamped / 2))
    }
}
