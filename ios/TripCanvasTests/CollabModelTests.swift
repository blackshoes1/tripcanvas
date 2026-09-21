import XCTest
@testable import TripCanvas

/// 함께하기 판정 — `collab.js`와 **같은 답**이 나와야 한다(`test/collab.test.js`의 짝).
/// 두 벌이 갈리면 같은 후보를 두고 웹과 앱이 다른 말을 한다.
final class CollabModelTests: XCTestCase {
    private func candidate(id: Int = 1, must: Int = 0, ok: Int = 0, pass: Int = 0,
                           status: String = "PROPOSED", mine: Bool = false, myReaction: String? = nil,
                           createdAt: String = "2026-09-01T00:00:00.000Z") -> CandidateView {
        var reactions: [CandidateView.ReactionEntry] = []
        // 서버는 반응마다 user_id를 함께 준다 — 분리(§25)가 이름이 아니라 id로 가르기 때문이다.
        for i in 0..<must { reactions.append(.init(name: "M\(i)", reaction: "MUST", me: false, userId: "m\(i)")) }
        for i in 0..<ok { reactions.append(.init(name: "O\(i)", reaction: "OK", me: false, userId: "o\(i)")) }
        for i in 0..<pass { reactions.append(.init(name: "P\(i)", reaction: "PASS", me: false, userId: "p\(i)")) }
        return CandidateView(
            id: id, title: "카사 바트요", placeId: nil, lat: nil, lng: nil, addr: nil, note: nil, url: nil,
            status: status, scheduledRef: nil, proposedByLabel: "영희", mine: mine, myReaction: myReaction,
            mustCount: must, okCount: ok, passCount: pass, reactions: reactions, commentCount: 0, createdAt: createdAt)
    }

    // MARK: 역할 — 보기 권한은 의견만 낸다

    func testRoleRules() {
        XCTAssertTrue(CollabModel.canEdit(.owner))
        XCTAssertTrue(CollabModel.canEdit(.editor))
        XCTAssertFalse(CollabModel.canEdit(.viewer))
        XCTAssertFalse(CollabModel.canEdit(.unknown))

        XCTAssertTrue(CollabModel.canManage(.owner))
        XCTAssertFalse(CollabModel.canManage(.editor))

        // 소유자는 못 나간다(§71)
        XCTAssertFalse(CollabModel.canLeave(.owner))
        XCTAssertTrue(CollabModel.canLeave(.editor))
        XCTAssertTrue(CollabModel.canLeave(.viewer))

        // 의견은 활성 멤버 전원, 내용을 만드는 것은 편집 권한
        XCTAssertTrue(CollabModel.canReact(.viewer))
        XCTAssertTrue(CollabModel.canComment(.viewer))
        XCTAssertFalse(CollabModel.canPropose(.viewer))
        XCTAssertFalse(CollabModel.canScheduleCandidate(.viewer))

        // 후보를 빼는 기준은 역할이 아니라 '누가 냈는가'
        XCTAssertTrue(CollabModel.canRemoveCandidate(.viewer, mine: true))
        XCTAssertFalse(CollabModel.canRemoveCandidate(.editor, mine: false))
        XCTAssertTrue(CollabModel.canRemoveCandidate(.owner, mine: false))
    }

    func testMemberNameNeverFallsBackToEmail() {
        let named = MemberView(id: 1, userId: "u1", role: .editor, status: "ACTIVE", displayName: "영희", joinedAt: nil, me: false)
        XCTAssertEqual(CollabModel.memberName(named), "영희")
        let ownerNoName = MemberView(id: 2, userId: "u2", role: .owner, status: "ACTIVE", displayName: "  ", joinedAt: nil, me: true)
        XCTAssertEqual(CollabModel.memberName(ownerNoName), "주최자")
        let memberNoName = MemberView(id: 3, userId: "u3", role: .viewer, status: "ACTIVE", displayName: nil, joinedAt: nil, me: false)
        XCTAssertEqual(CollabModel.memberName(memberNoName), "멤버")
        XCTAssertEqual(CollabModel.displayNameFromEmail("blackshoes85@gmail.com"), "blackshoes85")
        XCTAssertEqual(CollabModel.displayNameFromEmail(nil), "")
    }

    // MARK: 초대 링크 — 토큰만 싣는다

    func testInviteLinkCarriesOnlyTheToken() {
        let link = CollabModel.inviteLink(webBase: URL(string: "https://tripcanvas-ai.vercel.app/#something")!, token: "abc_123-XYZ")
        XCTAssertEqual(link, "https://tripcanvas-ai.vercel.app/#join=abc_123-XYZ")
        XCTAssertFalse(link.contains("something"))
    }

    func testJoinTokenParsing() {
        let token = String(repeating: "a", count: 32)
        XCTAssertEqual(CollabModel.joinToken(from: "https://tripcanvas-ai.vercel.app/#join=\(token)"), token)
        XCTAssertEqual(CollabModel.joinToken(from: "tripcanvas://join/\(token)"), token)
        XCTAssertEqual(CollabModel.joinToken(from: "  \(token)  "), token)
        // 형식이 어긋나면 서버에 보내지 않는다
        XCTAssertNil(CollabModel.joinToken(from: "short"))
        XCTAssertNil(CollabModel.joinToken(from: "https://x/#join=has space here that is long"))
        XCTAssertNil(CollabModel.joinToken(from: ""))
        XCTAssertNil(CollabModel.joinToken(from: "https://tripcanvas-ai.vercel.app/#v=abcdefghijklmnop"))
    }

    func testInviteVerdictSpeaksTheReason() {
        func preview(valid: Bool, reason: String, already: Bool = false) -> InvitePreview {
            InvitePreview(valid: valid, reason: reason, tripName: "바르셀로나", startDate: "2026-10-25", dayCount: 14,
                          role: .editor, expiresAt: nil, alreadyMember: already)
        }
        XCTAssertTrue(CollabModel.inviteVerdict(preview(valid: true, reason: "OK")).ok)
        XCTAssertEqual(CollabModel.inviteVerdict(preview(valid: true, reason: "OK")).text, "")

        let expired = CollabModel.inviteVerdict(preview(valid: false, reason: "EXPIRED"))
        XCTAssertFalse(expired.ok)
        XCTAssertTrue(expired.text.contains("만료"))

        let removed = CollabModel.inviteVerdict(preview(valid: false, reason: "REMOVED"))
        XCTAssertTrue(removed.text.contains("내보내진"))

        let already = CollabModel.inviteVerdict(preview(valid: true, reason: "OK", already: true))
        XCTAssertTrue(already.ok)
        XCTAssertTrue(already.alreadyMember)

        // 못 읽었으면 '올바르지 않다'가 아니라 '못 불러왔다'
        XCTAssertTrue(CollabModel.inviteVerdict(nil).text.contains("불러오지 못했"))
    }

    func testInviteRangeText() {
        XCTAssertEqual(CollabModel.inviteRangeText(start: "2026-10-25", dayCount: 14), "10/25 ~ 11/7 · 14일")
        XCTAssertEqual(CollabModel.inviteRangeText(start: "2026-10-25", dayCount: 1), "10/25 · 1일")
        XCTAssertEqual(CollabModel.inviteRangeText(start: nil, dayCount: 3), "3일")
        XCTAssertEqual(CollabModel.inviteRangeText(start: nil, dayCount: nil), "")
    }

    // MARK: 집계 · 상태 — §91 fixture

    func testMoodFixture() {
        // 전원 MUST(3명 중 3명) — 다들 좋아해요
        XCTAssertEqual(CollabModel.mood(candidate(must: 3), memberCount: 3), .loved)
        // MUST + OK, 전원이 말했고 반대 없음
        XCTAssertEqual(CollabModel.mood(candidate(must: 1, ok: 2), memberCount: 3), .loved)
        // MUST와 PASS가 같이 — 갈림
        XCTAssertEqual(CollabModel.mood(candidate(must: 2, ok: 1, pass: 1), memberCount: 4), .split)
        // 전원 PASS — 아무도 안 끌림
        XCTAssertEqual(CollabModel.mood(candidate(pass: 3), memberCount: 3), .cool)
        // 아무도 말하지 않음
        XCTAssertEqual(CollabModel.mood(candidate(), memberCount: 4), .none)
        // 둘이 좋다고 넷의 마음을 말하지 않는다 — 아직 다 말하지 않았으면 QUIET
        XCTAssertEqual(CollabModel.mood(candidate(must: 2), memberCount: 4), .quiet)
    }

    /// §20의 예 — A(MUST2·OK1·PASS1)는 CONFLICT, B(MUST1·OK3)는 GOOD_MATCH. B가 위다.
    func testConsensusRanksNoOppositionAboveConflict() {
        let a = candidate(id: 1, must: 2, ok: 1, pass: 1)
        let b = candidate(id: 2, must: 1, ok: 3)
        let ca = CollabModel.consensus(a, memberCount: 4), cb = CollabModel.consensus(b, memberCount: 4)
        XCTAssertEqual(ca.status, .conflict)
        XCTAssertEqual(cb.status, .goodMatch)

        let sorted = CollabModel.sorted([a, b], byInterest: true, memberCount: 4)
        XCTAssertEqual(sorted.first?.id, 2, "반대가 있는 쪽을 '잘 맞는다'고 하지 않는다")
    }

    func testConsensusStatusFixture() {
        XCTAssertEqual(CollabModel.consensus(candidate(must: 3), memberCount: 3).status, .strongMatch)
        XCTAssertEqual(CollabModel.consensus(candidate(must: 1, ok: 3), memberCount: 4).status, .goodMatch)
        XCTAssertEqual(CollabModel.consensus(candidate(ok: 1, pass: 1), memberCount: 4).status, .mixed)
        XCTAssertEqual(CollabModel.consensus(candidate(must: 1, pass: 1), memberCount: 4).status, .conflict)
        XCTAssertNil(CollabModel.consensus(candidate(), memberCount: 4).status)
        // 아직 말하지 않은 사람만큼 확신이 줄어든다
        let full = CollabModel.consensus(candidate(must: 2), memberCount: 2).score
        let partial = CollabModel.consensus(candidate(must: 2), memberCount: 4).score
        XCTAssertGreaterThan(full, partial)
    }

    /// 점수는 내부값이다 — 화면에 나가는 문장에는 숫자가 없다(§21·§22).
    func testVerdictTextHasNoNumbers() {
        for c in [candidate(must: 3), candidate(must: 2, pass: 1), candidate(ok: 2, pass: 1), candidate(), candidate(must: 1)] {
            let text = CollabModel.verdict(c, memberCount: 4).text
            XCTAssertFalse(text.contains(where: \.isNumber), text)
        }
        for status in [ConsensusStatus.strongMatch, .goodMatch, .mixed, .conflict] {
            XCTAssertFalse(status.text.contains(where: \.isNumber), status.text)
        }
    }

    /// 한 명의 하트로 합의를 말하지 않는다 — 두 명 이상일 때만 합의 문장.
    func testVerdictNeedsTwoVoicesForConsensusText() {
        XCTAssertEqual(CollabModel.verdict(candidate(must: 1), memberCount: 4).text, CandidateMood.quiet.text)
        XCTAssertEqual(CollabModel.verdict(candidate(must: 1, ok: 1), memberCount: 4).text, ConsensusStatus.goodMatch.text)
    }

    func testGroupsPutUndecidedFirstAndSeparateDecided() {
        let list = [
            candidate(id: 1, must: 2, pass: 1),                       // split → 의견 필요
            candidate(id: 2, must: 3),                                // loved
            candidate(id: 3, pass: 2),                                // cool
            candidate(id: 4, must: 1, status: "SCHEDULED"),
            candidate(id: 5, must: 1, pass: 1, status: "REJECTED")
        ]
        let groups = CollabModel.grouped(list, memberCount: 3)
        XCTAssertEqual(groups.needsOpinion.map(\.id), [1])
        XCTAssertEqual(groups.loved.map(\.id), [2])
        XCTAssertEqual(groups.resting.map(\.id), [3])
        XCTAssertEqual(groups.scheduled.map(\.id), [4])
        XCTAssertEqual(groups.rejected.map(\.id), [5])
    }

    func testSortIsStableAcrossRenders() {
        let a = candidate(id: 1, must: 1, createdAt: "2026-09-01T00:00:00.000Z")
        let b = candidate(id: 2, must: 1, createdAt: "2026-09-02T00:00:00.000Z")
        let first = CollabModel.sorted([a, b], byInterest: true, memberCount: 3).map(\.id)
        let again = CollabModel.sorted([b, a], byInterest: true, memberCount: 3).map(\.id)
        XCTAssertEqual(first, again)
        XCTAssertEqual(CollabModel.sorted([a, b], byInterest: false, memberCount: 3).map(\.id), [2, 1], "최근 순")
    }

    // MARK: 충돌 — 자동으로 빼지 않는다

    func testConflictOnlyWhenMustAndPassTogether() {
        XCTAssertNil(CollabModel.conflict(candidate(must: 2), memberCount: 3))
        XCTAssertNil(CollabModel.conflict(candidate(ok: 1, pass: 2), memberCount: 3))
        let conflict = CollabModel.conflict(candidate(must: 2, ok: 1, pass: 1), memberCount: 4)
        XCTAssertNotNil(conflict)
        XCTAssertEqual(conflict?.must.count, 2)
        XCTAssertEqual(conflict?.pass.count, 1)

        // 이미 결정된 것은 다시 묻지 않는다
        XCTAssertNil(CollabModel.conflict(candidate(must: 1, pass: 1, status: "REJECTED"), memberCount: 3))

        let options = conflict?.options ?? []
        XCTAssertEqual(options.map(\.key), [.together, .split, .skip])
        XCTAssertEqual(options[0].action, "SCHEDULE")
        XCTAssertEqual(options[1].action, "SPLIT", "셋 다 실제 동작이다 — 분리만 안내로 남지 않는다")
        XCTAssertEqual(options[2].action, "REJECT")
        XCTAssertFalse(options[1].text.contains("다음 단계"))
        XCTAssertEqual(conflict?.goers, ["m0", "m1", "o0"], "가고 싶은 쪽은 MUST 다음 OK")
        XCTAssertEqual(conflict?.others, ["p0"])
    }

    /// id가 없으면 누가 어느 쪽인지 모른다 — 만들 수 없는 것을 권하지 않는다.
    func testConflictWithoutReactorIdsOffersNoSplit() {
        let nameOnly = CandidateView(
            id: 1, title: "캄프 누", placeId: nil, lat: nil, lng: nil, addr: nil, note: nil, url: nil,
            status: "PROPOSED", scheduledRef: nil, proposedByLabel: "영희", mine: false, myReaction: nil,
            mustCount: 1, okCount: 0, passCount: 1,
            reactions: [.init(name: "민수", reaction: "MUST", me: false),
                        .init(name: "영희", reaction: "PASS", me: false)],
            commentCount: 0, createdAt: "2026-09-01T00:00:00.000Z")
        let conflict = CollabModel.conflict(nameOnly, memberCount: 2)
        XCTAssertNotNil(conflict, "이름으로는 여전히 갈린 것이 보인다")
        XCTAssertEqual(conflict?.isSplittable, false)
        XCTAssertNil(conflict?.options[1].action)
        XCTAssertNil(CollabModel.buildSplitPlan(nameOnly, members: [], splitId: "sp1"))
    }

    // MARK: 분리 — 미리보기다. 넣기 전에는 저장되지 않는다

    func testSplitPlanSplitsByIdAndAddsFreeTimeAndReunion() {
        let members = [
            MemberView(id: 1, userId: "m0", role: .owner, status: "ACTIVE", displayName: "민수", joinedAt: nil, me: true),
            MemberView(id: 2, userId: "o0", role: .editor, status: "ACTIVE", displayName: "현우", joinedAt: nil, me: false),
            MemberView(id: 3, userId: "p0", role: .editor, status: "ACTIVE", displayName: "지민", joinedAt: nil, me: false)
        ]
        guard let plan = CollabModel.buildSplitPlan(candidate(must: 1, ok: 1, pass: 1),
                                                   members: members, splitId: "sp1") else {
            XCTFail("양쪽에 사람이 있으면 계획이 나와야 한다"); return
        }
        XCTAssertEqual(plan.goers, ["m0", "o0"], "MUST 다음에 OK")
        XCTAssertEqual(plan.others, ["p0"])
        XCTAssertEqual(plan.spots.map(\.name), ["카사 바트요", "자유시간", "다시 만나기"])
        XCTAssertEqual(plan.spots[0].raw["who"]?.arrayValue?.compactMap(\.stringValue), ["m0", "o0"])
        XCTAssertEqual(plan.spots[1].raw["who"]?.arrayValue?.compactMap(\.stringValue), ["p0"])
        XCTAssertEqual(plan.spots[0].raw["split"]?.stringValue, "sp1")
        XCTAssertEqual(plan.spots[1].raw["split"]?.stringValue, "sp1", "같은 묶음이라 나란히 일어난다")
        XCTAssertNil(plan.spots[2].raw["split"], "합류는 묶음 밖 — 다 모인 뒤다")
        XCTAssertEqual(plan.spots[2].raw["reunion"]?.boolValue, true)
        XCTAssertNil(plan.spots[1].point, "자유시간에는 장소를 정해 주지 않는다")
        // ⚠️ m0은 나다 — 이름표 규칙이 **나를 '나'로 부르고 맨 앞에 둔다**(§26). '민수'는 나오지 않는다.
        XCTAssertEqual(plan.text, "나, 현우은(는) 카사 바트요, 지민은(는) 자유시간 — 끝나면 다시 만나요")
    }

    func testSplitPlanNeedsBothSides() {
        XCTAssertNil(CollabModel.buildSplitPlan(candidate(must: 2, ok: 1), members: [], splitId: "sp1"),
                     "반대가 없으면 다 같이 간다")
        XCTAssertNil(CollabModel.buildSplitPlan(candidate(pass: 2), members: [], splitId: "sp1"),
                     "가고 싶은 사람이 없으면 아무도 안 간다")
    }

    /// 같은 묶음 키를 주면 같은 답이다 — 미리보기와 저장본이 갈리지 않는다.
    func testSplitPlanIsDeterministicForTheSameSplitId() {
        let c = candidate(must: 1, pass: 1)
        XCTAssertEqual(CollabModel.buildSplitPlan(c, members: [], splitId: "fixed")?.spots,
                       CollabModel.buildSplitPlan(c, members: [], splitId: "fixed")?.spots)
    }

    /// 묶음 키는 웹 `uid()` 형식(`[A-Za-z0-9_-]{1,40}`)이어야 `normalizeSpot`을 지난다.
    func testSplitIdPassesTheWebIdRule() {
        let id = CandidateBoardViewModel.newSplitId()
        XCTAssertTrue(id.hasPrefix("sp"))
        XCTAssertTrue(TripBooking.isValidId(id), id)
    }

    // MARK: 낙관적 반응 — 되돌릴 수 있어야 한다

    func testApplyingReactionKeepsTheServerShape() {
        let before = candidate(must: 1, ok: 1)
        let after = CollabModel.applyingReaction(.must, to: before)
        XCTAssertEqual(after.myReaction, "MUST")
        XCTAssertEqual(after.mustCount, 2)
        XCTAssertEqual(after.reactions.filter(\.me).count, 1)
        XCTAssertEqual(CollabModel.tally(after, memberCount: 4).must, 2, "집계와 배열이 서로 어긋나지 않는다")

        // 거두면 내 표만 빠진다
        let cleared = CollabModel.applyingReaction(nil, to: after)
        XCTAssertNil(cleared.myReaction)
        XCTAssertEqual(cleared.mustCount, 1)
        XCTAssertFalse(cleared.reactions.contains { $0.me })
    }

    // MARK: 활동 문장 — 서버는 재료만 준다

    private func activity(id: Int = 1, kind: String, mine: Bool = false, actor: String = "영희",
                          member: String? = nil, subject: [String: JSONValue] = [:],
                          createdAt: String = "2026-09-01T10:00:00.000Z") -> ActivityView {
        ActivityView(id: id, kind: kind, actorLabel: actor, mine: mine, memberLabel: member, subject: subject, createdAt: createdAt)
    }

    func testActivityText() {
        XCTAssertEqual(CollabModel.activityText(activity(kind: "MEMBER_JOINED", member: "철수")), "철수님이 함께하게 됐어요")
        XCTAssertEqual(CollabModel.activityText(activity(kind: "MEMBER_JOINED", mine: true, member: "나")), "내가 함께하게 됐어요")
        XCTAssertEqual(CollabModel.activityText(activity(kind: "CANDIDATE_PROPOSED", subject: ["title": .string("카사 바트요")])),
                       "영희님이 카사 바트요를 후보로 담았어요")
        XCTAssertEqual(CollabModel.activityText(activity(kind: "CANDIDATE_SCHEDULED", subject: ["title": .string("공원"), "ref": .string("2")])),
                       "영희님이 공원을 Day 2에 넣었어요")
        XCTAssertEqual(CollabModel.activityText(activity(kind: "REACTION", subject: ["title": .string("공원"), "reaction": .string("MUST")])),
                       "영희님이 공원을 \"꼭 가고 싶어요\"로 골랐어요")
        XCTAssertEqual(CollabModel.activityText(activity(kind: "COMMENT_ADDED", subject: ["title": .string("공원"), "excerpt": .string("야경 보고 싶어")])),
                       "영희님이 공원에 한마디: “야경 보고 싶어”")
        XCTAssertEqual(CollabModel.activityText(activity(kind: "SCHEDULE_CHANGED"), count: 3), "영희님이 일정을 바꿨어요 (3번)")
        XCTAssertEqual(CollabModel.activityText(activity(kind: "BOOKING_ADDED", subject: ["count": .number(2)])), "영희님이 예약 2건을 추가했어요")
        // 모르는 종류는 빈 문자열 — 화면이 그 줄을 건너뛴다
        XCTAssertEqual(CollabModel.activityText(activity(kind: "SOMETHING_NEW")), "")
    }

    /// 받침이 있으면 '을'. 한글이 아니면 '를'(외국어 상호가 많다).
    func testObjectParticle() {
        XCTAssertEqual(CollabModel.objectParticle("공원"), "을")
        XCTAssertEqual(CollabModel.objectParticle("카사 바트요"), "를")
        XCTAssertEqual(CollabModel.objectParticle("Sagrada"), "를")
        XCTAssertEqual(CollabModel.objectParticle(""), "를")
    }

    func testCondenseMergesRunsAndKeepsLastReaction() {
        let rows = [
            activity(id: 5, kind: "SCHEDULE_CHANGED", createdAt: "2026-09-01T10:05:00.000Z"),
            activity(id: 4, kind: "SCHEDULE_CHANGED", createdAt: "2026-09-01T10:04:00.000Z"),
            activity(id: 3, kind: "SCHEDULE_CHANGED", createdAt: "2026-09-01T10:03:00.000Z"),
            activity(id: 2, kind: "REACTION", subject: ["candidate_id": .number(7), "reaction": .string("MUST")], createdAt: "2026-09-01T10:02:00.000Z"),
            activity(id: 1, kind: "REACTION", subject: ["candidate_id": .number(7), "reaction": .string("PASS")], createdAt: "2026-09-01T10:01:00.000Z")
        ]
        let condensed = CollabModel.condensed(rows)
        XCTAssertEqual(condensed.count, 2, "연속 저장은 한 줄, 같은 후보 반응은 마지막 것만")
        XCTAssertEqual(condensed[0].count, 3)
        XCTAssertEqual(condensed[1].event.id, 2, "최신 반응이 남는다")
    }

    func testCondenseDoesNotMergeDifferentActors() {
        let rows = [
            activity(id: 2, kind: "SCHEDULE_CHANGED", actor: "영희", createdAt: "2026-09-01T10:02:00.000Z"),
            activity(id: 1, kind: "SCHEDULE_CHANGED", actor: "철수", createdAt: "2026-09-01T10:01:00.000Z")
        ]
        XCTAssertEqual(CollabModel.condensed(rows).count, 2)
    }

    func testRelativeTime() {
        let now = ISODateText.parseTimestamp("2026-09-01T12:00:00.000Z")!
        XCTAssertEqual(CollabModel.relativeTime("2026-09-01T11:59:30.000Z", now: now), "방금")
        XCTAssertEqual(CollabModel.relativeTime("2026-09-01T11:30:00.000Z", now: now), "30분 전")
        XCTAssertEqual(CollabModel.relativeTime("2026-09-01T09:00:00.000Z", now: now), "3시간 전")
        XCTAssertEqual(CollabModel.relativeTime("2026-08-30T12:00:00.000Z", now: now), "2일 전")
        XCTAssertEqual(CollabModel.relativeTime("엉망", now: now), "")
        XCTAssertEqual(CollabModel.relativeTime(nil, now: now), "")
    }

    // MARK: 취향 — 서버와 같은 화이트리스트

    func testPrefsNormalizationMatchesTheServer() {
        var prefs = TripPrefs(raw: [
            "pace": .string("PACKED"),
            "walking": .string("NOPE"),                       // 모르는 값은 버린다
            "morning": .bool(false),
            "interests": .array([.string("야경"), .string("야경"), .string("  "), .string("미술관"), .number(3)]),
            "note": .string(String(repeating: "가", count: 200)),
            "unknownKey": .string("사라진다")
        ])
        XCTAssertEqual(prefs.pace, .packed)
        XCTAssertNil(prefs.walking)
        XCTAssertEqual(prefs.morning, false)
        XCTAssertEqual(prefs.interests, ["미술관", "야경"], "중복·빈 값 제거 후 정렬")
        XCTAssertEqual(prefs.note.count, CollabModel.prefNoteMax)
        XCTAssertNil(prefs.raw["unknownKey"])

        // 빈 것은 키를 넣지 않는다 — 서버(tc_norm_prefs)도 같다
        prefs.interests = []
        prefs.note = "   "
        XCTAssertNil(prefs.raw["interests"])
        XCTAssertNil(prefs.raw["note"])
    }

    func testTopicIsEitherInterestOrDislikeNeverBoth() {
        var prefs = TripPrefs()
        prefs.toggleInterest("쇼핑")
        XCTAssertEqual(prefs.interests, ["쇼핑"])
        prefs.toggleDislike("쇼핑")
        XCTAssertEqual(prefs.dislikes, ["쇼핑"])
        XCTAssertTrue(prefs.interests.isEmpty, "같은 주제가 관심과 별로에 동시에 있을 수 없다")
        prefs.toggleDislike("쇼핑")
        XCTAssertTrue(prefs.dislikes.isEmpty, "다시 누르면 거둔다")
    }

    func testPrefsText() {
        var prefs = TripPrefs()
        prefs.pace = .relaxed
        prefs.walking = .low
        prefs.interests = ["미술관", "야경"]
        prefs.dislikes = ["쇼핑"]
        XCTAssertEqual(prefs.text, "여유롭게 · 많이 걷기 싫어요 · 관심: 미술관, 야경 · 별로: 쇼핑")
        XCTAssertEqual(TripPrefs().text, "")
    }

    private func preference(label: String, mine: Bool = false, prefs: [String: JSONValue]) -> PreferenceView {
        PreferenceView(userId: label, label: label, role: .editor, mine: mine, prefs: prefs)
    }

    /// 정리만 한다 — 자동으로 빼자고 하지 않는다(§23·§62).
    func testGroupContextSummarizesWithoutDeciding() {
        let rows = [
            preference(label: "영희", prefs: ["pace": .string("RELAXED"), "walking": .string("LOW"), "morning": .bool(false), "interests": .array([.string("미술관")])]),
            preference(label: "철수", prefs: ["pace": .string("PACKED"), "walking": .string("HIGH"), "interests": .array([.string("미술관")]), "dislikes": .array([.string("쇼핑")])]),
            preference(label: "민수", prefs: ["interests": .array([.string("쇼핑")])])
        ]
        let lines = CollabModel.groupContextText(rows, memberCount: 4)
        XCTAssertTrue(lines.contains("4명 중 3명이 취향을 남겼어요"))
        XCTAssertTrue(lines.contains { $0.contains("페이스 생각이 갈려요") })
        // 제약은 가장 약한 사람 기준
        XCTAssertTrue(lines.contains { $0.contains("많이 걷기 싫어요 (영희)") })
        XCTAssertTrue(lines.contains { $0.contains("아침 일찍은 어려워요 (영희)") })
        XCTAssertTrue(lines.contains { $0.contains("함께 관심: 미술관") })
        XCTAssertTrue(lines.contains { $0.contains("쇼핑") && $0.contains("별로") })
        XCTAssertFalse(lines.contains { $0.contains("빼") }, "정리만 한다 — 결정하지 않는다")
    }

    func testGroupContextWhenNobodyAnswered() {
        let lines = CollabModel.groupContextText([preference(label: "영희", prefs: [:])], memberCount: 3)
        XCTAssertEqual(lines.count, 1)
        XCTAssertTrue(lines[0].contains("아직 아무도"))
    }

    // MARK: 후보 → 장소

    func testCandidateBecomesASpotWithoutGuessing() {
        let withCoord = CandidateView(
            id: 1, title: "구엘 공원", placeId: "pid", lat: 41.41, lng: 2.15, addr: nil, note: "아침이 좋대", url: nil,
            status: "PROPOSED", scheduledRef: nil, proposedByLabel: "영희", mine: false, myReaction: nil,
            mustCount: 0, okCount: 0, passCount: 0, reactions: [], commentCount: 0, createdAt: "2026-09-01T00:00:00.000Z")
        let spot = CandidateBoardViewModel.spot(from: withCoord)
        XCTAssertEqual(spot.name, "구엘 공원")
        XCTAssertEqual(spot.city, "기타", "도시를 추측하지 않는다")
        XCTAssertEqual(spot.desc, "아침이 좋대")
        XCTAssertEqual(spot.point?.lat, 41.41)
        XCTAssertEqual(spot.placeId, "pid")
        XCTAssertNil(spot.raw["cat"], "종류도 추측하지 않는다")

        let noCoord = candidate()
        let plain = CandidateBoardViewModel.spot(from: noCoord)
        XCTAssertNil(plain.point, "좌표가 없으면 위치 없는 장소다")
        XCTAssertEqual(plain.raw["lat"]?.isNull, true)
    }

    func testTimestampParsingAcceptsBothServerShapes() {
        XCTAssertNotNil(ISODateText.parseTimestamp("2026-09-01T10:00:00.000Z"))
        XCTAssertNotNil(ISODateText.parseTimestamp("2026-09-01T10:00:00Z"))
        XCTAssertNotNil(ISODateText.parseTimestamp("2026-09-01T10:00:00+00:00"))
        XCTAssertNil(ISODateText.parseTimestamp("어제"))
    }
}

/// 참여자 이름표가 `collab.js`와 **같은 답**을 내는지.
///
/// 픽스처는 `next`의 `whoTextParity.test.ts`가 `collab.js`로 만든다.
/// 규칙을 바꾸면 그 테스트가 파일을 새로 쓰고 여기가 깨진다 — 그게 목적이다.
final class WhoTextParityTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Member: Decodable { let user_id: String; let display_name: String?; let me: Bool }
        struct Case: Decodable {
            let name: String
            let who: [String]
            let text: String
            let labels: [String]
            let includesMe: Bool
        }
        struct Pick: Decodable {
            let name: String
            let who: [String]
            let toggle: String
            let allIds: [String]
            let next: [String]
        }
        let members: [Member]
        let cases: [Case]
        /// 역할별 참여자 지정 권한. `collab.js`의 `canAssignWho`가 만든다.
        let canAssignWho: [String: Bool]
        /// 칩 하나를 켜고 끈 결과. `collab.js`의 `pickWho`가 만든다.
        let picks: [Pick]
    }

    private func load() throws -> Fixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "who-text", withExtension: "json"),
                                "who-text.json 픽스처를 테스트 번들에 포함시켜야 합니다")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    func testMatchesTheJavaScriptRule() throws {
        let fixture = try load()
        let members = fixture.members.map {
            MemberView(id: 0, userId: $0.user_id, role: .editor, status: "ACTIVE",
                       displayName: $0.display_name, joinedAt: nil, me: $0.me)
        }
        XCTAssertGreaterThan(fixture.cases.count, 0)
        for c in fixture.cases {
            XCTAssertEqual(CollabModel.whoText(c.who, members: members), c.text, c.name)
            XCTAssertEqual(CollabModel.whoLabels(c.who, members: members), c.labels, c.name)
            XCTAssertEqual(CollabModel.includesMe(c.who, myId: "me"), c.includesMe, c.name)
        }
    }

    /// 참여자를 **고를 수 있는 역할**도 `collab.js`가 정한다 — 보기 권한은 의견만 낸다(§12).
    /// 갈리면 앱에서만 보기 권한자에게 '누가 가나요'가 떠, 저장할 수 없는 편집을 시키게 된다.
    func testAssignPermissionMatchesTheJavaScriptRule() throws {
        let fixture = try load()
        let roles: [String: MemberRole] = ["OWNER": .owner, "EDITOR": .editor, "VIEWER": .viewer]
        XCTAssertEqual(Set(fixture.canAssignWho.keys), Set(roles.keys), "픽스처가 역할을 다 담아야 한다")
        for (name, expected) in fixture.canAssignWho {
            let role = try XCTUnwrap(roles[name], name)
            XCTAssertEqual(CollabModel.canAssignWho(role), expected, name)
        }
    }

    /// 칩을 켜고 끄는 규칙도 `collab.js`가 단일 출처다.
    /// ⚠️ 여기가 갈리면 **같은 선택이 다른 문서가 된다** — 특히 전원을 고른 것을 비우지 않으면
    ///    `whoKey`가 `"u1,u2,u3"`와 `"*"`로 갈려, 갈라지지 않은 하루가 분리된 것처럼 보인다.
    func testTogglingMatchesTheJavaScriptRule() throws {
        let fixture = try load()
        XCTAssertGreaterThan(fixture.picks.count, 0)
        for pick in fixture.picks {
            XCTAssertEqual(CollabModel.pickWho(pick.who, toggling: pick.toggle, all: pick.allIds),
                           pick.next, pick.name)
        }
    }

    /// 이름표에 계정 이메일이 나오면 안 된다(§69).
    func testLabelsNeverLeakEmails() throws {
        let fixture = try load()
        for c in fixture.cases {
            XCTAssertFalse(c.text.contains("@"), c.name)
        }
    }
}

/// 갈린 후보의 **세 선택지와 분리 계획**이 `collab.js`와 같은 답을 내는지.
///
/// 픽스처는 `next`의 `splitPlanParity.test.ts`가 `collab.js`로 만든다.
/// 규칙을 바꾸면 그 테스트가 파일을 새로 쓰고 여기가 깨진다 — 그게 목적이다.
/// 장소 세 줄의 **키까지** 맞춘다: 웹과 앱이 같은 문서를 쓰므로 키가 하나만 달라도
/// 한쪽이 만든 분리를 다른 쪽이 못 읽는다.
final class SplitPlanParityTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Member: Decodable { let user_id: String; let display_name: String?; let me: Bool }
        struct Conflict: Decodable {
            let title: String
            let must: [String], ok: [String], pass: [String]
            let goers: [String], others: [String]
        }
        struct Option: Decodable { let key: String; let title: String; let text: String; let action: String? }
        struct Plan: Decodable {
            let goers: [String], others: [String]
            let spots: [[String: JSONValue]]
            let text: String
        }
        struct Case: Decodable {
            let name: String
            let memberCount: Int
            let candidate: CandidateView
            let conflict: Conflict?
            let options: [Option]
            let plan: Plan?
        }
        let splitId: String
        let members: [Member]
        let cases: [Case]
    }

    private func load() throws -> Fixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "split-plan", withExtension: "json"),
                                "split-plan.json 픽스처를 테스트 번들에 포함시켜야 합니다")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    /// 웹의 key 문자열과 맞춘다 — 순서뿐 아니라 어느 칸이 무엇인지도 같아야 한다.
    private func keyName(_ key: CandidateConflict.Option.Key) -> String {
        switch key {
        case .together: "TOGETHER"
        case .split: "SPLIT"
        case .skip: "SKIP"
        }
    }

    func testMatchesTheJavaScriptRule() throws {
        let fixture = try load()
        let members = fixture.members.map {
            MemberView(id: 0, userId: $0.user_id, role: .editor, status: "ACTIVE",
                       displayName: $0.display_name, joinedAt: nil, me: $0.me)
        }
        XCTAssertGreaterThan(fixture.cases.count, 0)
        for c in fixture.cases {
            let conflict = CollabModel.conflict(c.candidate, memberCount: c.memberCount)
            if let expected = c.conflict {
                XCTAssertEqual(conflict?.title, expected.title, c.name)
                XCTAssertEqual(conflict?.must, expected.must, c.name)
                XCTAssertEqual(conflict?.ok, expected.ok, c.name)
                XCTAssertEqual(conflict?.pass, expected.pass, c.name)
                XCTAssertEqual(conflict?.goers, expected.goers, c.name)
                XCTAssertEqual(conflict?.others, expected.others, c.name)
            } else {
                XCTAssertNil(conflict, c.name)
            }

            let options = conflict?.options ?? []
            XCTAssertEqual(options.count, c.options.count, c.name)
            for (option, expected) in zip(options, c.options) {
                XCTAssertEqual(keyName(option.key), expected.key, c.name)
                XCTAssertEqual(option.title, expected.title, c.name)
                XCTAssertEqual(option.text, expected.text, c.name)
                XCTAssertEqual(option.action, expected.action, c.name)
            }

            let plan = CollabModel.buildSplitPlan(c.candidate, members: members, splitId: fixture.splitId)
            if let expected = c.plan {
                XCTAssertEqual(plan?.goers, expected.goers, c.name)
                XCTAssertEqual(plan?.others, expected.others, c.name)
                XCTAssertEqual(plan?.text, expected.text, c.name)
                XCTAssertEqual(plan?.spots.map(\.raw), expected.spots, c.name)
            } else {
                XCTAssertNil(plan, c.name)
            }
        }
    }

    /// 이름표에 계정 이메일이 나오면 안 된다(§69).
    func testTextsNeverLeakEmails() throws {
        let fixture = try load()
        for c in fixture.cases {
            for option in c.options { XCTAssertFalse(option.text.contains("@"), c.name) }
            if let plan = c.plan { XCTAssertFalse(plan.text.contains("@"), c.name) }
        }
    }
}

/// 권한 거절 문구가 `collab.js`와 같은 답을 내는지.
///
/// 픽스처는 `next`의 `forbiddenTextParity.test.ts`가 `collab.js`로 만든다.
/// 요점 하나: **서버가 말한 이유를 화면이 뭉개지 않는다.** 서버는 왜 막았는지를 문장으로
/// 보내는데 역할로 짐작해 덮어쓰면 "권한이 없어요" 하나만 남고 무엇을 하면 되는지가 사라진다.
final class ForbiddenTextParityTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Case: Decodable { let name: String; let message: String; let role: String; let text: String }
        let cases: [Case]
    }

    private func load() throws -> Fixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "forbidden-text", withExtension: "json"),
                                "forbidden-text.json 픽스처를 테스트 번들에 포함시켜야 합니다")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    private func role(_ raw: String) -> MemberRole {
        switch raw {
        case "OWNER": .owner
        case "EDITOR": .editor
        case "VIEWER": .viewer
        default: .unknown
        }
    }

    func testMatchesTheJavaScriptRule() throws {
        let fixture = try load()
        XCTAssertGreaterThan(fixture.cases.count, 0)
        for c in fixture.cases {
            XCTAssertEqual(CollabModel.forbiddenText(c.message, role: role(c.role)), c.text, c.name)
        }
    }

    /// 내부 토큰이 화면 문장에 새지 않는다 — 사람에게 쓴 말만 보인다.
    func testNeverLeaksInternalTokens() throws {
        for c in try load().cases {
            XCTAssertFalse(c.text.contains("FORBIDDEN"), c.name)
            XCTAssertFalse(c.text.contains("permission denied"), c.name)
        }
    }

    /// 문장이 없으면 역할로 짐작하고, nil도 빈 문장과 같다(서버에 묻기 전의 로컬 판정).
    func testFallsBackToTheRoleWhenThereIsNoSentence() {
        XCTAssertEqual(CollabModel.forbiddenText(nil, role: .viewer),
                       "보기 권한이라 저장할 수 없어요 — 주최자에게 편집 권한을 요청하세요")
        XCTAssertEqual(CollabModel.forbiddenText(nil, role: .editor), "이 여행을 바꿀 권한이 없어요")
        XCTAssertEqual(CollabModel.forbiddenText("   ", role: .owner), "이 여행을 바꿀 권한이 없어요")
    }

    /// 한글이 있으면 사람에게 쓴 말이다 — 웹의 `[가-힣]`과 같은 범위.
    func testHumanMessageMatchesTheWebRange() {
        XCTAssertTrue(CollabModel.isHumanMessage("초대 링크는 주최자만 만들 수 있습니다."))
        XCTAssertFalse(CollabModel.isHumanMessage("TRIP_FORBIDDEN"))
        XCTAssertFalse(CollabModel.isHumanMessage("permission denied for table trips"))
        XCTAssertFalse(CollabModel.isHumanMessage(""))
    }
}
