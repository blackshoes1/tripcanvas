import KakaoMapsSDK
import SwiftUI
import UIKit

/// 국내 지도 — 카카오맵 SDK v2.
///
/// 엔진 생명주기가 UIKit 뷰 컨트롤러에 맞춰져 있어(prepare → addViews → activate, 화면을 벗어나면 pause)
/// 그 순서를 여기서 그대로 지킨다. 순서가 어긋나면 오류 없이 **검은 지도**만 남는다.
///
/// ⚠️ 카카오 SDK는 POI 탭 신원을 주지 않는다(웹과 같은 제약). 여기서 오는 pick은 좌표뿐이다.
struct KakaoMapContainer: UIViewRepresentable {
    let pins: [MapPin]
    var routes: [MapRoute] = []
    let focus: GeoPoint?
    let onPick: ((MapPick) -> Void)?

    func makeCoordinator() -> Coordinator { Coordinator(pins: pins, routes: routes, focus: focus, onPick: onPick) }

    func makeUIView(context: Context) -> KMViewContainer {
        let container = KMViewContainer(frame: CGRect(x: 0, y: 0, width: 320, height: 320))
        context.coordinator.attach(container)
        return container
    }

    func updateUIView(_ container: KMViewContainer, context: Context) {
        context.coordinator.onPick = onPick
        context.coordinator.update(pins: pins, routes: routes, focus: focus)
    }

    static func dismantleUIView(_ container: KMViewContainer, coordinator: Coordinator) {
        coordinator.detach()
    }

    final class Coordinator: NSObject, MapControllerDelegate {
        private static let viewName = "mapview"
        private static let layerId = "spots"
        private static let styleId = "spotPin"
        private static let pickStyleId = "pickPin"
        private static let routeLayerId = "dayRoute"
        private static let routeStyleId = "dayRouteStyle"

        var onPick: ((MapPick) -> Void)?
        private var pins: [MapPin]
        private var focus: GeoPoint?
        private var routes: [MapRoute] = []
        private var controller: KMController?
        private var ready = false
        private var pendingRender = true
        private var tapHandler: DisposableEventHandler?
        private var pickPoi: Poi?

        init(pins: [MapPin], routes: [MapRoute], focus: GeoPoint?, onPick: ((MapPick) -> Void)?) {
            self.pins = pins
            self.routes = routes
            self.focus = focus
            self.onPick = onPick
        }

        func attach(_ container: KMViewContainer) {
            let controller = KMController(viewContainer: container)
            controller.delegate = self
            self.controller = controller
            controller.prepareEngine()
            controller.activateEngine()
        }

        func detach() {
            tapHandler?.dispose()
            tapHandler = nil
            controller?.pauseEngine()
            controller?.resetEngine()
            controller = nil
            ready = false
        }

        func update(pins: [MapPin], routes: [MapRoute], focus: GeoPoint?) {
            let changed = pins != self.pins || routes != self.routes || focus != self.focus
            self.pins = pins
            self.routes = routes
            self.focus = focus
            guard changed else { return }
            if ready { render() } else { pendingRender = true }
        }

        // MARK: MapControllerDelegate

        func addViews() {
            let start = focus ?? pins.first?.point ?? GeoPoint(lat: 37.5665, lng: 126.9780)
            let info = MapviewInfo(
                viewName: Self.viewName, viewInfoName: "map",
                defaultPosition: MapPoint(longitude: start.lng, latitude: start.lat), defaultLevel: 15)
            controller?.addView(info)
        }

        func addViewSucceeded(_ viewName: String, viewInfoName: String) {
            guard let map = mapView else { return }
            let manager = map.getLabelManager()
            _ = manager.addLabelLayer(option: LabelLayerOptions(
                layerID: Self.layerId, competitionType: .none, competitionUnit: .poi, orderType: .rank, zOrder: 0))
            if let symbol = UIImage(systemName: "mappin.circle.fill") {
                let icon = PoiIconStyle(symbol: symbol, anchorPoint: CGPoint(x: 0.5, y: 0.5))
                manager.addPoiStyle(PoiStyle(styleID: Self.styleId, styles: [PerLevelPoiStyle(iconStyle: icon, level: 0)]))
                let pickIcon = PoiIconStyle(symbol: symbol.withTintColor(.systemOrange, renderingMode: .alwaysOriginal), anchorPoint: CGPoint(x: 0.5, y: 0.5))
                manager.addPoiStyle(PoiStyle(styleID: Self.pickStyleId, styles: [PerLevelPoiStyle(iconStyle: pickIcon, level: 0)]))
            }
            // 동선 — 자동 합성 구간(숙소 복귀)을 구분하려고 스타일을 둘 둔다(styleIndex 0/1).
            let routeManager = map.getRouteManager()
            routeManager.addRouteStyleSet(RouteStyleSet(styleID: Self.routeStyleId, styles: [
                RouteStyle(styles: [PerLevelRouteStyle(width: 12, color: UIColor.tintColor.withAlphaComponent(0.85),
                                                       strokeWidth: 0, strokeColor: .clear, level: 0)]),
                RouteStyle(styles: [PerLevelRouteStyle(width: 6, color: UIColor.tintColor.withAlphaComponent(0.35),
                                                       strokeWidth: 0, strokeColor: .clear, level: 0)])
            ]))
            _ = routeManager.addRouteLayer(layerID: Self.routeLayerId, zOrder: 0)

            tapHandler = map.addMapTappedEventHandler(target: self, handler: Coordinator.mapTapped)
            ready = true
            if pendingRender { render() }
        }

        func addViewFailed(_ viewName: String, viewInfoName: String) {
            print("[TripCanvas] kakao map addView failed: \(viewName)")
        }

        func authenticationFailed(_ errorCode: Int, desc: String) {
            // 앱 키·번들 ID 제한이 맞지 않을 때 여기로 온다 — 화면에는 지도가 안 뜨는 것으로만 보인다.
            print("[TripCanvas] kakao map auth failed (\(errorCode)): \(desc)")
        }

        func containerDidResized(_ size: CGSize) {
            mapView?.viewRect = CGRect(origin: .zero, size: size)
        }

        // MARK: 그리기

        private var mapView: KakaoMap? {
            controller?.getView(Self.viewName) as? KakaoMap
        }

        /// 서버가 그 구간의 경로를 조회해 뒀으면 도로를 따르고, 아니면 두 점을 곧게 잇는다(`MapRoute.routed`).
        /// ⚠️ 직선을 도로처럼 보이게 두지 않는다 — 그 사실은 화면이 말한다.
        private func drawRoutes(on map: KakaoMap) {
            guard let layer = map.getRouteManager().getRouteLayer(layerID: Self.routeLayerId) else { return }
            layer.clearAllRoutes()
            for route in routes where route.points.count >= 2 {
                let options = RouteOptions(routeID: route.id, styleID: Self.routeStyleId, zOrder: 0)
                options.segments = [RouteSegment(
                    points: route.points.map { MapPoint(longitude: $0.lng, latitude: $0.lat) },
                    styleIndex: route.synthetic ? 1 : 0)]
                _ = layer.addRoute(option: options)
            }
        }

        private func render() {
            pendingRender = false
            guard let map = mapView, let layer = map.getLabelManager().getLabelLayer(layerID: Self.layerId) else { return }
            drawRoutes(on: map)
            layer.clearAllItems()
            for pin in pins {
                let options = PoiOptions(styleID: Self.styleId, poiID: pin.id)
                options.rank = pin.order
                if let poi = layer.addPoi(option: options, at: MapPoint(longitude: pin.point.lng, latitude: pin.point.lat)) {
                    poi.show()
                }
            }
            if let focus {
                map.moveCamera(CameraUpdate.make(target: MapPoint(longitude: focus.lng, latitude: focus.lat), zoomLevel: 16, mapView: map))
            } else if let first = pins.first {
                if pins.count == 1 {
                    map.moveCamera(CameraUpdate.make(target: MapPoint(longitude: first.point.lng, latitude: first.point.lat), zoomLevel: 15, mapView: map))
                } else {
                    // 전부 보이게 — 중심과 퍼진 정도로 레벨을 정한다(넓을수록 낮은 레벨).
                    let lats = pins.map(\.point.lat), lngs = pins.map(\.point.lng)
                    let center = MapPoint(longitude: (lngs.min()! + lngs.max()!) / 2, latitude: (lats.min()! + lats.max()!) / 2)
                    let span = max(lats.max()! - lats.min()!, lngs.max()! - lngs.min()!)
                    let level: Int = span > 1.5 ? 7 : span > 0.5 ? 9 : span > 0.15 ? 11 : span > 0.05 ? 13 : 14
                    map.moveCamera(CameraUpdate.make(target: center, zoomLevel: level, mapView: map))
                }
            }
        }

        private func mapTapped(_ param: ViewInteractionEventParam) {
            guard let onPick, let map = param.view as? KakaoMap else { return }
            let position = map.getPosition(param.point)
            let point = GeoPoint(lat: position.wgsCoord.latitude, lng: position.wgsCoord.longitude)
            if let layer = map.getLabelManager().getLabelLayer(layerID: Self.layerId) {
                pickPoi?.hide()
                if let poi = layer.addPoi(option: PoiOptions(styleID: Self.pickStyleId), at: position) {
                    poi.show()
                    pickPoi = poi
                }
            }
            onPick(MapPick(point: point, name: nil, placeId: nil))
        }
    }
}
