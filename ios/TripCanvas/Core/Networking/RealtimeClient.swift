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
    ///
    /// 소켓은 하나지만 **듣는 화면은 여럿이다**(여행 전체 · 가고 싶은 곳 보드). `key`가 그 화면을 가리키고,
    /// 같은 키로 다시 부르면 핸들러를 갈아 끼운다. 2026-09-20 전에는 핸들러가 하나뿐이라, 이미 붙은
    /// 여행에 두 번째 화면이 붙으면 그 화면의 핸들러가 **조용히 버려졌다.**
    func connect(tripId: String, key: String, onEvent: @escaping @MainActor (RealtimeActivity) -> Void)
    /// 화면 하나가 떠난다. 남은 구독자가 있으면 소켓은 그대로 둔다 — 시트를 닫았다고 여행 전체가 끊기면 안 된다.
    func disconnect(key: String)
    /// 전부 뗀다(백그라운드 · 여행을 떠날 때).
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
    /// 던지면 **이번에는 답을 못 받은 것**이다 — 그 답(nil)과 섞지 않는다. 네트워크 실패(타임아웃 등)는 소켓이
    /// 끊겼을 때처럼 몇 번 다시 묻고, 다시 물어도 같은 실패(서버 오류·응답 모양 어긋남·권한)는 이번에는 접는다.
    private let urlFor: @MainActor () async throws -> URL?

    private var task: URLSessionWebSocketTask?
    private var tripId: String?
    /// 듣는 화면들. 하나의 소켓을 나눠 쓴다 — 키는 화면이 스스로 정한다.
    private var handlers: [String: @MainActor (RealtimeActivity) -> Void] = [:]
    private var attempts = 0
    private var retry: Task<Void, Never>?
    private var pump: Task<Void, Never>?
    /// 지금 연결의 번호. `run`을 띄울 때마다 오른다 — `run`은 자기 번호가 아직 지금의 것일 때만 흔적을 지운다.
    /// 늦게 끝난 옛 `run`이 새 연결의 `pump`를 지우면 `connect`가 pump를 하나 더 띄운다.
    private var generation = 0
    /// 권한·형식 문제는 재시도해도 같다 — 매달리지 않는다.
    private var stopped = false

    /// 흔들리는 네트워크에 매달리지 않는다. 폴백이 있으므로 몇 번만 시도한다(웹과 같은 값).
    private let retrySeconds: Double
    private let maxAttempts = 5

    init(session: URLSession = .shared, tokens: TokenProviding,
         retrySeconds: Double = 3, urlFor: @escaping @MainActor () async throws -> URL?) {
        self.session = session
        self.tokens = tokens
        self.retrySeconds = retrySeconds
        self.urlFor = urlFor
    }

    func connect(tripId: String, key: String, onEvent: @escaping @MainActor (RealtimeActivity) -> Void) {
        // 보고 있는 여행 하나만 구독한다 — 여행을 바꾸면 이전 것을 끊고 새로 연다.
        if self.tripId != tripId { disconnect() }
        self.tripId = tripId
        handlers[key] = onEvent
        // 이미 붙어 있거나 붙는 중(재시도 대기 포함)이면 핸들러만 더한다.
        // 소켓을 다시 열면 이미 듣던 화면이 끊기고, pump가 둘이 되면 같은 이벤트를 두 번 받는다.
        guard task == nil, pump == nil, retry == nil else { return }
        stopped = false
        attempts = 0
        open()
    }

    /// 받은 이벤트를 듣는 화면들에 나눈다. 소켓 없이 분배 규칙만 보려고 따로 두었다.
    func emit(_ activity: RealtimeActivity) {
        for handler in handlers.values { handler(activity) }
    }

    /// 화면 하나가 떠난다. **남은 구독자가 있으면 소켓은 그대로다.**
    func disconnect(key: String) {
        guard handlers.removeValue(forKey: key) != nil else { return }
        if handlers.isEmpty { disconnect() }
    }

    func disconnect() {
        stopped = true
        retry?.cancel(); retry = nil
        pump?.cancel(); pump = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        tripId = nil
        handlers.removeAll()
        state = .off
    }

    // MARK: -

    private func open() {
        guard let tripId else { return }
        stopped = false
        state = .connecting
        launch(tripId)
    }

    private func launch(_ tripId: String) {
        generation += 1
        let current = generation
        pump = Task { [weak self] in await self?.run(tripId: tripId, generation: current) }
    }

    /// 이 `run`이 아직 지금의 연결인가. 기다리는 사이에 끊겼거나(취소) 여행이 바뀌었거나 새 연결이 떴으면 아니다.
    private func isCurrent(_ generation: Int, tripId: String) -> Bool {
        !Task.isCancelled && generation == self.generation && self.tripId == tripId
    }

    private func run(tripId: String, generation: Int) async {
        // ⚠️ 붙기 전에 두 번 기다린다. 깨어나면 **아직 지금의 연결인지 다시 본다** — 전에는 다시 보지 않아,
        //    끊은 뒤(백그라운드·여행을 떠남)에 소켓을 열고 토큰까지 실어 보냈다.
        // ⚠️ 여기서 끝나도 `pump`를 비운다. 남겨 두면 `connect`의 가드에 걸려, 백그라운드에 다녀오기 전까지
        //    같은 여행에 다시 붙지 않았다.
        let resolved: URL?
        do { resolved = try await urlFor() } catch {
            guard isCurrent(generation, tripId: tripId) else { return }
            pump = nil
            // 네트워크가 흔들려 못 물었다 — "안 쓴다"는 답이 아니다. `.off`로 접으면 같은 화면에 있는 동안
            // 다시 붙지 않으니 소켓이 끊겼을 때처럼 몇 번 다시 묻는다.
            // ⚠️ 그 밖의 실패(서버 오류·응답 모양이 어긋남·권한)는 다시 물어도 같다 — 매번 6번씩 묻지 않고
            //    접는다. 담지 않았으므로 화면에 다시 들어오면(다음 `connect`) 한 번 다시 묻는다.
            guard Self.isTransient(error) else { state = .off; return }
            state = .connecting
            schedule()
            return
        }
        guard isCurrent(generation, tripId: tripId) else { return }
        guard let url = resolved else { state = .off; pump = nil; return }   // 서버가 실시간을 안 쓴다고 했다
        let fetched = try? await tokens.accessToken()
        guard isCurrent(generation, tripId: tripId) else { return }
        guard let token = fetched else { state = .off; pump = nil; return }   // 로그아웃이면 붙지 않는다

        let socket = session.webSocketTask(with: url)
        task = socket
        socket.resume()

        await send(socket, ["type": "AUTH", "token": token])

        while isCurrent(generation, tripId: tripId), !stopped {
            let message: URLSessionWebSocketTask.Message
            do { message = try await socket.receive() } catch { break }
            // ⚠️ 받는 사이에 끊겼으면(여행을 바꿈·앱이 뒤로 감) 이 프레임은 이제 지금의 연결 것이 아니다.
            //    옛 연결이 ERROR로 `stopped`를 남기면 새 연결이 붙자마자 접히고, SUBSCRIBED로 `.live`를 남기면
            //    소켓도 없이 실시간인 척한다.
            guard isCurrent(generation, tripId: tripId) else { break }
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
                emit(RealtimeActivity(tripId: eventTrip, id: id, kind: kind, mine: (msg["mine"] as? Bool) ?? false))
            default:
                continue
            }
        }

        // 받는 쪽이 끝났으면 소켓도 닫는다 — ERROR 뒤에 서버가 닫지 않으면 열린 소켓이 남는다.
        socket.cancel(with: .goingAway, reason: nil)
        // 지금의 소켓일 때만 지운다 — 늦게 끝난 옛 연결이 새 연결의 참조를 지우면 안 된다.
        if task === socket { task = nil }
        guard isCurrent(generation, tripId: tripId) else { return }
        pump = nil
        if stopped { return }
        state = .connecting
        schedule()
    }

    /// 다시 물으면 될 수도 있는 실패인가 — 네트워크 자체의 문제만이다.
    private static func isTransient(_ error: Error) -> Bool {
        (error as? APIError)?.isOffline == true || error is URLError
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
            self.launch(tripId)
        }
    }
}
