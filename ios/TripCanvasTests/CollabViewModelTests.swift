import XCTest
@testable import TripCanvas

/// 함께하기 배선. 지키는 것은 셋이다 —
/// **권한이 없으면 요청 자체가 안 나간다**, **반응은 낙관적이되 실패하면 되돌린다**,
/// **일정에 넣기는 문서 저장이 먼저다**(표시가 실패해도 정직하게 말한다).
@MainActor
final class CollabViewModelTests: XCTestCase {
    private func trip(role: MemberRole = .owner, members: Int = 3, days: Int = 3) -> TripSummary {
        TripSummary(id: "t1", name: "바르셀로나", start: "2026-10-01", dayCount: days, revision: 4,
                    updatedAt: "2026-09-01T00:00:00.000Z", timeZone: "Europe/Madrid", cities: ["바르셀로나"],
                    todayIndex: 0, role: role, memberCount: members)
    }

    // MARK: 멤버 · 초대

    func testLoadsMembersAndDerivesMyRole() async {
        let service = FakeCollabService()
        service.membersList = [
            .init(id: 1, userId: "u1", role: .owner, status: "ACTIVE", displayName: "영희", joinedAt: nil, me: false),
            .init(id: 2, userId: "u2", role: .editor, status: "ACTIVE", displayName: "나", joinedAt: nil, me: true)
        ]
        let model = CollabViewModel(trip: trip(role: .editor), service: service, webBaseURL: URL(string: "https://example.test/")!)
        await model.load()

        XCTAssertEqual(model.members.count, 2)
        XCTAssertEqual(model.role, .editor)
        XCTAssertFalse(model.canManage)
        XCTAssertTrue(model.canLeave)
        XCTAssertTrue(service.inviteListCalls == 0, "주최자가 아니면 초대 목록을 부르지 않는다")
    }

    func testInviteLinkIsWebAndShownOnce() async {
        let service = FakeCollabService()
        service.membersList = [.init(id: 1, userId: "u1", role: .owner, status: "ACTIVE", displayName: "나", joinedAt: nil, me: true)]
        let model = CollabViewModel(trip: trip(), service: service, webBaseURL: URL(string: "https://tripcanvas-ai.vercel.app/")!)
        await model.load()
        await model.createInvite(role: .editor)

        XCTAssertEqual(model.createdInviteLink, "https://tripcanvas-ai.vercel.app/#join=\(service.issuedToken)")
        XCTAssertEqual(service.createdInviteRoles, [.editor])
        model.clearCreatedInvite()
        XCTAssertNil(model.createdInviteLink)
    }

    func testViewerCannotInvite() async {
        let service = FakeCollabService()
        service.membersList = [.init(id: 9, userId: "u9", role: .viewer, status: "ACTIVE", displayName: "나", joinedAt: nil, me: true)]
        let model = CollabViewModel(trip: trip(role: .viewer), service: service, webBaseURL: URL(string: "https://example.test/")!)
        await model.load()
        await model.createInvite(role: .editor)

        XCTAssertTrue(service.createdInviteRoles.isEmpty, "요청 자체가 나가지 않는다")
        XCTAssertNil(model.createdInviteLink)
    }

    /// 주최자는 나갈 수 없다 — 서버가 거절하면 그 문장을 그대로 말한다.
    func testOwnerCannotLeave() async {
        let service = FakeCollabService()
        service.membersList = [.init(id: 1, userId: "u1", role: .owner, status: "ACTIVE", displayName: "나", joinedAt: nil, me: true)]
        let model = CollabViewModel(trip: trip(), service: service, webBaseURL: URL(string: "https://example.test/")!)
        await model.load()
        await model.leave()

        XCTAssertFalse(service.didLeave)
        XCTAssertFalse(model.hasLeft)
    }

    func testLeaveMarksTheTripGone() async {
        let service = FakeCollabService()
        service.membersList = [.init(id: 2, userId: "u2", role: .editor, status: "ACTIVE", displayName: "나", joinedAt: nil, me: true)]
        let model = CollabViewModel(trip: trip(role: .editor), service: service, webBaseURL: URL(string: "https://example.test/")!)
        await model.load()
        await model.leave()

        XCTAssertTrue(service.didLeave)
        XCTAssertTrue(model.hasLeft)
    }

    func testPrefsSaveSendsNormalizedAndServerWins() async {
        let service = FakeCollabService()
        service.membersList = [.init(id: 1, userId: "u1", role: .owner, status: "ACTIVE", displayName: "나", joinedAt: nil, me: true)]
        let model = CollabViewModel(trip: trip(), service: service, webBaseURL: URL(string: "https://example.test/")!)
        await model.load()

        var prefs = TripPrefs()
        prefs.pace = .relaxed
        prefs.interests = ["야경", "야경", "  "]
        await model.savePrefs(prefs)

        let sent = service.savedPrefs.last ?? [:]
        XCTAssertEqual(sent["pace"]?.stringValue, "RELAXED")
        XCTAssertEqual(sent["interests"]?.arrayValue?.count, 1, "중복·빈 값은 보내지 않는다")
        XCTAssertEqual(model.myPrefs.pace, .packed, "저장 뒤에는 서버가 돌려준 것이 이긴다")
    }

    func testActivityIsCondensedForReading() async {
        let service = FakeCollabService()
        service.membersList = [.init(id: 1, userId: "u1", role: .owner, status: "ACTIVE", displayName: "나", joinedAt: nil, me: true)]
        service.activityRows = [
            .init(id: 3, kind: "SCHEDULE_CHANGED", actorLabel: "영희", mine: false, memberLabel: nil, subject: [:], createdAt: "2026-09-01T10:03:00.000Z"),
            .init(id: 2, kind: "SCHEDULE_CHANGED", actorLabel: "영희", mine: false, memberLabel: nil, subject: [:], createdAt: "2026-09-01T10:02:00.000Z")
        ]
        let model = CollabViewModel(trip: trip(), service: service, webBaseURL: URL(string: "https://example.test/")!)
        await model.load()

        XCTAssertEqual(model.activity.count, 1)
        XCTAssertEqual(model.activity.first?.count, 2)
    }

    // MARK: 후보 보드

    private func candidate(id: Int = 1, title: String = "카사 바트요", status: String = "PROPOSED", mine: Bool = false,
                           myReaction: String? = nil,
                           reactions: [CandidateView.ReactionEntry] = []) -> CandidateView {
        CandidateView(id: id, title: title, placeId: nil, lat: 41.4, lng: 2.16, addr: nil, note: nil, url: nil,
                      status: status, scheduledRef: nil, proposedByLabel: "영희", mine: mine, myReaction: myReaction,
                      mustCount: reactions.filter { $0.reaction == "MUST" }.count,
                      okCount: reactions.filter { $0.reaction == "OK" }.count,
                      passCount: reactions.filter { $0.reaction == "PASS" }.count,
                      reactions: reactions, commentCount: 0, createdAt: "2026-09-01T00:00:00.000Z")
    }

    func testReactionIsOptimisticAndTogglesOff() async {
        let service = FakeCollabService()
        service.candidateList = [candidate()]
        let documents = FakeDocumentStore()
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: documents)
        await model.load()

        await model.react(candidateId: 1, reaction: .must)
        XCTAssertEqual(service.reactions.last?.reaction, .must)
        XCTAssertEqual(model.candidates.first?.myReaction, "MUST")

        // 같은 것을 다시 누르면 거둔다
        await model.react(candidateId: 1, reaction: .must)
        XCTAssertNil(service.reactions.last?.reaction ?? nil)
        XCTAssertNil(model.candidates.first?.myReaction)
    }

    func testFailedReactionRollsBack() async {
        let service = FakeCollabService()
        service.candidateList = [candidate()]
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: FakeDocumentStore())
        await model.load()
        service.failure = .forbidden("보기 권한이라 저장할 수 없어요")

        await model.react(candidateId: 1, reaction: .must)
        XCTAssertNil(model.candidates.first?.myReaction, "저장되지 않은 것이 저장된 척하지 않는다")
        XCTAssertNotNil(model.errorMessage)
    }

    func testViewerCannotAddCandidates() async {
        let service = FakeCollabService()
        let model = CandidateBoardViewModel(trip: trip(role: .viewer), service: service, documents: FakeDocumentStore())
        await model.load()
        let added = await model.add(title: "구엘 공원", note: "")

        XCTAssertFalse(added)
        XCTAssertTrue(service.addedCandidates.isEmpty)
    }

    /// 일정에 넣기 — 문서를 CAS로 저장하고 고른 날 **맨 뒤**에 붙는다. 그 뒤에 후보를 표시한다.
    func testScheduleAppendsToTheChosenDayThenMarks() async {
        let service = FakeCollabService()
        service.candidateList = [candidate()]
        let documents = FakeDocumentStore()
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: documents)
        await model.load()

        await model.schedule(candidateId: 1, dayIndex: 1)

        XCTAssertEqual(documents.saves.count, 1)
        XCTAssertEqual(documents.saves.first?.expectedRevision, 7)
        let day = documents.saves.first?.document.days[1]
        XCTAssertEqual(day?.spots.map(\.name), ["기존 장소", "카사 바트요"], "맨 뒤에 붙는다")
        XCTAssertEqual(day?.spots.last?.point?.lat, 41.4)
        XCTAssertEqual(service.candidateActions.last?.action, "SCHEDULE")
        XCTAssertEqual(service.candidateActions.last?.value, "2", "표시는 1부터 센 날짜")
    }

    /// 표시가 실패해도 일정에는 들어가 있다고 정직하게 말한다.
    func testScheduleTellsTheTruthWhenMarkingFails() async {
        let service = FakeCollabService()
        service.candidateList = [candidate()]
        service.failCandidateActions = true
        let documents = FakeDocumentStore()
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: documents)
        await model.load()

        await model.schedule(candidateId: 1, dayIndex: 0)
        XCTAssertEqual(documents.saves.count, 1, "문서에는 들어갔다")
        XCTAssertTrue(model.errorMessage?.contains("일정에는 넣었지만") == true)
    }

    /// 남기기는 됐는데 다시 읽기가 실패하면 그 사실이 남아야 한다 — 목록을 다시 읽는 것이 안내를 지우면 안 된다.
    func testCommentReloadFailureIsNotSwallowed() async {
        let service = FakeCollabService()
        service.candidateList = [candidate()]
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: FakeDocumentStore())
        await model.load()

        service.failCommentReads = true
        let sent = await model.addComment(candidateId: 1, body: "야경 보고 저녁 먹자")
        XCTAssertTrue(sent, "한마디는 남았다")
        XCTAssertNotNil(model.errorMessage, "다시 읽지 못한 사실을 삼키지 않는다")
    }

    func testScheduleRefusesADayThatIsNotThere() async {
        let service = FakeCollabService()
        service.candidateList = [candidate()]
        let documents = FakeDocumentStore()
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: documents)
        await model.load()

        await model.schedule(candidateId: 1, dayIndex: 9)
        XCTAssertTrue(documents.saves.isEmpty)
        XCTAssertEqual(model.errorMessage, "그 날짜는 일정에 없어요")
    }

    // ── 지도에서 후보 담기 (§37) ────────────────────────────────────────────

    /// 지도에서 고른 자리가 좌표와 함께 후보가 된다 — 그래야 "어느 날에 넣을지"를 정할 수 있다.
    func testAddCarriesTheLocationFromTheMap() async {
        let service = FakeCollabService()
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: FakeDocumentStore())
        await model.load()

        let added = await model.add(title: "카사 바트요", note: "야경이 좋대",
                                    lat: 41.3916, lng: 2.1649,
                                    placeId: "ChIJ_place", addr: "Passeig de Gràcia 43")

        XCTAssertTrue(added)
        let detail = service.addedDetails.last
        XCTAssertEqual(detail?.lat, 41.3916)
        XCTAssertEqual(detail?.lng, 2.1649)
        XCTAssertEqual(detail?.placeId, "ChIJ_place")
        XCTAssertEqual(detail?.addr, "Passeig de Gràcia 43")
    }

    /// 위치 없이도 담긴다 — 이름만 아는 곳(“그 골목 라멘집”)을 막지 않는다.
    func testAddWithoutLocationStillWorks() async {
        let service = FakeCollabService()
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: FakeDocumentStore())
        await model.load()

        let added = await model.add(title: "그 골목 라멘집", note: "")
        XCTAssertTrue(added)
        let detail = service.addedDetails.last
        XCTAssertNil(detail?.lat)
        XCTAssertNil(detail?.placeId)
    }

    /// ⚠️ §37 — 보기 권한은 지도에서 골라도 후보를 만들지 못한다. 의견만 낸다.
    func testViewerCannotAddFromTheMap() async {
        let service = FakeCollabService()
        let model = CandidateBoardViewModel(trip: trip(role: .viewer), service: service, documents: FakeDocumentStore())
        await model.load()

        let added = await model.add(title: "카사 바트요", note: "", lat: 41.39, lng: 2.16, placeId: nil, addr: nil)

        XCTAssertFalse(added)
        XCTAssertTrue(service.addedDetails.isEmpty, "요청 자체가 나가지 않는다")
    }

    // ── 그룹 제안 (§35) — 앱은 판정하지 않고 서버가 준 것을 그린다 ───────────────

    private func proposal(_ picks: [(Int, Int, String)]) -> GroupProposalView {
        GroupProposalView(
            summary: "이 \(picks.count)곳은 다들 좋아해요",
            picks: picks.map { GroupProposalPick(candidateId: $0.0, title: $0.2, dayIndex: $0.1,
                                                 dayLabel: "Day \($0.1 + 1)", reasons: ["반대 없음"], distanceKm: nil) },
            impact: GroupProposalImpact(spotsAdded: picks.count, daysTouched: Set(picks.map(\.1)).count),
            options: [GroupProposalOption(key: "ACCEPT", label: "이대로 할래요"),
                      GroupProposalOption(key: "DISMISS", label: "나중에")],
            groupNotes: [])
    }

    func testProposalComesFromTheServerAndIsNotComputedHere() async {
        let service = FakeCollabService()
        service.candidateList = [candidate()]
        service.proposalResult = proposal([(1, 1, "카사 바트요")])
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: FakeDocumentStore())

        await model.load()

        XCTAssertEqual(service.proposalReads, 1, "서버에 물어본다")
        XCTAssertEqual(model.proposal?.summary, "이 1곳은 다들 좋아해요")
    }

    /// 제안을 못 읽어도 보드는 그대로 뜬다 — 곁들이가 본체를 막지 않는다.
    func testProposalFailureDoesNotBreakTheBoard() async {
        let service = FakeCollabService()
        service.candidateList = [candidate()]
        service.failProposal = true
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: FakeDocumentStore())

        await model.load()

        XCTAssertEqual(model.candidates.count, 1)
        XCTAssertNil(model.proposal)
        XCTAssertNil(model.errorMessage, "제안이 없다고 오류를 띄우지 않는다")
    }

    /// 여러 곳을 넣어도 문서 저장은 **한 번**이다 — 스스로 CAS 충돌을 만들지 않는다.
    func testAcceptSavesTheDocumentOnceThenMarksEach() async {
        let service = FakeCollabService()
        service.candidateList = [candidate(), candidate(id: 2, title: "공원")]
        service.proposalResult = proposal([(1, 1, "카사 바트요"), (2, 2, "공원")])
        let documents = FakeDocumentStore()
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: documents)
        await model.load()

        await model.acceptProposal()

        XCTAssertEqual(documents.saves.count, 1, "한 번만 저장한다")
        XCTAssertEqual(documents.saves.first?.expectedRevision, 7)
        let saved = documents.saves.first?.document
        XCTAssertEqual(saved?.days[1].spots.map(\.name), ["기존 장소", "카사 바트요"])
        XCTAssertEqual(saved?.days[2].spots.map(\.name), ["공원"])
        XCTAssertEqual(service.candidateActions.map(\.action), ["SCHEDULE", "SCHEDULE"])
        XCTAssertEqual(service.candidateActions.map(\.value), ["2", "3"], "표시는 1부터 센 날짜")
        XCTAssertNil(model.proposal, "수락한 제안은 사라진다")
    }

    /// 표시가 실패해도 일정에는 들어가 있다고 정직하게 말한다.
    func testAcceptTellsTheTruthWhenMarkingFails() async {
        let service = FakeCollabService()
        service.candidateList = [candidate()]
        service.proposalResult = proposal([(1, 1, "카사 바트요")])
        service.failCandidateActions = true
        let documents = FakeDocumentStore()
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: documents)
        await model.load()

        await model.acceptProposal()

        XCTAssertEqual(documents.saves.count, 1, "문서에는 들어갔다")
        XCTAssertEqual(model.errorMessage?.contains("일정에는"), true)
    }

    /// 자동으로 적용하지 않는다 — "나중에"는 이 세션에서 다시 올라오지 않는다(§79).
    func testDismissKeepsItAwayForTheSession() async {
        let service = FakeCollabService()
        service.candidateList = [candidate()]
        service.proposalResult = proposal([(1, 1, "카사 바트요")])
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: FakeDocumentStore())
        await model.load()
        XCTAssertNotNil(model.proposal)

        model.dismissProposal()
        XCTAssertNil(model.proposal)

        await model.load()
        XCTAssertNil(model.proposal, "거절한 제안을 다시 올리지 않는다")
        XCTAssertEqual(service.proposalReads, 1, "다시 묻지도 않는다")
    }

    func testViewerSeesNoProposalAction() async {
        let service = FakeCollabService()
        service.candidateList = [candidate()]
        service.proposalResult = proposal([(1, 1, "카사 바트요")])
        let model = CandidateBoardViewModel(trip: trip(role: .viewer), service: service, documents: FakeDocumentStore())
        await model.load()

        await model.acceptProposal()
        XCTAssertFalse(model.canSchedule)
        XCTAssertEqual(service.candidateActions.count, 0, "보기 권한은 일정에 넣지 않는다")
    }

    func testRejectKeepsTheCandidateAndReopenBringsItBack() async {
        let service = FakeCollabService()
        service.candidateList = [candidate(reactions: [.init(name: "영희", reaction: "MUST", me: false), .init(name: "철수", reaction: "PASS", me: false)])]
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: FakeDocumentStore())
        await model.load()

        await model.reject(candidateId: 1)
        XCTAssertEqual(service.candidateActions.last?.action, "REJECT")
        await model.reopen(candidateId: 1)
        XCTAssertEqual(service.candidateActions.last?.action, "REOPEN")
        XCTAssertTrue(service.candidateActions.allSatisfy { $0.action != "REMOVE" }, "제외는 지우는 것이 아니다")
    }

    func testMemberCountComesFromTheMemberList() async {
        let service = FakeCollabService()
        service.candidateList = [candidate()]
        service.membersList = [
            .init(id: 1, userId: "u1", role: .owner, status: "ACTIVE", displayName: "영희", joinedAt: nil, me: false),
            .init(id: 2, userId: "u2", role: .editor, status: "ACTIVE", displayName: "나", joinedAt: nil, me: true),
            .init(id: 3, userId: "u3", role: .viewer, status: "ACTIVE", displayName: "철수", joinedAt: nil, me: false),
            .init(id: 4, userId: "u4", role: .viewer, status: "ACTIVE", displayName: "민수", joinedAt: nil, me: false)
        ]
        let model = CandidateBoardViewModel(trip: trip(members: 1), service: service, documents: FakeDocumentStore())
        await model.load()
        XCTAssertEqual(model.memberCount, 4, "몇 명이 아직 말하지 않았는지 알려면 인원이 필요하다")
    }

    // MARK: 초대 참여

    func testJoinPreviewThenAccept() async {
        let service = FakeCollabService()
        let model = JoinInviteViewModel(token: String(repeating: "a", count: 32), service: service)
        await model.load()

        XCTAssertTrue(model.verdict.ok)
        XCTAssertEqual(model.preview?.tripName, "바르셀로나")

        model.displayName = "영희"
        await model.accept()
        XCTAssertEqual(service.acceptedNames.last, "영희")
        XCTAssertEqual(model.joined?.clientId, "t1")
    }

    /// 서버가 거절하면 이유를 그대로 말하고 참여하지 않는다.
    func testJoinRejectedShowsTheReason() async {
        let service = FakeCollabService()
        service.acceptResult = InviteAccept(ok: false, reason: "EXPIRED", clientId: nil, tripName: nil, role: nil, alreadyMember: false)
        let model = JoinInviteViewModel(token: String(repeating: "a", count: 32), service: service)
        await model.load()
        await model.accept()

        XCTAssertNil(model.joined)
        XCTAssertTrue(model.errorMessage?.contains("만료") == true)
    }
}

// MARK: - 가짜들

@MainActor
private final class FakeCollabService: CollabSource {
    var membersList: [MemberView] = []
    var candidateList: [CandidateView] = []
    var activityRows: [ActivityView] = []
    var prefRows: [PreferenceView] = [PreferenceView(userId: "u1", label: "나", role: .owner, mine: true, prefs: ["pace": .string("PACKED")])]
    var failure: APIError?
    var failCandidateActions = false
    /// 한마디를 다시 읽는 것만 실패시킨다 — 남기기는 됐는데 목록을 못 읽는 경우.
    var failCommentReads = false
    let issuedToken = String(repeating: "z", count: 32)
    var acceptResult = InviteAccept(ok: true, reason: "OK", clientId: "t1", tripName: "바르셀로나", role: .editor, alreadyMember: false)

    private(set) var inviteListCalls = 0
    private(set) var createdInviteRoles: [MemberRole] = []
    private(set) var didLeave = false
    private(set) var savedPrefs: [[String: JSONValue]] = []
    private(set) var reactions: [(candidateId: Int, reaction: Reaction?)] = []
    private(set) var addedCandidates: [String] = []
    /// 지도에서 담을 때 좌표·placeId·주소가 함께 가는지 보려면 인자를 통째로 봐야 한다.
    private(set) var addedDetails: [(title: String, lat: Double?, lng: Double?, placeId: String?, addr: String?)] = []
    private(set) var candidateActions: [(action: String, value: String?)] = []
    private(set) var acceptedNames: [String?] = []

    private func check() throws { if let failure { throw failure } }

    func members(tripId: String) async throws -> [MemberView] { try check(); return membersList }
    func manageMember(tripId: String, memberId: Int, action: String, value: String?) async throws { try check() }
    func leave(tripId: String) async throws { try check(); didLeave = true }

    func invites(tripId: String) async throws -> [InviteView] { inviteListCalls += 1; try check(); return [] }
    func createInvite(tripId: String, role: MemberRole, hours: Int) async throws -> InviteCreated {
        try check()
        createdInviteRoles.append(role)
        return InviteCreated(id: 1, token: issuedToken, role: role, expiresAt: "2026-09-08T00:00:00.000Z")
    }
    func revokeInvite(tripId: String, inviteId: Int) async throws { try check() }
    func previewInvite(token: String) async throws -> InvitePreview {
        try check()
        return InvitePreview(valid: true, reason: "OK", tripName: "바르셀로나", startDate: "2026-10-01", dayCount: 5,
                             role: .editor, expiresAt: nil, alreadyMember: false)
    }
    func acceptInvite(token: String, displayName: String?) async throws -> InviteAccept {
        try check(); acceptedNames.append(displayName); return acceptResult
    }

    func candidates(tripId: String) async throws -> [CandidateView] { try check(); return candidateList }
    func addCandidate(tripId: String, title: String, note: String?, lat: Double?, lng: Double?, placeId: String?, addr: String?) async throws -> Int {
        try check()
        addedCandidates.append(title)
        addedDetails.append((title, lat, lng, placeId, addr))
        return 99
    }
    func react(tripId: String, candidateId: Int, reaction: Reaction?) async throws {
        try check(); reactions.append((candidateId, reaction))
    }
    func manageCandidate(tripId: String, candidateId: Int, action: String, value: String?) async throws {
        if failCandidateActions { throw APIError.server(status: 500, message: "서버 오류") }
        try check()
        candidateActions.append((action, value))
        // 서버는 SCHEDULE된 후보를 더는 제안하지 않는다(buildGroupProposal은 PROPOSED만 본다).
        // 가짜도 그렇게 굴어야 "수락하면 그 제안이 사라진다"를 진짜로 확인할 수 있다.
        if action == "SCHEDULE", let index = candidateList.firstIndex(where: { $0.id == candidateId }) {
            let c = candidateList[index]
            candidateList[index] = CandidateView(
                id: c.id, title: c.title, placeId: c.placeId, lat: c.lat, lng: c.lng, addr: c.addr, note: c.note,
                url: c.url, status: "SCHEDULED", scheduledRef: value, proposedByLabel: c.proposedByLabel, mine: c.mine,
                myReaction: c.myReaction, mustCount: c.mustCount, okCount: c.okCount, passCount: c.passCount,
                reactions: c.reactions, commentCount: c.commentCount, createdAt: c.createdAt)
        }
    }

    func comments(tripId: String, candidateId: Int) async throws -> [CommentView] {
        try check()
        if failCommentReads { throw APIError.offline }
        return []
    }
    func addComment(tripId: String, candidateId: Int, body: String) async throws { try check() }
    func deleteComment(tripId: String, commentId: Int) async throws { try check() }

    func activity(tripId: String, limit: Int) async throws -> [ActivityView] { try check(); return activityRows }
    /// 판정은 서버가 한다 — 앱 테스트는 "받은 것을 그대로 쓰는가"만 본다.
    var proposalResult: GroupProposalView?
    var failProposal = false
    private(set) var proposalReads = 0
    func realtimeChoice() async throws -> RealtimeChoice { RealtimeChoice(provider: "NONE", url: nil) }
    func groupProposal(tripId: String) async throws -> GroupProposalView? {
        proposalReads += 1
        if failProposal { throw APIError.offline }
        guard let plan = proposalResult else { return nil }
        // 서버와 같은 규칙: 이미 일정에 들어간 후보는 제안하지 않는다.
        let open = plan.picks.filter { pick in
            candidateList.first { $0.id == pick.candidateId }.map { $0.status == "PROPOSED" } ?? false
        }
        guard !open.isEmpty else { return nil }
        return GroupProposalView(summary: plan.summary, picks: open, impact: plan.impact,
                                 options: plan.options, groupNotes: plan.groupNotes)
    }
    func preferences(tripId: String) async throws -> [PreferenceView] { try check(); return prefRows }
    /// 서버는 정규화한 결과를 돌려준다 — 여기서는 '서버가 이긴다'를 보이려 일부러 다른 값을 돌려준다.
    func savePreferences(tripId: String, prefs: [String: JSONValue]) async throws -> [String: JSONValue] {
        try check()
        savedPrefs.append(prefs)
        prefRows = [PreferenceView(userId: "u1", label: "나", role: .owner, mine: true, prefs: ["pace": .string("PACKED")])]
        return prefRows[0].prefs
    }
}

@MainActor
private final class FakeDocumentStore: TripDocumentSource {
    private(set) var saves: [(document: TripDocument, expectedRevision: Int)] = []

    func document(tripId: String) async throws -> TripDocumentSnapshot {
        let raw: [String: JSONValue] = [
            "name": .string("바르셀로나"),
            "days": .array([
                .object(["title": .string("Day 1"), "spots": .array([])]),
                .object(["title": .string("Day 2"), "spots": .array([.object(["name": .string("기존 장소"), "city": .string("바르셀로나")])])]),
                .object(["title": .string("Day 3"), "spots": .array([])])
            ])
        ]
        return TripDocumentSnapshot(document: TripDocument(raw: raw), revision: 7, role: .owner)
    }

    func saveDocument(tripId: String, document: TripDocument, expectedRevision: Int) async throws -> TripDocumentSnapshot {
        saves.append((document, expectedRevision))
        return TripDocumentSnapshot(document: document, revision: expectedRevision + 1, role: .owner)
    }
}
