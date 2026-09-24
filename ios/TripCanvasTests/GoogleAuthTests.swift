import XCTest
@testable import TripCanvas

final class GoogleAuthTests: XCTestCase {
    func testGoogleLoginUsesSignedHeaderAndSendsIdTokenAndNonce() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [GoogleAuthProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let client = TripCanvasAuthClient(baseURL: URL(string: "https://api.test")!, session: session)
        let result = try await client.signInGoogle(idToken: "google-id-token", nonce: "nonce")
        XCTAssertEqual(result.token, "signed-session")
        XCTAssertEqual(result.userId, "user")
    }

    func testGoogleLoginRejectsMissingSignedHeader() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [GoogleAuthProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let client = TripCanvasAuthClient(baseURL: URL(string: "https://missing.test")!, session: session)
        do {
            _ = try await client.signInGoogle(idToken: "google-id-token", nonce: "nonce")
            XCTFail("Unsigned response must not become an app session")
        } catch { XCTAssertEqual(error as? AuthError, .notSignedIn) }
    }
}

private final class GoogleAuthProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        XCTAssertEqual(request.url?.path, "/api/auth/sign-in/social")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertFalse(request.httpShouldHandleCookies)
        var data = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable {
                let size = stream.read(&buffer, maxLength: buffer.count)
                if size <= 0 { break }
                data.append(contentsOf: buffer.prefix(size))
            }
        }
        let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        XCTAssertEqual(body?["provider"] as? String, "google")
        XCTAssertEqual(body?["idToken"] as? [String: String], ["token": "google-id-token", "nonce": "nonce"])
        let headers = request.url?.host == "missing.test" ? [:] : ["set-auth-token": "signed-session"]
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"token":"unsigned-token","user":{"id":"user","email":"j@example.com"}}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
