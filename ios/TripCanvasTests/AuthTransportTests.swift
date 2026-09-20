import Network
import XCTest
@testable import TripCanvas

final class AuthTransportTests: XCTestCase {
    func testSignInIgnoresCookiesLeftByAnEarlierSession() async throws {
        // 실제 HTTP 연결을 사용한다. URLProtocol 가짜 응답은 자동 쿠키 전송을 재현하지 못한다.
        let listener = try NWListener(using: .tcp, on: .any)
        let ready = expectation(description: "HTTP server ready")
        listener.stateUpdateHandler = { state in
            if case .ready = state { ready.fulfill() }
        }
        listener.newConnectionHandler = { connection in
            connection.start(queue: .global())
            Self.respond(connection, received: Data())
        }
        listener.start(queue: .global())
        defer { listener.cancel() }
        await fulfillment(of: [ready], timeout: 5)
        let port = try XCTUnwrap(listener.port)
        let url = URL(string: "http://127.0.0.1:\(port.rawValue)")!
        let config = URLSessionConfiguration.ephemeral
        let cookie = HTTPCookie(properties: [.domain: "127.0.0.1", .path: "/", .name: "better-auth.session_token", .value: "old-session"])!
        let storage = try XCTUnwrap(config.httpCookieStorage)
        storage.setCookie(cookie)
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }

        let (_, controlResponse) = try await session.data(from: url)
        XCTAssertEqual((controlResponse as? HTTPURLResponse)?.statusCode, 403,
                       "기본 URLSession은 이전 쿠키를 전송하므로 서버가 거절한다")

        let client = TripCanvasAuthClient(baseURL: url, session: session)
        let result = try await client.signIn(email: "j@example.com", password: "test-password")
        XCTAssertEqual(result.token, "test-token")
        XCTAssertEqual(result.userId, "test-user")
        XCTAssertNotNil(storage.cookies(for: url)?.first, "다른 요청의 쿠키를 삭제하지 않는다")
    }

    private static func respond(_ connection: NWConnection, received: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, complete, error in
            var request = received
            if let data { request.append(data) }
            guard let text = String(data: request, encoding: .utf8),
                  text.contains("\r\n\r\n") else {
                if complete || error != nil { connection.cancel() }
                else { respond(connection, received: request) }
                return
            }
            let hasCookie = text.lowercased().contains("\r\ncookie:")
            let status = hasCookie ? "403 Forbidden" : "200 OK"
            let body = hasCookie
                ? #"{"code":"MISSING_OR_NULL_ORIGIN","message":"Missing or null Origin"}"#
                : #"{"user":{"id":"test-user","email":"j@example.com"}}"#
            let response = "HTTP/1.1 \(status)\r\nContent-Type: application/json\r\nset-auth-token: test-token\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
            connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
        }
    }
}
