import CoreLocation
import GoogleMaps
import SwiftUI

/// 지도에 찍을 핀 하나. 두 SDK가 같은 입력을 받는다.
struct MapPin: Identifiable, Hashable {
    enum Kind: String { case itinerary, candidate, searchResult }
    let id: String
    let title: String
    let point: GeoPoint
    /// 목록 순서(1부터). 동선 위에서 몇 번째인지 보이게
    let order: Int
    var kind: Kind = .itinerary
}

/// 지도에 그릴 동선 하나. 두 SDK가 같은 입력을 받는다.
///
/// ⚠️ 점들이 **실제 도로일 수도, 두 점을 곧게 이은 직선일 수도** 있다. 서버가 그 구간의 경로를
/// 조회해 뒀으면(`DayPlanLeg.path`) 도로를 따르고, 아니면 직선이다.
/// 그 사실은 `routed`로 실어 보내고 **화면이 말해야 한다** — 직선을 도로처럼 보이게 두면 거짓말이 된다.
struct MapRoute: Identifiable, Hashable {
    let id: String
    /// 순서대로 이을 점들. 두 개 미만이면 그릴 것이 없다.
    let points: [GeoPoint]
    /// 숙소 복귀처럼 **자동으로 이어 붙인** 구간인가 — 사용자가 넣은 이동이 아니라 옅게 그린다.
    let synthetic: Bool
    /// 이 선의 **모든** 구간이 실제 경로인가. 하나라도 직선이면 false다.
    var routed: Bool = false
    /// 며칠째 동선인가 — 여행 전체를 볼 때 날마다 색을 나눈다. **음수면 기본색**(하루만 볼 때).
    var colorIndex: Int = -1
}

/// 지도에서 사용자가 고른 자리. POI를 탭했으면 그 신원(placeId·이름)까지 온다.
struct MapPick: Hashable {
    let point: GeoPoint
    let name: String?
    let placeId: String?
}

/// 해외 지도 — Google Maps SDK.
///
/// POI 아이콘을 탭하면 `placeId`가 그대로 온다(웹의 `clickableIcons`와 같다). 그래서 좌표를 되짚는
/// 추측 없이 '탭한 그 장소'를 담을 수 있다.
struct GoogleMapContainer: UIViewRepresentable {
    let pins: [MapPin]
    var routes: [MapRoute] = []
    let focus: GeoPoint?
    /// 고른 장소가 없을 때 맞출 사각형(장면). nil이면 그린 것 전부.
    var frame: MapBounds? = nil
    let onPick: ((MapPick) -> Void)?
    var preservesCamera = false
    var selectedPinID: String? = nil
    var onPinSelected: ((String) -> Void)? = nil
    var onAreaChanged: ((PlaceSearchArea) -> Void)? = nil
    /// 숨겨진 동안 뷰를 감춘다(`isHidden`) — 그리지 않지만 버리지도 않아 다시 보일 때 타일이 그대로다.
    var isVisible = true

    func makeCoordinator() -> Coordinator { Coordinator(onPick: onPick) }

    func makeUIView(context: Context) -> GMSMapView {
        let options = GMSMapViewOptions()
        options.frame = .zero
        options.camera = GMSCameraPosition.camera(
            withLatitude: focus?.lat ?? pins.first?.point.lat ?? 35.0,
            longitude: focus?.lng ?? pins.first?.point.lng ?? 135.0,
            zoom: 12)
        let mapView = GMSMapView(options: options)
        mapView.delegate = context.coordinator
        mapView.settings.compassButton = true
        mapView.isHidden = !isVisible
        context.coordinator.onPinSelected = onPinSelected
        context.coordinator.onAreaChanged = onAreaChanged
        context.coordinator.render(pins: pins, routes: routes, focus: focus, frame: frame, on: mapView, animated: false,
                                   preservesCamera: preservesCamera, selectedPinID: selectedPinID)
        return mapView
    }

    func updateUIView(_ mapView: GMSMapView, context: Context) {
        mapView.isHidden = !isVisible
        context.coordinator.onPick = onPick
        context.coordinator.onPinSelected = onPinSelected
        context.coordinator.onAreaChanged = onAreaChanged
        context.coordinator.render(pins: pins, routes: routes, focus: focus, frame: frame, on: mapView, animated: true,
                                   preservesCamera: preservesCamera, selectedPinID: selectedPinID)
    }

    final class Coordinator: NSObject, GMSMapViewDelegate {
        var onPick: ((MapPick) -> Void)?
        var onPinSelected: ((String) -> Void)?
        var onAreaChanged: ((PlaceSearchArea) -> Void)?
        private var renderedSelection: String?
        private var rendered: [MapPin] = []
        private var renderedFocus: GeoPoint?
        private var renderedFrame: MapBounds?
        private var markers: [GMSMarker] = []
        private var pickMarker: GMSMarker?
        private var renderedRoutes: [MapRoute] = []
        private var polylines: [GMSPolyline] = []
        /// 뷰가 아직 0×0일 때 요청된 맞춤 — SDK가 줌을 못 정하므로 첫 idle(레이아웃 뒤)까지 미룬다.
        private var pendingFit: MapBounds?

        init(onPick: ((MapPick) -> Void)?) { self.onPick = onPick }

        func render(pins: [MapPin], routes: [MapRoute], focus: GeoPoint?, frame: MapBounds? = nil, on mapView: GMSMapView,
                    animated: Bool, preservesCamera: Bool = false, selectedPinID: String? = nil) {
            // 동선이 **처음** 도착하는 순간(핀은 그대로)에는 한 번 더 맞춘다 — 숙소 복귀처럼 핀 밖으로 나가는
            // 선이 그때 생긴다. 그 뒤 도로가 채워져 선이 바뀔 때는 움직이지 않는다(보고 있는 지도를 흔들지 않는다).
            // ⚠️ 아래에서 renderedRoutes를 덮어쓰기 전에 판정한다.
            let routesArrived = renderedRoutes.isEmpty && !routes.isEmpty && !rendered.isEmpty && pins == rendered
            if routes != renderedRoutes {
                polylines.forEach { $0.map = nil }
                polylines = routes.compactMap { route in
                    guard route.points.count >= 2 else { return nil }   // 점 하나로는 선이 없다
                    let path = GMSMutablePath()
                    for p in route.points { path.add(CLLocationCoordinate2D(latitude: p.lat, longitude: p.lng)) }
                    let line = GMSPolyline(path: path)
                    // 자동으로 이어 붙인 구간(숙소 복귀)은 옅고 가늘게 — 내가 넣은 이동과 구분한다.
                    let base = MapPalette.color(route.colorIndex)
                    line.strokeColor = base.withAlphaComponent(route.synthetic ? 0.35 : 0.85)
                    line.strokeWidth = route.synthetic ? 2 : 4
                    line.geodesic = true
                    line.map = mapView
                    return line
                }
                renderedRoutes = routes
            }
            let pinsChanged = pins != rendered
            if pinsChanged || renderedSelection != selectedPinID {
                markers.forEach { $0.map = nil }
                markers = pins.map { pin in
                    let marker = GMSMarker(position: CLLocationCoordinate2D(latitude: pin.point.lat, longitude: pin.point.lng))
                    marker.title = pin.title
                    marker.snippet = pin.kind == .itinerary ? "\(pin.order)번째" : pin.kind == .candidate ? "가고 싶은 곳" : "검색 결과"
                    marker.userData = pin.id
                    marker.icon = MapPinImage.make(pin: pin, selected: pin.id == selectedPinID)
                    marker.map = mapView
                    return marker
                }
                rendered = pins
                renderedSelection = selectedPinID
            }
            if let pending = pendingFit, mapView.bounds.width > 0, mapView.bounds.height > 0 {
                pendingFit = nil
                fit(bounds: pending, on: mapView, animated: false)
            }
            // 카메라 — 고른 장소가 있으면 거기로, 없으면 **그린 것 전부**가 보이게(그날 동선 통째로).
            // 고른 장소가 있는 동안은 동선이 바뀌어도 거기 머문다. 고름을 풀면 다시 전부를 보인다.
            let focusCleared = focus == nil && renderedFocus != nil
            let frameChanged = frame != renderedFrame
            renderedFrame = frame
            if let focus, focus != renderedFocus {
                renderedFocus = focus
                let update = GMSCameraUpdate.setTarget(CLLocationCoordinate2D(latitude: focus.lat, longitude: focus.lng), zoom: 15)
                if animated { mapView.animate(with: update) } else { mapView.moveCamera(update) }
            } else if focus == nil, !preservesCamera, pinsChanged || routesArrived || focusCleared || frameChanged {
                renderedFocus = nil
                // 장면(frame)이 있으면 거기만, 없으면 그린 것 전부.
                if let frame { fit(bounds: frame, on: mapView, animated: animated) }
                else { fit(pins: pins, routes: routes, on: mapView, animated: animated) }
            }
        }

        func mapView(_ mapView: GMSMapView, idleAt position: GMSCameraPosition) {
            // 첫 프레임 전에 미뤄 둔 맞춤은 레이아웃이 끝난 첫 idle에 한다.
            if let pending = pendingFit, mapView.bounds.width > 0, mapView.bounds.height > 0 {
                pendingFit = nil
                fit(bounds: pending, on: mapView, animated: false)
            }
            let region = mapView.projection.visibleRegion()
            let corners = [region.nearLeft, region.nearRight, region.farLeft, region.farRight]
            let area = PlaceSearchArea(south: corners.map(\.latitude).min()!, west: corners.map(\.longitude).min()!,
                                       north: corners.map(\.latitude).max()!, east: corners.map(\.longitude).max()!)
            if area.isValid { onAreaChanged?(area) }
        }

        func mapView(_ mapView: GMSMapView, didTap marker: GMSMarker) -> Bool {
            guard let id = marker.userData as? String, let onPinSelected else { return false }
            onPinSelected(id)
            return true
        }

        /// 그린 것 전부가 보이게 — 핀과 동선의 점을 담는 사각형(`MapBounds`)을 맞춘다. 웹의 `fit(pts, 48)`과 같다.
        private func fit(pins: [MapPin], routes: [MapRoute], on mapView: GMSMapView, animated: Bool) {
            guard let bounds = MapBounds.covering(pins: pins, routes: routes) else { return }
            fit(bounds: bounds, on: mapView, animated: animated)
        }

        /// ⚠️ 뷰가 아직 0×0이면(첫 프레임 전) SDK가 줌을 정하지 못한다 — 미뤄 두었다가 첫 idle에 맞춘다.
        private func fit(bounds: MapBounds, on mapView: GMSMapView, animated: Bool) {
            guard mapView.bounds.width > 0, mapView.bounds.height > 0 else { pendingFit = bounds; return }
            pendingFit = nil
            let update: GMSCameraUpdate
            if bounds.isPoint {
                update = GMSCameraUpdate.setTarget(CLLocationCoordinate2D(latitude: bounds.center.lat, longitude: bounds.center.lng),
                                                   zoom: Float(MapBounds.pointZoom))
            } else {
                let box = GMSCoordinateBounds(coordinate: CLLocationCoordinate2D(latitude: bounds.south, longitude: bounds.west),
                                              coordinate: CLLocationCoordinate2D(latitude: bounds.north, longitude: bounds.east))
                update = GMSCameraUpdate.fit(box, withPadding: 48)
            }
            if animated { mapView.animate(with: update) } else { mapView.moveCamera(update) }
        }

        private func showPick(at coordinate: CLLocationCoordinate2D, title: String?, on mapView: GMSMapView) {
            pickMarker?.map = nil
            let marker = GMSMarker(position: coordinate)
            marker.title = title ?? "여기"
            marker.icon = GMSMarker.markerImage(with: .systemOrange)
            marker.map = mapView
            pickMarker = marker
        }

        func mapView(_ mapView: GMSMapView, didTapAt coordinate: CLLocationCoordinate2D) {
            guard let onPick else { return }
            showPick(at: coordinate, title: nil, on: mapView)
            onPick(MapPick(point: GeoPoint(lat: coordinate.latitude, lng: coordinate.longitude), name: nil, placeId: nil))
        }

        func mapView(_ mapView: GMSMapView, didTapPOIWithPlaceID placeID: String, name: String, location: CLLocationCoordinate2D) {
            guard let onPick else { return }
            showPick(at: location, title: name, on: mapView)
            onPick(MapPick(point: GeoPoint(lat: location.latitude, lng: location.longitude), name: name, placeId: placeID))
        }
    }
}

/// SDK에는 벡터 심볼 대신 색과 번호를 그린 비트맵을 넘긴다. 두 지도에서 모양이 같다.
enum MapPinImage {
    static func make(pin: MapPin, selected: Bool) -> UIImage {
        let color: UIColor = selected ? .systemOrange : pin.kind == .candidate ? .systemGreen : .systemBlue
        return UIGraphicsImageRenderer(size: CGSize(width: 36, height: 36)).image { _ in
            UIColor.white.setFill()
            UIBezierPath(ovalIn: CGRect(x: 0, y: 0, width: 36, height: 36)).fill()
            color.setFill()
            UIBezierPath(ovalIn: CGRect(x: 2, y: 2, width: 32, height: 32)).fill()
            if pin.kind == .itinerary {
                let text = String(pin.order) as NSString
                let attributes: [NSAttributedString.Key: Any] = [.font: UIFont.boldSystemFont(ofSize: 15), .foregroundColor: UIColor.white]
                let size = text.size(withAttributes: attributes)
                text.draw(at: CGPoint(x: (36 - size.width) / 2, y: (36 - size.height) / 2), withAttributes: attributes)
            } else {
                UIImage(systemName: pin.kind == .candidate ? "star.fill" : "magnifyingglass")?
                    .withTintColor(.white, renderingMode: .alwaysOriginal)
                    .draw(in: CGRect(x: 9, y: 9, width: 18, height: 18))
            }
        }
    }
}
