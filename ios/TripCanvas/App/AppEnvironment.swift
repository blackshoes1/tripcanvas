import Foundation
import Observation

/// 기본값은 프로덕션을 가리킨다. 로컬 서버로 붙일 때만 Info.plist에서 덮어쓴다.
/// Supabase publishable 키는 공개용이다 — 데이터는 RLS가 지킨다(웹도 같은 값을 들고 있다).
enum AppConfig {
    static let apiBaseURL: URL = {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "TCApiBaseURL") as? String,
           let url = URL(string: raw), !raw.isEmpty { return url }
        // 운영 API는 NAS다(2026-09-04 전환). 정적 웹에는 /api/v1 이 없어서, 그쪽을 가리키면
        // 모든 호출이 404가 되고 앱에는 오류가 아니라 "여행 없음"으로 보인다.
        return URL(string: "https://bokbok9.tail8b977f.ts.net")!
    }()

    /// 지도 SDK 키. 둘 다 **번들 ID로 제한**된 네이티브 키다 — 웹 키(리퍼러·도메인 제한)는 앱에서 거부된다.
    /// 값은 바이너리에 어차피 들어가고 제한이 실제 방어선이라 웹 키와 같은 기준으로 저장소에 둔다.
    static let googleMapsKey: String = {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "TCGoogleMapsKey") as? String, !raw.isEmpty { return raw }
        return "AIzaSyC5b_lS9bW-qGFnL9KQ0Kn8SBr0a0VodIg"
    }()

    static let kakaoNativeKey: String = {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "TCKakaoNativeKey") as? String, !raw.isEmpty { return raw }
        return "fd08ca0a759ed5b4f1240887ed814957"
    }()

    /// 구글 Places REST가 요구하는 `X-Ios-Bundle-Identifier` 값. 무료 스펙에서 번들 ID를 바꿨다면 그 값이 나간다.
    static let bundleId: String = Bundle.main.bundleIdentifier ?? "com.fromj.trip"

    /// 초대 링크가 가리키는 **웹** 주소. 받는 사람에게 앱이 없을 수 있어 링크는 웹(`#join=`)으로 만든다.
    static let webBaseURL: URL = {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "TCWebBaseURL") as? String,
           let url = URL(string: raw), !raw.isEmpty { return url }
        return URL(string: "https://tripcanvas-ai.vercel.app/")!
    }()

    static let supabaseURL: URL = {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "TCSupabaseURL") as? String,
           let url = URL(string: raw), !raw.isEmpty { return url }
        return URL(string: "https://gdnhrwtfidjimtabgovh.supabase.co")!
    }()

    static let supabaseAnonKey: String = {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "TCSupabaseAnonKey") as? String, !raw.isEmpty { return raw }
        return "sb_publishable_2C-n1YFvE9Cw9B7L7B6Trw_XO3Val5q"
    }()
}

/// 앱 하나짜리 의존성 컨테이너. 프레임워크를 얹지 않고 생성자 주입만 쓴다(§31).
@Observable
@MainActor
final class AppEnvironment {
    let auth: AuthStore
    let service: TripService
    /// Siri · Push · Widget · Watch · Share가 함께 쓰는 단 하나의 라우터(§41).
    let router = ActionRouter()
    let location: LocationProvider
    let liveActivity: LiveActivityController
    let push: PushService
    let travelMode: TravelModeController
    /// 장소 검색 — 국내는 서버 프록시, 해외는 구글 직접(`PlaceSearchService`).
    let places: PlaceSearchService

    /// @Observable은 저장 프로퍼티를 init 접근자로 바꾼다 — lazy와 함께 쓸 수 없다.
    /// 그래서 의존 관계는 여기서 지역 상수로 조립한다. 클로저도 self가 아니라 지역 상수를
    /// 붙잡으므로 순환 참조도, 초기화 순서 문제도 생기지 않는다.
    init(auth: AuthStore? = nil, service: TripService? = nil) {
        let authStore = auth ?? AuthStore(
            client: SupabaseAuthClient(baseURL: AppConfig.supabaseURL, anonKey: AppConfig.supabaseAnonKey))
        let apiClient = APIClient(baseURL: AppConfig.apiBaseURL, tokens: AuthTokenProvider(store: authStore))
        let tripService = service ?? TripService(api: apiClient, cache: TripCache())
        let locationProvider = LocationProvider()
        let liveActivityController = LiveActivityController()
        let pushService = PushService { token in
            try? await tripService.registerDevice(
                deviceId: DeviceIdentity.current, pushToken: token,
                preferences: [:], appVersion: AppConfig.version)
        }

        self.auth = authStore
        self.service = tripService
        self.location = locationProvider
        self.liveActivity = liveActivityController
        self.push = pushService
        self.places = PlaceSearchService(api: apiClient, googleKey: AppConfig.googleMapsKey, bundleId: AppConfig.bundleId)
        self.travelMode = TravelModeController(
            service: tripService, location: locationProvider,
            push: pushService, liveActivity: liveActivityController)
    }
}

/// 기기 하나를 가리키는 값. 사용자를 식별하지 않는다 — 로그아웃하면 토큰과 함께 지운다(§45).
enum DeviceIdentity {
    private static let store = KeychainStore(account: "device.id")
    private struct Wrapper: Codable { let id: String }

    static var current: String = {
        if let saved = store.read(Wrapper.self)?.id { return saved }
        let created = UUID().uuidString
        store.write(Wrapper(id: created))
        return created
    }()

    static func reset() { store.clear() }
}

extension AppConfig {
    static var version: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0"
    }
}
