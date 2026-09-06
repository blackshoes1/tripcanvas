import SwiftUI

/// 듀얼 엔진 — 국내는 카카오, 해외는 구글. 웹의 `inKorea` 판정과 같다.
///
/// 어느 엔진인지는 **핀(또는 초점)의 위치**로 정한다. 핀이 하나도 없으면 사용자가 무엇을 하려는지
/// 모르므로 `regionHint`를 따른다(검색어에 한글이 있으면 국내 — `isKoreanSearch`).
struct MapEngineView: View {
    let pins: [MapPin]
    /// 장소를 순서대로 이은 선. ⚠️ 실제 도로가 아니다 — 화면이 그 사실을 함께 말해야 한다.
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
    /// ⚠️ 숙소 복귀는 자동으로 이어 붙인 구간이라 **따로** 그린다(옅게). 마지막 날에는 서버가 주지 않는다.
    /// ⚠️ 렌터카 픽업·반납은 좌표가 없어 여기 들어오지 않는다.
    var mapRoutes: [MapRoute] {
        let located = spots.compactMap(\.location)
        var out: [MapRoute] = []
        if located.count >= 2 { out.append(MapRoute(id: "day-\(index)", points: located, synthetic: false)) }
        if let back = back?.location, let last = located.last {
            out.append(MapRoute(id: "day-\(index)-back", points: [last, back], synthetic: true))
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
