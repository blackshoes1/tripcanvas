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
        context.coordinator.render(pins: pins, focus: focus, on: mapView, animated: false)
        return mapView
    }

    func updateUIView(_ mapView: GMSMapView, context: Context) {
        context.coordinator.onPick = onPick
        context.coordinator.render(pins: pins, focus: focus, on: mapView, animated: true)
    }

    final class Coordinator: NSObject, GMSMapViewDelegate {
        var onPick: ((MapPick) -> Void)?
        private var rendered: [MapPin] = []
        private var renderedFocus: GeoPoint?
        private var markers: [GMSMarker] = []
        private var pickMarker: GMSMarker?

        init(onPick: ((MapPick) -> Void)?) { self.onPick = onPick }

        func render(pins: [MapPin], focus: GeoPoint?, on mapView: GMSMapView, animated: Bool) {
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
