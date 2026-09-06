import XCTest
@testable import TripCanvas

/// 함께하기 판정 — `collab.js`와 **같은 답**이 나와야 한다(`test/collab.test.js`의 짝).
/// 두 벌이 갈리면 같은 후보를 두고 웹과 앱이 다른 말을 한다.
final class CollabModelTests: XCTestCase {
    private func candidate(id: Int = 1, must: Int = 0, ok: Int = 0, pass: Int = 0,
                           status: String = "PROPOSED", mine: Bool = false, myReaction: String? = nil,
                           createdAt: String = "2026-09-01T00:00:00.000Z") -> CandidateView {
        var reactions: [CandidateView.ReactionEntry] = []
        for i in 0..<must { reactions.append(.init(name: "M\(i)", reaction: "MUST", me: false)) }
        for i in 0..<ok { reactions.append(.init(name: "O\(i)", reaction: "OK", me: false)) }
        for i in 0..<pass { reactions.append(.init(name: "P\(i)", reaction: "PASS", me: false)) }
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
        XCTAssertNil(options[1].action, "분리 일정은 다음 단계 — 안내만")
        XCTAssertEqual(options[2].action, "REJECT")
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
        let members: [Member]
        let cases: [Case]
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

    /// 이름표에 계정 이메일이 나오면 안 된다(§69).
    func testLabelsNeverLeakEmails() throws {
        let fixture = try load()
        for c in fixture.cases {
            XCTAssertFalse(c.text.contains("@"), c.name)
        }
    }
}
