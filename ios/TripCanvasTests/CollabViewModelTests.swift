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
                    todayIndex: 0, daysUntilStart: nil, role: role, memberCount: members)
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

    /// 자유시간으로 분리 — 세 줄이 고른 날 **맨 뒤**에 나란히 붙고, 그 뒤에 후보를 표시한다.
    func testSplitAppendsThreeSpotsToTheChosenDay() async {
        let service = FakeCollabService()
        service.membersList = [
            .init(id: 1, userId: "u1", role: .owner, status: "ACTIVE", displayName: "나", joinedAt: nil, me: true),
            .init(id: 2, userId: "u2", role: .editor, status: "ACTIVE", displayName: "지민", joinedAt: nil, me: false)
        ]
        service.candidateList = [candidate(reactions: [
            .init(name: "나", reaction: "MUST", me: true, userId: "u1"),
            .init(name: "지민", reaction: "PASS", me: false, userId: "u2")
        ])]
        let documents = FakeDocumentStore()
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: documents)
        await model.load()

        let ok = await model.split(candidateId: 1, dayIndex: 1, splitId: "sp1")

        XCTAssertTrue(ok)
        XCTAssertEqual(documents.saves.count, 1)
        XCTAssertEqual(documents.saves.first?.expectedRevision, 7, "CAS로 저장한다")
        let day = documents.saves.first?.document.days[1]
        XCTAssertEqual(day?.spots.map(\.name), ["기존 장소", "카사 바트요", "자유시간", "다시 만나기"], "맨 뒤에 세 줄")
        XCTAssertEqual(day?.spots[1].raw["who"]?.arrayValue?.compactMap(\.stringValue), ["u1"])
        XCTAssertEqual(day?.spots[2].raw["who"]?.arrayValue?.compactMap(\.stringValue), ["u2"])
        XCTAssertEqual(day?.spots[1].raw["split"]?.stringValue, "sp1")
        XCTAssertEqual(day?.spots[2].raw["split"]?.stringValue, "sp1")
        XCTAssertNil(day?.spots[3].raw["split"], "합류는 묶음 밖이다")
        XCTAssertEqual(service.candidateActions.last?.action, "SCHEDULE")
        XCTAssertEqual(service.candidateActions.last?.value, "2", "표시는 1부터 센 날짜")
    }

    /// 한쪽이 비면 갈릴 것이 없다 — 문서를 건드리지 않고 그렇게 말한다.
    func testSplitRefusesWhenOneSideIsEmpty() async {
        let service = FakeCollabService()
        service.candidateList = [candidate(reactions: [.init(name: "나", reaction: "MUST", me: true, userId: "u1")])]
        let documents = FakeDocumentStore()
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: documents)
        await model.load()

        let ok = await model.split(candidateId: 1, dayIndex: 0, splitId: "sp1")

        XCTAssertFalse(ok)
        XCTAssertTrue(documents.saves.isEmpty, "만들 수 없으면 저장도 하지 않는다")
        XCTAssertNotNil(model.errorMessage)
    }

    /// 방금 누른 내 의견에도 id가 실려야 한다 — 내가 만든 충돌에서 내가 빠지지 않는다.
    func testOptimisticReactionCarriesMyUserId() async {
        let service = FakeCollabService()
        service.membersList = [
            .init(id: 1, userId: "u1", role: .owner, status: "ACTIVE", displayName: "나", joinedAt: nil, me: true),
            .init(id: 2, userId: "u2", role: .editor, status: "ACTIVE", displayName: "지민", joinedAt: nil, me: false)
        ]
        service.candidateList = [candidate(reactions: [.init(name: "지민", reaction: "PASS", me: false, userId: "u2")])]
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: FakeDocumentStore())
        await model.load()

        await model.react(candidateId: 1, reaction: .must)

        let mine = model.candidates.first?.reactions.first(where: { $0.me })
        XCTAssertEqual(mine?.userId, "u1")
        // 그래서 서버를 다시 읽기 전에도 나눌 수 있는 충돌로 보인다
        let conflict = CollabModel.conflict(model.candidates[0], memberCount: 2)
        XCTAssertEqual(conflict?.goers, ["u1"])
        XCTAssertEqual(conflict?.others, ["u2"])
        XCTAssertEqual(conflict?.options[1].action, "SPLIT")
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

    func testScheduleMovesAnExistingCandidateAndPreservesItsEditedFields() async {
        let service = FakeCollabService()
        service.candidateList = [candidate()]
        let documents = FakeDocumentStore()
        var document = documents.snapshot.document
        var existing = CandidateBoardViewModel.spot(from: candidate())
        existing.stayMinutes = 0
        existing.setField("cost", .number(0))
        existing.setField("bookAt", .string("14:00"))
        existing.setField("bookingId", .string("booking-1"))
        existing.setField("who", .array([.string("u1")]))
        existing.setField("custom", .object(["keep": .bool(true)]))
        document.insertSpot(existing, dayIndex: 0)
        documents.snapshot = .init(document: document, revision: 8, role: .owner)
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: documents)
        await model.load()

        // 문서에는 넣었지만 후보 표시는 아직 PROPOSED인 상태에서 다른 날로 다시 배치한다.
        let saved = await model.schedule(candidateId: 1, dayIndex: 1, position: 0, expectedRevision: 8)

        XCTAssertTrue(saved)
        XCTAssertTrue(documents.snapshot.document.days[0].spots.isEmpty)
        XCTAssertEqual(documents.snapshot.document.days[1].spots.map(\.name), ["카사 바트요", "기존 장소"])
        XCTAssertEqual(documents.snapshot.document.days[1].spots.first?.raw, existing.raw, "예약·0분·비용·알 수 없는 필드까지 원문을 옮긴다")
        XCTAssertEqual(documents.saves.count, 1)
        XCTAssertEqual(service.candidateActions.last?.value, "2")
    }

    func testScheduleRepositionsAnExistingCandidateWithinTheSameDay() async {
        let service = FakeCollabService()
        service.candidateList = [candidate()]
        let documents = FakeDocumentStore()
        var document = documents.snapshot.document
        document.insertSpot(CandidateBoardViewModel.spot(from: candidate()), dayIndex: 1)
        documents.snapshot = .init(document: document, revision: 8, role: .owner)
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: documents)
        await model.load()

        let saved = await model.schedule(candidateId: 1, dayIndex: 1, position: 0, expectedRevision: 8)

        XCTAssertTrue(saved)
        XCTAssertEqual(documents.snapshot.document.days[1].spots.map(\.name), ["카사 바트요", "기존 장소"])
        XCTAssertEqual(documents.snapshot.document.days[1].spots.count, 2, "같은 날에도 복제하지 않는다")
    }

    func testScheduleDoesNotClaimToMoveALegacyCandidateWithoutALinkedSpot() async {
        let service = FakeCollabService()
        service.candidateList = [candidate(status: "SCHEDULED")]
        let documents = FakeDocumentStore()
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: documents)
        await model.load()

        let saved = await model.schedule(candidateId: 1, dayIndex: 1)

        XCTAssertFalse(saved)
        XCTAssertTrue(documents.saves.isEmpty)
        XCTAssertTrue(service.candidateActions.isEmpty)
        XCTAssertTrue(model.errorMessage?.contains("연결된 장소를 찾지 못했어요") == true)
        XCTAssertNil(model.toast)
    }

    func testScheduleKeepsTheOriginalPositionWhenThePreviewRevisionIsStale() async {
        let service = FakeCollabService()
        service.candidateList = [candidate()]
        let documents = FakeDocumentStore()
        var document = documents.snapshot.document
        document.insertSpot(CandidateBoardViewModel.spot(from: candidate()), dayIndex: 0)
        documents.snapshot = .init(document: document, revision: 8, role: .owner)
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: documents)
        await model.load()

        let saved = await model.schedule(candidateId: 1, dayIndex: 1, position: 0, expectedRevision: 7)

        XCTAssertFalse(saved)
        XCTAssertEqual(documents.snapshot.document, document)
        XCTAssertTrue(documents.saves.isEmpty)
        XCTAssertTrue(service.candidateActions.isEmpty)
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

    func testProposalRetryAfterALostSaveResponseDoesNotDuplicatePlaces() async {
        let service = FakeCollabService()
        service.candidateList = [candidate()]
        service.proposalResult = proposal([(1, 1, "카사 바트요")])
        let documents = FakeDocumentStore()
        documents.loseNextSaveResponse = true
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: documents)
        await model.load()

        await model.acceptProposal()
        XCTAssertNotNil(model.errorMessage)
        XCTAssertTrue(service.candidateActions.isEmpty)
        XCTAssertNotNil(model.proposal, "응답이 끊긴 제안은 재시도할 수 있다")
        await model.acceptProposal()

        XCTAssertEqual(documents.saves.count, 1, "최신 문서에 이미 있으면 다시 저장하지 않는다")
        XCTAssertEqual(documents.snapshot.document.days[1].spots.map(\.name), ["기존 장소", "카사 바트요"])
        XCTAssertEqual(service.candidateActions.last?.value, "2")
        XCTAssertNil(model.errorMessage)
        XCTAssertNil(model.proposal)
    }

    func testProposalRetryRepairsTheActualDayAfterCandidateMarkingFailed() async {
        let service = FakeCollabService()
        service.candidateList = [candidate()]
        service.proposalResult = proposal([(1, 1, "카사 바트요")])
        service.failCandidateActions = true
        let documents = FakeDocumentStore()
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: documents)
        await model.load()
        await model.acceptProposal()

        // 오래된 서버/응답이 다른 날짜를 다시 제안해도 기존 장소의 실제 위치를 우선한다.
        service.failCandidateActions = false
        service.proposalResult = proposal([(1, 2, "카사 바트요")])
        await model.load()
        await model.acceptProposal()

        XCTAssertEqual(documents.saves.count, 1)
        XCTAssertEqual(documents.snapshot.document.days[1].spots.map(\.name), ["기존 장소", "카사 바트요"])
        XCTAssertTrue(documents.snapshot.document.days[2].spots.isEmpty)
        XCTAssertEqual(service.candidateActions.last?.value, "2", "새 제안의 Day 3이 아니라 실제 Day 2의 표시를 복구한다")
        XCTAssertNil(model.errorMessage)
    }

    func testFreshViewerRoleBlocksBothIndividualAndGroupPlacement() async {
        let service = FakeCollabService()
        service.candidateList = [candidate()]
        service.proposalResult = proposal([(1, 1, "카사 바트요")])
        let documents = FakeDocumentStore()
        documents.snapshot = .init(document: documents.snapshot.document, revision: 8, role: .viewer)
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: documents)
        await model.load()

        let saved = await model.schedule(candidateId: 1, dayIndex: 1)
        await model.acceptProposal()

        XCTAssertFalse(saved)
        XCTAssertTrue(documents.saves.isEmpty, "여행 목록의 예전 OWNER 권한을 믿고 쓰지 않는다")
        XCTAssertTrue(service.candidateActions.isEmpty)
        XCTAssertTrue(model.errorMessage?.contains("권한") == true)
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
final class FakeCollabService: CollabSource {
    var membersList: [MemberView] = []
    var candidateList: [CandidateView] = []
    var activityRows: [ActivityView] = []
    var prefRows: [PreferenceView] = [PreferenceView(userId: "u1", label: "나", role: .owner, mine: true, prefs: ["pace": .string("PACKED")])]
    var failure: APIError?
    var failCandidateActions = false
    var candidateReads: (() async throws -> [CandidateView])?
    private(set) var candidateWriteKeys: [String] = []
    /// 한마디를 다시 읽는 것만 실패시킨다 — 남기기는 됐는데 목록을 못 읽는 경우.
    var failCommentReads = false
    let issuedToken = String(repeating: "z", count: 32)
    var acceptResult = InviteAccept(ok: true, reason: "OK", clientId: "t1", tripName: "바르셀로나", role: .editor, alreadyMember: false)

    private(set) var inviteListCalls = 0
    private(set) var memberListCalls = 0
    private(set) var prefListCalls = 0
    private(set) var activityCalls = 0
    private(set) var candidateListCalls = 0
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

    func members(tripId: String) async throws -> [MemberView] { memberListCalls += 1; try check(); return membersList }
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

    func candidates(tripId: String) async throws -> [CandidateView] {
        candidateListCalls += 1
        if let candidateReads { return try await candidateReads() }
        try check(); return candidateList
    }
    func addCandidate(tripId: String, title: String, note: String?, lat: Double?, lng: Double?, placeId: String?, addr: String?, provider: String?, providerId: String?, clientKey: String) async throws -> Int {
        candidateWriteKeys.append(clientKey)
        return try await addCandidate(tripId: tripId, title: title, note: note, lat: lat, lng: lng, placeId: placeId, addr: addr)
    }
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

    func activity(tripId: String, limit: Int) async throws -> [ActivityView] { activityCalls += 1; try check(); return activityRows }
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
    func preferences(tripId: String) async throws -> [PreferenceView] { prefListCalls += 1; try check(); return prefRows }
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
    var snapshot: TripDocumentSnapshot
    var loseNextSaveResponse = false

    init() {
        let raw: [String: JSONValue] = [
            "name": .string("바르셀로나"),
            "days": .array([
                .object(["title": .string("Day 1"), "spots": .array([])]),
                .object(["title": .string("Day 2"), "spots": .array([.object(["name": .string("기존 장소"), "city": .string("바르셀로나")])])]),
                .object(["title": .string("Day 3"), "spots": .array([])])
            ])
        ]
        snapshot = TripDocumentSnapshot(document: TripDocument(raw: raw), revision: 7, role: .owner)
    }

    func document(tripId: String) async throws -> TripDocumentSnapshot { snapshot }

    func saveDocument(tripId: String, document: TripDocument, expectedRevision: Int) async throws -> TripDocumentSnapshot {
        guard snapshot.revision == expectedRevision else {
            throw APIError.revisionConflict(message: "다른 기기에서 먼저 바뀌었어요", revision: snapshot.revision)
        }
        saves.append((document, expectedRevision))
        snapshot = TripDocumentSnapshot(document: document, revision: expectedRevision + 1, role: snapshot.role)
        if loseNextSaveResponse { loseNextSaveResponse = false; throw APIError.offline }
        return snapshot
    }

    /// 이 테스트는 서버 계산을 쓰지 않는다 — 계산이 없어도 일정 편집은 그대로 돈다.
    func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse> {
        throw APIError.notFound("일자 계획 없음")
    }
    /// 전체 동선·지난 계산은 이 테스트의 관심사가 아니다 — 프로토콜을 채우기만 한다.
    func tripRoutes(tripId: String) async throws -> TripRoutesResponse { throw APIError.offline }
    func cachedDayPlan(tripId: String, dayIndex: Int) async -> DayPlanResponse? { nil }

}

// MARK: - 다시 읽는 것을 고른다 (2026-09-18 네트워크 감사)
//
// 변경마다 전부를 다시 읽었다 — 이름 하나에 4건, 반응 하나에 3건, 후보 하나 넣는 데 13~15건.
// 여기서 지키는 것: 바뀐 것만 다시 읽는다 / 방금 받은 것은 다시 받지 않는다 / 아는 후보로 시작하면 목록을 읽지 않는다.

extension CollabViewModelTests {

    func testRenameReloadsOnlyMembersAndActivity() async {
        let service = FakeCollabService()
        service.membersList = [.init(id: 2, userId: "u2", role: .owner, status: "ACTIVE", displayName: "나", joinedAt: nil, me: true)]
        let model = CollabViewModel(trip: trip(), service: service, webBaseURL: URL(string: "https://example.test/")!)
        await model.load()
        let members = service.memberListCalls, prefs = service.prefListCalls, activity = service.activityCalls, invites = service.inviteListCalls

        await model.rename("근영")

        XCTAssertEqual(service.memberListCalls, members + 1)
        XCTAssertEqual(service.activityCalls, activity + 1)
        XCTAssertEqual(service.prefListCalls, prefs, "취향은 바뀌지 않았다")
        XCTAssertEqual(service.inviteListCalls, invites, "초대도 바뀌지 않았다")
    }

    /// 초대 취소는 활동 기록에 남지 않는다 — 초대 목록만 다시 읽는다.
    func testRevokingAnInviteReloadsOnlyInvites() async {
        let service = FakeCollabService()
        service.membersList = [.init(id: 2, userId: "u2", role: .owner, status: "ACTIVE", displayName: "나", joinedAt: nil, me: true)]
        let model = CollabViewModel(trip: trip(), service: service, webBaseURL: URL(string: "https://example.test/")!)
        await model.load()
        let members = service.memberListCalls, activity = service.activityCalls, invites = service.inviteListCalls

        await model.revokeInvite(id: 1)

        XCTAssertEqual(service.inviteListCalls, invites + 1)
        XCTAssertEqual(service.memberListCalls, members)
        XCTAssertEqual(service.activityCalls, activity)
    }

    /// 시트를 닫았다 바로 열면 다시 받지 않는다 — Today·Plan과 같은 60초 규칙.
    func testReopeningTheSheetSoonDoesNotReload() async {
        let service = FakeCollabService()
        service.membersList = [.init(id: 2, userId: "u2", role: .owner, status: "ACTIVE", displayName: "나", joinedAt: nil, me: true)]
        let model = CollabViewModel(trip: trip(), service: service, webBaseURL: URL(string: "https://example.test/")!)
        await model.loadIfStale()
        await model.loadIfStale()
        XCTAssertEqual(service.memberListCalls, 1, "방금 받았으면 다시 묻지 않는다")
        await model.loadIfStale(now: Date().addingTimeInterval(120))
        XCTAssertEqual(service.memberListCalls, 2, "오래됐으면 새로 받는다")

        let board = CandidateBoardViewModel(trip: trip(), service: service, documents: FakeDocumentStore())
        await board.loadIfStale()
        await board.loadIfStale()
        XCTAssertEqual(service.candidateListCalls, 1)
        await board.loadIfStale(now: Date().addingTimeInterval(120))
        XCTAssertEqual(service.candidateListCalls, 2)
    }

    /// 지도의 배치 흐름 — 이미 아는 후보로 시작하면 목록·인원·제안을 읽지 않고 넣는다.
    func testSeededBoardSchedulesWithoutReadingTheList() async {
        let service = FakeCollabService()
        let documents = FakeDocumentStore()
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: documents, seed: [candidate()])

        let saved = await model.schedule(candidateId: 1, dayIndex: 1, reloadAfter: false)

        XCTAssertTrue(saved)
        XCTAssertEqual(service.candidateListCalls, 0, "목록을 읽지 않는다")
        XCTAssertEqual(service.proposalReads, 0)
        XCTAssertEqual(service.memberListCalls, 0)
        XCTAssertEqual(documents.saves.count, 1)
        XCTAssertEqual(service.candidateActions.last?.action, "SCHEDULE")
    }

    /// 목록이 그대로면 제안도 그대로다 — 다시 묻지 않는다. 인원은 처음 한 번과 멤버 이벤트 때만.
    func testUnchangedListDoesNotAskForProposalOrMembersAgain() async {
        let service = FakeCollabService()
        service.candidateList = [candidate()]
        service.membersList = [
            .init(id: 1, userId: "u1", role: .owner, status: "ACTIVE", displayName: "영희", joinedAt: nil, me: false),
            .init(id: 2, userId: "u2", role: .editor, status: "ACTIVE", displayName: "나", joinedAt: nil, me: true)
        ]
        service.proposalResult = proposal([(1, 1, "카사 바트요")])
        let model = CandidateBoardViewModel(trip: trip(), service: service, documents: FakeDocumentStore())
        await model.load()
        await model.load()

        XCTAssertEqual(service.candidateListCalls, 2)
        XCTAssertEqual(service.proposalReads, 1, "목록이 그대로면 제안을 다시 묻지 않는다")
        XCTAssertEqual(service.memberListCalls, 1, "인원은 처음 한 번")
        XCTAssertEqual(model.memberCount, 2)

        await model.handle(RealtimeActivity(tripId: "t1", id: 5, kind: "MEMBER_JOINED", mine: false))
        XCTAssertEqual(service.memberListCalls, 2, "멤버 이벤트가 오면 그때 다시 읽는다")
        XCTAssertEqual(service.candidateListCalls, 2, "멤버 이벤트는 후보 목록을 건드리지 않는다")
    }
}
