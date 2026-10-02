import XCTest
@testable import TripCanvas

// 실시간에서 지키는 것은 두 가지다.
//   1. `liveEffects`가 `collab.js`와 **같은 답**을 낸다 — 복사본은 조용히 갈라진다(§39·§40)
//   2. 이벤트를 받으면 payload가 아니라 **API로 다시 읽는다**(§41)

final class LiveEffectsParityTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Effects: Decodable, Equatable {
            let candidates: Bool; let members: Bool; let pull: Bool; let activity: Bool; let notify: Bool
        }
        struct Case: Decodable { let kind: String; let mine: Bool; let effects: Effects }
        let cases: [Case]
    }

    private func load() throws -> Fixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "live-effects", withExtension: "json"),
                                "live-effects.json 픽스처를 테스트 번들에 포함시켜야 합니다")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    /// 픽스처는 `next`의 `liveEffectsParity.test.ts`가 **`collab.js`로** 만든다.
    /// 규칙을 바꾸면 그 테스트가 파일을 새로 쓰고 여기가 깨진다 — 그게 목적이다.
    func testMatchesTheJavaScriptRule() throws {
        let fixture = try load()
        XCTAssertGreaterThan(fixture.cases.count, 0)
        for c in fixture.cases {
            let swift = CollabModel.liveEffects(kind: c.kind, mine: c.mine)
            XCTAssertEqual(
                Fixture.Effects(candidates: swift.candidates, members: swift.members, pull: swift.pull,
                                activity: swift.activity, notify: swift.notify),
                c.effects,
                "kind=\(c.kind) mine=\(c.mine) — collab.js와 답이 다르다")
        }
    }

    func testActivityKindsMatchTheFixture() throws {
        let fixture = try load()
        // 픽스처에는 모르는 kind도 들어 있다 — 아는 것만 골라 비교한다.
        let known = Set(fixture.cases.filter { $0.effects.activity }.map(\.kind))
        XCTAssertEqual(known, Set(CollabModel.activityKinds))
    }
}

@MainActor
final class RealtimeHandlingTests: XCTestCase {
    private func board(_ service: FakeRealtimeService) -> CandidateBoardViewModel {
        CandidateBoardViewModel(
            trip: TripSummary(id: "t1", name: "바르셀로나", start: "2026-10-01", dayCount: 3, revision: 1,
                              updatedAt: "2026-09-01T00:00:00.000Z", timeZone: "Europe/Madrid",
                              cities: ["바르셀로나"], todayIndex: 0, daysUntilStart: nil, role: .owner, memberCount: 3),
            service: service, documents: FakeRealtimeDocuments())
    }

    /// 후보가 바뀌었다는 신호를 받으면 **payload를 쓰지 않고 목록을 다시 읽는다**(§41).
    func testCandidateEventRefetchesInsteadOfUsingThePayload() async {
        let service = FakeRealtimeService()
        let model = board(service)
        await model.load()
        let before = service.candidateReads

        await model.handle(RealtimeActivity(tripId: "t1", id: 9, kind: "REACTION", mine: false))

        XCTAssertEqual(service.candidateReads, before + 1, "API로 다시 읽는다")
    }

    /// 내 반응·담기의 에코는 다시 읽지 않는다 — 내 화면은 이미 그렇다(낙관 반영, 2026-09-18).
    func testMyOwnEchoDoesNotRefetch() async {
        let service = FakeRealtimeService()
        let model = board(service)
        await model.load()
        let before = service.candidateReads

        await model.handle(RealtimeActivity(tripId: "t1", id: 9, kind: "REACTION", mine: true))
        await model.handle(RealtimeActivity(tripId: "t1", id: 10, kind: "CANDIDATE_PROPOSED", mine: true))
        XCTAssertEqual(service.candidateReads, before, "내 반응·담기는 이미 내 화면이다")

        await model.handle(RealtimeActivity(tripId: "t1", id: 11, kind: "SCHEDULE_CHANGED", mine: true))
        XCTAssertEqual(service.candidateReads, before + 1, "문서 변경은 내 것이어도 후보 날짜 표시를 다시 읽는다")
    }

    /// 다른 여행의 이벤트는 무시한다.
    func testIgnoresOtherTrips() async {
        let service = FakeRealtimeService()
        let model = board(service)
        await model.load()
        let before = service.candidateReads

        await model.handle(RealtimeActivity(tripId: "t2", id: 9, kind: "REACTION", mine: false))

        XCTAssertEqual(service.candidateReads, before)
    }

    /// 날짜 이동·삭제는 후보의 배치 상태도 바꾸므로 보드를 다시 읽는다.
    func testScheduleChangeRefetchesCandidates() async {
        let service = FakeRealtimeService()
        let model = board(service)
        await model.load()
        let before = service.candidateReads

        await model.handle(RealtimeActivity(tripId: "t1", id: 9, kind: "SCHEDULE_CHANGED", mine: false))

        XCTAssertEqual(service.candidateReads, before + 1, "문서 변경 뒤 후보의 배치 상태를 다시 읽는다")
    }

    func testUnrelatedEventDoesNotRefetch() async {
        let service = FakeRealtimeService()
        let model = board(service)
        await model.load()
        let before = service.candidateReads
        await model.handle(RealtimeActivity(tripId: "t1", id: 9, kind: "UNRELATED_EVENT", mine: false))
        XCTAssertEqual(service.candidateReads, before)
    }

    /// 알림은 적게(§51) — 남이 담았을 때만.
    func testNotifiesOnlyForOthersProposals() async {
        let service = FakeRealtimeService()
        let model = board(service)
        await model.load()

        await model.handle(RealtimeActivity(tripId: "t1", id: 1, kind: "CANDIDATE_PROPOSED", mine: true))
        XCTAssertNil(model.toast, "내가 담은 것은 알리지 않는다")

        await model.handle(RealtimeActivity(tripId: "t1", id: 2, kind: "CANDIDATE_PROPOSED", mine: false))
        XCTAssertEqual(model.toast?.contains("담았어요"), true)
    }
}

// MARK: - 가짜

private final class FakeRealtimeService: CollabSource, @unchecked Sendable {
    private(set) var candidateReads = 0

    func members(tripId: String) async throws -> [MemberView] { [] }
    func manageMember(tripId: String, memberId: Int, action: String, value: String?) async throws {}
    func leave(tripId: String) async throws {}
    func invites(tripId: String) async throws -> [InviteView] { [] }
    func createInvite(tripId: String, role: MemberRole, hours: Int) async throws -> InviteCreated {
        InviteCreated(id: 1, token: String(repeating: "z", count: 32), role: .editor, expiresAt: "2026-12-01T00:00:00.000Z")
    }
    func revokeInvite(tripId: String, inviteId: Int) async throws {}
    func previewInvite(token: String) async throws -> InvitePreview {
        InvitePreview(valid: false, reason: "EXPIRED", tripName: nil, startDate: nil, dayCount: nil,
                      role: nil, expiresAt: "", alreadyMember: false)
    }
    func acceptInvite(token: String, displayName: String?) async throws -> InviteAccept {
        InviteAccept(ok: true, reason: "OK", clientId: "t1", tripName: "바르셀로나", role: .editor, alreadyMember: false)
    }
    func candidates(tripId: String) async throws -> [CandidateView] { candidateReads += 1; return [] }
    func addCandidate(tripId: String, title: String, note: String?, lat: Double?, lng: Double?,
                      placeId: String?, addr: String?) async throws -> Int { 1 }
    func react(tripId: String, candidateId: Int, reaction: Reaction?) async throws {}
    func manageCandidate(tripId: String, candidateId: Int, action: String, value: String?) async throws {}
    func comments(tripId: String, candidateId: Int) async throws -> [CommentView] { [] }
    func addComment(tripId: String, candidateId: Int, body: String) async throws {}
    func deleteComment(tripId: String, commentId: Int) async throws {}
    func activity(tripId: String, limit: Int) async throws -> [ActivityView] { [] }
    func groupProposal(tripId: String) async throws -> GroupProposalView? { nil }
    func realtimeChoice() async throws -> RealtimeChoice { RealtimeChoice(provider: "NONE", url: nil) }
    func preferences(tripId: String) async throws -> [PreferenceView] { [] }
    func savePreferences(tripId: String, prefs: [String: JSONValue]) async throws -> [String: JSONValue] { prefs }
}

private final class FakeRealtimeDocuments: TripDocumentSource, @unchecked Sendable {
    func document(tripId: String) async throws -> TripDocumentSnapshot {
        TripDocumentSnapshot(document: TripDocument(raw: ["days": .array([])]), revision: 1, role: .owner)
    }
    func saveDocument(tripId: String, document: TripDocument, expectedRevision: Int) async throws -> TripDocumentSnapshot {
        TripDocumentSnapshot(document: document, revision: expectedRevision + 1, role: .owner)
    }

    /// 이 테스트는 서버 계산을 쓰지 않는다 — 계산이 없어도 일정 편집은 그대로 돈다.
    func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse> {
        throw APIError.notFound("일자 계획 없음")
    }
    /// 전체 동선·지난 계산은 이 테스트의 관심사가 아니다 — 프로토콜을 채우기만 한다.
    func tripRoutes(tripId: String) async throws -> TripRoutesResponse { throw APIError.offline }
    func cachedDayPlan(tripId: String, dayIndex: Int) async -> DayPlanResponse? { nil }

}

/// 여행 화면의 실시간 분배(M7). 2026-09-20 전에는 '가고 싶은 곳' 보드가 열려 있을 때만 소켓에 붙어서,
/// `지금`·`일정` 탭에서는 일행이 일정을 고쳐도 화면에 아무 일도 일어나지 않았다.
@MainActor
final class TripLiveRefreshTests: XCTestCase {
    private func decide(_ kind: String, mine: Bool = false,
                        plan: Bool = true, today: Bool = true, collab: Bool = true) -> TripLiveRefresh {
        TripLiveRefresh.decide(kind: kind, mine: mine, hasPlan: plan, hasToday: today, hasCollab: collab)
    }

    func testScheduleChangeRefreshesThePlanAndToday() {
        XCTAssertEqual(decide("SCHEDULE_CHANGED"), TripLiveRefresh(plan: true, today: true, members: false, activity: true))
        XCTAssertEqual(decide("BOOKING_ADDED"), TripLiveRefresh(plan: true, today: true, members: false, activity: true))
    }

    /// **내 편집의 에코로는 일정을 다시 읽지 않는다** — 내가 이 기기에서 바꿨으니 화면은 이미 그렇다
    /// (`liveEffects`의 `pull`이 `doc && !mine`이다). 활동 기록은 내 것도 목록에 남으므로 켜진다.
    func testMyOwnScheduleChangeDoesNotRefetchThePlan() {
        XCTAssertEqual(decide("SCHEDULE_CHANGED", mine: true),
                       TripLiveRefresh(plan: false, today: false, members: false, activity: true))
    }

    func testMemberAndActivityEventsRefreshTheCollabScreen() {
        XCTAssertEqual(decide("MEMBER_JOINED"), TripLiveRefresh(plan: false, today: false, members: true, activity: true))
        // 활동 기록은 아는 종류면 전부 남는다 — 함께하기 화면의 목록이 그걸 보여 준다.
        // ⚠️ 멤버는 켜지 않는다: 인원이 안 바뀐 일로 4건을 부르지 않는다(#34가 없앤 그 문제다).
        XCTAssertEqual(decide("COMMENT_ADDED"), TripLiveRefresh(plan: false, today: false, members: false, activity: true))
    }

    /// 후보 목록은 여기서 읽지 않는다 — 보드 화면이 제 구독으로 받는다. 둘 다 읽으면 같은 목록을 두 번 받는다.
    func testCandidateEventsAreLeftToTheBoard() {
        let refresh = decide("CANDIDATE_PROPOSED")
        XCTAssertFalse(refresh.plan)
        XCTAssertFalse(refresh.today)
    }

    /// 닫힌 화면은 채우지 않는다 — 열 때 `loadIfStale`이 챙긴다(`docs/network-audit.md`).
    func testScreensWithoutContentAreNotFetched() {
        XCTAssertEqual(decide("SCHEDULE_CHANGED", plan: false, today: false, collab: false), TripLiveRefresh())
        XCTAssertEqual(decide("MEMBER_JOINED", collab: false), TripLiveRefresh())
        XCTAssertEqual(decide("SCHEDULE_CHANGED", today: false, collab: false),
                       TripLiveRefresh(plan: true, today: false, members: false, activity: false))
    }

    func testUnknownKindDoesNothing() {
        XCTAssertEqual(decide("WHAT_IS_THIS"), TripLiveRefresh())
    }
}

/// 소켓 하나를 화면 여럿이 나눠 쓴다. 전에는 핸들러가 하나뿐이라 두 번째 화면의 것이 **조용히 버려졌다.**
@MainActor
final class RealtimeSubscriberTests: XCTestCase {
    private func client() -> RealtimeClient {
        // 주소가 없으면 붙지 않는다 — 분배 규칙만 보므로 소켓은 필요 없다.
        RealtimeClient(tokens: NoTokens(), urlFor: { nil })
    }
    private let event = RealtimeActivity(tripId: "t1", id: 1, kind: "SCHEDULE_CHANGED", mine: false)

    func testEverySubscriberGetsTheEvent() {
        let live = client()
        var trip = 0, board = 0
        live.connect(tripId: "t1", key: "trip") { _ in trip += 1 }
        live.connect(tripId: "t1", key: "candidates") { _ in board += 1 }

        live.emit(event)

        XCTAssertEqual(trip, 1, "여행 화면이 받는다")
        XCTAssertEqual(board, 1, "보드도 같은 이벤트를 받는다 — 나중에 붙었다고 버려지지 않는다")
    }

    func testLeavingOneScreenKeepsTheOthersSubscribed() {
        let live = client()
        var trip = 0, board = 0
        live.connect(tripId: "t1", key: "trip") { _ in trip += 1 }
        live.connect(tripId: "t1", key: "candidates") { _ in board += 1 }

        live.disconnect(key: "candidates")   // 보드 시트를 닫았다
        live.emit(event)

        XCTAssertEqual(board, 0, "떠난 화면은 더 받지 않는다")
        XCTAssertEqual(trip, 1, "시트를 닫았다고 여행 화면의 실시간이 끊기면 안 된다")
    }

    func testTheSameScreenReconnectingReplacesItsHandler() {
        let live = client()
        var first = 0, second = 0
        live.connect(tripId: "t1", key: "trip") { _ in first += 1 }
        live.connect(tripId: "t1", key: "trip") { _ in second += 1 }

        live.emit(event)

        XCTAssertEqual(first, 0)
        XCTAssertEqual(second, 1, "같은 키로 다시 붙으면 최신 핸들러 하나만 남는다")
    }

    func testLastSubscriberLeavingClosesTheSocket() {
        let live = client()
        var got = 0
        live.connect(tripId: "t1", key: "trip") { _ in got += 1 }
        live.disconnect(key: "trip")

        live.emit(event)

        XCTAssertEqual(got, 0, "떠난 뒤에는 받지 않는다")
        XCTAssertEqual(live.state, .off, "아무도 안 들으면 소켓도 닫는다")
    }
}

/// `/api/v1/me`를 한 번 못 물었다고 실시간을 접지 않는다(2026-10-02).
/// 전에는 실패도 "실시간 없음"으로 담아, 지하철에서 한 번 타임아웃이 나면 앱을 끌 때까지 모든 여행에서 실시간이 꺼졌다.
@MainActor
final class RealtimeAddressTests: XCTestCase {
    func testAFailedLookupIsNotKeptButASuccessIs() async {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MeProtocol.self]
        let session = URLSession(configuration: config)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer {
            session.invalidateAndCancel()
            MeProtocol.online = false
            MeProtocol.requests = 0
            try? FileManager.default.removeItem(at: directory)
        }
        let api = APIClient(baseURL: URL(string: "https://example.invalid")!, tokens: NoTokens(), session: session)
        let service = TripService(api: api, cache: TripCache(directory: directory))

        MeProtocol.online = false
        let failed = await service.cachedRealtimeURL()
        XCTAssertNil(failed, "못 물었으면 이번에는 실시간 없이 간다")

        MeProtocol.online = true
        let recovered = await service.cachedRealtimeURL()
        XCTAssertEqual(recovered?.absoluteString, "wss://example.invalid/realtime",
                       "다음에 붙을 때 다시 묻는다 — 한 번의 실패가 굳지 않는다")

        let asked = MeProtocol.requests
        MeProtocol.online = false
        let kept = await service.cachedRealtimeURL()
        XCTAssertEqual(kept?.absoluteString, "wss://example.invalid/realtime")
        XCTAssertEqual(MeProtocol.requests, asked, "받은 답은 들고 있는다 — 붙을 때마다 /me를 부르지 않는다")
    }
}

/// `/api/v1/me`를 흉내 낸다 — 꺼 두면 타임아웃, 켜면 실시간 주소를 준다.
private final class MeProtocol: URLProtocol {
    @MainActor static var online = false
    @MainActor static var requests = 0
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Task { @MainActor in
            Self.requests += 1
            guard Self.online else {
                client?.urlProtocol(self, didFailWithError: URLError(.timedOut)); return
            }
            let body = Data(#"{"realtime":{"provider":"TRIPCANVAS","url":"wss://example.invalid/realtime"}}"#.utf8)
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() {}
}

@MainActor
private final class NoTokens: TokenProviding {
    func accessToken() async throws -> String { "live-test-token" }
    func refreshToken() async throws -> String { "live-test-token" }
}
