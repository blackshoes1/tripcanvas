import Foundation
import Observation

/// 실시간 이벤트 하나. **내용은 없다** — 무엇이 바뀌었는지만 온다(§45).
/// 진실은 PostgreSQL이고 소켓은 알림 채널일 뿐이라, 받은 뒤 API로 다시 읽는다.
struct RealtimeActivity: Equatable, Sendable {
    let tripId: String
    let id: Int
    let kind: String
    /// 내가 한 것인가 — 서버가 구독자별로 계산해 준다. 내 저장을 다시 당기지 않는 데 쓴다.
    let mine: Bool
}

/// 실시간 접속 상태. 화면은 이걸로 "실시간"인지 "당겨서 새로고침"인지 말한다.
enum RealtimeState: Equatable, Sendable {
    case off
    case connecting
    case live
    /// 몇 번 시도해도 안 됐다 — 앱은 그대로 돌고 폴백(당겨서 새로고침)으로 간다.
    case unavailable
}

@MainActor
protocol RealtimeConnecting: AnyObject {
    var state: RealtimeState { get }
    /// 이 여행 하나를 구독한다. 다른 여행으로 바꾸면 이전 것은 끊는다.
    func connect(tripId: String, onEvent: @escaping @MainActor (RealtimeActivity) -> Void)
    func disconnect()
}

/// WebSocket 사이드카 접속(`server/realtime/hub.ts`).
///
/// 규약은 웹(`api.js`의 `connectRealtime`)과 **같다**:
/// 붙으면 첫 프레임으로 `AUTH` — **토큰을 URL에 싣지 않는다**(프록시·접근 로그에 남는다).
/// `READY` 뒤에 `SUBSCRIBE`, 그다음부터 `ACTIVITY`가 온다. `PING`에는 `PONG`으로 답해야 끊기지 않는다.
///
/// ⚠️ **실시간이 없어도 앱은 그대로 돈다.** 붙지 못하면 조용히 폴백(당겨서 새로고침)으로 간다 —
/// 실시간을 못 붙였다고 오류 화면을 띄우지 않는다.
@Observable
@MainActor
final class RealtimeClient: RealtimeConnecting {
    private(set) var state: RealtimeState = .off

    private let session: URLSession
    private let tokens: TokenProviding
    /// `/api/v1/me`가 알려 준 주소. nil이면 서버가 실시간을 쓰지 말라고 한 것이다.
    private let urlFor: @MainActor () async -> URL?

    private var task: URLSessionWebSocketTask?
    private var tripId: String?
    private var onEvent: (@MainActor (RealtimeActivity) -> Void)?
    private var attempts = 0
    private var retry: Task<Void, Never>?
    private var pump: Task<Void, Never>?
    /// 권한·형식 문제는 재시도해도 같다 — 매달리지 않는다.
    private var stopped = false

    /// 흔들리는 네트워크에 매달리지 않는다. 폴백이 있으므로 몇 번만 시도한다(웹과 같은 값).
    private let retrySeconds: Double
    private let maxAttempts = 5

    init(session: URLSession = .shared, tokens: TokenProviding,
         retrySeconds: Double = 3, urlFor: @escaping @MainActor () async -> URL?) {
        self.session = session
        self.tokens = tokens
        self.retrySeconds = retrySeconds
        self.urlFor = urlFor
    }

    func connect(tripId: String, onEvent: @escaping @MainActor (RealtimeActivity) -> Void) {
        // 보고 있는 여행 하나만 구독한다 — 여행을 바꾸면 이전 것을 끊고 새로 연다.
        if self.tripId == tripId, task != nil { return }
        disconnect()
        self.tripId = tripId
        self.onEvent = onEvent
        stopped = false
        attempts = 0
        open()
    }

    func disconnect() {
        stopped = true
        retry?.cancel(); retry = nil
        pump?.cancel(); pump = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        tripId = nil
        onEvent = nil
        state = .off
    }

    // MARK: -

    private func open() {
        guard let tripId else { return }
        stopped = false
        state = .connecting
        pump = Task { [weak self] in await self?.run(tripId: tripId) }
    }

    private func run(tripId: String) async {
        guard let url = await urlFor() else { state = .off; return }   // 서버가 실시간을 안 쓴다고 했다
        guard let token = try? await tokens.accessToken() else { state = .off; return }   // 로그아웃이면 붙지 않는다

        let socket = session.webSocketTask(with: url)
        task = socket
        socket.resume()

        await send(socket, ["type": "AUTH", "token": token])

        while !Task.isCancelled, !stopped {
            let message: URLSessionWebSocketTask.Message
            do { message = try await socket.receive() } catch { break }
            guard case .string(let text) = message,
                  let data = text.data(using: .utf8),
                  let msg = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let type = msg["type"] as? String else { continue }

            switch type {
            case "READY":
                await send(socket, ["type": "SUBSCRIBE", "tripId": tripId])
            case "SUBSCRIBED":
                attempts = 0
                state = .live
            case "PING":
                await send(socket, ["type": "PONG"])
            case "ERROR":
                // 권한·형식 문제는 재시도해도 같다.
                stopped = true
                state = .unavailable
            case "ACTIVITY":
                guard let id = msg["id"] as? Int, let kind = msg["kind"] as? String,
                      let eventTrip = msg["tripId"] as? String else { continue }
                onEvent?(RealtimeActivity(tripId: eventTrip, id: id, kind: kind, mine: (msg["mine"] as? Bool) ?? false))
            default:
                continue
            }
        }

        task = nil
        if stopped || Task.isCancelled { return }
        state = .connecting
        schedule()
    }

    private func send(_ socket: URLSessionWebSocketTask, _ payload: [String: Any]) async {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else { return }
        try? await socket.send(.string(text))
    }

    private func schedule() {
        guard !stopped, retry == nil, let tripId else { return }
        attempts += 1
        guard attempts <= maxAttempts else { state = .unavailable; return }
        let delay = retrySeconds * Double(min(attempts, 4))
        retry = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard let self, !Task.isCancelled, !self.stopped else { return }
            self.retry = nil
            self.pump = Task { [weak self] in await self?.run(tripId: tripId) }
        }
    }
}
