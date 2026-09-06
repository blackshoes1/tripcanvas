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
    var regionHint: Bool = true
    var onPick: ((MapPick) -> Void)? = nil

    private var usesKakao: Bool {
        if let anchor = focus ?? pins.first?.point { return MapRegion.isKorea(anchor) }
        return regionHint
    }

    var body: some View {
        Group {
            if usesKakao {
                KakaoMapContainer(pins: pins, routes: routes, focus: focus, onPick: onPick)
            } else {
                GoogleMapContainer(pins: pins, routes: routes, focus: focus, onPick: onPick)
            }
        }
        // 엔진이 바뀌면 뷰를 새로 만든다 — 같은 자리에 다른 SDK를 끼워 넣지 않는다.
        .id(usesKakao ? "kakao" : "google")
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
        var points: [GeoPoint] = []
        var allRouted = true
        var previous: GeoPoint?

        for spot in spots {
            guard let point = spot.location else { continue }
            defer { previous = point }
            guard previous != nil else { points.append(point); continue }
            // 조회된 경로는 출발점 근처에서 시작해 도착점에서 끝난다 — 그대로 이어 붙이면 선이 이어진다.
            let path = Polyline.decode(spot.incomingLeg?.path)
            if path.count >= 2 {
                points.append(contentsOf: path)
            } else {
                points.append(point)
                allRouted = false
            }
        }

        var out: [MapRoute] = []
        if points.count >= 2 {
            out.append(MapRoute(id: "day-\(index)", points: points, synthetic: false, routed: allRouted))
        }
        if let back, let destination = back.location, let last = spots.compactMap(\.location).last {
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
