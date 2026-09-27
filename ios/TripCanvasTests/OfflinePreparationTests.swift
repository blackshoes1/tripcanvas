import XCTest
@testable import TripCanvas

@MainActor private final class OfflinePrepTokens: TokenProviding {
    func accessToken() async throws -> String { "test" }
    func refreshToken() async throws -> String { "test" }
}
private final class OfflinePrepProtocol: URLProtocol {
    @MainActor static var respond: ((URLRequest) throws -> Data)?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Task { @MainActor in
            do {
                guard let respond = Self.respond else { throw URLError(.notConnectedToInternet) }
                let data = try respond(request)
                client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
            } catch { client?.urlProtocol(self, didFailWithError: error) }
        }
    }
    override func stopLoading() {}
}

@MainActor final class OfflinePreparationTests: XCTestCase {
    func testWholeTripPreparationFailureRecoveryAndOfflineRead() async throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "day-plan", withExtension: "json"))
        let data = try Data(contentsOf: url)
        let plan = try JSONDecoder().decode(DayPlanResponse.self, from: data)
        let doc: [String: JSONValue] = ["days": .array([.object([:]), .object([:])]), "notes": .array([.object(["id": .string("n1"), "body": .string("오프라인 메모")])])]
        let detail = TripDetailResponse(trip: plan.trip, document: doc)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = TripCache(directory: directory)
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [OfflinePrepProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel(); OfflinePrepProtocol.respond = nil }
        let service = TripService(api: APIClient(baseURL: URL(string: "https://example.invalid")!, tokens: OfflinePrepTokens(), session: session), cache: cache)
        var fail = true
        OfflinePrepProtocol.respond = { request in
            let path = request.url!.path
            if path.hasSuffix("/days/1"), fail { throw URLError(.notConnectedToInternet) }
            if path.contains("/days/") {
                var raw = try JSONSerialization.jsonObject(with: data) as! [String: Any]
                var day = raw["day"] as! [String: Any]
                day["index"] = path.hasSuffix("/1") ? 1 : 0; raw["day"] = day
                return try JSONSerialization.data(withJSONObject: raw)
            }
            if path.hasSuffix("/bookings") { return try JSONEncoder().encode(BookingListResponse(schemaVersion: 1, bookings: [])) }
            return try JSONEncoder().encode(detail)
        }
        do { _ = try await service.prepareOffline(tripId: plan.trip.id) { _, _ in }; XCTFail("부분 다운로드는 실패해야 해요") } catch { }
        let incomplete = await service.offlineTrip(plan.trip.id)
        XCTAssertNil(incomplete)
        fail = false
        let pack = try await service.prepareOffline(tripId: plan.trip.id) { _, _ in }
        XCTAssertTrue(pack.isComplete)
        // 파일 하나만 남아도 전 일자·예약·메모를 읽을 수 있다.
        for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) where !file.lastPathComponent.hasPrefix("offline-trip-") {
            try FileManager.default.removeItem(at: file)
        }
        OfflinePrepProtocol.respond = nil
        let offline = try await service.document(tripId: plan.trip.id)
        XCTAssertFalse(offline.canEdit)
        XCTAssertEqual(TripNote.notes(in: offline.document).first?.body, "오프라인 메모")
        let dayTwo = try await service.dayPlan(tripId: plan.trip.id, dayIndex: 1)
        XCTAssertTrue(dayTwo.isStale)
        XCTAssertEqual(dayTwo.value.day.index, 1)
        let bookings = try await service.bookings(tripId: plan.trip.id)
        XCTAssertTrue(bookings.isStale)
    }

    func testCacheReportsDiskFailureInsteadOfReadiness() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data().write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let cache = TripCache(directory: file)
        let saved = await cache.save("not saved", key: "test")
        XCTAssertFalse(saved)
    }
}
