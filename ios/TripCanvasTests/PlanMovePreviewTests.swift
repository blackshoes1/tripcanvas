import XCTest
@testable import TripCanvas

@MainActor final class PlanMovePreviewTests: XCTestCase {
    private func documents() -> (original: TripDocument, canonical: TripDocument) {
        var moved = TripSpot(name: "11시 장소")
        moved.arriveAt = "11:00"; moved.bookedAt = "12:07"
        moved.setField("futureField", .object(["keep": .bool(true)]))
        moved.setField("who", .array([.string("companion")]))
        var early = TripSpot(name: "9시 장소"); early.arriveAt = "09:00"
        var late = TripSpot(name: "13시 장소"); late.arriveAt = "13:00"
        let original = TripDocument(raw: ["name": .string("이동 검토"), "futureRoot": .string("keep"), "days": .array([
            .object(["spots": .array([.object(moved.raw)])]),
            .object(["spots": .array([.object(early.raw), .object(late.raw)])])])])
        var canonical = original
        canonical.moveSpots(fromDay: 0, indexes: IndexSet(integer: 0), toDay: 1, position: 1)
        return (original, canonical)
    }
    private func model(_ source: MovePreviewSource, day: Int = 1) -> PlanMovePreviewModel {
        PlanMovePreviewModel(tripId: "move-trip", document: source.documentValue, revision: 7,
                             sourceDay: 0, indexes: IndexSet(integer: 0), initialDay: day, source: source)
    }

    func testAnEmptyEditedNameCannotOpenTheMoveReview() {
        for name in ["", "  \n"] {
            XCTAssertEqual(SpotEditorView.validationError(for: TripSpot(name: name), costText: ""), "장소 이름을 입력해 주세요.")
        }
    }

    func testCrossDayReviewUsesTheExactServerDocumentAndDoesNotSave() async throws {
        let docs = documents(), source = MovePreviewSource(documents())
        let model = model(source)
        XCTAssertNil(model.confirmedDocument)
        await model.refresh()
        XCTAssertNil(model.error)
        XCTAssertEqual(source.calls.map(\.sorted), [true, false])
        XCTAssertEqual(source.calls.map(\.day), [1, 0])
        XCTAssertEqual(model.inputDocument.days[1].spots.map(\.name), ["9시 장소", "13시 장소", "11시 장소"])
        XCTAssertEqual(model.confirmedDocument, docs.canonical)
        XCTAssertEqual(source.calls[1].document, docs.canonical, "출발일 비교도 검토한 원문을 쓴다")
        XCTAssertTrue(source.saves.isEmpty, "미리보기는 사용자가 확인하기 전 저장하지 않는다")
        let moved = try XCTUnwrap(model.confirmedDocument?.days[1].spots[1])
        XCTAssertEqual(moved.bookedAt, "12:07")
        XCTAssertEqual(moved.raw["futureField"], docs.original.days[0].spots[0].raw["futureField"])
        XCTAssertEqual(model.confirmedDocument?.raw["futureRoot"], .string("keep"))
    }

    func testArrivalEditImmediatelyInvalidatesReviewAndNeverChangesReservationTime() async {
        let source = MovePreviewSource(documents()), model = model(source)
        await model.refresh()
        XCTAssertNotNil(model.confirmedDocument)
        model.arrivalAt = "12:30"
        XCTAssertNil(model.confirmedDocument)
        XCTAssertTrue(model.previews.isEmpty)
        XCTAssertEqual(model.inputDocument.days[1].spots.last?.arriveAt, "12:30")
        XCTAssertEqual(model.inputDocument.days[1].spots.last?.bookedAt, "12:07")
        XCTAssertEqual(source.documentValue.days[0].spots[0].arriveAt, "11:00", "취소해도 원문·편집기 초안은 그대로다")
        model.day = 0
        XCTAssertNil(model.confirmedDocument)
    }

    func testMissingCanonicalDocumentFailureAndStaleResponseCannotBeConfirmed() async {
        for failure in ["missing", "offline", "stale"] {
            let source = MovePreviewSource(documents())
            source.omitCanonical = failure == "missing"
            source.failure = failure == "offline" ? .offline : nil
            source.responseRevision = failure == "stale" ? 8 : 7
            let model = model(source)
            await model.refresh()
            XCTAssertNil(model.confirmedDocument, failure)
            XCTAssertNotNil(model.error, failure)
            XCTAssertTrue(source.saves.isEmpty)
        }
    }

    func testLatePreviewCannotConfirmAChangedSelection() async {
        let source = MovePreviewSource(documents()); source.hold = true
        let model = model(source)
        let work = Task { await model.refresh() }
        for _ in 0..<500 where source.continuation == nil { await Task.yield() }
        XCTAssertNotNil(source.continuation)
        model.arrivalAt = "10:00"
        source.continuation?.resume(); source.continuation = nil
        await work.value
        XCTAssertNil(model.confirmedDocument)
        XCTAssertTrue(model.previews.isEmpty)
        XCTAssertTrue(source.saves.isEmpty)
    }

    func testSameDayManualPositionDoesNotAskTheServerToSort() async {
        let docs = documents()
        let source = MovePreviewSource((docs.canonical, docs.canonical))
        let model = PlanMovePreviewModel(tripId: "move-trip", document: docs.canonical, revision: 7,
            sourceDay: 1, indexes: IndexSet(integer: 2), source: source)
        model.position = 0
        await model.refresh()
        XCTAssertNil(model.error)
        XCTAssertEqual(source.calls.map(\.sorted), [false])
        XCTAssertEqual(model.confirmedDocument?.days[1].spots.map(\.name), ["13시 장소", "9시 장소", "11시 장소"])
    }

    func testUntimedCrossDayMoveKeepsTheChosenInsertionPosition() async {
        var original = documents().original
        var moved = original.days[0].spots[0]; moved.arriveAt = nil
        original.updateSpot(dayIndex: 0, at: 0, with: moved)
        var canonical = original
        canonical.moveSpots(fromDay: 0, indexes: IndexSet(integer: 0), toDay: 1, position: 1)
        let source = MovePreviewSource((original, canonical)), model = model(source)
        model.position = 1
        await model.refresh()
        XCTAssertEqual(source.calls.first?.document.days[1].spots.map(\.name), ["9시 장소", "11시 장소", "13시 장소"])
        XCTAssertEqual(model.confirmedDocument, canonical)
        XCTAssertEqual(source.calls.first?.sorted, true)
    }

    func testReviewedMoveSavesOneCASRevisionAndUndoRestoresRawDocument() async throws {
        let docs = documents(), preview = MovePreviewSource(documents())
        let review = model(preview); await review.refresh()
        let source = FakeDocumentService(snapshot: .init(document: docs.original, revision: 7, role: .owner))
        let plan = TripPlanViewModel(tripId: "move-trip", service: source, loadsPlans: false)
        await plan.load()
        let confirmed = try XCTUnwrap(review.confirmedDocument)
        let saved = await plan.savePreparedDocument(confirmed, expectedRevision: 7, message: "이동")
        XCTAssertTrue(saved)
        XCTAssertEqual(source.saves.first?.document, docs.canonical)
        XCTAssertEqual(source.saves.map(\.expectedRevision), [7])
        await plan.undoLastChange()
        XCTAssertEqual(plan.document, docs.original)
        XCTAssertEqual(source.saves.map(\.expectedRevision), [7, 8])
    }

    func testMoveHandoffRequiresTheExactRevisionIDAndName() async throws {
        let docs = documents(), source = FakeDocumentService(snapshot: .init(document: documents().original, revision: 7, role: .owner))
        let plan = TripPlanViewModel(tripId: "move-trip", service: source, loadsPlans: false)
        await plan.load()
        let activity = ActivitySummary(id: "d0s0", name: docs.original.days[0].spots[0].name, city: "", desc: "",
            status: .planned, flexibility: .flexible, type: .other, etaMinutes: 660, startMinutes: 660,
            endMinutes: 720, stayMinutes: 60, travelInMinutes: 0, fixedAtMinutes: 660, location: nil,
            mustVisit: false, optional: false, bookingId: nil, bookUrl: nil, placeId: nil)
        plan.requestMove(activity, day: 0, revision: 7)
        XCTAssertEqual(plan.takeFocusedSpot()?.intent, .move)
        plan.requestFocus(activity, day: 0, revision: 7)
        XCTAssertEqual(plan.takeFocusedSpot()?.intent, .edit)
        plan.requestMove(activity, day: 0, revision: 6)
        XCTAssertNil(plan.takeFocusedSpot())
        XCTAssertTrue(plan.errorMessage?.contains("다시 선택") == true)
        var wrongID = try JSONSerialization.jsonObject(with: JSONEncoder().encode(activity)) as! [String: Any]
        wrongID["id"] = "d0s99"
        let missing = try JSONDecoder().decode(ActivitySummary.self, from: JSONSerialization.data(withJSONObject: wrongID))
        plan.requestMove(missing, day: 0, revision: 7)
        XCTAssertNil(plan.takeFocusedSpot())
        var changed = source.snapshot.document
        var spot = changed.days[0].spots[0]; spot.name = "다른 장소"
        changed.updateSpot(dayIndex: 0, at: 0, with: spot)
        plan.acceptSaved(.init(document: changed, revision: 7, role: .owner))
        plan.requestMove(activity, day: 0, revision: 7)
        XCTAssertNil(plan.takeFocusedSpot())
        XCTAssertNil(plan.focusActivity)
        XCTAssertTrue(source.saves.isEmpty)
    }

    func testAtOnlyConflictIsIncludedWithoutInventingAReservationTime() throws {
        var raw = try MovePreviewSource.responseJSON(day: 0, revision: 7)
        var day = raw["day"] as! [String: Any], spots = day["spots"] as! [[String: Any]]
        spots[0]["conflict"] = true; spots[0]["bookedAtMinutes"] = NSNull()
        day["spots"] = spots; raw["day"] = day
        let response = try JSONDecoder().decode(DayPlanResponse.self, from: JSONSerialization.data(withJSONObject: raw))
        let line = PlanPreviewSection.spotLine(response.day.spots[0])
        XCTAssertTrue(line.contains("시간 확인 필요"))
        XCTAssertFalse(line.contains("예약"))
    }

    func testCanonicalPreviewDecodesUnknownFieldsAndLegacyResponseRemainsSupported() throws {
        let response = try MovePreviewSource.response(day: 0, revision: 7)
        let docs = documents()
        let encoded = try JSONEncoder().encode(PlanChangePreview(before: response, after: response, document: docs.canonical.raw))
        let decoded = try JSONDecoder().decode(PlanChangePreview.self, from: encoded)
        XCTAssertEqual(decoded.canonicalDocument, docs.canonical)
        let legacy = try JSONDecoder().decode(PlanChangePreview.self,
            from: JSONEncoder().encode(PlanChangePreview(before: response, after: response)))
        XCTAssertNil(legacy.canonicalDocument)
    }
}

@MainActor private final class MovePreviewSource: TripDocumentSource {
    let documentValue: TripDocument
    let canonical: TripDocument
    var omitCanonical = false
    var responseRevision = 7
    var failure: APIError?
    var hold = false
    var continuation: CheckedContinuation<Void, Never>?
    var calls: [(day: Int, sorted: Bool, document: TripDocument)] = []
    var saves: [TripDocument] = []
    init(_ documents: (original: TripDocument, canonical: TripDocument)) {
        documentValue = documents.original; canonical = documents.canonical
    }
    func document(tripId: String) async throws -> TripDocumentSnapshot { .init(document: documentValue, revision: 7, role: .owner) }
    func saveDocument(tripId: String, document: TripDocument, expectedRevision: Int) async throws -> TripDocumentSnapshot {
        saves.append(document); return .init(document: document, revision: expectedRevision + 1, role: .owner)
    }
    func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse> { throw APIError.offline }
    func cachedDayPlan(tripId: String, dayIndex: Int) async -> DayPlanResponse? { nil }
    func tripRoutes(tripId: String) async throws -> TripRoutesResponse { throw APIError.offline }
    func planPreview(tripId: String, document: TripDocument, dayIndex: Int, revision: Int, sortByTime: Bool) async throws -> PlanChangePreview {
        calls.append((dayIndex, sortByTime, document))
        if hold { hold = false; await withCheckedContinuation { continuation = $0 } }
        if let failure { throw failure }
        let response = try Self.response(day: dayIndex, revision: responseRevision)
        return .init(before: response, after: response, document: sortByTime && !omitCanonical ? canonical.raw : nil)
    }
    static func responseJSON(day: Int, revision: Int) throws -> [String: Any] {
        let url = Bundle(for: PlanMovePreviewTests.self).url(forResource: "day-plan", withExtension: "json")!
        var raw = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        var trip = raw["trip"] as! [String: Any]; trip["id"] = "move-trip"; trip["revision"] = revision; raw["trip"] = trip
        var value = raw["day"] as! [String: Any]; value["index"] = day; raw["day"] = value
        return raw
    }
    static func response(day: Int, revision: Int) throws -> DayPlanResponse {
        try JSONDecoder().decode(DayPlanResponse.self, from: JSONSerialization.data(withJSONObject: responseJSON(day: day, revision: revision)))
    }
}

extension PlanMovePreviewTests {
    func testRealServiceSendsStrictSortFlagAndReturnsCanonicalRawDocument() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MovePreviewProtocol.self]
        let session = URLSession(configuration: config)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { session.invalidateAndCancel(); MovePreviewProtocol.respond = nil; try? FileManager.default.removeItem(at: directory) }
        let response = try MovePreviewSource.response(day: 1, revision: 7), docs = documents()
        let payload = try JSONEncoder().encode(PlanChangePreview(before: response, after: response, document: docs.canonical.raw))
        var sent: [[String: Any]] = []
        MovePreviewProtocol.respond = { request in
            XCTAssertEqual(request.url?.path, "/api/v1/trips/move-trip/plan-preview")
            var data = request.httpBody ?? Data()
            if let stream = request.httpBodyStream {
                stream.open(); defer { stream.close() }
                var bytes = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable {
                    let count = stream.read(&bytes, maxLength: bytes.count)
                    if count <= 0 { break }
                    data.append(contentsOf: bytes.prefix(count))
                }
            }
            sent.append((try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:])
            return payload
        }
        let service = TripService(api: APIClient(baseURL: URL(string: "https://move-preview.invalid")!,
            tokens: MovePreviewTokens(), session: session), cache: TripCache(directory: directory))
        let sorted = try await service.planPreview(tripId: "move-trip", document: docs.original, dayIndex: 1, revision: 7, sortByTime: true)
        XCTAssertEqual(sorted.canonicalDocument, docs.canonical)
        XCTAssertEqual(sent.first?["sortByTime"] as? Bool, true)
        XCTAssertEqual(sent.first?["revision"] as? Int, 7)
        _ = try await service.planPreview(tripId: "move-trip", document: docs.original, dayIndex: 0, revision: 7)
        XCTAssertNil(sent.last?["sortByTime"], "기존 요청의 의미는 그대로다")
    }

    func testLegacySourceSupportsManualPreviewButRejectsUnsupportedAutomaticSort() async throws {
        let source: TripDocumentSource = LegacyMovePreviewSource()
        let response = try await source.planPreview(tripId: "move-trip", document: documents().original,
            dayIndex: 0, revision: 7, sortByTime: false)
        XCTAssertNil(response.canonicalDocument)
        do {
            _ = try await source.planPreview(tripId: "move-trip", document: documents().original,
                dayIndex: 0, revision: 7, sortByTime: true)
            XCTFail("정렬을 모르는 소스가 미정렬 문서를 검토 완료라고 돌려주면 안 된다")
        } catch let error as APIError {
            guard case .notFound = error else { return XCTFail("정렬 미지원 오류가 필요하다") }
        }
    }
}

@MainActor private struct MovePreviewTokens: TokenProviding {
    func accessToken() async throws -> String { "synthetic" }
    func refreshToken() async throws -> String { "synthetic" }
}
private final class MovePreviewProtocol: URLProtocol {
    @MainActor static var respond: ((URLRequest) -> Data)?
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "move-preview.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Task { @MainActor in
            guard let data = Self.respond?(request) else { return }
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() {}
}
private struct LegacyMovePreviewSource: TripDocumentSource {
    func document(tripId: String) async throws -> TripDocumentSnapshot { throw APIError.offline }
    func saveDocument(tripId: String, document: TripDocument, expectedRevision: Int) async throws -> TripDocumentSnapshot { throw APIError.offline }
    func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse> { throw APIError.offline }
    func cachedDayPlan(tripId: String, dayIndex: Int) async -> DayPlanResponse? { nil }
    func tripRoutes(tripId: String) async throws -> TripRoutesResponse { throw APIError.offline }
    func planPreview(tripId: String, document: TripDocument, dayIndex: Int, revision: Int) async throws -> PlanChangePreview {
        let response = try await MovePreviewSource.response(day: dayIndex, revision: revision)
        return .init(before: response, after: response)
    }
}
