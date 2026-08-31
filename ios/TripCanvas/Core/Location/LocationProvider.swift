import CoreLocation
import Observation

/// 위치는 **필요할 때 한 번만** 묻는다(§41·§42).
/// 연속 추적·백그라운드 지오펜싱은 이번 단계에서 만들지 않는다 — 앱 첫 실행에 권한을 몰아 요청하지도 않는다.
/// 지도에서 현재 위치가 필요할 때 그 자리에서 요청한다.
///
/// 받은 좌표는 서버에 영구 저장하지 않는다(§43). 필요해지면 `TodayResponse`의 currentLocation을
/// 채우는 요청 파라미터로만 실어 보낸다.
@Observable
@MainActor
final class LocationProvider: NSObject, CLLocationManagerDelegate {
    enum Permission { case unknown, denied, granted }

    private(set) var permission: Permission = .unknown
    private(set) var lastPoint: GeoPoint?
    private(set) var lastUpdatedAt: Date?

    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<GeoPoint?, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        syncPermission()
    }

    /// 한 번 조회. 권한이 없으면 그 자리에서 요청하고, 거부돼 있으면 nil을 돌려준다(화면은 계속 동작).
    func requestOnce() async -> GeoPoint? {
        syncPermission()
        if permission == .denied { return nil }
        if permission == .unknown {
            manager.requestWhenInUseAuthorization()
        }
        return await withCheckedContinuation { (continuation: CheckedContinuation<GeoPoint?, Never>) in
            self.continuation = continuation
            manager.requestLocation()
        }
    }

    private func syncPermission() {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: permission = .granted
        case .denied, .restricted: permission = .denied
        default: permission = .unknown
        }
    }

    private func finish(_ point: GeoPoint?) {
        if let point {
            lastPoint = point
            lastUpdatedAt = Date()
        }
        continuation?.resume(returning: point)
        continuation = nil
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let coordinate = locations.last?.coordinate
        Task { @MainActor in
            finish(coordinate.map { GeoPoint(lat: $0.latitude, lng: $0.longitude) })
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in finish(nil) }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            syncPermission()
            if permission == .denied { finish(nil) }
        }
    }
}
