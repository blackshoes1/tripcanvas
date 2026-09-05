import XCTest
@testable import TripCanvas

// 로그인은 웹(`auth.js`)과 **같은 서버·같은 계약**이다. 여기서 지키는 것은 세 가지다:
//   1. 서버가 준 실패를 화면이 분기할 수 있는 코드로 옮긴다(문구가 아니라 코드로)
//   2. 예전 Supabase 세션을 자체 Auth 세션으로 **변환하지 않는다** — 지우고 한 번 다시 묻는다
//   3. refresh 그랜트가 없으므로 401은 "세션이 아직 사는가"를 서버에 묻는 것으로 처리한다

private final class FakeAuthClient: AuthClient, @unchecked Sendable {
    var signInResult: Result<AuthSession, AuthError> = .success(
        AuthSession(token: "t1", userId: "u1", email: "j@example.com"))
    var signUpResult: Result<SignUpResult, AuthError> = .success(SignUpResult(verificationSent: true))
    /// `session(token:)`이 돌려줄 것. `.success(nil)`이면 세션이 죽은 것이다.
    var sessionResult: Result<AuthSession?, AuthError> = .success(nil)

    private(set) var signedOutTokens: [String] = []
    private(set) var resetRequests: [String] = []
    private(set) var sessionChecks = 0

    func signIn(email: String, password: String) async throws -> AuthSession { try signInResult.get() }
    func signUp(email: String, password: String) async throws -> SignUpResult { try signUpResult.get() }
    func session(token: String) async throws -> AuthSession? {
        sessionChecks += 1
        return try sessionResult.get()
    }
    func signOut(token: String) async { signedOutTokens.append(token) }
    func requestPasswordReset(email: String) async { resetRequests.append(email) }
}

private final class FakeSessionStore: SessionStoring, @unchecked Sendable {
    var stored: AuthSession?
    var legacyPresent = false
    private(set) var legacyReads = 0

    init(stored: AuthSession? = nil, legacyPresent: Bool = false) {
        self.stored = stored
        self.legacyPresent = legacyPresent
    }

    func loadSession() -> AuthSession? { stored }
    func saveSession(_ session: AuthSession) { stored = session }
    func removeSession() { stored = nil }
    func takeLegacySession() -> Bool {
        legacyReads += 1
        defer { legacyPresent = false }
        return legacyPresent
    }
}

@MainActor
final class AuthErrorMappingTests: XCTestCase {
    func testRateLimitWinsOverEverythingElse() {
        XCTAssertEqual(AuthError.from(status: 429, body: ["message": "invalid password"]).code, .rateLimited)
    }

    /// 미인증은 "비밀번호가 틀렸다"와 전혀 다른 상황이다 — 안내가 갈려야 한다.
    func testUnverifiedEmailIsNotAWrongPassword() {
        XCTAssertEqual(AuthError.from(status: 403, body: ["code": "EMAIL_NOT_VERIFIED"]).code, .emailNotVerified)
        XCTAssertEqual(AuthError.from(status: 401, body: ["message": "Email not verified"]).code, .emailNotVerified)
    }

    func testWrongPassword() {
        XCTAssertEqual(AuthError.from(status: 401, body: ["message": "Invalid email or password"]).code, .invalidCredentials)
        XCTAssertEqual(AuthError.from(status: 401, body: nil).code, .invalidCredentials)
    }

    func testAlreadyRegistered() {
        XCTAssertEqual(AuthError.from(status: 400, body: ["message": "User already exists"]).code, .emailTaken)
    }

    func testUnknownKeepsTheServerSentence() {
        let mapped = AuthError.from(status: 500, body: ["message": "서버가 아파요"])
        XCTAssertEqual(mapped.code, .unknown)
        XCTAssertEqual(mapped.message, "서버가 아파요")
    }

    /// 사용자에게 보이는 문장에 내부 코드가 새지 않는다.
    func testMessagesDoNotLeakCodes() {
        for error in [AuthError.from(status: 429, body: nil),
                      AuthError.from(status: 403, body: ["code": "EMAIL_NOT_VERIFIED"]),
                      AuthError.from(status: 401, body: nil)] {
            XCTAssertFalse(error.message.contains("_"), "코드가 문장에 섞였다: \(error.message)")
        }
    }
}

@MainActor
final class AuthStoreTests: XCTestCase {
    func testSignInKeepsTheSession() async {
        let client = FakeAuthClient()
        let store = FakeSessionStore()
        let auth = AuthStore(client: client, store: store)

        await auth.signIn(email: "j@example.com", password: "12345678")

        XCTAssertTrue(auth.isSignedIn)
        XCTAssertEqual(auth.email, "j@example.com")
        XCTAssertEqual(store.stored?.token, "t1", "다음 실행에서도 이어지도록 저장한다")
        XCTAssertNil(auth.lastError)
    }

    func testFailedSignInSaysWhyAndStaysSignedOut() async {
        let client = FakeAuthClient()
        client.signInResult = .failure(AuthError(code: .emailNotVerified, message: "메일의 확인 링크를 먼저 눌러주세요 (스팸함도 확인)."))
        let store = FakeSessionStore()
        let auth = AuthStore(client: client, store: store)

        await auth.signIn(email: "j@example.com", password: "12345678")

        XCTAssertFalse(auth.isSignedIn)
        XCTAssertNil(store.stored)
        XCTAssertEqual(auth.lastError, "메일의 확인 링크를 먼저 눌러주세요 (스팸함도 확인).")
    }

    /// 가입은 로그인이 아니다 — 이메일 확인 전에는 세션이 열리지 않는다.
    func testSignUpDoesNotSignIn() async {
        let auth = AuthStore(client: FakeAuthClient(), store: FakeSessionStore())

        await auth.signUp(email: "j@example.com", password: "12345678")

        XCTAssertFalse(auth.isSignedIn)
        XCTAssertNil(auth.lastError)
        XCTAssertEqual(auth.notice?.contains("확인 메일"), true)
    }

    /// 있는 이메일인지 알려주지 않는다 — 언제나 같은 답이다.
    func testPasswordResetAlwaysAnswersTheSame() async {
        let client = FakeAuthClient()
        let auth = AuthStore(client: client, store: FakeSessionStore())

        await auth.requestPasswordReset(email: "nobody@example.com")

        XCTAssertEqual(client.resetRequests, ["nobody@example.com"])
        XCTAssertNil(auth.lastError)
        XCTAssertEqual(auth.notice?.contains("가입된 이메일이면"), true)
    }

    /// §8 — 예전 Supabase 세션을 자체 Auth 세션으로 바꾸지 않는다. 지우고 한 번 다시 묻는다.
    func testLegacySupabaseSessionIsClearedNotConverted() {
        let store = FakeSessionStore(stored: nil, legacyPresent: true)
        let auth = AuthStore(client: FakeAuthClient(), store: store)

        XCTAssertFalse(auth.isSignedIn, "예전 토큰으로 로그인한 척하지 않는다")
        XCTAssertEqual(auth.notice?.contains("로그인 방식이 변경"), true)
        XCTAssertEqual(auth.notice?.contains("저장된 여행은 그대로"), true, "여행이 사라지는 줄 알게 두지 않는다")
        XCTAssertFalse(store.legacyPresent, "예전 세션은 지워진다")
    }

    func testValidSessionSkipsTheLegacyPath() {
        let store = FakeSessionStore(stored: AuthSession(token: "t1", userId: "u1", email: "j@example.com"),
                                     legacyPresent: true)
        let auth = AuthStore(client: FakeAuthClient(), store: store)

        XCTAssertTrue(auth.isSignedIn)
        XCTAssertNil(auth.notice, "이미 로그인돼 있으면 다시 로그인하라고 하지 않는다")
        XCTAssertEqual(store.legacyReads, 0)
    }

    func testSignOutClearsLocallyAndTellsTheServer() async {
        let client = FakeAuthClient()
        let store = FakeSessionStore(stored: AuthSession(token: "t1", userId: "u1", email: "j@example.com"))
        let auth = AuthStore(client: client, store: store)

        auth.signOut()

        XCTAssertFalse(auth.isSignedIn)
        XCTAssertNil(store.stored)
        // 서버 통보는 뒤따라가는 작업이라 잠깐 기다렸다 본다 — 실패해도 이 기기는 이미 로그아웃이다.
        try? await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(client.signedOutTokens, ["t1"])
    }

    /// refresh 그랜트가 없다 — 401이면 "세션이 아직 사는가"를 묻는다.
    func testForceRefreshKeepsALiveSession() async throws {
        let client = FakeAuthClient()
        let live = AuthSession(token: "t1", userId: "u1", email: "j@example.com")
        client.sessionResult = .success(live)
        let auth = AuthStore(client: client, store: FakeSessionStore(stored: live))

        let token = try await auth.forceRefresh().token

        XCTAssertEqual(token, "t1")
        XCTAssertTrue(auth.isSignedIn)
    }

    func testForceRefreshSignsOutWhenTheSessionIsGone() async {
        let client = FakeAuthClient()
        client.sessionResult = .success(nil)
        let store = FakeSessionStore(stored: AuthSession(token: "t1", userId: "u1", email: "j@example.com"))
        let auth = AuthStore(client: client, store: store)

        do {
            _ = try await auth.forceRefresh()
            XCTFail("죽은 세션으로 계속 가면 안 된다")
        } catch {
            XCTAssertEqual((error as? AuthError)?.code, .notSignedIn)
        }
        XCTAssertFalse(auth.isSignedIn)
        XCTAssertNil(store.stored)
    }

    /// 네트워크가 끊겼다고 로그아웃시키지 않는다 — 비행기 안에서 캐시된 여행을 못 보게 된다.
    func testRestoreKeepsTheSessionWhenOffline() async {
        let client = FakeAuthClient()
        client.sessionResult = .failure(AuthError.network)
        let session = AuthSession(token: "t1", userId: "u1", email: "j@example.com")
        let auth = AuthStore(client: client, store: FakeSessionStore(stored: session))

        await auth.restore()

        XCTAssertTrue(auth.isSignedIn)
    }

    func testRestoreSignsOutWhenTheServerSaysTheSessionIsGone() async {
        let client = FakeAuthClient()
        client.sessionResult = .success(nil)
        let auth = AuthStore(client: client,
                             store: FakeSessionStore(stored: AuthSession(token: "t1", userId: "u1", email: "j@example.com")))

        await auth.restore()

        XCTAssertFalse(auth.isSignedIn)
    }
}
