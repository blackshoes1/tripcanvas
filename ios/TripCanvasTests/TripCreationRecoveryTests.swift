import XCTest
@testable import TripCanvas

@MainActor private final class CreationTokens: TokenProviding {
    func accessToken() async throws -> String { "test-token" }
    func refreshToken() async throws -> String { "test-token" }
}
private final class CreationProtocol: URLProtocol {
    @MainActor static var respond: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Task { @MainActor in
            do {
                guard let respond = Self.respond else { throw URLError(.notConnectedToInternet) }
                let (status, data) = try respond(request)
                client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
            } catch { client?.urlProtocol(self, didFailWithError: error) }
        }
    }
    override func stopLoading() {}

    static func body(_ request: URLRequest) throws -> [String: Any] {
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var bytes = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&bytes, maxLength: bytes.count)
                if count <= 0 { break }
                data.append(contentsOf: bytes.prefix(count))
            }
        }
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}

@MainActor final class TripCreationRecoveryTests: XCTestCase {
    func testResponseLossAndRetryRecoverOneServerTripAndRejectChangedInput() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [CreationProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel(); CreationProtocol.respond = nil }
        let service = TripService(api: APIClient(baseURL: URL(string: "https://example.invalid")!, tokens: CreationTokens(), session: session),
                                  cache: TripCache(directory: directory))
        var serverDocument: [String: JSONValue]?
        var createdCount = 0, postedIDs: [String] = []
        CreationProtocol.respond = { request in
            if request.httpMethod == "POST" {
                let raw = try XCTUnwrap(try CreationProtocol.body(request)["trip"] as? [String: Any])
                let document = try XCTUnwrap(JSONDecoder().decode(JSONValue.self, from: JSONSerialization.data(withJSONObject: raw)).objectValue)
                postedIDs.append(try XCTUnwrap(document["id"]?.stringValue))
                if serverDocument == nil {
                    serverDocument = document; createdCount += 1
                    throw URLError(.networkConnectionLost) // 서버에는 저장됐으나 응답만 사라진다.
                }
                return (409, Data(#"{"error":"CONFLICT","message":"already created"}"#.utf8))
            }
            let document = try XCTUnwrap(serverDocument)
            let summary = TripSummary(id: document["id"]!.stringValue!, name: document["name"]!.stringValue!, start: "2026-10-15",
                                      dayCount: 1, revision: 1, updatedAt: "", timeZone: nil, cities: [],
                                      todayIndex: -1, daysUntilStart: nil, role: .owner, memberCount: 1)
            return (200, try JSONEncoder().encode(TripDetailResponse(trip: summary, document: document)))
        }
        let request: [String: JSONValue] = ["id": .string("stable-trip-id"), "name": .string("여행"), "start": .string("2026-10-15"),
                                           "days": .array([.object(["spots": .array([])])])]
        do { _ = try await service.createTrip(document: request); XCTFail("첫 응답은 유실된다") } catch { }
        let recovered = try await service.createTrip(document: request)
        XCTAssertEqual(recovered.id, "stable-trip-id"); XCTAssertEqual(createdCount, 1)
        XCTAssertEqual(postedIDs, ["stable-trip-id", "stable-trip-id"])
        var changed = request; changed["name"] = .string("수정한 입력")
        do { _ = try await service.createTrip(document: changed); XCTFail("다른 입력을 이미 저장한 것으로 말하면 안 된다") }
        catch APIError.badRequest(let message) { XCTAssertTrue(message.contains("이전 내용")) }
        XCTAssertEqual(createdCount, 1)
    }

    func testScratchFormUsesTheSameCreationIDForRetries() {
        let form = NewTripFormState()
        form.name = "여행"
        let id = form.draft.creationID
        form.dayCount = 5
        XCTAssertEqual(form.draft.creationID, id)
        XCTAssertNotEqual(NewTripFormState().draft.creationID, id)
    }

    func testPasswordResetTransportReportsNetworkFailureAndHidesAccountPresence() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [CreationProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel(); CreationProtocol.respond = nil }
        let client = TripCanvasAuthClient(baseURL: URL(string: "https://example.invalid")!, session: session)
        CreationProtocol.respond = { _ in throw URLError(.notConnectedToInternet) }
        do { try await client.requestPasswordReset(email: "a@example.com"); XCTFail("연결 실패는 성공이 아니다") }
        catch { XCTAssertEqual(error as? AuthError, .network) }
        CreationProtocol.respond = { _ in (404, Data(#"{"message":"User not found"}"#.utf8)) }
        try await client.requestPasswordReset(email: "a@example.com")
        CreationProtocol.respond = { _ in (429, Data()) }
        do { try await client.requestPasswordReset(email: "a@example.com"); XCTFail("요청 제한은 재시도 안내가 필요하다") }
        catch let error as AuthError { XCTAssertEqual(error.code, .rateLimited) }
    }
}
