import XCTest
@testable import TripCanvas

@MainActor
final class CollabFollowupTests: XCTestCase {
    private func trip(_ id: String = "t1", role: MemberRole = .owner) -> TripSummary {
        TripSummary(id: id, name: "파리", start: "2026-10-14", dayCount: 1, revision: 1,
                    updatedAt: "2026-10-14T00:00:00Z", timeZone: "Europe/Paris", cities: ["파리"],
                    todayIndex: 0, daysUntilStart: nil, role: role, memberCount: 2)
    }

    private func board(_ service: FollowupCollabSource, _ documents: FollowupDocuments? = nil) -> CandidateBoardViewModel {
        CandidateBoardViewModel(trip: trip(), service: service, documents: documents ?? FollowupDocuments())
    }

    func testSplitRetryAfterLostDocumentResponseCreatesOnlyOneGroup() async {
        let service = FollowupCollabSource()
        let documents = FollowupDocuments()
        documents.loseNextResponse = true
        let model = board(service, documents)
        await model.load()

        let first = await model.split(candidateId: 1, dayIndex: 0, splitId: "sp-retry")
        let second = await model.split(candidateId: 1, dayIndex: 0, splitId: "sp-retry")

        XCTAssertFalse(first)
        XCTAssertTrue(second)
        XCTAssertEqual(documents.saveCount, 1, "응답을 잃어도 저장된 묶음을 다시 만든다 하지 않는다")
        XCTAssertEqual(documents.snapshot.document.days[0].spots.count, 3)
        XCTAssertEqual(documents.snapshot.document.days[0].spots.first?.raw["candidateId"]?.doubleValue, 1)
    }

    func testSplitRetryAfterMarkingFailureFindsCandidateEvenWithNewPreviewID() async {
        let service = FollowupCollabSource()
        let documents = FollowupDocuments()
        service.failNextMark = true
        let model = board(service, documents)
        await model.load()

        let first = await model.split(candidateId: 1, dayIndex: 0, splitId: "first-preview")
        let second = await model.split(candidateId: 1, dayIndex: 0, splitId: "reopened-preview")

        XCTAssertFalse(first)
        XCTAssertTrue(second)
        XCTAssertEqual(documents.saveCount, 1)
        XCTAssertEqual(documents.snapshot.document.days[0].spots.count, 3)
        XCTAssertEqual(service.markCalls, 2)
    }

    func testSplitRetryAfterLostMarkResponseKeepsScheduledGroup() async {
        let service = FollowupCollabSource()
        let documents = FollowupDocuments()
        service.loseNextMarkResponse = true
        let model = board(service, documents)
        await model.load()

        let first = await model.split(candidateId: 1, dayIndex: 0, splitId: "sp-retry")
        let second = await model.split(candidateId: 1, dayIndex: 0, splitId: "sp-retry")

        XCTAssertFalse(first)
        XCTAssertTrue(second)
        XCTAssertEqual(documents.saveCount, 1)
        XCTAssertEqual(documents.snapshot.document.days[0].spots.count, 3)
    }

    func testLiveCommentReloadsOnlyOpenedThread() async {
        let service = FollowupCollabSource()
        let model = board(service)
        await model.load()
        model.setCommentsOpen(candidateId: 1, isOpen: true)
        await model.loadComments(candidateId: 1)
        service.commentRows = [service.comment("새 한마디")]

        await model.handle(.init(tripId: "t1", id: 2, kind: "COMMENT_ADDED", mine: false))

        XCTAssertEqual(model.comments[1]?.first?.body, "새 한마디")
        XCTAssertEqual(service.commentReads, [1, 1])
        model.setCommentsOpen(candidateId: 1, isOpen: false)
        await model.handle(.init(tripId: "t1", id: 3, kind: "COMMENT_ADDED", mine: false))
        XCTAssertEqual(service.commentReads, [1, 1], "닫힌 댓글을 미리 받지 않는다")
    }

    func testNewReactionSuccessSurvivesOlderDelayedFailure() async {
        let service = FollowupCollabSource()
        let model = board(service)
        await model.load()
        let started = expectation(description: "첫 반응 대기")
        var firstResponse: CheckedContinuation<Void, Error>?
        service.reactionGate = { call in
            if call == 1 {
                try await withCheckedThrowingContinuation { continuation in
                    firstResponse = continuation
                    started.fulfill()
                }
            }
        }
        let first = Task { await model.react(candidateId: 1, reaction: .must) }
        await fulfillment(of: [started], timeout: 1)
        await model.react(candidateId: 1, reaction: .ok)
        XCTAssertEqual(model.candidates.first?.myReaction, "OK")
        firstResponse?.resume(throwing: APIError.offline)
        await first.value

        XCTAssertEqual(model.candidates.first?.myReaction, "OK")
        XCTAssertEqual(service.candidateRows.first?.myReaction, "OK")
        XCTAssertNil(model.errorMessage, "옛 실패가 최신 성공을 실패라고 말하지 않는다")
    }

    func testOlderDelayedSuccessCannotLeaveServerWithOlderReaction() async {
        let service = FollowupCollabSource()
        let model = board(service)
        await model.load()
        let started = expectation(description: "첫 반응 대기")
        var firstResponse: CheckedContinuation<Void, Error>?
        service.reactionGate = { call in
            if call == 1 {
                try await withCheckedThrowingContinuation { continuation in
                    firstResponse = continuation
                    started.fulfill()
                }
            }
        }
        let first = Task { await model.react(candidateId: 1, reaction: .must) }
        await fulfillment(of: [started], timeout: 1)
        await model.react(candidateId: 1, reaction: .ok)
        firstResponse?.resume()
        await first.value

        XCTAssertEqual(model.candidates.first?.myReaction, "OK")
        XCTAssertEqual(service.candidateRows.first?.myReaction, "OK")
        XCTAssertEqual(service.reactionCalls, 3, "서버를 덮은 옛 성공 뒤 마지막 선택을 복구한다")
    }

    func testVisibleBoardCatchesUpMembersAndOpenedCommentsAfterBackground() async {
        let service = FollowupCollabSource()
        let model = board(service)
        await model.load()
        model.isVisible = true
        model.setCommentsOpen(candidateId: 1, isOpen: true)
        service.memberRows = [service.member(role: .viewer)]
        service.commentRows = [service.comment("복귀 뒤 내용")]

        await model.resumeAfterBackground()

        XCTAssertEqual(service.memberReads, 2)
        XCTAssertEqual(model.memberCount, 1)
        XCTAssertFalse(model.canSchedule, "복귀 뒤 변경된 역할을 쓴다")
        XCTAssertEqual(model.comments[1]?.first?.body, "복귀 뒤 내용")
        XCTAssertEqual(service.commentReads, [1])
    }

    func testHiddenBoardInvalidatesWithoutNetworkUntilReopened() async {
        let service = FollowupCollabSource()
        let model = board(service)
        await model.load()
        let reads = service.candidateReads

        await model.resumeAfterBackground()
        XCTAssertEqual(service.candidateReads, reads)
        XCTAssertNil(model.loadedAt)
        await model.loadIfStale()
        XCTAssertEqual(service.candidateReads, reads + 1)
        XCTAssertEqual(service.memberReads, 2)
    }

    func testVisibleCollabCatchesUpAllPanelsAndHiddenOneOnlyInvalidates() async {
        let service = FollowupCollabSource()
        let model = CollabViewModel(trip: trip(), service: service, webBaseURL: URL(string: "https://example.test")!)
        await model.load()
        model.isVisible = true
        await model.resumeAfterBackground()
        XCTAssertEqual(service.memberReads, 2)
        XCTAssertEqual(service.inviteReads, 2)
        XCTAssertEqual(service.preferenceReads, 2)
        XCTAssertEqual(service.activityReads, 2)

        model.isVisible = false
        await model.resumeAfterBackground()
        XCTAssertEqual(service.memberReads, 2)
        XCTAssertNil(model.loadedAt)
        await model.loadIfStale()
        XCTAssertEqual(service.memberReads, 3)
    }

    func testNameDraftSurvivesPreferenceRefreshAndTypingDuringSave() {
        var draft = CollabNameDraft()
        draft.receive("원래 이름")
        draft.text = "입력 중 이름"
        draft.receive("원래 이름")
        XCTAssertEqual(draft.text, "입력 중 이름")
        draft.text = "저장 대기 중 새 이름"
        draft.acknowledge(submitted: "입력 중 이름", serverName: "입력 중 이름")
        XCTAssertEqual(draft.text, "저장 대기 중 새 이름")
        var initial = CollabNameDraft()
        initial.text = "처음 응답보다 먼저 입력"
        initial.receive("서버 이름")
        XCTAssertEqual(initial.text, "처음 응답보다 먼저 입력")
    }

    func testHiddenCollabInvalidationRejectsOldInFlightResponse() async {
        let service = FollowupCollabSource()
        let model = CollabViewModel(trip: trip(), service: service, webBaseURL: URL(string: "https://example.test")!)
        let started = expectation(description: "기존 멤버 조회 대기")
        var pending: CheckedContinuation<[MemberView], Never>?
        service.memberGate = {
            await withCheckedContinuation { continuation in
                pending = continuation
                started.fulfill()
            }
        }
        let load = Task { await model.load() }
        await fulfillment(of: [started], timeout: 1)
        await model.resumeAfterBackground()
        service.memberGate = nil
        pending?.resume(returning: service.memberRows)
        await load.value

        XCTAssertNil(model.loadedAt)
        XCTAssertTrue(model.members.isEmpty, "복귀 전에 시작한 읽기로 무효화된 캐시를 살리지 않는다")
        await model.loadIfStale()
        XCTAssertEqual(service.memberReads, 2)
    }

    func testSuccessfulLeaveClearsNavigationAndPendingRoute() async {
        let service = FollowupCollabSource()
        service.memberRows = [service.member(role: .editor)]
        let model = CollabViewModel(trip: trip(role: .editor), service: service, webBaseURL: URL(string: "https://example.test")!)
        await model.load()
        await model.leave()
        var path = [trip()]
        var panel: TripPanel? = .collab
        var destination: ActionRouter.Destination? = .bookings(tripId: "t1")
        if model.hasLeft {
            TripLeaveNavigation.clear(tripId: "t1", path: &path, requestedPanel: &panel, pendingDestination: &destination)
        }
        XCTAssertTrue(path.isEmpty)
        XCTAssertNil(panel)
        XCTAssertNil(destination)
    }
}

@MainActor
private final class FollowupDocuments: TripDocumentSource {
    var snapshot = TripDocumentSnapshot(document: TripDocument(raw: [
        "name": .string("파리"), "days": .array([.object(["title": .string("Day 1"), "spots": .array([])])])
    ]), revision: 1, role: .owner)
    var saveCount = 0
    var loseNextResponse = false
    func document(tripId: String) async throws -> TripDocumentSnapshot { snapshot }
    func saveDocument(tripId: String, document: TripDocument, expectedRevision: Int) async throws -> TripDocumentSnapshot {
        guard expectedRevision == snapshot.revision else { throw APIError.offline }
        saveCount += 1
        snapshot = .init(document: document, revision: expectedRevision + 1, role: .owner)
        if loseNextResponse { loseNextResponse = false; throw APIError.offline }
        return snapshot
    }
    func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse> { throw APIError.offline }
    func tripRoutes(tripId: String) async throws -> TripRoutesResponse { throw APIError.offline }
    func cachedDayPlan(tripId: String, dayIndex: Int) async -> DayPlanResponse? { nil }
}

@MainActor
private final class FollowupCollabSource: CollabSource {
    var candidateRows = [CandidateView(id: 1, title: "루브르", placeId: nil, lat: nil, lng: nil, addr: nil,
        note: nil, url: nil, status: "PROPOSED", scheduledRef: nil, proposedByLabel: "나", mine: true,
        myReaction: "MUST", mustCount: 1, okCount: 0, passCount: 1,
        reactions: [.init(name: "나", reaction: "MUST", me: true, userId: "me"),
                    .init(name: "일행", reaction: "PASS", me: false, userId: "other")],
        commentCount: 0, createdAt: "2026-10-14T00:00:00Z")]
    var memberRows: [MemberView] = [.init(id: 1, userId: "me", role: .owner, status: "ACTIVE", displayName: "나", joinedAt: nil, me: true)]
    var commentRows: [CommentView] = []
    var candidateReads = 0, memberReads = 0, inviteReads = 0, preferenceReads = 0, activityReads = 0
    var commentReads: [Int] = []
    var reactionCalls = 0, markCalls = 0
    var failNextMark = false, loseNextMarkResponse = false
    var reactionGate: ((Int) async throws -> Void)?
    var memberGate: (() async -> [MemberView])?
    func member(role: MemberRole) -> MemberView { .init(id: 1, userId: "me", role: role, status: "ACTIVE", displayName: "나", joinedAt: nil, me: true) }
    func comment(_ body: String) -> CommentView { .init(id: 1, body: body, authorLabel: "일행", mine: false, createdAt: "2026-10-14T00:00:00Z") }
    func members(tripId: String) async throws -> [MemberView] {
        memberReads += 1
        if let memberGate { return await memberGate() }
        return memberRows
    }
    func candidates(tripId: String) async throws -> [CandidateView] { candidateReads += 1; return candidateRows }
    func react(tripId: String, candidateId: Int, reaction: Reaction?) async throws {
        reactionCalls += 1
        try await reactionGate?(reactionCalls)
        candidateRows[0] = CollabModel.applyingReaction(reaction, to: candidateRows[0], myId: "me")
    }
    func manageCandidate(tripId: String, candidateId: Int, action: String, value: String?) async throws {
        markCalls += 1
        if failNextMark { failNextMark = false; throw APIError.offline }
        if action == "SCHEDULE" {
            let c = candidateRows[0]
            candidateRows[0] = .init(id: c.id, title: c.title, placeId: c.placeId, lat: c.lat, lng: c.lng,
                addr: c.addr, note: c.note, url: c.url, status: "SCHEDULED", scheduledRef: value,
                proposedByLabel: c.proposedByLabel, mine: c.mine, myReaction: c.myReaction,
                mustCount: c.mustCount, okCount: c.okCount, passCount: c.passCount,
                reactions: c.reactions, commentCount: c.commentCount, createdAt: c.createdAt)
        }
        if loseNextMarkResponse { loseNextMarkResponse = false; throw APIError.offline }
    }
    func comments(tripId: String, candidateId: Int) async throws -> [CommentView] { commentReads.append(candidateId); return commentRows }
    func invites(tripId: String) async throws -> [InviteView] { inviteReads += 1; return [] }
    func preferences(tripId: String) async throws -> [PreferenceView] { preferenceReads += 1; return [] }
    func activity(tripId: String, limit: Int) async throws -> [ActivityView] { activityReads += 1; return [] }
    func groupProposal(tripId: String) async throws -> GroupProposalView? { nil }
    func manageMember(tripId: String, memberId: Int, action: String, value: String?) async throws {}
    func leave(tripId: String) async throws {}
    func revokeInvite(tripId: String, inviteId: Int) async throws {}
    func addComment(tripId: String, candidateId: Int, body: String) async throws {}
    func deleteComment(tripId: String, commentId: Int) async throws {}
    func addCandidate(tripId: String, title: String, note: String?, lat: Double?, lng: Double?, placeId: String?, addr: String?) async throws -> Int { 1 }
    func savePreferences(tripId: String, prefs: [String: JSONValue]) async throws -> [String: JSONValue] { prefs }
    func realtimeChoice() async throws -> RealtimeChoice { .init(provider: "NONE", url: nil) }
    func createInvite(tripId: String, role: MemberRole, hours: Int) async throws -> InviteCreated { throw APIError.offline }
    func previewInvite(token: String) async throws -> InvitePreview { throw APIError.offline }
    func acceptInvite(token: String, displayName: String?) async throws -> InviteAccept { throw APIError.offline }
}
