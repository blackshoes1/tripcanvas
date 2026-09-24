import AuthenticationServices
import CryptoKit
import GoogleSignIn
import Observation
import SwiftUI

/// 시스템 인증 브라우저를 사용한다. 제공자 비밀 키·세션 토큰은 콜백 URL에 넣지 않는다.
@Observable
@MainActor
final class SocialSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    enum Provider: String, CaseIterable, Identifiable, Decodable {
        case google, apple, naver, kakao
        var id: String { rawValue }
        var title: String {
            switch self {
            case .google: "Google로 계속하기"
            case .apple: "Apple로 계속하기"
            case .naver: "네이버로 계속하기"
            case .kakao: "카카오로 계속하기"
            }
        }
    }
    private(set) var providers: [Provider] = []
    private(set) var isWorking = false
    private(set) var error: String?
    private var browser: ASWebAuthenticationSession?
    private let baseURL: URL
    private let transport: URLSession

    init(baseURL: URL = AppConfig.apiBaseURL, transport: URLSession = .shared) {
        self.baseURL = baseURL
        self.transport = transport
    }

    func loadProviders() async {
        guard let data = try? await request(path: "/api/v1/auth-config"),
              let config = try? JSONDecoder().decode(Configuration.self, from: data),
              config.provider == "TRIPCANVAS" else { providers = []; return }
        providers = (config.socialProviders ?? []).compactMap(Provider.init(rawValue:))
    }

    func signIn(_ provider: Provider, auth: AuthStore) async {
        guard !isWorking, !auth.isWorking else { return }
        isWorking = true; error = nil
        defer { isWorking = false; browser = nil }
        if !providers.contains(provider) { await loadProviders() }
        guard providers.contains(provider) else {
            error = "지금은 이 로그인 방법을 사용할 수 없어요. 잠시 후 다시 시도해 주세요."
            return
        }
        do {
            var bytes = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw AuthError.network }
            let verifier = Self.base64url(Data(bytes))
            if provider == .google {
                let token = try await googleToken(nonce: verifier)
                await auth.completeSocialSignIn(token: token)
                return
            }
            let challenge = Self.challenge(verifier)
            var start = URLComponents(url: baseURL.appendingPathComponent("api/auth/social/start"), resolvingAgainstBaseURL: false)!
            start.queryItems = [URLQueryItem(name: "provider", value: provider.rawValue), URLQueryItem(name: "client", value: "ios"),
                                URLQueryItem(name: "challenge", value: challenge)]
            let callback = try await open(start.url!)
            let ticket = try Self.ticket(from: callback, challenge: challenge)
            let data = try await request(path: "/api/auth/social/exchange", body: ["ticket": ticket, "verifier": verifier])
            let result = try JSONDecoder().decode(Exchange.self, from: data)
            await auth.completeSocialSignIn(token: result.token)
        } catch let failure as ASWebAuthenticationSessionError where failure.code == .canceledLogin {
            // 닫기는 사용자의 선택이다. 실패 안내를 띄우지 않는다.
        } catch let failure as NSError where failure.domain == kGIDSignInErrorDomain && failure.code == GIDSignInError.canceled.rawValue {
            // Google 로그인 창 닫기도 오류로 표시하지 않는다.
        } catch let failure as AuthError { error = failure.message }
        catch { self.error = "로그인을 완료하지 못했어요. 처음부터 다시 시도해 주세요." }
    }

    private func googleToken(nonce: String) async throws -> String {
        guard var presenter = activeWindow?.rootViewController else {
            throw AuthError.network
        }
        while let presented = presenter.presentedViewController { presenter = presented }
        // GIDClientID(iOS)와 GIDServerClientID(웹)는 Info.plist에서 SDK가 읽는다.
        defer { GIDSignIn.sharedInstance.signOut() }
        let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter, hint: nil, additionalScopes: nil, nonce: nonce)
        guard let idToken = result.user.idToken?.tokenString, !idToken.isEmpty else { throw AuthError.notSignedIn }
        let client = TripCanvasAuthClient(baseURL: baseURL, session: transport)
        return try await client.signInGoogle(idToken: idToken, nonce: nonce).token
    }

    func cancel() { browser?.cancel() }

    private func open(_ url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "tripcanvas") { callback, error in
                if let error { continuation.resume(throwing: error) }
                else if let callback { continuation.resume(returning: callback) }
                else { continuation.resume(throwing: AuthError.network) }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = true
            browser = session
            if !session.start() { continuation.resume(throwing: AuthError.network); browser = nil }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        activeWindow ?? ASPresentationAnchor()
    }

    private var activeWindow: UIWindow? {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }.flatMap(\.windows).first { $0.isKeyWindow }
    }

    static func challenge(_ verifier: String) -> String { base64url(Data(SHA256.hash(data: Data(verifier.utf8)))) }
    private static func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    static func ticket(from url: URL, challenge: String) throws -> String {
        guard url.scheme == "tripcanvas", url.host == "oauth", url.path.isEmpty,
              let fragment = url.fragment,
              let values = URLComponents(string: "https://callback.invalid/?" + fragment)?.queryItems,
              values.filter({ $0.name == "social_state" }).count == 1,
              values.first(where: { $0.name == "social_state" })?.value == challenge else { throw AuthError.notSignedIn }
        if let code = values.first(where: { $0.name == "social_error" })?.value {
            throw AuthError(code: .unknown, message: code == "EMAIL_NOT_VERIFIED"
                ? "확인 메일을 보냈어요. 메일의 링크를 누른 뒤 같은 방식으로 다시 로그인해 주세요."
                : "로그인을 완료하지 못했어요. 이메일 제공에 동의했는지 확인하고 다시 시도해 주세요.")
        }
        guard values.filter({ $0.name == "social_ticket" }).count == 1,
              let ticket = values.first(where: { $0.name == "social_ticket" })?.value, !ticket.isEmpty, ticket.count <= 4096 else { throw AuthError.notSignedIn }
        return ticket
    }

    private func request(path: String, body: [String: String]? = nil) async throws -> Data {
        var request = URLRequest(url: baseURL.appendingPathComponent(path), timeoutInterval: 30)
        request.httpShouldHandleCookies = false
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(baseURL.absoluteString, forHTTPHeaderField: "Origin")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await transport.data(for: request)
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else { throw AuthError.network }
        return data
    }
    private struct Configuration: Decodable { let provider: String; let socialProviders: [String]? }
    private struct Exchange: Decodable { let token: String }
}
