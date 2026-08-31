import Foundation
import Observation

/// 기본값은 프로덕션을 가리킨다. 로컬 서버로 붙일 때만 Info.plist에서 덮어쓴다.
/// Supabase publishable 키는 공개용이다 — 데이터는 RLS가 지킨다(웹도 같은 값을 들고 있다).
enum AppConfig {
    static let apiBaseURL: URL = {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "TCApiBaseURL") as? String,
           let url = URL(string: raw), !raw.isEmpty { return url }
        return URL(string: "https://tripcanvas-ai.vercel.app")!
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

    init(auth: AuthStore? = nil, service: TripService? = nil) {
        let authStore = auth ?? AuthStore(
            client: SupabaseAuthClient(baseURL: AppConfig.supabaseURL, anonKey: AppConfig.supabaseAnonKey))
        self.auth = authStore
        self.service = service ?? TripService(
            api: APIClient(baseURL: AppConfig.apiBaseURL, tokens: AuthTokenProvider(store: authStore)),
            cache: TripCache())
    }
}
