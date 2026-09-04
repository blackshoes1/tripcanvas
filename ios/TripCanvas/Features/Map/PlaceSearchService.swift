import Foundation

/// 장소 검색 — 국내는 서버 프록시(카카오), 해외는 구글에 직접.
///
/// 라우팅은 웹과 같은 규칙(`MapRegion.isKoreanSearch`)이다. 국내 검색이 서버를 지나는 이유는
/// 카카오 REST 키를 앱에 넣을 수 없어서고, 해외가 직접인 이유는 구글 iOS 키가 번들 ID로
/// 제한돼 앱 밖에서는 쓸모없기 때문이다(`X-Ios-Bundle-Identifier`를 붙여야 통과한다).
@MainActor
protocol PlaceSearching {
    func search(_ query: String, near: GeoPoint?) async throws -> [PlaceHit]
}

@MainActor
final class PlaceSearchService: PlaceSearching {
    private let api: APIClient
    private let googleKey: String
    private let bundleId: String
    private let session: URLSession

    init(api: APIClient, googleKey: String, bundleId: String, session: URLSession = .shared) {
        self.api = api
        self.googleKey = googleKey
        self.bundleId = bundleId
        self.session = session
    }

    func search(_ query: String, near: GeoPoint?) async throws -> [PlaceHit] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        if MapRegion.isKoreanSearch(trimmed, near: near) {
            return try await searchKorea(trimmed, near: near)
        }
        return try await searchGoogle(trimmed, near: near)
    }

    private func searchKorea(_ query: String, near: GeoPoint?) async throws -> [PlaceHit] {
        var items = [URLQueryItem(name: "q", value: query), URLQueryItem(name: "limit", value: "10")]
        if let near {
            items.append(URLQueryItem(name: "lat", value: String(near.lat)))
            items.append(URLQueryItem(name: "lng", value: String(near.lng)))
        }
        let response: PlaceSearchResponse = try await api.get("/api/v1/places/search", query: items)
        return response.hits
    }

    private func searchGoogle(_ query: String, near: GeoPoint?) async throws -> [PlaceHit] {
        // 키가 없으면 빈 결과가 아니라 '연결 안 됨'이다 — 가짜로 "없다"고 말하지 않는다.
        guard !googleKey.isEmpty else { throw APIError.server(status: 0, message: "해외 장소 검색이 연결되어 있지 않아요.") }

        var request = URLRequest(url: GooglePlaces.endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(googleKey, forHTTPHeaderField: "X-Goog-Api-Key")
        request.setValue(GooglePlaces.fieldMask, forHTTPHeaderField: "X-Goog-FieldMask")
        request.setValue(bundleId, forHTTPHeaderField: "X-Ios-Bundle-Identifier")
        let language = Locale.current.language.languageCode?.identifier ?? "ko"
        request.httpBody = try JSONSerialization.data(
            withJSONObject: GooglePlaces.requestBody(query: query, near: near, limit: 10, languageCode: language))

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where [.notConnectedToInternet, .networkConnectionLost, .timedOut].contains(error.code) {
            throw APIError.offline
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.server(status: 0, message: "알 수 없는 응답입니다.") }
        guard (200..<300).contains(http.statusCode) else {
            // 상세는 콘솔에만 — 키·할당량 문구를 화면에 그대로 내지 않는다(웹의 classifySearchErr와 같은 태도).
            print("[TripCanvas] google places \(http.statusCode): \(String(data: data, encoding: .utf8) ?? "")")
            let message = http.statusCode == 403 || http.statusCode == 401
                ? "해외 장소 검색 인증에 실패했어요. 앱 키 제한을 확인해 주세요."
                : "해외 장소 검색이 지금 응답하지 않아요."
            throw APIError.server(status: http.statusCode, message: message)
        }
        let decoded = try JSONDecoder().decode(GooglePlaces.Response.self, from: data)
        return GooglePlaces.hits(from: decoded)
    }
}
