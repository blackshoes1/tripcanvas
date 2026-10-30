import CoreLocation
import Observation

@MainActor
protocol LocationManaging: AnyObject {
    var delegate: (any CLLocationManagerDelegate)? { get set }
    var authorizationStatus: CLAuthorizationStatus { get }
    func requestWhenInUseAuthorization()
    func requestLocation()
    func stopUpdatingLocation()
}
extension CLLocationManager: LocationManaging {}

/// 위치는 **필요할 때 한 번만** 묻는다(§41·§42).
/// 잠금 중 일정 장소 감시는 `ArrivalMonitor`가 맡는다. 앱 첫 실행에 권한을 몰아 요청하지 않는다.
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
    private(set) var lastHorizontalAccuracy: Double?

    private let manager: any LocationManaging
    private var continuations: [UUID: CheckedContinuation<GeoPoint?, Never>] = [:]
    private var timeoutTask: Task<Void, Never>?
    private let timeout: TimeInterval
    var pendingRequestCount: Int { continuations.count }

    override convenience init() { self.init(manager: CLLocationManager()) }

    init(manager: any LocationManaging, timeout: TimeInterval = 15) {
        self.manager = manager; self.timeout = timeout
        super.init()
        manager.delegate = self
        (manager as? CLLocationManager)?.desiredAccuracy = kCLLocationAccuracyHundredMeters
        syncPermission()
    }

    /// 한 번 조회. 권한이 없으면 그 자리에서 요청하고, 거부돼 있으면 nil을 돌려준다(화면은 계속 동작).
    func requestOnce() async -> GeoPoint? {
        syncPermission()
        if permission == .denied { return nil }
        let id = UUID()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                guard !Task.isCancelled else { continuation.resume(returning: nil); return }
                let first = continuations.isEmpty
                continuations[id] = continuation
                guard first else { return }
                timeoutTask = Task { [weak self, timeout] in
                    try? await Task.sleep(for: .seconds(timeout))
                    guard !Task.isCancelled else { return }
                    self?.finish(nil)
                }
                if permission == .unknown { manager.requestWhenInUseAuthorization() }
                else { manager.requestLocation() }
            }
        } onCancel: { Task { @MainActor [weak self] in self?.cancel(id) } }
    }

    private func syncPermission() {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: permission = .granted
        case .denied, .restricted: permission = .denied
        default: permission = .unknown
        }
    }

    /// 도착 판정에는 오래됐거나 대략적인 좌표를 재사용하지 않는다.
    func freshArrivalPoint(at now: Date = Date()) -> GeoPoint? {
        guard let measured = lastUpdatedAt, let accuracy = lastHorizontalAccuracy,
              accuracy >= 0, accuracy <= 100, (-5...60).contains(now.timeIntervalSince(measured)) else { return nil }
        return lastPoint
    }

    private func finish(_ point: GeoPoint?, measuredAt: Date? = nil, accuracy: Double? = nil) {
        if let point {
            lastPoint = point
            lastUpdatedAt = measuredAt
            lastHorizontalAccuracy = accuracy
        }
        let pending = Array(continuations.values)
        continuations.removeAll()
        timeoutTask?.cancel(); timeoutTask = nil
        manager.stopUpdatingLocation()
        for continuation in pending { continuation.resume(returning: point) }
    }

    private func cancel(_ id: UUID) {
        continuations.removeValue(forKey: id)?.resume(returning: nil)
        if continuations.isEmpty { timeoutTask?.cancel(); timeoutTask = nil; manager.stopUpdatingLocation() }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let coordinate = locations.last?.coordinate
        let measuredAt = locations.last?.timestamp, accuracy = locations.last?.horizontalAccuracy
        Task { @MainActor in
            finish(coordinate.map { GeoPoint(lat: $0.latitude, lng: $0.longitude) }, measuredAt: measuredAt, accuracy: accuracy)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in finish(nil) }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            syncPermission()
            if permission == .denied { finish(nil) }
            else if permission == .granted, !continuations.isEmpty { self.manager.requestLocation() }
        }
    }
}
