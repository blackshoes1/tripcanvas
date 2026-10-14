import XCTest
@testable import TripCanvas

private final class ReviewSearchProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var observed: [URLRequest] = []
    static var googleStatus = 200
    static var googleName = "에펠탑"
    static func reset() { lock.lock(); defer { lock.unlock() }; observed = []; googleStatus = 200; googleName = "에펠탑" }
    static var requests: [URLRequest] { lock.lock(); defer { lock.unlock() }; return observed }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); Self.observed.append(request); Self.lock.unlock()
        let url = request.url!
        let body: [String: Any]
        if url.host == "places.googleapis.com" {
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Ios-Bundle-Identifier"), "com.fromj.trip")
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
            body = ["places": [["id": "review-google", "displayName": ["text": Self.googleName],
                                  "formattedAddress": "Paris", "location": ["latitude": 48.858, "longitude": 2.294],
                                  "types": ["tourist_attraction"]]]]
        } else {
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "q" }?.value
            body = ["provider": "kakao", "places": [["name": query?.hasPrefix("경복궁") == true ? "경복궁" : "다른 카페", "address": "서울",
                "city": "서울", "lat": 37.5, "lng": 127.0, "provider": "kakao", "providerId": "1"]]]
        }
        let data = try! JSONSerialization.data(withJSONObject: body)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: url.host == "places.googleapis.com" ? Self.googleStatus : 200, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor private struct ReviewSearchTokens: TokenProviding {
    func accessToken() async throws -> String { "synthetic" }
    func refreshToken() async throws -> String { "synthetic" }
}

@MainActor final class PlaceSearchTransportTests: XCTestCase {
    private func check(_ run: (PlaceSearchService) async throws -> Void) async throws {
        ReviewSearchProtocol.reset()
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [ReviewSearchProtocol.self]
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel() }
        let api = APIClient(baseURL: URL(string: "https://review.invalid")!, tokens: ReviewSearchTokens(), session: session)
        try await run(PlaceSearchService(api: api, googleKey: "synthetic-key", bundleId: "com.fromj.trip", session: session))
    }
    func testExplicitForeignHangulSearchNeverCallsDomesticAPI() async throws {
        try await check { service in
            let hits = try await service.search("에펠탑", near: nil, region: .international)
            XCTAssertEqual(hits.map(\.name), ["에펠탑"])
            XCTAssertEqual(ReviewSearchProtocol.requests.map { $0.url?.host }, ["places.googleapis.com"])
        }
    }
    func testAutomaticSearchWithoutAnchorFallsBackOnlyWhenDomesticNameDoesNotMatch() async throws {
        try await check { service in
            let hits = try await service.search("에펠탑", near: nil)
            XCTAssertEqual(hits.first?.placeId, "review-google")
            XCTAssertEqual(ReviewSearchProtocol.requests.count, 2)
        }
        try await check { service in
            let hits = try await service.search("경복궁", near: nil)
            XCTAssertEqual(hits.first?.provider, "kakao")
            XCTAssertEqual(ReviewSearchProtocol.requests.count, 1)
        }
    }
    func testExplicitDomesticSearchDoesNotSpendAnExtraGoogleRequest() async throws {
        try await check { service in
            _ = try await service.search("에펠탑", near: nil, region: .korea)
            XCTAssertEqual(ReviewSearchProtocol.requests.count, 1)
            XCTAssertEqual(ReviewSearchProtocol.requests.first?.url?.host, "review.invalid")
        }
    }

    func testSupplementalForeignFailureKeepsValidDomesticResults() async throws {
        try await check { service in
            ReviewSearchProtocol.googleStatus = 403
            let hits = try await service.search("경복궁 서울", near: nil)
            XCTAssertEqual(hits.first?.provider, "kakao")
            XCTAssertEqual(hits.first?.name, "경복궁")
        }
    }

    func testUnrelatedForeignResultDoesNotReplaceDomesticResults() async throws {
        try await check { service in
            ReviewSearchProtocol.googleName = "무관한 장소"
            let hits = try await service.search("경복궁 서울", near: nil)
            XCTAssertEqual(hits.first?.provider, "kakao")
        }
    }
}
