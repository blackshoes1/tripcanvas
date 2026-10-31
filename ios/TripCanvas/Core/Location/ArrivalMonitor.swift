import CoreLocation
import Observation
import UIKit

struct ArrivalMonitoringContext: Codable, Equatable, Sendable {
    let accountID: String
    let deviceId: String
    let activityId: String
}

struct LiveActivityArrivalRequest: Codable, Equatable, Sendable {
    let deviceId: String
    let activityId: String
    let tripId: String
    let target: LiveActivityTarget
    let arrived: Bool
    let observedAtISO: String
    let eventRevision: Int
}

enum ArrivalReportResult: Equatable { case recorded, retry, discard }

@MainActor protocol ArrivalMonitoring: AnyObject {
    var onObservation: (@MainActor (ArrivalMonitoringContext, LiveActivityArrivalRequest) async -> ArrivalReportResult)? { get set }
    func restore(context: ArrivalMonitoringContext?, activeTripID: String?)
    func update(_ response: TravelStateResponse, context: ArrivalMonitoringContext?)
    func retryPending() async
    func stop()
}

@MainActor protocol ArrivalRegionManaging: AnyObject {
    var delegate: (any CLLocationManagerDelegate)? { get set }
    var authorizationStatus: CLAuthorizationStatus { get }
    var accuracyAuthorization: CLAccuracyAuthorization { get }
    var monitoredRegions: Set<CLRegion> { get }
    var maximumRegionMonitoringDistance: CLLocationDistance { get }
    func requestAlwaysAuthorization()
    func startMonitoring(for region: CLRegion)
    func stopMonitoring(for region: CLRegion)
    func requestState(for region: CLRegion)
}
extension CLLocationManager: ArrivalRegionManaging {}

/// 일정의 목적지만 감시한다. 사용자 위치의 연속 수집·기록은 하지 않는다.
@Observable @MainActor
final class ArrivalMonitor: NSObject, ArrivalMonitoring, CLLocationManagerDelegate {
    private(set) var authorizationStatus: CLAuthorizationStatus
    private(set) var hasFullAccuracy: Bool
    var canMonitor: Bool { available && authorizationStatus == .authorizedAlways && hasFullAccuracy }
    @ObservationIgnored var onObservation: (@MainActor (ArrivalMonitoringContext, LiveActivityArrivalRequest) async -> ArrivalReportResult)?

    private struct Destination: Codable, Equatable {
        let regionID: String
        let target: LiveActivityTarget
        let point: GeoPoint
        let expiresAt: Date
    }
    private struct Plan: Codable {
        let context: ArrivalMonitoringContext
        let tripID: String
        var destinations: [Destination]
        var reportedRegionID: String?
        var reportedAtISO: String?
        var pending: [LiveActivityArrivalRequest]
    }
    private static let prefix = "withj.arrival."
    private static let planKey = "withj.arrival.plan.v1"
    private static let revisionKey = "withj.arrival.revision.v1"
    private let manager: any ArrivalRegionManaging
    private let defaults: UserDefaults
    private let available: Bool
    private let now: () -> Date
    private let beginBackground: (@escaping @MainActor () -> Void) -> UIBackgroundTaskIdentifier
    private let endBackground: (UIBackgroundTaskIdentifier) -> Void
    private var plan: Plan?
    private var preferred: LiveActivityTarget?
    private var inside: [String: Bool] = [:]
    private var needsConfirmation: Set<String> = []
    private var isRestored = false
    private var generation = 0
    @ObservationIgnored private var deliveryTask: Task<Void, Never>?

    init(manager: any ArrivalRegionManaging = CLLocationManager(), defaults: UserDefaults = .standard,
         available: Bool = CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self),
         now: @escaping () -> Date = Date.init,
         beginBackground: @escaping (@escaping @MainActor () -> Void) -> UIBackgroundTaskIdentifier = {
             UIApplication.shared.beginBackgroundTask(withName: "일정 도착 확인", expirationHandler: $0)
         }, endBackground: @escaping (UIBackgroundTaskIdentifier) -> Void = {
             if $0 != .invalid { UIApplication.shared.endBackgroundTask($0) }
         }) {
        self.manager = manager; self.defaults = defaults; self.available = available; self.now = now
        self.beginBackground = beginBackground; self.endBackground = endBackground
        authorizationStatus = manager.authorizationStatus
        hasFullAccuracy = manager.accuracyAuthorization == .fullAccuracy
        if let data = defaults.data(forKey: Self.planKey) { plan = try? JSONDecoder().decode(Plan.self, from: data) }
        super.init()
        manager.delegate = self
    }

    /// 사용자가 잠금 상태 도착 안내를 고른 자리에서만 호출한다.
    func enable() { manager.requestAlwaysAuthorization() }

    func refreshAuthorization() {
        authorizationStatus = manager.authorizationStatus
        hasFullAccuracy = manager.accuracyAuthorization == .fullAccuracy
        if isRestored, !canMonitor {
            let arrived = lastArrival?.destination
            plan?.pending.removeAll { $0.arrived }
            if let arrived { invalidateArrival(arrived, observedAt: now()) }
            save()
        }
        reconcileRegions()
        scheduleDelivery()
    }

    func restore(context: ArrivalMonitoringContext?, activeTripID: String?) {
        guard let context, let activeTripID, let stored = plan,
              stored.context == context, stored.tripID == activeTripID else { stop(); return }
        isRestored = true
        refreshAuthorization()
        for region in ownedRegions { manager.requestState(for: region) }
        scheduleDelivery()
    }

    func update(_ response: TravelStateResponse, context: ArrivalMonitoringContext?) {
        guard let context, response.today.currentState.live, response.liveActivity.shouldEnd != true else { stop(); return }
        let today = response.today
        let previous = plan
        let sameContext = previous?.context == context && previous?.tripID == today.trip.id
        var retainedTargets = sameContext ? (previous?.pending.map(\.target) ?? []) : []
        if sameContext, let reported = previous?.destinations.first(where: { $0.regionID == previous?.reportedRegionID }) {
            retainedTargets.append(reported.target)
        }
        let stay = today.nowFocus?.currentStay
        let candidates = today.activities.enumerated().filter { candidate in
            let activity = candidate.element
            return !activity.status.isDone && activity.choiceState != "PENDING" && activity.location != nil
                && (activity.endMinutes > today.currentState.nowMinutes
                    || (activity.id == stay?.target.activityId && stay?.target.dayIndex == today.day.index && stay?.target.revision == today.trip.revision)
                    || retainedTargets.contains(where: { $0.activityId == activity.id
                        && $0.dayIndex == today.day.index && $0.revision == today.trip.revision }))
        }.sorted { left, right in
            let leftProtected = left.element.id == stay?.target.activityId || retainedTargets.contains(where: { $0.activityId == left.element.id })
            let rightProtected = right.element.id == stay?.target.activityId || retainedTargets.contains(where: { $0.activityId == right.element.id })
            if leftProtected != rightProtected { return leftProtected }
            return left.element.startMinutes == right.element.startMinutes ? left.offset < right.offset : left.element.startMinutes < right.element.startMinutes
        }
        var destinations: [Destination] = []
        for (_, activity) in candidates {
            guard destinations.count < 20, let point = activity.location,
                  point.lat.isFinite, point.lng.isFinite, abs(point.lat) <= 90, abs(point.lng) <= 180,
                  let expiry = (activity.id == stay?.target.activityId ? ISO8601DateFormatter.tripCanvasDate(stay?.expiresAtISO) : nil)
                    ?? expiry(for: 1440, today: today), expiry > now() else { continue }
            let target = LiveActivityTarget(dayIndex: today.day.index, activityId: activity.id, revision: today.trip.revision)
            guard target.spotIndex != nil else { continue }
            let retained = sameContext ? previous?.destinations.first { $0.target == target && $0.point == point } : nil
            destinations.append(.init(regionID: retained?.regionID ?? Self.prefix + UUID().uuidString,
                                      target: target, point: point, expiresAt: expiry))
        }
        guard !destinations.isEmpty else { stop(); return }
        if !sameContext {
            stop()
            plan = .init(context: context, tripID: today.trip.id, destinations: destinations, pending: [])
        } else {
            plan?.destinations = destinations
            let targets = destinations.map(\.target)
            plan?.pending.removeAll { !targets.contains($0.target) }
            if let reported = plan?.reportedRegionID, !destinations.contains(where: { $0.regionID == reported }) {
                plan?.reportedRegionID = nil
                plan?.reportedAtISO = nil
            }
        }
        if let focus = response.liveActivity.nowFocus, focus.kind == .currentStay || focus.kind == .departure {
            preferred = focus.focusedTarget
        } else { preferred = response.liveActivity.target }
        isRestored = true
        reconcileFreshLocation(response)
        save()
        refreshAuthorization()
        scheduleDelivery()
    }

    func stop() {
        generation += 1
        deliveryTask?.cancel(); deliveryTask = nil
        plan = nil; preferred = nil; inside = [:]; needsConfirmation = []; isRestored = false
        defaults.removeObject(forKey: Self.planKey)
        for region in ownedRegions { manager.stopMonitoring(for: region) }
    }

    private var ownedRegions: [CLRegion] { manager.monitoredRegions.filter { $0.identifier.hasPrefix(Self.prefix) } }

    private func reconcileRegions() {
        // Siri 등 보조 환경의 manager는 소유권을 복구하기 전 다른 환경의 감시를 지우지 않는다.
        guard isRestored else { return }
        let valid = canMonitor ? (plan?.destinations.filter { $0.expiresAt > now() } ?? []) : []
        for region in ownedRegions where !valid.contains(where: { $0.regionID == region.identifier }) {
            manager.stopMonitoring(for: region)
            inside.removeValue(forKey: region.identifier)
        }
        for destination in valid where !ownedRegions.contains(where: { $0.identifier == destination.regionID }) {
            let radius = min(100, manager.maximumRegionMonitoringDistance)
            guard radius > 0 else { continue }
            let region = CLCircularRegion(center: .init(latitude: destination.point.lat, longitude: destination.point.lng),
                                          radius: radius, identifier: destination.regionID)
            region.notifyOnEntry = true; region.notifyOnExit = true
            manager.startMonitoring(for: region)
        }
    }

    private func expiry(for minutes: Int, today: TodayResponse) -> Date? {
        guard minutes >= 0, let zone = TimeZone(identifier: today.day.timeZone) ?? TimeZone(identifier: today.trip.timeZone) else { return nil }
        let parts = today.day.date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        guard let day = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])),
              let targetDay = calendar.date(byAdding: .day, value: minutes / 1440, to: day) else { return nil }
        return calendar.date(bySettingHour: minutes % 1440 / 60, minute: minutes % 60, second: 0, of: targetDay)
    }

    private func observe(_ region: CLRegion, arrived: Bool) {
        guard isRestored, canMonitor, let plan, let destination = plan.destinations.first(where: { $0.regionID == region.identifier && $0.expiresAt > now() }) else { return }
        inside[region.identifier] = arrived
        let entered = plan.destinations.filter { inside[$0.regionID] == true && $0.expiresAt > now() }
        let selected = entered.first { $0.target == preferred } ?? entered.first
        if needsConfirmation.remove(region.identifier) != nil, !arrived || selected?.regionID == region.identifier {
            enqueue(destination.target, arrived: arrived)
            scheduleDelivery()
            return
        }
        let current = plan.pending.last.map { $0.arrived ? $0.target : nil } ?? plan.reportedRegionID.flatMap { id in
            plan.destinations.first { $0.regionID == id }?.target
        }
        guard current != selected?.target else { return }
        if let current { enqueue(current, arrived: false) }
        if let selected { enqueue(selected.target, arrived: true) }
        scheduleDelivery()
    }

    private var lastArrival: (destination: Destination, observedAtISO: String?)? {
        guard let plan else { return nil }
        if let last = plan.pending.last {
            guard last.arrived, let destination = plan.destinations.first(where: { $0.target == last.target }) else { return nil }
            return (destination, last.observedAtISO)
        }
        guard let reported = plan.reportedRegionID,
              let destination = plan.destinations.first(where: { $0.regionID == reported }) else { return nil }
        return (destination, plan.reportedAtISO)
    }

    private func reconcileFreshLocation(_ response: TravelStateResponse) {
        guard let point = response.locationUsed, let timestamp = response.locationUpdatedAt,
              let observedAt = ISO8601DateFormatter.tripCanvas.date(from: timestamp),
              abs(now().timeIntervalSince(observedAt)) <= 60, let arrived = lastArrival,
              point.lat.isFinite, point.lng.isFinite, abs(point.lat) <= 90, abs(point.lng) <= 180 else { return }
        if let timestamp = arrived.observedAtISO,
           let recordedAt = ISO8601DateFormatter.tripCanvas.date(from: timestamp), observedAt <= recordedAt { return }
        let region = CLCircularRegion(center: .init(latitude: arrived.destination.point.lat, longitude: arrived.destination.point.lng),
                                      radius: min(100, manager.maximumRegionMonitoringDistance), identifier: arrived.destination.regionID)
        if !region.contains(.init(latitude: point.lat, longitude: point.lng)) {
            invalidateArrival(arrived.destination, observedAt: observedAt)
        }
    }

    private func invalidateArrival(_ destination: Destination, observedAt: Date) {
        inside[destination.regionID] = false
        needsConfirmation.remove(destination.regionID)
        plan?.pending.removeAll { $0.arrived && $0.target == destination.target }
        enqueue(destination.target, arrived: false, observedAt: observedAt)
    }

    private func enqueue(_ target: LiveActivityTarget, arrived: Bool, observedAt: Date? = nil) {
        guard let context = plan?.context, let tripID = plan?.tripID else { return }
        let revision = max(Int(now().timeIntervalSince1970 * 1000), defaults.integer(forKey: Self.revisionKey) + 1)
        defaults.set(revision, forKey: Self.revisionKey)
        plan?.pending.append(.init(deviceId: context.deviceId, activityId: context.activityId, tripId: tripID,
                                  target: target, arrived: arrived,
                                  observedAtISO: ISO8601DateFormatter.tripCanvas.string(from: observedAt ?? now()), eventRevision: revision))
        save()
    }

    private func scheduleDelivery() {
        guard isRestored, deliveryTask == nil, plan?.pending.isEmpty == false else { return }
        Task { [weak self] in await self?.retryPending() }
    }

    func retryPending() async {
        guard isRestored else { return }
        if let deliveryTask { await deliveryTask.value; return }
        discardStalePending()
        guard isRestored, plan?.pending.isEmpty == false, onObservation != nil else { return }
        let task = Task { [weak self] in
            guard let self else { return }
            await self.deliverPending()
        }
        deliveryTask = task
        await task.value
    }

    private func deliverPending() async {
        guard let context = plan?.context, let onObservation else { return }
        let request = generation
        var background: UIBackgroundTaskIdentifier = .invalid
        background = beginBackground { [weak self] in
            self?.deliveryTask?.cancel()
            if background != .invalid { self?.endBackground(background); background = .invalid }
        }
        defer {
            if background != .invalid { endBackground(background) }
            if request == generation { deliveryTask = nil }
        }
        while !Task.isCancelled, request == generation, plan?.context == context, let event = plan?.pending.first {
            if event.arrived, !canMonitor { plan?.pending.removeFirst(); save(); continue }
            let result = await onObservation(context, event)
            guard !Task.isCancelled, request == generation, plan?.context == context else { return }
            // 서버 확인 중 새 응답이 revision/목표를 바꿔 대기열을 정리할 수 있다.
            guard plan?.pending.first?.eventRevision == event.eventRevision else { continue }
            guard result != .retry else { return }
            plan?.pending.removeFirst()
            if result == .recorded {
                let reportedID = event.arrived ? plan?.destinations.first { $0.target == event.target }?.regionID : nil
                plan?.reportedRegionID = reportedID
                plan?.reportedAtISO = event.arrived ? event.observedAtISO : nil
            }
            save()
        }
    }

    private func discardStalePending() {
        let stale = plan?.pending.filter { event in
            guard plan?.destinations.contains(where: { $0.target == event.target && $0.expiresAt > now() }) == true else { return true }
            guard let observed = ISO8601DateFormatter.tripCanvas.date(from: event.observedAtISO) else { return true }
            return now().timeIntervalSince(observed) > 15 * 60 || observed.timeIntervalSince(now()) > 60
        } ?? []
        guard !stale.isEmpty else { return }
        plan?.pending.removeAll { event in stale.contains { $0.eventRevision == event.eventRevision } }
        for destination in plan?.destinations ?? [] where destination.expiresAt > now() && stale.contains(where: { $0.target == destination.target }) {
            inside.removeValue(forKey: destination.regionID)
            needsConfirmation.insert(destination.regionID)
            if !canMonitor { invalidateArrival(destination, observedAt: now()) }
            else if let region = ownedRegions.first(where: { $0.identifier == destination.regionID }) { manager.requestState(for: region) }
        }
        save()
    }

    private func save() {
        if let plan, let data = try? JSONEncoder().encode(plan) { defaults.set(data, forKey: Self.planKey) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didStartMonitoringFor region: CLRegion) {
        Task { @MainActor in
            guard self.ownedRegions.contains(where: { $0.identifier == region.identifier }) else { return }
            self.manager.requestState(for: region)
        }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didDetermineState state: CLRegionState, for region: CLRegion) {
        guard state != .unknown else { return }
        Task { @MainActor in self.observe(region, arrived: state == .inside) }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        Task { @MainActor in self.observe(region, arrived: true) }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        Task { @MainActor in self.observe(region, arrived: false) }
    }
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in self.refreshAuthorization() }
    }
}
