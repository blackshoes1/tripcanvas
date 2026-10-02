import Foundation

/// URLSession 소켓과 테스트 대역이 공유하는 최소 경계. 토큰·재접속 판단은 RealtimeClient에 남는다.
@MainActor
protocol RealtimeSocket: AnyObject {
    func resume()
    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?)
    func receive() async throws -> URLSessionWebSocketTask.Message
    func send(_ message: URLSessionWebSocketTask.Message) async throws
}

extension URLSessionWebSocketTask: RealtimeSocket {}
