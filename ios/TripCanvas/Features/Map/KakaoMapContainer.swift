import KakaoMapsSDK
import SwiftUI
import UIKit

/// 국내 지도 — 카카오맵 SDK v2.
///
/// 엔진 생명주기가 UIKit 뷰 컨트롤러에 맞춰져 있어(prepare → addViews → activate, 화면을 벗어나면 pause)
/// 그 순서를 여기서 그대로 지킨다. 순서가 어긋나면 오류 없이 **검은 지도**만 남는다.
///
/// 검색 결과로 추가한 핀은 ID로 선택하고, 일반 지형 선택은 좌표만 전달한다.
struct KakaoMapContainer: UIViewRepresentable {
    let pins: [MapPin]
    var routes: [MapRoute] = []
    let focus: GeoPoint?
    let onPick: ((MapPick) -> Void)?
    var preservesCamera = false
    var selectedPinID: String? = nil
    var onPinSelected: ((String) -> Void)? = nil
    var onAreaChanged: ((PlaceSearchArea) -> Void)? = nil
    /// 숨겨진 동안 엔진을 쉬게 한다(pause). 버리지 않으므로 다시 보일 때 인증·타일을 되풀이하지 않는다.
    var isVisible = true

    func makeCoordinator() -> Coordinator { Coordinator(pins: pins, routes: routes, focus: focus, onPick: onPick) }

    func makeUIView(context: Context) -> KMViewContainer {
        let container = KMViewContainer(frame: CGRect(x: 0, y: 0, width: 320, height: 320))
        context.coordinator.preservesCamera = preservesCamera
        context.coordinator.onPinSelected = onPinSelected
        context.coordinator.onAreaChanged = onAreaChanged
        context.coordinator.attach(container)
        context.coordinator.setVisible(isVisible)
        return container
    }

    func updateUIView(_ container: KMViewContainer, context: Context) {
        context.coordinator.onPick = onPick
        context.coordinator.preservesCamera = preservesCamera
        context.coordinator.onPinSelected = onPinSelected
        context.coordinator.onAreaChanged = onAreaChanged
        context.coordinator.update(pins: pins, routes: routes, focus: focus, selectedPinID: selectedPinID)
        context.coordinator.setVisible(isVisible)
    }

    static func dismantleUIView(_ container: KMViewContainer, coordinator: Coordinator) {
        coordinator.detach()
    }

    final class Coordinator: NSObject, MapControllerDelegate, KakaoMapEventDelegate {
        private static let viewName = "mapview"
        private static let layerId = "spots"
        private static let pickStyleId = "pickPin"
        private static let routeLayerId = "dayRoute"
        private static let routeStyleId = "dayRouteStyle"

        var onPick: ((MapPick) -> Void)?
        var preservesCamera = false
        var onPinSelected: ((String) -> Void)?
        var onAreaChanged: ((PlaceSearchArea) -> Void)?
        private var selectedPinID: String?
        private var shouldMoveCamera = true
        private var pins: [MapPin]
        private var focus: GeoPoint?
        private var routes: [MapRoute] = []
        private var controller: KMController?
        private weak var container: KMViewContainer?
        private var ready = false
        private var pendingRender = true
        private var registeredPinStyles: Set<String> = []
        private var pickPoi: Poi?

        init(pins: [MapPin], routes: [MapRoute], focus: GeoPoint?, onPick: ((MapPick) -> Void)?) {
            self.pins = pins
            self.routes = routes
            self.focus = focus
            self.onPick = onPick
        }

        func attach(_ container: KMViewContainer) {
            self.container = container
            let controller = KMController(viewContainer: container)
            controller.delegate = self
            self.controller = controller
            controller.prepareEngine()
            controller.activateEngine()
        }

        func detach() {
            mapView?.eventDelegate = nil
            controller?.pauseEngine()
            controller?.resetEngine()
            controller = nil
            container = nil
            ready = false
            paused = false
            registeredPinStyles = []
        }

        /// 보이지 않는 동안은 엔진을 멈춘다 — 화면 뒤에서 그리는 것은 배터리다. 다시 보이면 이어서 그린다.
        /// ⚠️ 상태가 바뀔 때만 부른다: 이미 도는 엔진에 activate를 또 걸거나, 쉬는 엔진을 또 pause 하지 않는다.
        private var paused = false
        func setVisible(_ visible: Bool) {
            container?.isHidden = !visible
            guard let controller else { return }
            if visible, paused { controller.activateEngine(); paused = false }
            else if !visible, !paused { controller.pauseEngine(); paused = true }
        }

        func update(pins: [MapPin], routes: [MapRoute], focus: GeoPoint?, selectedPinID: String? = nil) {
            let changed = pins != self.pins || routes != self.routes || focus != self.focus || selectedPinID != self.selectedPinID
            if focus != self.focus || (!preservesCamera && pins != self.pins) { shouldMoveCamera = true }
            self.pins = pins
            self.routes = routes
            self.focus = focus
            self.selectedPinID = selectedPinID
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
            // 인증 중 먼저 끝난 레이아웃을 반영한다. 이후 크기 변경은 containerDidResized가 처리한다.
            if let container { map.viewRect = container.bounds }
            let manager = map.getLabelManager()
            _ = manager.addLabelLayer(option: LabelLayerOptions(
                layerID: Self.layerId, competitionType: .none, competitionUnit: .poi, orderType: .rank, zOrder: 0))
            let selectedPoint = MapPin(id: "selected-point", title: "선택한 위치", point: GeoPoint(lat: 0, lng: 0), order: 0, kind: .searchResult)
            let pickIcon = PoiIconStyle(symbol: MapPinImage.make(pin: selectedPoint, selected: true), anchorPoint: CGPoint(x: 0.5, y: 0.5))
            manager.addPoiStyle(PoiStyle(styleID: Self.pickStyleId, styles: [PerLevelPoiStyle(iconStyle: pickIcon, level: 0)]))
            // 동선 스타일 — 카카오는 **미리 등록한 목록에서 번호로** 고른다.
            // 짝수는 보통 선, 홀수는 자동 합성(숙소 복귀). 앞의 두 개는 기본색(하루만 볼 때),
            // 그 뒤로 일자 색 10개가 같은 규칙으로 이어진다.
            let routeManager = map.getRouteManager()
            let pair: (UIColor) -> [RouteStyle] = { color in [
                RouteStyle(styles: [PerLevelRouteStyle(width: 12, color: color.withAlphaComponent(0.85),
                                                       strokeWidth: 0, strokeColor: .clear, level: 0)]),
                RouteStyle(styles: [PerLevelRouteStyle(width: 6, color: color.withAlphaComponent(0.35),
                                                       strokeWidth: 0, strokeColor: .clear, level: 0)])
            ] }
            let styles = pair(.tintColor) + MapPalette.colors.flatMap(pair)
            routeManager.addRouteStyleSet(RouteStyleSet(styleID: Self.routeStyleId, styles: styles))
            _ = routeManager.addRouteLayer(layerID: Self.routeLayerId, zOrder: 0)

            map.eventDelegate = self
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
                // 위에서 등록한 순서와 같은 규칙으로 번호를 고른다(기본 한 쌍 + 일자 색 쌍들).
                let slot = route.colorIndex < 0 ? 0 : 1 + (route.colorIndex % MapPalette.colors.count)
                options.segments = [RouteSegment(
                    points: route.points.map { MapPoint(longitude: $0.lng, latitude: $0.lat) },
                    styleIndex: UInt(slot * 2 + (route.synthetic ? 1 : 0)))]
                _ = layer.addRoute(option: options)
            }
        }

        private func render() {
            pendingRender = false
            guard let map = mapView, let layer = map.getLabelManager().getLabelLayer(layerID: Self.layerId) else { return }
            drawRoutes(on: map)
            layer.clearAllItems()
            for pin in pins {
                let selected = pin.id == selectedPinID
                let style = "pin-\(pin.kind.rawValue)-\(pin.kind == .itinerary ? pin.order : 0)-\(selected)"
                if registeredPinStyles.insert(style).inserted {
                    let image = MapPinImage.make(pin: pin, selected: selected)
                    let icon = PoiIconStyle(symbol: image, anchorPoint: CGPoint(x: 0.5, y: 0.5))
                    map.getLabelManager().addPoiStyle(PoiStyle(styleID: style, styles: [PerLevelPoiStyle(iconStyle: icon, level: 0)]))
                }
                let options = PoiOptions(styleID: style, poiID: pin.id)
                options.rank = pin.order
                options.clickable = true
                if let poi = layer.addPoi(option: options, at: MapPoint(longitude: pin.point.lng, latitude: pin.point.lat)) {
                    poi.show()
                }
            }
            guard shouldMoveCamera else { return }
            shouldMoveCamera = false
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

        func terrainDidTapped(kakaoMap map: KakaoMap, position: MapPoint) {
            guard let onPick else { return }
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

        func poiDidTapped(kakaoMap: KakaoMap, layerID: String, poiID: String, position: MapPoint) {
            guard layerID == Self.layerId, pins.contains(where: { $0.id == poiID }) else { return }
            onPinSelected?(poiID)
        }

        func cameraDidStopped(kakaoMap map: KakaoMap, by: MoveBy) {
            let rect = map.viewRect
            let corners = [CGPoint(x: rect.minX, y: rect.minY), CGPoint(x: rect.maxX, y: rect.minY),
                           CGPoint(x: rect.minX, y: rect.maxY), CGPoint(x: rect.maxX, y: rect.maxY)]
                .map { map.getPosition($0).wgsCoord }
            let area = PlaceSearchArea(south: corners.map(\.latitude).min()!, west: corners.map(\.longitude).min()!,
                                       north: corners.map(\.latitude).max()!, east: corners.map(\.longitude).max()!)
            if area.isValid { onAreaChanged?(area) }
        }
    }
}
