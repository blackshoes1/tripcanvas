import XCTest
@testable import TripCanvas

@MainActor private final class CacheFollowupTokens: TokenProviding {
    func accessToken() async throws -> String { "cache-test" }
    func refreshToken() async throws -> String { "cache-test" }
}

private final class CacheFollowupProtocol: URLProtocol {
    @MainActor static var handle: ((CacheFollowupProtocol) -> Void)?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Task { @MainActor in
            if let handle = Self.handle { handle(self) }
            else { fail() }
        }
    }
    override func stopLoading() {}
    func finish<T: Encodable>(_ value: T, status: Int = 200) throws {
        let data = try JSONEncoder().encode(value)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status,
            httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    func fail() { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)) }

    func body() throws -> [String: JSONValue] {
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
        return try JSONDecoder().decode([String: JSONValue].self, from: data)
    }
}

@MainActor final class AccountCacheFollowupTests: XCTestCase {
    private func summary(_ revision: Int = 1) -> TripSummary {
        .init(id: "cache-trip", name: "여행", start: "2026-10-15", dayCount: 2, revision: revision,
              updatedAt: "", timeZone: "", cities: [], todayIndex: -1, daysUntilStart: nil,
              role: .owner, memberCount: 1)
    }
    private func detail(_ revision: Int, name: String = "처음") -> TripDetailResponse {
        .init(trip: summary(revision), document: ["name": .string(name),
            "days": .array([.object(["spots": .array([])]), .object(["spots": .array([])])])])
    }
    private func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CacheFollowupProtocol.self]
        return URLSession(configuration: configuration)
    }
    private func service(_ cache: TripCache, _ session: URLSession) -> TripService {
        TripService(api: APIClient(baseURL: URL(string: "https://example.invalid")!,
                                  tokens: CacheFollowupTokens(), session: session), cache: cache)
    }
    private func fixture<T: Decodable>(_ type: T.Type, name: String, revision: Int, day: Int? = nil) throws -> T {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"))
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        object["trip"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(summary(revision)))
        if let day {
            var value = try XCTUnwrap(object["day"] as? [String: Any])
            value["index"] = day; object["day"] = value
        }
        return try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: object))
    }

    func testLateDocumentGETCannotReplaceSavedRevisionOnDiskOrAfterRestart() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = TripCache(directory: directory), transport = session(), source = service(cache, transport)
        defer { transport.invalidateAndCancel(); CacheFollowupProtocol.handle = nil }
        let started = expectation(description: "old document GET started")
        var delayed: CacheFollowupProtocol?
        CacheFollowupProtocol.handle = { request in
            if request.request.url?.path.hasSuffix("/bookings") == true { request.fail() }
            else if request.request.httpMethod == "PUT" { try? request.finish(self.detail(2, name: "저장된 변경")) }
            else { delayed = request; started.fulfill() }
        }
        let oldRead = Task { try await source.document(tripId: "cache-trip") }
        await fulfillment(of: [started], timeout: 3)
        _ = try await source.saveDocument(tripId: "cache-trip", document: TripDocument(raw: detail(2).document), expectedRevision: 1)
        try delayed?.finish(detail(1))
        _ = try await oldRead.value
        CacheFollowupProtocol.handle = nil
        let offline = try await source.document(tripId: "cache-trip")
        XCTAssertEqual(offline.revision, 2)
        XCTAssertEqual(offline.document.name, "저장된 변경")
        let restarted = service(TripCache(directory: directory), transport)
        let restored = try await restarted.document(tripId: "cache-trip")
        XCTAssertEqual(restored.revision, 2)
        XCTAssertEqual(restored.document.name, "저장된 변경")
    }

    func testLateTodayAndDayPlanResponsesDoNotRegressCachedRevision() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = TripCache(directory: directory), transport = session(), source = service(cache, transport)
        defer { transport.invalidateAndCancel(); CacheFollowupProtocol.handle = nil }
        let day1 = try fixture(DayPlanResponse.self, name: "day-plan", revision: 1, day: 0)
        let day2 = try fixture(DayPlanResponse.self, name: "day-plan", revision: 2, day: 0)
        let today1 = try fixture(TodayResponse.self, name: "today", revision: 1)
        let today2 = try fixture(TodayResponse.self, name: "today", revision: 2)
        for isToday in [false, true] {
            let started = expectation(description: "old calculated response started")
            var delayed: CacheFollowupProtocol?, reads = 0
            CacheFollowupProtocol.handle = { request in
                reads += 1
                if reads == 1 { delayed = request; started.fulfill() }
                else if isToday { try? request.finish(today2) }
                else { try? request.finish(day2) }
            }
            if isToday {
                let read = Task { try await source.today(tripId: "cache-trip") }
                await fulfillment(of: [started], timeout: 3)
                _ = try await source.today(tripId: "cache-trip")
                try delayed?.finish(today1); _ = try await read.value
            } else {
                let read = Task { try await source.dayPlan(tripId: "cache-trip", dayIndex: 0) }
                await fulfillment(of: [started], timeout: 3)
                _ = try await source.dayPlan(tripId: "cache-trip", dayIndex: 0)
                try delayed?.finish(day1); _ = try await read.value
            }
        }
        CacheFollowupProtocol.handle = nil
        let offlineToday = try await source.today(tripId: "cache-trip")
        let offlineDay = try await source.dayPlan(tripId: "cache-trip", dayIndex: 0)
        XCTAssertEqual(offlineToday.value.trip.revision, 2)
        XCTAssertEqual(offlineDay.value.trip.revision, 2)
    }

    func testSuccessfulDeleteAndLeaveRemoveOfflineCopiesAndRejectLateGETs() async throws {
        for leaves in [false, true] {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: directory) }
            let cache = TripCache(directory: directory), transport = session(), source = service(cache, transport)
            defer { transport.invalidateAndCancel(); CacheFollowupProtocol.handle = nil }
            let current = detail(2)
            let plans = try (0..<2).map { try fixture(DayPlanResponse.self, name: "day-plan", revision: 2, day: $0) }
            let pack = OfflineTrip(detail: current, plans: plans, bookings: [], savedAt: Date())
            XCTAssertTrue(pack.isComplete)
            await cache.save([current.trip], key: TripCache.tripsKey)
            await cache.save(current, key: TripCache.documentKey(tripId: "cache-trip"))
            await cache.save([BookingSummary](), key: TripCache.bookingsKey(tripId: "cache-trip"))
            await cache.save(pack, key: OfflineTrip.key("cache-trip"))
            let started = expectation(description: "GETs started before removal"); started.expectedFulfillmentCount = 2
            var documentGET: CacheFollowupProtocol?, listGET: CacheFollowupProtocol?
            CacheFollowupProtocol.handle = { request in
                if request.request.httpMethod != "GET" { try? request.finish(OkResponse(ok: true)) }
                else if request.request.url?.path == "/api/v1/trips" { listGET = request; started.fulfill() }
                else { documentGET = request; started.fulfill() }
            }
            let readDocument = Task { () -> Bool in
                do { _ = try await source.document(tripId: "cache-trip"); return true } catch { return false }
            }
            let readList = Task { try await source.trips() }
            await fulfillment(of: [started], timeout: 3)
            if leaves { try await source.leaveTrip(tripId: "cache-trip") }
            else { try await source.deleteTrip(tripId: "cache-trip", expectedRevision: 2) }
            try documentGET?.finish(current)
            try listGET?.finish(TripListResponse(schemaVersion: 1, trips: [current.trip]))
            let returnedDocument = await readDocument.value, returnedList = try await readList.value
            XCTAssertFalse(returnedDocument)
            XCTAssertTrue(returnedList.value.isEmpty)
            CacheFollowupProtocol.handle = nil
            let restarted = service(TripCache(directory: directory), transport)
            let offlineList = try await restarted.trips()
            XCTAssertTrue(offlineList.value.isEmpty)
            let stalePack = await restarted.offlineTrip("cache-trip")
            XCTAssertNil(stalePack)
            do { _ = try await restarted.document(tripId: "cache-trip"); XCTFail("removed document must stay unavailable") }
            catch { XCTAssertNotNil(error as? APIError) }
            do { _ = try await restarted.bookings(tripId: "cache-trip"); XCTFail("removed reservations must stay unavailable") }
            catch { XCTAssertNotNil(error as? APIError) }
        }
    }

    func testFailedRemovalRetainsOfflineCopyAndNewInvitationRestoresAccess() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = TripCache(directory: directory), transport = session(), source = service(cache, transport)
        defer { transport.invalidateAndCancel(); CacheFollowupProtocol.handle = nil }
        await cache.save(detail(1), key: TripCache.documentKey(tripId: "cache-trip"))
        CacheFollowupProtocol.handle = { $0.fail() }
        do { try await source.deleteTrip(tripId: "cache-trip", expectedRevision: 1); XCTFail("offline deletion cannot be confirmed") } catch { }
        let retained = try await source.document(tripId: "cache-trip")
        XCTAssertEqual(retained.revision, 1)
        let generation = await cache.tripGeneration("cache-trip", scope: nil)
        let oldGeneration = try XCTUnwrap(generation)
        await cache.removeTrip("cache-trip", scope: nil)
        CacheFollowupProtocol.handle = { request in
            if request.request.url?.path.hasSuffix("/accept") == true {
                try? request.finish(InviteAcceptResponse(result: .init(ok: true, reason: "OK", clientId: "cache-trip",
                    tripName: "여행", role: .editor, alreadyMember: false)))
            } else if request.request.url?.path.hasSuffix("/bookings") == true { request.fail() }
            else { try? request.finish(self.detail(2)) }
        }
        _ = try await source.acceptInvite(token: "abcdefghijklmnop", displayName: nil)
        let acceptsOld = await cache.acceptsTrip("cache-trip", generation: oldGeneration, scope: nil)
        XCTAssertFalse(acceptsOld)
        let reopened = try await source.document(tripId: "cache-trip")
        XCTAssertEqual(reopened.revision, 2)
    }

    func testSharedImportUsesConfirmedInputDuringDelayedReadAndSave() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let transport = session(), source = service(TripCache(directory: directory), transport)
        defer { transport.invalidateAndCancel(); CacheFollowupProtocol.handle = nil }
        let input = SharedTravelInput(id: "shared-key", sourceType: .text, url: nil, text: "원문", title: nil)
        let model = SharedImportModel(input: input, service: source)
        CacheFollowupProtocol.handle = { request in
            if request.request.url?.path.hasSuffix("/bookings") == true { request.fail() }
            else { try? request.finish(self.detail(1)) }
        }
        await model.selectTrip("cache-trip")
        let readStarted = expectation(description: "latest document read"), putStarted = expectation(description: "confirmed import PUT")
        var read: CacheFollowupProtocol?, put: CacheFollowupProtocol?, savedDocument: [String: JSONValue]?
        CacheFollowupProtocol.handle = { request in
            if request.request.httpMethod == "PUT" {
                savedDocument = try? request.body()["trip"]?.objectValue
                put = request; putStarted.fulfill()
            } else if request.request.url?.path.hasSuffix("/bookings") == true { request.fail() }
            else { read = request; readStarted.fulfill() }
        }
        var edited = SharedTextInputDraft(kind: .place, title: "확인한 장소", body: "확인한 본문", day: 1)
        let confirmed = edited
        let save = Task { await model.saveText(confirmed) }
        await fulfillment(of: [readStarted], timeout: 3)
        XCTAssertTrue(model.isWorking)
        edited = .init(kind: .note, title: "대기 중 바꾼 제목", body: "다른 본문", day: 0)
        try read?.finish(detail(1))
        await fulfillment(of: [putStarted], timeout: 3)
        let sent = TripDocument(raw: try XCTUnwrap(savedDocument))
        XCTAssertTrue(sent.days[0].spots.isEmpty)
        XCTAssertEqual(sent.days[1].spots.first?.name, "확인한 장소")
        XCTAssertEqual(sent.days[1].spots.first?.desc, "확인한 본문")
        XCTAssertNil(sent.raw["notes"])
        edited = .init(kind: .note, title: "PUT 대기 중 변경", body: "새 입력", day: 0)
        try put?.finish(TripDetailResponse(trip: summary(2), document: sent.raw))
        let failure = await save.value
        XCTAssertNil(failure)
        XCTAssertTrue(model.saved)
        XCTAssertEqual(edited.title, "PUT 대기 중 변경")
    }
}
