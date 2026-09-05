import Foundation
import Observation

/// TripCanvas Auth 세션. **웹(`auth.js`)과 같은 서버·같은 계약**이라 웹에서 만든 계정이 그대로 들어온다.
///
/// bearer 토큰 하나가 전부다 — 교차 출처라 쿠키를 쓰지 않고, refresh 그랜트도 없다(better-auth 세션).
/// 만료는 서버가 안다: `/api/auth/get-session`이 답하지 않으면 그 세션은 끝난 것이다.
struct AuthSession: Codable, Sendable, Equatable {
    let token: String
    let userId: String
    let email: String
}

/// 제공자별 문구가 아니라 **코드**로 분기한다 — `auth.js`의 `toError`와 같은 규칙이다.
/// 규칙을 바꿀 때는 `auth.js`를 먼저 고치고 여기를 따라 맞춘다.
enum AuthErrorCode: String, Sendable, Equatable {
    case invalidCredentials = "INVALID_CREDENTIALS"
    case emailNotVerified = "EMAIL_NOT_VERIFIED"
    case emailTaken = "EMAIL_TAKEN"
    case rateLimited = "RATE_LIMITED"
    case network = "NETWORK"
    case notSignedIn = "NOT_SIGNED_IN"
    case unknown = "UNKNOWN"
}

struct AuthError: Error, LocalizedError, Equatable {
    let code: AuthErrorCode
    let message: String

    var errorDescription: String? { message }

    static let notSignedIn = AuthError(code: .notSignedIn, message: "로그인이 필요합니다.")
    static let network = AuthError(code: .network, message: "네트워크에 연결하지 못했어요 — 잠시 뒤에 다시 해주세요.")

    /// 서버 응답을 코드로 옮긴다. `auth.js`의 `toError`와 같은 판정 순서다.
    static func from(status: Int, body: [String: Any]?) -> AuthError {
        let raw = [body?["message"], body?["error"], body?["code"]]
            .compactMap { $0 as? String }
            .joined(separator: " ")
        if status == 429 {
            return AuthError(code: .rateLimited, message: "너무 여러 번 시도했어요 — 잠시 뒤에 다시 해주세요.")
        }
        if raw.range(of: "EMAIL_NOT_VERIFIED|verif(y|ication|ied)", options: [.regularExpression, .caseInsensitive]) != nil {
            return AuthError(code: .emailNotVerified, message: "메일의 확인 링크를 먼저 눌러주세요 (스팸함도 확인).")
        }
        if status == 401 || status == 403
            || raw.range(of: "invalid|credential|password", options: [.regularExpression, .caseInsensitive]) != nil {
            return AuthError(code: .invalidCredentials, message: "이메일 또는 비밀번호가 맞지 않아요.")
        }
        if raw.range(of: "exist|already", options: [.regularExpression, .caseInsensitive]) != nil {
            return AuthError(code: .emailTaken, message: "이미 가입된 이메일이에요 — 로그인해주세요.")
        }
        return AuthError(code: .unknown, message: raw.isEmpty ? "알 수 없는 오류예요." : raw)
    }
}

/// 가입 결과. 이메일 확인 전에는 로그인이 열리지 않으므로(`requireEmailVerification`) 세션이 오지 않는다.
struct SignUpResult: Sendable, Equatable {
    /// 확인 메일이 나갔다 — 화면은 "메일을 확인해주세요"로 간다.
    let verificationSent: Bool
}

/// 로그인 서버와 이야기하는 최소 계약. 테스트는 이걸 가짜로 바꾼다.
protocol AuthClient: Sendable {
    func signIn(email: String, password: String) async throws -> AuthSession
    func signUp(email: String, password: String) async throws -> SignUpResult
    /// 토큰이 아직 살아 있는지 서버에 묻는다. 죽었으면 nil(오류가 아니다).
    func session(token: String) async throws -> AuthSession?
    func signOut(token: String) async
    /// **있는 이메일인지 알려주지 않는다** — 성공/실패를 구분하지 않는다(계정 존재 확인에 쓰이지 않게).
    func requestPasswordReset(email: String) async
}

/// `/api/auth/*` — 웹 `auth.js`가 쓰는 것과 같은 엔드포인트다.
/// SDK를 넣지 않고 URLSession만 쓴다(§4).
struct TripCanvasAuthClient: AuthClient {
    let baseURL: URL
    let session: URLSession

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func signIn(email: String, password: String) async throws -> AuthSession {
        let (status, body, headers) = try await call(
            "/api/auth/sign-in/email", body: ["email": email, "password": password])
        guard (200..<300).contains(status) else { throw AuthError.from(status: status, body: body) }
        // bearer 플러그인이 세션 토큰을 헤더로 준다 — 쿠키를 쓰지 않는다
        guard let token = headers["set-auth-token"], !token.isEmpty,
              let user = body?["user"] as? [String: Any], let id = user["id"] as? String else {
            throw AuthError(code: .unknown, message: "세션을 받지 못했어요.")
        }
        return AuthSession(token: token, userId: id, email: (user["email"] as? String) ?? email)
    }

    func signUp(email: String, password: String) async throws -> SignUpResult {
        // 이름은 받지 않는다 — 여행에 보이는 이름은 여행별로 정한다(§69)
        let name = email.split(separator: "@").first.map(String.init) ?? email
        let (status, body, _) = try await call(
            "/api/auth/sign-up/email", body: ["email": email, "password": password, "name": name])
        guard (200..<300).contains(status) else { throw AuthError.from(status: status, body: body) }
        return SignUpResult(verificationSent: true)
    }

    func session(token: String) async throws -> AuthSession? {
        let (status, body, _) = try await call("/api/auth/get-session", method: "GET", token: token)
        guard (200..<300).contains(status) else { return nil }
        guard let user = body?["user"] as? [String: Any], let id = user["id"] as? String else { return nil }
        return AuthSession(token: token, userId: id, email: (user["email"] as? String) ?? "")
    }

    func signOut(token: String) async {
        _ = try? await call("/api/auth/sign-out", token: token)
    }

    func requestPasswordReset(email: String) async {
        _ = try? await call("/api/auth/request-password-reset", body: ["email": email])
    }

    // MARK: -

    /// 네트워크 실패만 던진다. 상태 코드 판정은 부르는 쪽이 한다 — 경로마다 뜻이 다르다.
    private func call(
        _ path: String, method: String = "POST", body: [String: Any]? = nil, token: String? = nil
    ) async throws -> (status: Int, body: [String: Any]?, headers: [String: String]) {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.timeoutInterval = 15
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw AuthError.network
        }
        guard let http = response as? HTTPURLResponse else { throw AuthError.network }

        var headers: [String: String] = [:]
        for (key, value) in http.allHeaderFields {
            if let k = key as? String, let v = value as? String { headers[k.lowercased()] = v }
        }
        return (http.statusCode, try? JSONSerialization.jsonObject(with: data) as? [String: Any], headers)
    }
}

/// 세션을 어디에 두는가. 실물은 Keychain이고 테스트는 메모리다.
protocol SessionStoring: Sendable {
    func loadSession() -> AuthSession?
    func saveSession(_ session: AuthSession)
    func removeSession()
    /// 예전 Supabase 세션이 남아 있으면 **지우고** true. 자체 Auth 세션으로 바꾸지 않는다(§8) —
    /// 다른 Auth가 발급한 토큰을 이어서 들고 있으면 로그인한 것처럼 보이면서 아무것도 못 한다.
    func takeLegacySession() -> Bool
}

struct KeychainSessionStore: SessionStoring {
    /// provider-neutral 이름. 예전 이름(`supabase.session`)은 아래에서 지우기만 한다.
    private let current = KeychainStore(account: "withj.auth.session.v1")
    private let legacy = KeychainStore(account: "supabase.session")

    func loadSession() -> AuthSession? { current.read(AuthSession.self) }
    func saveSession(_ session: AuthSession) { current.write(session) }
    func removeSession() { current.clear() }

    func takeLegacySession() -> Bool {
        struct AnyStored: Decodable {}
        guard legacy.read(AnyStored.self) != nil else { return false }
        legacy.clear()
        return true
    }
}

/// 세션 보관과 확인. 매번 로그인을 요구하지 않는다(§25) — 세션은 Keychain에 둔다.
@Observable
@MainActor
final class AuthStore {
    private(set) var session: AuthSession?
    private(set) var isWorking = false
    private(set) var lastError: String?
    /// 가입 직후 안내("메일을 확인해주세요") 등 오류가 아닌 한마디.
    private(set) var notice: String?

    private let client: any AuthClient
    private let store: any SessionStoring
    /// 여러 요청이 동시에 401을 만나도 확인은 한 번만 돌게 한다.
    private var verifyTask: Task<AuthSession, Error>?

    init(client: any AuthClient, store: any SessionStoring = KeychainSessionStore()) {
        self.client = client
        self.store = store
        self.session = store.loadSession()
        // 로그인 방식이 바뀌었다는 것을 사용자가 알 수 있게 말한다(§8).
        if self.session == nil, store.takeLegacySession() {
            self.notice = "로그인 방식이 변경되어 한 번만 다시 로그인해 주세요.\n저장된 여행은 그대로 유지됩니다."
        }
    }

    var isSignedIn: Bool { session != nil }
    var email: String? { session?.email }

    func dismissNotice() { notice = nil }

    func signIn(email: String, password: String) async {
        await work {
            let new = try await self.client.signIn(email: email, password: password)
            self.persist(new)
        }
    }

    /// 가입은 로그인이 아니다 — 이메일 확인 전에는 세션이 열리지 않는다.
    func signUp(email: String, password: String) async {
        await work {
            _ = try await self.client.signUp(email: email, password: password)
            self.notice = "\(email)로 확인 메일을 보냈어요.\n링크를 누른 뒤 로그인해주세요."
        }
    }

    /// 있는 이메일인지 알려주지 않는다 — 언제나 같은 답을 보인다.
    func requestPasswordReset(email: String) async {
        await work {
            await self.client.requestPasswordReset(email: email)
            // 새 비밀번호를 받는 화면은 웹에만 있다 — 메일 링크가 웹으로 간다.
            self.notice = "가입된 이메일이면 재설정 링크를 보냈어요.\n메일의 링크에서 새 비밀번호를 정해주세요."
        }
    }

    func signOut() {
        let token = session?.token
        // 이 기기에서는 먼저 확실히 로그아웃한다 — 서버 호출이 실패해도 남아 있으면 안 된다.
        session = nil
        verifyTask = nil
        store.removeSession()
        if let token {
            Task { [client] in await client.signOut(token: token) }
        }
    }

    func validAccessToken() async throws -> String {
        guard let current = session else { throw AuthError.notSignedIn }
        return current.token
    }

    /// 401을 만났을 때. **refresh 그랜트가 없으므로** 서버에 세션이 아직 사는지 묻는다.
    /// 살아 있으면 같은 토큰으로 한 번 더(다른 이유의 401), 죽었으면 로그아웃시켜 로그인 화면으로 보낸다.
    @discardableResult
    func forceRefresh() async throws -> AuthSession {
        if let running = verifyTask { return try await running.value }
        guard let current = session else { throw AuthError.notSignedIn }
        let task = Task { [client] () throws -> AuthSession in
            guard let alive = try await client.session(token: current.token) else { throw AuthError.notSignedIn }
            return alive
        }
        verifyTask = task
        defer { verifyTask = nil }
        do {
            let alive = try await task.value
            persist(alive)
            return alive
        } catch {
            signOut()
            throw AuthError.notSignedIn
        }
    }

    /// 앱이 뜰 때 한 번. 네트워크가 안 되면 토큰을 버리지 않는다 — 오프라인에서 로그아웃당하지 않게.
    func restore() async {
        guard let current = session else { return }
        do {
            if let alive = try await client.session(token: current.token) {
                persist(alive)
            } else {
                signOut()
            }
        } catch {
            // 네트워크 문제다. 들고 있던 세션을 유지한다.
        }
    }

    private func persist(_ new: AuthSession) {
        session = new
        store.saveSession(new)
    }

    private func work(_ body: @escaping () async throws -> Void) async {
        isWorking = true
        lastError = nil
        notice = nil
        defer { isWorking = false }
        do {
            try await body()
        } catch let error as AuthError {
            lastError = error.message
        } catch {
            lastError = AuthError.network.message
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
        try await store.forceRefresh().token
    }
}
