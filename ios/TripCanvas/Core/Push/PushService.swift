import Foundation
import UserNotifications
import Observation

/// 알림 — **적게 보내는 것이 목표다**(§3).
///
/// 권한을 첫 실행에 요구하지 않는다(§75.4). Travel Mode를 켜는 시점처럼 "왜 필요한지" 말할 수 있을 때 묻는다.
/// 기기가 판단하는 알림(출발·지연)은 로컬로 띄우고, 서버가 판단하는 것(가격·재구성)만 APNs로 받는다(§11).
@Observable
@MainActor
final class PushService: NSObject, PushScheduling {
    enum Permission { case unknown, denied, granted }

    private(set) var permission: Permission = .unknown
    private(set) var deviceToken: String?
    private(set) var registrationError: String?
    /// 알림을 눌러 들어온 목적지. 앱이 화면을 띄운 뒤 비운다.
    private(set) var pendingDeepLink: URL?

    private let center = UNUserNotificationCenter.current()
    private let registerToken: (String) async throws -> Void
    private let permissionReader: (() async -> Permission)?
    private let enqueue: ((UNNotificationRequest) async throws -> Void)?
    var onOpenLink: ((URL) -> Void)?

    init(handlesSystemNotifications: Bool = true,
         permissionReader: (() async -> Permission)? = nil,
         enqueue: ((UNNotificationRequest) async throws -> Void)? = nil,
         registerToken: @escaping (String) async throws -> Void) {
        self.registerToken = registerToken; self.permissionReader = permissionReader; self.enqueue = enqueue
        super.init()
        if handlesSystemNotifications { center.delegate = self }
    }

    func refreshPermission() async {
        if let permissionReader { permission = await permissionReader(); return }
        let settings = await center.notificationSettings()
        permission = switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: .granted
        case .denied: .denied
        default: .unknown
        }
    }

    /// 실제로 쓸모를 설명할 수 있는 시점에만 부른다.
    @discardableResult
    func requestAuthorization() async -> Bool {
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            permission = granted ? .granted : .denied
            if granted { await MainActor.run { UIApplicationShim.registerForRemoteNotifications() } }
            return granted
        } catch {
            permission = .denied
            return false
        }
    }

    func didRegister(tokenData: Data) async {
        let token = tokenData.map { String(format: "%02x", $0) }.joined()
        deviceToken = token
        do { try await registerToken(token); registrationError = nil }
        catch { registrationError = "알림 기기를 등록하지 못했어요. 연결되면 다시 확인해요." }
    }

    func registrationFailed() { registrationError = "기기 알림 등록에 연결하지 못했어요. 잠시 후 다시 확인해 주세요." }

    func prepareForDelivery() async { await refreshPermission() }

    func refreshForForeground(isSignedIn: Bool) async {
        await refreshPermission()
        if isSignedIn, permission == .granted { UIApplicationShim.registerForRemoteNotifications() }
    }

    // MARK: 로컬 알림 (기기가 판단하는 것)

    /// 서버가 만든 문구를 그대로 쓴다 — 클라이언트가 다시 쓰면 톤이 갈라진다(§14).
    /// dedupeKey를 식별자로 써서 같은 상황이 두 번 뜨지 않는다(§46).
    func present(_ item: NotificationPlanItem) {
        Task { _ = await schedule(item) }
    }

    /// 시스템 등록 성공을 확인한 뒤에만 발송 기록을 남긴다.
    func schedule(_ item: NotificationPlanItem) async -> Bool {
        guard permission == .granted else { return false }
        let content = UNMutableNotificationContent()
        content.title = item.title
        content.body = item.body
        content.sound = item.priority >= 2 ? .default : nil     // 급하지 않으면 소리 없이(§42)
        content.userInfo = ["deepLink": item.deepLink, "kind": item.kind.rawValue]
        content.interruptionLevel = item.priority >= 2 ? .timeSensitive : .active

        // 지금 알릴 것이므로 트리거 없이 즉시. 미래 예약은 상태가 바뀌면 낡으므로 하지 않는다.
        let request = UNNotificationRequest(identifier: item.dedupeKey, content: content, trigger: nil)
        do {
            if let enqueue { try await enqueue(request) } else { try await center.add(request) }
            return true
        } catch { return false }
    }

    func receiveLink(_ text: String?, kind: String?) {
        if let text, let url = URL(string: text), ActionRouter.parse(url) != nil {
            pendingDeepLink = url
            if let onOpenLink { onOpenLink(url); pendingDeepLink = nil }
        }
        Analytics.track(.notificationOpened, ["kind": kind ?? ""])
    }

    func clearDeepLink() { pendingDeepLink = nil }

    func resetForAccountChange() {
        deviceToken = nil
        registrationError = nil
        pendingDeepLink = nil
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
    }
}

extension PushService: UNUserNotificationCenterDelegate {
    /// 앱이 떠 있을 때도 배너를 보여준다 — 여행 중에는 화면을 보고 있어도 출발 시점이 중요하다.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        let link = info["deepLink"] as? String
        let kind = info["kind"] as? String
        await MainActor.run {
            receiveLink(link, kind: kind)
        }
    }
}

/// 딥링크 해석 — 모든 알림은 홈이 아니라 그 화면으로 간다(§40).
/// `tripcanvas://trip/{tripId}/today?focus={activityId}` 형태.
enum DeepLink: Equatable {
    case today(tripId: String, focusActivityId: String?)
    case replan(tripId: String)
    case suggestion(tripId: String, suggestionId: String)
    case bookings(tripId: String)

    static func parse(_ url: URL) -> DeepLink? {
        guard url.scheme == "tripcanvas" else { return nil }
        // host가 "trip", path가 "/{tripId}/{screen}"
        let parts = ([url.host].compactMap { $0 } + url.pathComponents.filter { $0 != "/" })
        guard parts.count >= 3, parts[0] == "trip" else { return nil }
        let tripId = parts[1]
        let screen = parts[2]
        let focus = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first { $0.name == "focus" }?.value
        switch screen {
        case "today": return .today(tripId: tripId, focusActivityId: focus)
        case "replan": return .replan(tripId: tripId)
        case "bookings": return .bookings(tripId: tripId)
        case "suggestion":
            guard parts.count >= 4 else { return nil }
            return .suggestion(tripId: tripId, suggestionId: parts[3].removingPercentEncoding ?? parts[3])
        default: return nil
        }
    }

    var tripId: String {
        switch self {
        case .today(let id, _), .replan(let id), .suggestion(let id, _), .bookings(let id): id
        }
    }
}

/// UIKit 의존을 한 줄로 가둔다 — 테스트에서 이 파일 전체를 끌고 오지 않게.
enum UIApplicationShim {
    static func registerForRemoteNotifications() {
        #if canImport(UIKit)
        UIApplication.shared.registerForRemoteNotifications()
        #endif
    }
}

#if canImport(UIKit)
import UIKit

@MainActor
enum AppPushBridge {
    static weak var service: PushService?
    static func registered(_ token: Data) async { await service?.didRegister(tokenData: token) }
}

@MainActor
final class TripCanvasAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await AppPushBridge.registered(deviceToken) }
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        AppPushBridge.service?.registrationFailed()
    }
}
#endif
