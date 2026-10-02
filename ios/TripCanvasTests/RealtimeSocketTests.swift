import XCTest
@testable import TripCanvas

@MainActor
final class RealtimeSocketTests: XCTestCase {
    private let url = URL(string: "wss://example.invalid/realtime")!

    private func settle(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
        for _ in 0..<1000 {
            if condition() { return }
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        XCTFail("실시간 상태 전환이 완료되지 않았다", file: file, line: line)
    }

    func testReadySubscribePingActivityAndTerminalError() async {
        let socket = FakeProtocolSocket()
        let client = RealtimeClient(tokens: SocketTokens(), retrySeconds: 0.001,
            socketFactory: { _ in socket }, urlFor: { self.url })
        var events: [RealtimeActivity] = []
        client.connect(tripId: "t1", key: "trip") { events.append($0) }
        defer { client.disconnect() }
        await settle { socket.sentTypes == ["AUTH"] }
        socket.frame("{\"type\":\"READY\"}")
        await settle { socket.sentTypes == ["AUTH", "SUBSCRIBE"] }
        socket.frame("{\"type\":\"SUBSCRIBED\"}")
        await settle { client.state == .live }
        socket.frame("{\"type\":\"PING\"}")
        await settle { socket.sentTypes.last == "PONG" }
        socket.frame("{\"type\":\"ACTIVITY\",\"tripId\":\"t1\",\"id\":1,\"kind\":\"REACTION\",\"mine\":false}")
        await settle { events.count == 1 }
        socket.frame("{\"type\":\"ERROR\",\"code\":\"FORBIDDEN\"}")
        await settle { client.state == .unavailable && socket.cancelled > 0 }
        XCTAssertEqual(socket.resumed, 1)
        XCTAssertEqual(socket.sentTypes, ["AUTH", "SUBSCRIBE", "PONG"])
        XCTAssertEqual(events, [RealtimeActivity(tripId: "t1", id: 1, kind: "REACTION", mine: false)])
        // ERROR로 끝난 pump가 다음 명시적 접속을 막지 않는다.
        client.connect(tripId: "t1", key: "trip") { _ in }
        await settle { socket.resumed == 2 }
    }

    func testReceiveFailuresRetryOnlyFiveTimes() async {
        var sockets: [FakeProtocolSocket] = []
        let client = RealtimeClient(tokens: SocketTokens(), retrySeconds: 0.001, socketFactory: { _ in
            let socket = FakeProtocolSocket()
            socket.failImmediately = true
            sockets.append(socket)
            return socket
        }, urlFor: { self.url })
        client.connect(tripId: "t1", key: "trip") { _ in }
        defer { client.disconnect() }
        await settle { client.state == .unavailable }
        XCTAssertEqual(sockets.count, 6, "처음 1회 + 재시도 5회")
        XCTAssertTrue(sockets.allSatisfy { $0.cancelled == 1 })
    }

    func testLateErrorFromOldTripCannotStopTheNewSocket() async {
        let old = FakeProtocolSocket(), current = FakeProtocolSocket()
        old.ignoreCancellation = true // 취소 직전에 도착한 프레임이 뒤늦게 돌아오는 상황
        var opened = 0
        let client = RealtimeClient(tokens: SocketTokens(), socketFactory: { _ in
            opened += 1; return opened == 1 ? old : current
        }, urlFor: { self.url })
        client.connect(tripId: "t1", key: "trip") { _ in }
        await settle { old.waiting }
        client.connect(tripId: "t2", key: "trip") { _ in }
        defer { old.ignoreCancellation = false; old.cancel(with: .goingAway, reason: nil); client.disconnect() }
        await settle { current.waiting }
        current.frame("{\"type\":\"SUBSCRIBED\"}")
        await settle { client.state == .live }
        old.frame("{\"type\":\"ERROR\"}")
        await settle { old.cancelled >= 2 }
        XCTAssertEqual(client.state, .live)
        XCTAssertEqual(current.cancelled, 0)
        client.connect(tripId: "t2", key: "board") { _ in }
        XCTAssertEqual(opened, 2, "옛 pump의 종료가 새 pump를 지우지 않는다")
    }

    func testDisconnectCancelsReceiveAndDoesNotRetry() async {
        let socket = FakeProtocolSocket()
        var opened = 0
        let client = RealtimeClient(tokens: SocketTokens(), retrySeconds: 0.001, socketFactory: { _ in
            opened += 1; return socket
        }, urlFor: { self.url })
        client.connect(tripId: "t1", key: "trip") { _ in }
        await settle { socket.waiting }
        client.disconnect()
        await settle { socket.cancelled >= 2 }
        XCTAssertEqual(client.state, .off)
        XCTAssertEqual(opened, 1)
    }
}

@MainActor
private final class SocketTokens: TokenProviding {
    func accessToken() async throws -> String { "test-signed-token" }
    func refreshToken() async throws -> String { "test-signed-token" }
}

@MainActor
private final class FakeProtocolSocket: RealtimeSocket {
    private var receiver: CheckedContinuation<URLSessionWebSocketTask.Message, Error>?
    private var queued: [URLSessionWebSocketTask.Message] = []
    private(set) var sentTypes: [String] = []
    private(set) var resumed = 0
    private(set) var cancelled = 0
    var ignoreCancellation = false
    var failImmediately = false
    var waiting: Bool { receiver != nil }
    func resume() { resumed += 1 }
    func send(_ message: URLSessionWebSocketTask.Message) async throws {
        guard case .string(let text) = message, let data = text.data(using: .utf8),
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else { return }
        sentTypes.append(type)
    }
    func receive() async throws -> URLSessionWebSocketTask.Message {
        if failImmediately { throw URLError(.networkConnectionLost) }
        if !queued.isEmpty { return queued.removeFirst() }
        return try await withCheckedThrowingContinuation { receiver = $0 }
    }
    func frame(_ text: String) {
        if let waiting = receiver {
            receiver = nil; waiting.resume(returning: .string(text))
        } else { queued.append(.string(text)) }
    }
    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        cancelled += 1
        guard !ignoreCancellation, let waiting = receiver else { return }
        receiver = nil; waiting.resume(throwing: URLError(.cancelled))
    }
}
