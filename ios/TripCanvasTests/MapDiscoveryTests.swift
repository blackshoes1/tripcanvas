import XCTest
@testable import TripCanvas

@MainActor
final class MapDiscoveryTests: XCTestCase {
    private let seoul = PlaceSearchArea(south: 37.54, west: 126.96, north: 37.58, east: 127.00)
    private let osaka = PlaceSearchArea(south: 34.66, west: 135.49, north: 34.69, east: 135.52)
    private func trip(_ role: MemberRole = .owner) -> TripSummary {
        TripSummary(id: "map-test", name: "합성 여행", start: "2026-10-01", dayCount: 3, revision: 1,
            updatedAt: "2026-09-16T00:00:00Z", timeZone: "Asia/Seoul", cities: [], todayIndex: -1,
            daysUntilStart: 15, role: role, memberCount: 1)
    }
    private func hit(_ id: String, name: String = "같은 이름") -> PlaceHit {
        PlaceHit(id: "kakao-\(id)", name: name, city: "서울", address: "합성 주소",
            point: GeoPoint(lat: 37.56, lng: 126.98), category: .cafe, placeId: nil, provider: "kakao", providerId: id)
    }

    /// 지도를 닫았다 열어도 후보를 다시 받지 않는다 — 방금 받은 목록이면 그대로다(2026-09-17).
    func testReopeningTheMapDoesNotRefetchFreshCandidates() async {
        let source = FakeCollabService()
        var reads = 0
        source.candidateReads = { reads += 1; return [] }
        let model = MapDiscoveryModel(trip: trip(), searcher: DiscoverySearcher(), source: source)
        await model.loadCandidatesIfStale()
        await model.loadCandidatesIfStale()
        XCTAssertEqual(reads, 1)
        XCTAssertTrue(model.candidatesLoaded)
        await model.loadCandidatesIfStale(now: Date().addingTimeInterval(120))
        XCTAssertEqual(reads, 2, "오래됐으면 새로 받는다")
    }

    func testFiveContinuousSavesPreserveSearchAndDoNotMergeBranches() async {
        let source = FakeCollabService()
        let searcher = DiscoverySearcher()
        let model = MapDiscoveryModel(trip: trip(), searcher: searcher, source: source)
        await model.loadCandidates()
        model.query = "카페"; model.area = seoul
        searcher.results = (1...5).map { hit(String($0)) }
        await model.search()
        for place in model.hits { await model.save(place); await model.save(place) }
        XCTAssertEqual(source.addedCandidates.count, 5)
        XCTAssertEqual(model.hits.count, 5)
        XCTAssertEqual(model.area, seoul)
        XCTAssertEqual(model.query, "카페")
        XCTAssertTrue(model.hits.allSatisfy(model.isSaved))
    }

    func testProviderIdentitySurvivesReentryWithoutMergingNames() async throws {
        let source = FakeCollabService()
        source.candidateList = [try candidate(provider: "kakao", id: "100")]
        let model = MapDiscoveryModel(trip: trip(), searcher: DiscoverySearcher(), source: source)
        await model.loadCandidates()
        XCTAssertTrue(model.isSaved(hit("100")))
        XCTAssertFalse(model.isSaved(hit("101")), "동명이점은 별개의 장소")
        var other = hit("100"); other.provider = "google"
        XCTAssertFalse(model.isSaved(other), "서로 다른 제공자의 ID를 섞지 않음")
        let spot = CandidateBoardViewModel.spot(from: source.candidateList[0])
        XCTAssertEqual(spot.kakaoId, "100")
        XCTAssertNil(spot.placeId)
    }

    func testLateSearchDoesNotReplaceNewViewport() async {
        let searcher = DiscoverySearcher(); searcher.suspends = true
        let model = MapDiscoveryModel(trip: trip(), searcher: searcher, source: FakeCollabService())
        model.area = seoul; model.query = "카페"
        let pending = Task { await model.search() }
        while searcher.resume == nil { await Task.yield() }
        model.updateArea(osaka)
        searcher.resume?.resume(returning: [hit("old")]); searcher.resume = nil
        await pending.value
        XCTAssertTrue(model.hits.isEmpty)
        XCTAssertFalse(model.isSearching)
        XCTAssertEqual(model.area, osaka)
    }

    func testKoreanSearchTextInForeignAreaUsesInternationalProvider() async {
        let searcher = DiscoverySearcher()
        let model = MapDiscoveryModel(trip: trip(), searcher: searcher, source: FakeCollabService())
        model.area = osaka; model.query = "라멘"
        await model.search()
        XCTAssertEqual(searcher.region, .international)
        XCTAssertEqual(searcher.area, osaka)
    }

    func testViewerAndUnloadedCandidatesCannotWrite() async {
        let source = FakeCollabService()
        let viewer = MapDiscoveryModel(trip: trip(.viewer), searcher: DiscoverySearcher(), source: source)
        await viewer.loadCandidates(); await viewer.save(hit("1"))
        let owner = MapDiscoveryModel(trip: trip(), searcher: DiscoverySearcher(), source: source)
        await owner.save(hit("2"))
        XCTAssertTrue(source.addedCandidates.isEmpty)
    }

    func testManualSaveLeavesCoordinatesUnknown() async {
        let source = FakeCollabService()
        let model = MapDiscoveryModel(trip: trip(), searcher: DiscoverySearcher(), source: source)
        await model.loadCandidates(); await model.save(hit("manual"), withoutLocation: true)
        XCTAssertNil(source.addedDetails.first?.lat)
        XCTAssertNil(source.addedDetails.first?.lng)
    }

    func testUnknownWriteOutcomeIsReadBeforeRetry() async {
        let source = FakeCollabService()
        let model = MapDiscoveryModel(trip: trip(), searcher: DiscoverySearcher(), source: source)
        await model.loadCandidates()
        source.failure = .offline
        await model.save(hit("1"))
        source.failure = nil
        await model.save(hit("1"))
        XCTAssertEqual(source.addedCandidates.count, 1)
        XCTAssertEqual(source.candidateWriteKeys.count, 2)
        XCTAssertEqual(source.candidateWriteKeys.first, source.candidateWriteKeys.last, "재시도는 같은 키로 중복 저장을 막음")
        XCTAssertTrue(model.isSaved(hit("1")))
        XCTAssertNil(model.errorMessage)
    }

    func testRetryKeepsOriginalRequestBodyAndKey() async {
        let source = FakeCollabService()
        let model = MapDiscoveryModel(trip: trip(), searcher: DiscoverySearcher(), source: source)
        await model.loadCandidates()
        source.failure = .offline
        await model.save(hit("manual", name: "처음 이름"), withoutLocation: true)
        source.failure = nil
        await model.save(hit("manual", name: "바뀐 이름"))
        XCTAssertEqual(source.addedDetails.first?.title, "처음 이름")
        XCTAssertNil(source.addedDetails.first?.lat)
        XCTAssertEqual(Set(source.candidateWriteKeys).count, 1)
    }

    func testUncertainManualSaveBlocksDoubleTapWhileReading() async {
        let source = FakeCollabService()
        let model = MapDiscoveryModel(trip: trip(), searcher: DiscoverySearcher(), source: source)
        await model.loadCandidates()
        source.failure = .offline
        await model.save(hit("manual"), withoutLocation: true)
        source.failure = nil
        var read: CheckedContinuation<[CandidateView], Error>?
        source.candidateReads = { try await withCheckedThrowingContinuation { read = $0 } }
        let retry = Task { await model.save(self.hit("manual"), withoutLocation: true) }
        while read == nil { await Task.yield() }
        await model.save(hit("manual"), withoutLocation: true)
        XCTAssertEqual(source.candidateWriteKeys.count, 1)
        source.candidateReads = nil
        read?.resume(returning: [])
        await retry.value
        XCTAssertEqual(source.addedCandidates.count, 1)
        XCTAssertEqual(Set(source.candidateWriteKeys).count, 1)
        XCTAssertNil(source.addedDetails.first?.lat)
    }

    func testRejectedPlaceRequiresExplicitReopen() async throws {
        let source = FakeCollabService()
        source.candidateList = [try candidate(provider: "kakao", id: "100", status: "REJECTED")]
        let model = MapDiscoveryModel(trip: trip(), searcher: DiscoverySearcher(), source: source)
        await model.loadCandidates()
        XCTAssertFalse(model.isSaved(hit("100")))
        await model.save(hit("100"))
        XCTAssertTrue(source.candidateWriteKeys.isEmpty)
        XCTAssertTrue(source.candidateActions.isEmpty)
        await model.reopen(hit("100"))
        XCTAssertEqual(source.candidateActions.first?.action, "REOPEN")
    }

    func testOlderCandidateReadDoesNotReplaceNewerList() async throws {
        let source = FakeCollabService()
        let model = MapDiscoveryModel(trip: trip(), searcher: DiscoverySearcher(), source: source)
        var oldRead: CheckedContinuation<[CandidateView], Error>?
        source.candidateReads = { try await withCheckedThrowingContinuation { oldRead = $0 } }
        let old = Task { await model.loadCandidates() }
        while oldRead == nil { await Task.yield() }
        source.candidateReads = nil
        source.candidateList = [try candidate(provider: "kakao", id: "new")]
        await model.loadCandidates()
        oldRead?.resume(returning: [])
        await old.value
        XCTAssertTrue(model.isSaved(hit("new")))
    }

    func testViewportRequestUsesRestrictionAndKeepsExplicitType() {
        let body = PlaceSearchService.googleDiscoveryBody(query: "라멘", near: nil, area: osaka, category: .food, language: "ko")
        XCTAssertNil(body["locationBias"])
        XCTAssertNotNil(body["locationRestriction"])
        XCTAssertEqual(body["includedType"] as? String, "restaurant")
        XCTAssertEqual(body["strictTypeFiltering"] as? Bool, true)
        XCTAssertFalse(PlaceSearchArea(south: 0, west: 179, north: 1, east: -179).isValid)
        XCTAssertFalse(PlaceSearchArea(south: .nan, west: 0, north: 1, east: 1).isValid)
    }

    private func candidate(provider: String, id: String, status: String = "PROPOSED") throws -> CandidateView {
        let json = """
        {"id":1,"title":"같은 이름","place_id":null,"provider":"\(provider)","provider_id":"\(id)",
        "lat":37.56,"lng":126.98,"addr":"합성 주소","note":null,"url":null,"status":"\(status)",
        "scheduled_ref":null,"proposed_by_label":"나","mine":true,"my_reaction":null,
        "must_count":0,"ok_count":0,"pass_count":0,"reactions":[],"comment_count":0,"created_at":"2026-09-16T00:00:00Z"}
        """
        return try JSONDecoder().decode(CandidateView.self, from: Data(json.utf8))
    }
}

@MainActor private final class DiscoverySearcher: PlaceSearching {
    var results: [PlaceHit] = []
    var region: PlaceSearchRegion?
    var area: PlaceSearchArea?
    var suspends = false
    var resume: CheckedContinuation<[PlaceHit], Error>?
    func search(_ query: String, near: GeoPoint?) async throws -> [PlaceHit] { results }
    func search(_ query: String, area: PlaceSearchArea?, category: PlaceSearchCategory?, region: PlaceSearchRegion) async throws -> [PlaceHit] {
        self.region = region; self.area = area
        if suspends { return try await withCheckedThrowingContinuation { resume = $0 } }
        return results
    }
}
