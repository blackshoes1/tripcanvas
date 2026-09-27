import XCTest
@testable import TripCanvas

@MainActor private final class BoundaryTokens: TokenProviding {
    var token = "a"
    var refreshes = 0
    func accessToken() async throws -> String { token }
    func refreshToken() async throws -> String { refreshes += 1; return token }
}
private final class OfflineProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)) }
    override func stopLoading() {}
}
private final class DocumentPrefetchProtocol: URLProtocol {
    @MainActor static var respond: ((URLRequest) -> Data?)?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Task { @MainActor in
            guard let data = Self.respond?(request) else {
                client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)); return
            }
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() {}
}
private final class DelayedBoundaryProtocol: URLProtocol {
    @MainActor static var received: ((DelayedBoundaryProtocol) -> Void)?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Task { @MainActor in Self.received?(self) } }
    override func stopLoading() {}
    func finish(status: Int) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data((status == 200 ? "{\"ok\":true}" : "{\"error\":\"UNAUTHORIZED\"}").utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}
@MainActor
final class ServiceBoundaryTests: XCTestCase {
    func testOldAccountResponseDoesNotReturnDataOrRetryWithNewToken() async {
        for status in [200, 401] {
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [DelayedBoundaryProtocol.self]
            let session = URLSession(configuration: config)
            defer { session.invalidateAndCancel(); DelayedBoundaryProtocol.received = nil }
            let tokens = BoundaryTokens()
            let api = APIClient(baseURL: URL(string: "https://example.invalid")!, tokens: tokens, session: session)
            let received = expectation(description: "old account request started")
            var pending: DelayedBoundaryProtocol?
            var requests = 0
            DelayedBoundaryProtocol.received = { request in pending = request; requests += 1; received.fulfill() }
            let work = Task {
                do {
                    struct Ack: Decodable { let ok: Bool }
                    let _: Ack = try await api.post("/edit")
                    XCTFail("이전 계정의 응답을 새 화면에 돌려주면 안 된다")
                } catch { }
            }
            await fulfillment(of: [received], timeout: 3)
            tokens.token = "b"
            pending?.finish(status: status)
            await work.value
            XCTAssertEqual(requests, 1)
            XCTAssertEqual(tokens.refreshes, 0)
        }
    }

    func testOpeningDocumentAlsoPreservesServerBookingSummaryForOfflineRead() async throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "travel-state", withExtension: "json"))
        let travel = try JSONDecoder().decode(TravelStateResponse.self, from: Data(contentsOf: url))
        let document = TripDetailResponse(trip: travel.today.trip, document: [:])
        let summary = BookingSummary(id: "book", type: .hotel, title: "Booked hotel", provider: "", url: nil,
            price: 120, currency: "USD", start: nil, end: nil, refundable: nil, freeCancelUntil: nil,
            confirmation: "CONFIRM-123", place: "Room 1", startTime: nil, endTime: nil, priceStatus: nil)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = TripCache(directory: directory)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [DocumentPrefetchProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel(); DocumentPrefetchProtocol.respond = nil }
        let api = APIClient(baseURL: URL(string: "https://example.invalid")!, tokens: BoundaryTokens(), session: session)
        let service = TripService(api: api, cache: cache)
        let prefetched = expectation(description: "bookings prefetched without opening reservations")
        DocumentPrefetchProtocol.respond = { request in
            if request.url?.path.hasSuffix("/bookings") == true {
                prefetched.fulfill()
                return try? JSONEncoder().encode(BookingListResponse(schemaVersion: 1, bookings: [summary]))
            }
            return try? JSONEncoder().encode(document)
        }
        _ = try await service.document(tripId: travel.today.trip.id)
        await fulfillment(of: [prefetched], timeout: 3)
        var cached: CachedPayload<[BookingSummary]>?
        for _ in 0..<100 {
            cached = await cache.load([BookingSummary].self, key: TripCache.bookingsKey(tripId: travel.today.trip.id))
            if cached != nil { break }
            await Task.yield()
        }
        XCTAssertEqual(cached?.value.first?.confirmation, "CONFIRM-123")
        DocumentPrefetchProtocol.respond = { _ in nil }
        let offline = try await service.bookings(tripId: travel.today.trip.id)
        XCTAssertNotNil(offline.cachedAt)
        XCTAssertEqual(offline.value.first?.confirmation, "CONFIRM-123")
    }

    func testServiceReturnsOfflineDocumentAndTravelTimestamp() async throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "travel-state", withExtension: "json"))
        let travel = try JSONDecoder().decode(TravelStateResponse.self, from: Data(contentsOf: url))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = TripCache(directory: directory)
        let savedAt = Date(timeIntervalSince1970: 1_800_000_000)
        let tripID = travel.today.trip.id
        let response = TripDetailResponse(trip: travel.today.trip, document: ["days": .array([.object(["spots": .array([.object(TripSpot(name: "cached place").raw)])])])])
        await cache.save(response, key: TripCache.documentKey(tripId: tripID), savedAt: savedAt)
        await cache.save(travel, key: "travel-state-\(tripID)", savedAt: savedAt)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [OfflineProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let api = APIClient(baseURL: URL(string: "https://example.invalid")!, tokens: BoundaryTokens(), session: session)
        let service = TripService(api: api, cache: cache)
        let document = try await service.document(tripId: tripID)
        XCTAssertEqual(document.cachedAt, savedAt)
        XCTAssertFalse(document.canEdit)
        XCTAssertEqual(document.document.days[0].spots[0].name, "cached place")
        let cached = try await service.travelState(tripId: tripID, location: nil, locationUpdatedAt: nil, travelMode: true, suppressUntil: nil, markSent: true)
        XCTAssertEqual(cached.cachedAt, savedAt)
    }
}
