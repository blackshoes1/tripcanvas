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

    /// 다른 여행의 이벤트는 무시한다.
    func testIgnoresOtherTrips() async {
        let service = FakeRealtimeService()
        let model = board(service)
        await model.load()
        let before = service.candidateReads

        await model.handle(RealtimeActivity(tripId: "t2", id: 9, kind: "REACTION", mine: false))

        XCTAssertEqual(service.candidateReads, before)
    }

    /// 후보와 무관한 신호로 목록을 다시 읽지 않는다 — 소켓이 시끄러워도 API는 조용하다.
    func testUnrelatedEventDoesNotRefetch() async {
        let service = FakeRealtimeService()
        let model = board(service)
        await model.load()
        let before = service.candidateReads

        await model.handle(RealtimeActivity(tripId: "t1", id: 9, kind: "SCHEDULE_CHANGED", mine: false))

        XCTAssertEqual(service.candidateReads, before, "문서 변경은 이 화면이 다시 읽을 것이 아니다")
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
}
