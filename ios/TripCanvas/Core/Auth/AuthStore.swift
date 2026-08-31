import Foundation
import Observation

/// Supabase Auth 세션. 웹과 **같은 프로젝트·같은 계정**이라 웹에서 만든 여행이 그대로 보인다.
struct AuthSession: Codable, Sendable, Equatable {
    let accessToken: String
    let refreshToken: String
    /// 절대 만료 시각. 미리 갱신할지 판단하는 데만 쓴다.
    let expiresAt: Date
    let email: String?

    var isFresh: Bool { expiresAt.timeIntervalSinceNow > 60 }
}

enum AuthError: Error, LocalizedError {
    case invalidCredentials(String)
    case notSignedIn
    case network

    var errorDescription: String? {
        switch self {
        case .invalidCredentials(let m): m
        case .notSignedIn: "로그인이 필요합니다."
        case .network: "네트워크에 연결되어 있지 않아요."
        }
    }
}

/// Supabase Auth REST를 직접 부른다 — SDK 의존성을 추가하지 않기 위해(§4).
/// GoTrue의 password grant / refresh_token grant 두 가지만 쓴다.
struct SupabaseAuthClient: Sendable {
    let baseURL: URL          // https://<project>.supabase.co
    let anonKey: String
    let session: URLSession

    init(baseURL: URL, anonKey: String, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.anonKey = anonKey
        self.session = session
    }

    private struct TokenResponse: Decodable {
        let access_token: String
        let refresh_token: String
        let expires_in: Double
        let user: User?
        struct User: Decodable { let email: String? }
    }
    private struct ErrorResponse: Decodable {
        let error_description: String?
        let msg: String?
        let error: String?
        var message: String? { error_description ?? msg ?? error }
    }

    func signIn(email: String, password: String) async throws -> AuthSession {
        try await token(grant: "password", body: ["email": email, "password": password])
    }

    func refresh(refreshToken: String) async throws -> AuthSession {
        try await token(grant: "refresh_token", body: ["refresh_token": refreshToken])
    }

    private func token(grant: String, body: [String: String]) async throws -> AuthSession {
        var components = URLComponents(url: baseURL.appendingPathComponent("auth/v1/token"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "grant_type", value: grant)]
        guard let url = components?.url else { throw AuthError.network }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 15

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw AuthError.network
        }
        guard let http = response as? HTTPURLResponse else { throw AuthError.network }
        guard (200..<300).contains(http.statusCode) else {
            let detail = (try? JSONDecoder().decode(ErrorResponse.self, from: data))?.message
            throw AuthError.invalidCredentials(detail ?? "이메일이나 비밀번호를 다시 확인해 주세요.")
        }
        let decoded = try JSONDecoder().decode(TokenResponse.self, from: data)
        return AuthSession(
            accessToken: decoded.access_token,
            refreshToken: decoded.refresh_token,
            expiresAt: Date().addingTimeInterval(decoded.expires_in),
            email: decoded.user?.email
        )
    }
}

/// 세션 보관과 갱신. 매번 로그인을 요구하지 않는다(§25) — 세션은 Keychain에 둔다.
@Observable
@MainActor
final class AuthStore {
    private(set) var session: AuthSession?
    private(set) var isWorking = false
    private(set) var lastError: String?

    private let client: SupabaseAuthClient
    private let keychain: KeychainStore
    /// 동시에 여러 요청이 401을 만나도 갱신은 한 번만 돌게 한다.
    private var refreshTask: Task<AuthSession, Error>?

    init(client: SupabaseAuthClient, keychain: KeychainStore = KeychainStore(account: "supabase.session")) {
        self.client = client
        self.keychain = keychain
        self.session = keychain.read(AuthSession.self)
    }

    var isSignedIn: Bool { session != nil }
    var email: String? { session?.email }

    func signIn(email: String, password: String) async {
        isWorking = true
        lastError = nil
        defer { isWorking = false }
        do {
            let new = try await client.signIn(email: email, password: password)
            store(new)
        } catch {
            lastError = error.localizedDescription
        }
    }

    func signOut() {
        session = nil
        refreshTask = nil
        keychain.clear()
    }

    private func store(_ new: AuthSession) {
        session = new
        keychain.write(new)
    }

    /// 만료가 임박하면 미리 갱신한다. 갱신도 실패하면 로그아웃시켜 로그인 화면으로 보낸다.
    func validAccessToken() async throws -> String {
        guard let current = session else { throw AuthError.notSignedIn }
        if current.isFresh { return current.accessToken }
        return try await forceRefresh().accessToken
    }

    @discardableResult
    func forceRefresh() async throws -> AuthSession {
        if let running = refreshTask { return try await running.value }
        guard let current = session else { throw AuthError.notSignedIn }
        let task = Task { [client] () throws -> AuthSession in
            try await client.refresh(refreshToken: current.refreshToken)
        }
        refreshTask = task
        defer { refreshTask = nil }
        do {
            let new = try await task.value
            store(new)
            return new
        } catch {
            signOut()
            throw AuthError.notSignedIn
        }
    }
}

/// APIClient가 AuthStore를 직접 알지 않도록 사이에 두는 어댑터.
@MainActor
struct AuthTokenProvider: TokenProviding {
    let store: AuthStore

    func accessToken() async throws -> String {
        try await store.validAccessToken()
    }
    func refreshToken() async throws -> String {
        try await store.forceRefresh().accessToken
    }
}
