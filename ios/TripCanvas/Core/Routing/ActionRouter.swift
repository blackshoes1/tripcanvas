import Foundation
import Observation

/// Siri · Push · Widget · Watch · Share Extension이 **각자 다른 화면 이동 코드를 갖지 않게** 하는 한 곳(§41).
///
/// 새 진입점이 생기면 여기에 목적지를 하나 추가한다. 화면 코드는 이 라우터만 본다.
@Observable
@MainActor
final class ActionRouter {
    /// 지금 열어야 할 목적지. 화면이 처리한 뒤 비운다.
    private(set) var destination: Destination?

    enum Destination: Equatable {
        case today(tripId: String?, focusActivityId: String?)
        case trip(tripId: String)
        case suggestion(tripId: String, suggestionId: String)
        case replan(tripId: String)
        case bookings(tripId: String)
        /// 공유로 들어온 것을 확인하는 화면. tripId는 아직 모를 수 있다.
        case inbox(shareKey: String?)
        case memory(tripId: String)
        /// 초대 링크로 참여 — 토큰만 싣는다(여행 id·역할은 서버가 토큰으로 찾는다).
        case join(token: String)
    }

    func open(_ destination: Destination) { self.destination = destination }
    func clear() { destination = nil }

    /// 딥링크 하나로 모든 진입점을 처리한다(§40).
    /// `tripcanvas://today` · `tripcanvas://trip/{id}/today?focus=...` · `tripcanvas://inbox` 등.
    @discardableResult
    func open(url: URL) -> Bool {
        guard let destination = ActionRouter.parse(url) else { return false }
        open(destination)
        return true
    }

    static func parse(_ url: URL) -> Destination? {
        guard url.scheme == "tripcanvas" else { return nil }
        let parts = ([url.host].compactMap { $0 } + url.pathComponents.filter { $0 != "/" })
        guard let head = parts.first else { return nil }
        let focus = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first { $0.name == "focus" }?.value

        // 여행을 특정하지 않는 짧은 형태 — Siri·위젯이 쓴다.
        if head == "today" { return .today(tripId: nil, focusActivityId: focus) }
        if head == "inbox" {
            let key = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first { $0.name == "share" }?.value
            return .inbox(shareKey: key)
        }
        if head == "join" {
            guard parts.count >= 2, CollabModel.isValidToken(parts[1]) else { return nil }
            return .join(token: parts[1])
        }

        guard head == "trip", parts.count >= 2 else { return nil }
        let tripId = parts[1]
        guard parts.count >= 3 else { return .trip(tripId: tripId) }
        switch parts[2] {
        case "today": return .today(tripId: tripId, focusActivityId: focus)
        case "replan": return .replan(tripId: tripId)
        case "bookings": return .bookings(tripId: tripId)
        case "memory", "memories": return .memory(tripId: tripId)
        case "suggestion":
            guard parts.count >= 4 else { return nil }
            return .suggestion(tripId: tripId, suggestionId: parts[3].removingPercentEncoding ?? parts[3])
        default: return nil
        }
    }

    /// 링크를 만드는 쪽도 한 곳에서 — 문자열을 손으로 조립하면 반드시 어긋난다.
    static func link(_ destination: Destination) -> URL? {
        switch destination {
        case .today(let tripId, let focus):
            let base = tripId.map { "tripcanvas://trip/\($0)/today" } ?? "tripcanvas://today"
            return URL(string: focus.map { "\(base)?focus=\($0)" } ?? base)
        case .trip(let id): return URL(string: "tripcanvas://trip/\(id)")
        case .replan(let id): return URL(string: "tripcanvas://trip/\(id)/replan")
        case .bookings(let id): return URL(string: "tripcanvas://trip/\(id)/bookings")
        case .memory(let id): return URL(string: "tripcanvas://trip/\(id)/memory")
        case .suggestion(let id, let suggestionId):
            let encoded = suggestionId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? suggestionId
            return URL(string: "tripcanvas://trip/\(id)/suggestion/\(encoded)")
        case .inbox(let key):
            return URL(string: key.map { "tripcanvas://inbox?share=\($0)" } ?? "tripcanvas://inbox")
        case .join(let token):
            return URL(string: "tripcanvas://join/\(token)")
        }
    }
}
