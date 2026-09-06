import CoreLocation
import GoogleMaps
import SwiftUI

/// 지도에 찍을 핀 하나. 두 SDK가 같은 입력을 받는다.
struct MapPin: Identifiable, Hashable {
    let id: String
    let title: String
    let point: GeoPoint
    /// 목록 순서(1부터). 동선 위에서 몇 번째인지 보이게
    let order: Int
}

/// 지도에 그릴 동선 하나. 두 SDK가 같은 입력을 받는다.
///
/// ⚠️ **실제 도로가 아니라 장소를 순서대로 이은 직선이다.** 서버에는 구간 캐시가 없어
/// 경로 좌표열을 주지 않는다(`travelTimeSource: STRAIGHT_LINE_ESTIMATE`).
/// 그래서 화면은 이것이 직선임을 함께 말해야 한다 — 도로처럼 보이면 거짓말이 된다.
struct MapRoute: Identifiable, Hashable {
    let id: String
    /// 순서대로 이을 점들. 두 개 미만이면 그릴 것이 없다.
    let points: [GeoPoint]
    /// 숙소 복귀처럼 **자동으로 이어 붙인** 구간인가 — 사용자가 넣은 이동이 아니라 옅게 그린다.
    let synthetic: Bool
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
    let onPick: ((MapPick) -> Void)?

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
        context.coordinator.render(pins: pins, routes: routes, focus: focus, on: mapView, animated: false)
        return mapView
    }

    func updateUIView(_ mapView: GMSMapView, context: Context) {
        context.coordinator.onPick = onPick
        context.coordinator.render(pins: pins, routes: routes, focus: focus, on: mapView, animated: true)
    }

    final class Coordinator: NSObject, GMSMapViewDelegate {
        var onPick: ((MapPick) -> Void)?
        private var rendered: [MapPin] = []
        private var renderedFocus: GeoPoint?
        private var markers: [GMSMarker] = []
        private var pickMarker: GMSMarker?
        private var renderedRoutes: [MapRoute] = []
        private var polylines: [GMSPolyline] = []

        init(onPick: ((MapPick) -> Void)?) { self.onPick = onPick }

        func render(pins: [MapPin], routes: [MapRoute], focus: GeoPoint?, on mapView: GMSMapView, animated: Bool) {
            if routes != renderedRoutes {
                polylines.forEach { $0.map = nil }
                polylines = routes.compactMap { route in
                    guard route.points.count >= 2 else { return nil }   // 점 하나로는 선이 없다
                    let path = GMSMutablePath()
                    for p in route.points { path.add(CLLocationCoordinate2D(latitude: p.lat, longitude: p.lng)) }
                    let line = GMSPolyline(path: path)
                    // 자동으로 이어 붙인 구간(숙소 복귀)은 옅고 가늘게 — 내가 넣은 이동과 구분한다.
                    line.strokeColor = route.synthetic ? UIColor.tintColor.withAlphaComponent(0.35)
                                                       : UIColor.tintColor.withAlphaComponent(0.85)
                    line.strokeWidth = route.synthetic ? 2 : 4
                    line.geodesic = true
                    line.map = mapView
                    return line
                }
                renderedRoutes = routes
            }
            if pins != rendered {
                markers.forEach { $0.map = nil }
                markers = pins.map { pin in
                    let marker = GMSMarker(position: CLLocationCoordinate2D(latitude: pin.point.lat, longitude: pin.point.lng))
                    marker.title = pin.title
                    marker.snippet = "\(pin.order)번째"
                    marker.map = mapView
                    return marker
                }
                rendered = pins
                fit(pins: pins, on: mapView, animated: animated)
            }
            if let focus, focus != renderedFocus {
                renderedFocus = focus
                let update = GMSCameraUpdate.setTarget(CLLocationCoordinate2D(latitude: focus.lat, longitude: focus.lng), zoom: 15)
                if animated { mapView.animate(with: update) } else { mapView.moveCamera(update) }
            }
        }

        private func fit(pins: [MapPin], on mapView: GMSMapView, animated: Bool) {
            guard let first = pins.first else { return }
            if pins.count == 1 {
                let update = GMSCameraUpdate.setTarget(CLLocationCoordinate2D(latitude: first.point.lat, longitude: first.point.lng), zoom: 14)
                if animated { mapView.animate(with: update) } else { mapView.moveCamera(update) }
                return
            }
            var bounds = GMSCoordinateBounds()
            for pin in pins {
                bounds = bounds.includingCoordinate(CLLocationCoordinate2D(latitude: pin.point.lat, longitude: pin.point.lng))
            }
            let update = GMSCameraUpdate.fit(bounds, withPadding: 48)
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
