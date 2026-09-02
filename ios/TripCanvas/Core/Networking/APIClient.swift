import Foundation

/// 서버가 돌려준 오류를 화면이 그대로 말할 수 있는 형태로 옮긴다.
/// 사용자에게 보여줄 문장은 서버가 준 `message`를 우선한다 — 클라이언트가 다시 쓰면 톤이 갈라진다.
enum APIError: Error, LocalizedError, Equatable {
    case unauthorized
    case notFound(String)
    /// 다른 기기가 먼저 바꿨다. 최신을 받아 다시 시도하면 된다.
    case revisionConflict(message: String, revision: Int?)
    /// 상황이 바뀌어 그 제안이 더는 유효하지 않다.
    case stale(String)
    /// 이 여행을 바꿀 권한이 없다(보기 권한·내보내짐). 재시도해도 같다 — 주최자에게 요청한다.
    case forbidden(String)
    case badRequest(String)
    case server(status: Int, message: String)
    /// 네트워크 자체가 안 된다 — 캐시로 떨어질 신호다.
    case offline

    var errorDescription: String? {
        switch self {
        case .unauthorized: "로그인이 필요합니다."
        case .notFound(let m), .stale(let m), .badRequest(let m), .forbidden(let m): m
        case .revisionConflict(let m, _): m
        case .server(_, let m): m
        case .offline: "네트워크에 연결되어 있지 않아요."
        }
    }

    var isOffline: Bool { self == .offline }
}

/// 토큰이 만료됐을 때 한 번 갱신해 재시도할 수 있게 하는 최소 계약.
@MainActor
protocol TokenProviding {
    func accessToken() async throws -> String
    func refreshToken() async throws -> String
}

/// URLSession + Bearer. 외부 네트워킹 라이브러리를 넣지 않는다(§4).
// @MainActor 격리된 토큰 공급자를 들고 있어 Sendable로 두지 않는다 — 화면 계층에서만 쓴다.
struct APIClient {
    let baseURL: URL
    let session: URLSession
    let tokens: TokenProviding

    init(baseURL: URL, tokens: TokenProviding, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.tokens = tokens
        self.session = session
    }

    private static let decoder: JSONDecoder = JSONDecoder()

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        try await send(path: path, method: "GET", query: query, body: nil)
    }

    func post<T: Decodable>(_ path: String, query: [URLQueryItem] = [], body: [String: Any]? = nil) async throws -> T {
        let data = try body.map { try JSONSerialization.data(withJSONObject: $0) }
        return try await send(path: path, method: "POST", query: query, body: data)
    }

    func put<T: Decodable>(_ path: String, query: [URLQueryItem] = [], body: [String: Any]? = nil) async throws -> T {
        let data = try body.map { try JSONSerialization.data(withJSONObject: $0) }
        return try await send(path: path, method: "PUT", query: query, body: data)
    }

    func delete<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        try await send(path: path, method: "DELETE", query: query, body: nil)
    }

    /// 401이면 토큰을 한 번 갱신해 재시도한다. 그래도 401이면 로그인 화면으로 돌려보낸다.
    private func send<T: Decodable>(path: String, method: String, query: [URLQueryItem], body: Data?) async throws -> T {
        do {
            return try await attempt(path: path, method: method, query: query, body: body, token: try await tokens.accessToken())
        } catch APIError.unauthorized {
            let refreshed = try await tokens.refreshToken()
            return try await attempt(path: path, method: method, query: query, body: body, token: refreshed)
        }
    }

    private func attempt<T: Decodable>(path: String, method: String, query: [URLQueryItem], body: Data?, token: String) async throws -> T {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)
        if !query.isEmpty { components?.queryItems = query }
        guard let url = components?.url else { throw APIError.badRequest("요청 주소를 만들 수 없습니다.") }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        request.timeoutInterval = 15

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where Self.offlineCodes.contains(error.code) {
            throw APIError.offline
        }

        guard let http = response as? HTTPURLResponse else { throw APIError.server(status: 0, message: "알 수 없는 응답입니다.") }
        guard (200..<300).contains(http.statusCode) else { throw Self.mapError(status: http.statusCode, data: data) }

        do {
            return try Self.decoder.decode(T.self, from: data)
        } catch {
            // 계약이 어긋났다는 뜻이다. 사용자에게는 일반 문장을, 콘솔에는 원인을.
            print("[TripCanvas] decode failed for \(path): \(error)")
            throw APIError.server(status: http.statusCode, message: "응답을 읽지 못했어요. 앱을 업데이트하면 해결될 수 있어요.")
        }
    }

    private static let offlineCodes: Set<URLError.Code> = [
        .notConnectedToInternet, .networkConnectionLost, .cannotConnectToHost, .timedOut, .dataNotAllowed
    ]

    private static func mapError(status: Int, data: Data) -> APIError {
        let body = try? decoder.decode(APIErrorBody.self, from: data)
        let message = body?.message ?? "요청을 처리하지 못했어요."
        switch body?.error {
        case "UNAUTHORIZED": return .unauthorized
        case "TRIP_NOT_FOUND", "ACTIVITY_NOT_FOUND": return .notFound(message)
        case "REVISION_CONFLICT": return .revisionConflict(message: message, revision: body?.revision)
        case "SUGGESTION_STALE": return .stale(message)
        case "FORBIDDEN": return .forbidden(message)
        case "BAD_REQUEST": return .badRequest(message)
        default:
            if status == 401 { return .unauthorized }
            return .server(status: status, message: message)
        }
    }
}
