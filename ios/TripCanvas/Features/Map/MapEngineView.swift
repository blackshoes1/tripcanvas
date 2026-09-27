import SwiftUI

/// 듀얼 엔진 — 국내는 카카오, 해외는 구글. 웹의 `inKorea` 판정과 같다.
///
/// 어느 엔진인지는 **핀(또는 초점)의 위치**로 정한다. 핀이 하나도 없으면 사용자가 무엇을 하려는지
/// 모르므로 `regionHint`를 따른다(검색어에 한글이 있으면 국내 — `isKoreanSearch`).
struct MapEngineView: View {
    let pins: [MapPin]
    /// 그날의 동선. ⚠️ 조회된 구간은 도로를 따르고 나머지는 직선이다 — 화면이 그 사실을 함께 말해야 한다.
    var routes: [MapRoute] = []
    var focus: GeoPoint? = nil
    /// 고른 장소가 없을 때 카메라가 맞출 사각형. nil이면 그린 것 전부(핀+선). '이 날' 지도가 장면(`MapScenes`)
    /// 하나만 보일 때 준다 — 핀·선은 그대로 다 그리고 **카메라만** 거기로 간다.
    var frame: MapBounds? = nil
    var regionHint: Bool = true
    var onPick: ((MapPick) -> Void)? = nil
    var preservesCamera = false
    var selectedPinID: String? = nil
    var onPinSelected: ((String) -> Void)? = nil
    var onAreaChanged: ((PlaceSearchArea) -> Void)? = nil
    /// 화면에 보이는가. 숨긴 지도는 **버리지 않고 쉬게 한다** — 다시 보일 때 엔진을 새로 띄우고
    /// 타일을 다시 받지 않게(2026-09-17). 카카오는 엔진을 pause/activate, 구글은 뷰를 숨긴다.
    var isVisible: Bool = true

    private var usesKakao: Bool {
        if let anchor = focus ?? pins.first?.point { return MapRegion.isKorea(anchor) }
        return regionHint
    }

    var body: some View {
        Group {
            if usesKakao {
                KakaoMapContainer(pins: pins, routes: routes, focus: focus, frame: frame, onPick: onPick,
                                  preservesCamera: preservesCamera, selectedPinID: selectedPinID,
                                  onPinSelected: onPinSelected, onAreaChanged: onAreaChanged, isVisible: isVisible)
            } else {
                GoogleMapContainer(pins: pins, routes: routes, focus: focus, frame: frame, onPick: onPick,
                                   preservesCamera: preservesCamera, selectedPinID: selectedPinID,
                                   onPinSelected: onPinSelected, onAreaChanged: onAreaChanged, isVisible: isVisible)
            }
        }
        // 엔진이 바뀌면 뷰를 새로 만든다 — 같은 자리에 다른 SDK를 끼워 넣지 않는다.
        .id(usesKakao ? "kakao" : "google")
        // SDK가 첫 프레임을 그리기 전에는 빈 흰 면이 아니라 이 자리가 보인다. 그 뒤로는 지도가 덮는다.
        .background(MapLoadingPlaceholder())
    }
}

extension DayPlanDay {
    /// 그날의 동선. **서버가 준 좌표만** 잇는다 — 좌표 없는 장소는 선에서 빠지고, 그 사실은 화면이 따로 말한다.
    ///
    /// 구간에 조회된 경로(`incomingLeg.path`)가 있으면 **그 도로를 따라** 그리고, 없으면 두 점을 곧게 잇는다.
    /// 한 구간이라도 직선이면 `routed`는 false다 — 화면이 "일부는 직선"이라고 말할 수 있게.
    ///
    /// ⚠️ 숙소 복귀는 자동으로 이어 붙인 구간이라 **따로** 그린다(옅게). 마지막 날에는 서버가 주지 않는다.
    /// ⚠️ 렌터카 픽업·반납은 좌표가 없어 여기 들어오지 않는다.
    var mapRoutes: [MapRoute] {
        var builder = MapRouteBuilder(id: "day-\(index)")
        if let routes {
            for leg in routes {
                builder.append(from: leg.from, to: leg.to, path: Polyline.decode(leg.path), synthetic: leg.returning == true)
            }
            return builder.finish()
        }
        var previous: GeoPoint?
        for spot in spots {
            guard let point = spot.location else { continue }
            let path = Polyline.decode(spot.incomingLeg?.path)
            let from = spot.incomingLeg?.from ?? (splits.isEmpty ? previous : path.first)
            if let from { builder.append(from: from, to: point, path: path) }
            previous = point
        }
        var out = builder.finish()
        if let back, let destination = back.location,
           let last = back.leg.from ?? (splits.isEmpty ? previous : Polyline.decode(back.leg.path).first) {
            let path = Polyline.decode(back.leg.path)
            let routed = path.count >= 2
            out.append(MapRoute(id: "day-\(index)-back", points: routed ? path : [last, destination],
                                synthetic: true, routed: routed))
        }
        return out
    }
}

extension TripDay {
    /// 좌표 있는 장소만 핀이 된다. 순번은 **목록 순서**(좌표 없는 장소를 건너뛰지 않는다) — 화면의 번호와 같게.
    var pins: [MapPin] {
        spots.enumerated().compactMap { index, spot in
            guard let point = spot.point else { return nil }
            return MapPin(id: "spot-\(index)", title: spot.name.isEmpty ? "이름 없는 장소" : spot.name, point: point, order: index + 1)
        }
    }
}

// ⚠️ 이 확장은 `Contract.swift`가 아니라 여기 있다 — `MapRoute`·`MapPin`은 앱 타깃에만 있고
// 계약 파일은 위젯·워치와 함께 쓰이기 때문이다(거기서는 지도 타입을 모른다).
extension TripRouteDay {
    /// 그 날의 동선. 구간에 조회된 경로가 있으면 도로를 따르고, 없으면 두 점을 곧게 잇는다.
    /// ⚠️ 일자 지도(`DayPlanDay.mapRoutes`)와 **같은 규칙**이다.
    func mapRoutes(colorIndex: Int) -> [MapRoute] {
        var builder = MapRouteBuilder(id: "trip-day-\(index)", colorIndex: colorIndex)
        for leg in legs {
            builder.append(from: leg.from, to: leg.to, path: Polyline.decode(leg.path), synthetic: leg.returning == true)
        }
        return builder.finish()
    }

    /// 핀. 번호는 **그 날 안에서** 매긴다 — 여행 전체에 1..N을 매기면 14일차가 60번이 된다.
    var pins: [MapPin] {
        spots.enumerated().map { index, spot in
            MapPin(id: "trip-\(self.index)-\(index)",
                   title: spot.name.isEmpty ? "이름 없는 장소" : spot.name,
                   point: spot.location, order: index + 1)
        }
    }
}

/// 구간의 출발점이 앞 구간의 도착점과 다르면 선도 끊는다. 서로 다른 가지를 이어 그리지 않는다.
private struct MapRouteBuilder {
    let id: String
    var colorIndex: Int = 0
    private var routes: [MapRoute] = []
    private var points: [GeoPoint] = []
    private var last: GeoPoint?
    private var routed = true

    init(id: String, colorIndex: Int = 0) { self.id = id; self.colorIndex = colorIndex }

    mutating func append(from: GeoPoint, to: GeoPoint, path: [GeoPoint], synthetic: Bool = false) {
        if synthetic {
            flush()
            routes.append(MapRoute(id: "\(id)-return-\(routes.count)", points: path.count >= 2 ? path : [from, to],
                                   synthetic: true, routed: path.count >= 2, colorIndex: colorIndex))
            return
        }
        if let last, last != from { flush() }
        if points.isEmpty { points.append(from) }
        if path.count >= 2 { points.append(contentsOf: path) }
        else { points.append(to); routed = false }
        last = to
    }

    private mutating func flush() {
        if points.count >= 2 {
            routes.append(MapRoute(id: routes.isEmpty ? id : "\(id)-\(routes.count)", points: points,
                                   synthetic: false, routed: routed, colorIndex: colorIndex))
        }
        points = []
        routed = true
        last = nil
    }

    mutating func finish() -> [MapRoute] { flush(); return routes }
}
