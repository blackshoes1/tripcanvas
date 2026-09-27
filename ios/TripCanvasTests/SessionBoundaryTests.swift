import XCTest
@testable import TripCanvas

private actor DelayedSessionClient: AuthClient {
    var waiting: [String: CheckedContinuation<AuthSession?, Error>] = [:]
    let next = AuthSession(token: "token-b", userId: "b", email: "b@example.invalid")
    func signIn(email: String, password: String) async throws -> AuthSession { next }
    func signUp(email: String, password: String) async throws -> SignUpResult { .init(verificationSent: true) }
    func session(token: String) async throws -> AuthSession? {
        try await withCheckedThrowingContinuation { waiting[token] = $0 }
    }
    func signOut(token: String) async {}
    func requestPasswordReset(email: String) async {}
    func pending(_ token: String = "token-a") -> Bool { waiting[token] != nil }
    func finish(_ value: AuthSession?, token: String = "token-a") { waiting.removeValue(forKey: token)?.resume(returning: value) }
}
private final class BoundarySessionStore: SessionStoring, @unchecked Sendable {
    var value: AuthSession?
    init(_ value: AuthSession) { self.value = value }
    func loadSession() -> AuthSession? { value }
    func saveSession(_ session: AuthSession) { value = session }
    func removeSession() { value = nil }
    func takeLegacySession() -> Bool { false }
}
@MainActor
final class SessionBoundaryTests: XCTestCase {
    func testLateSessionVerificationCannotUndoLogout() async {
        for refresh in [false, true] {
            let original = AuthSession(token: "token-a", userId: "a", email: "a@example.invalid")
            let client = DelayedSessionClient()
            let disk = BoundarySessionStore(original)
            let auth = AuthStore(client: client, store: disk)
            let request = Task {
                if refresh { _ = try? await auth.forceRefresh() } else { await auth.restore() }
            }
            while !(await client.pending()) { await Task.yield() }
            auth.signOut()
            await client.finish(original)
            await request.value
            XCTAssertFalse(auth.isSignedIn)
            XCTAssertNil(disk.value)
        }
    }

    func testAccountSwitchStartsItsOwnSessionVerification() async {
        let original = AuthSession(token: "token-a", userId: "a", email: "a@example.invalid")
        let client = DelayedSessionClient()
        let auth = AuthStore(client: client, store: BoundarySessionStore(original))
        let first = Task { try? await auth.forceRefresh() }
        while !(await client.pending()) { await Task.yield() }
        await auth.signIn(email: "b@example.invalid", password: "fake-password")
        let second = Task { try? await auth.forceRefresh() }
        for _ in 0..<100 { await Task.yield() }
        let startedOwnCheck = await client.pending("token-b")
        XCTAssertTrue(startedOwnCheck)
        await client.finish(await client.next, token: "token-b")
        await client.finish(original)
        _ = await first.value
        _ = await second.value
        XCTAssertEqual(auth.session?.userId, "b")
    }

    func testPreviousAccountResponseCannotReplaceOrSignOutNewAccount() async {
        for refresh in [false, true] {
            for alive in [false, true] {
                let original = AuthSession(token: "token-a", userId: "a", email: "a@example.invalid")
                let client = DelayedSessionClient()
                let auth = AuthStore(client: client, store: BoundarySessionStore(original))
                let request = Task {
                    if refresh { _ = try? await auth.forceRefresh() } else { await auth.restore() }
                }
                while !(await client.pending()) { await Task.yield() }
                auth.signOut()
                await auth.signIn(email: "b@example.invalid", password: "fake-password")
                await client.finish(alive ? original : nil)
                await request.value
                XCTAssertEqual(auth.session?.userId, "b")
            }
        }
    }
}
