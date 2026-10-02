import XCTest
@testable import TripCanvas

// `CollabModel`·`TripPrefs`는 `collab.js`의 **복사본**이다. 이 파일은 그 나머지 규칙 —
// 후보 보드 · 활동 문장 · 초대와 역할 · 여행 취향 — 이 `collab.js`와 **같은 답**을 내는지 본다.
//
// 픽스처는 `next`의 `collabRulesParity.test.ts`가 `collab.js`로 만든다. 규칙을 바꾸면 그 테스트가
// 파일을 새로 쓰고 여기가 깨진다 — 그게 목적이다(복사본은 조용히 갈라진다).
// 손으로 적은 기대값은 `CollabModelTests`에 그대로 있다. 여기는 **원본이 낸 답**과 맞춘다.

/// 웹의 이름과 맞춘다 — 순서뿐 아니라 어느 값이 무엇인지도 같아야 한다.
private func moodName(_ mood: CandidateMood) -> String {
    switch mood {
    case .none: "NONE"
    case .quiet: "QUIET"
    case .split: "SPLIT"
    case .cool: "COOL"
    case .loved: "LOVED"
    }
}

private func statusName(_ status: ConsensusStatus) -> String {
    switch status {
    case .strongMatch: "STRONG_MATCH"
    case .goodMatch: "GOOD_MATCH"
    case .mixed: "MIXED"
    case .conflict: "CONFLICT"
    }
}

private func toneName(_ tone: VerdictTone) -> String {
    switch tone {
    case .good: "good"
    case .split: "split"
    case .mixed: "mixed"
    case .quiet: "quiet"
    }
}

/// 후보 보드 — 집계 · 상태 · 합의 · 배지 · 요약 · 묶음 · 정렬 · 분류.
final class CandidateBoardParityTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Tally: Decodable { let must: Int; let ok: Int; let pass: Int; let voted: Int; let silent: Int; let members: Int }
        struct ConsensusRow: Decodable {
            let score: Int
            let strongSupportCount: Int
            let oppositionCount: Int
            let status: String?
            let voted: Int
            let members: Int
        }
        struct Verdict: Decodable { let text: String; let tone: String }
        struct Case: Decodable {
            let name: String
            let memberCount: Int
            let candidate: CandidateView
            let tally: Tally
            let mood: String
            let moodText: String
            let consensus: ConsensusRow
            let verdict: Verdict
            let summary: String
            let attribution: String
        }
        struct Groups: Decodable {
            let loved: [Int], needsOpinion: [Int], resting: [Int], scheduled: [Int], rejected: [Int]
        }
        struct Board: Decodable {
            let memberCount: Int
            let candidates: [CandidateView]
            let groups: Groups
            let byInterest: [Int]
            let recent: [Int]
        }
        struct ReactionLabel: Decodable { let id: String; let label: String; let icon: String }
        struct CategoryRead: Decodable { let raw: String?; let value: String? }
        struct Categories: Decodable { let list: [String]; let reads: [CategoryRead] }
        let cases: [Case]
        let board: Board
        let reactions: [ReactionLabel]
        let moods: [String: String]
        let consensusTexts: [String: String]
        let categories: Categories
    }

    private func load() throws -> Fixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "candidate-board", withExtension: "json"),
                                "candidate-board.json 픽스처를 테스트 번들에 포함시켜야 합니다")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    func testCandidateJudgementMatchesTheJavaScriptRule() throws {
        let fixture = try load()
        XCTAssertGreaterThan(fixture.cases.count, 0)
        for c in fixture.cases {
            let tally = CollabModel.tally(c.candidate, memberCount: c.memberCount)
            XCTAssertEqual(tally, ReactionTally(must: c.tally.must, ok: c.tally.ok, pass: c.tally.pass,
                                                voted: c.tally.voted, silent: c.tally.silent, members: c.tally.members), c.name)

            let mood = CollabModel.mood(c.candidate, memberCount: c.memberCount)
            XCTAssertEqual(moodName(mood), c.mood, c.name)
            XCTAssertEqual(mood.text, c.moodText, c.name)

            let consensus = CollabModel.consensus(c.candidate, memberCount: c.memberCount)
            XCTAssertEqual(consensus.score, c.consensus.score, c.name)
            XCTAssertEqual(consensus.strongSupportCount, c.consensus.strongSupportCount, c.name)
            XCTAssertEqual(consensus.oppositionCount, c.consensus.oppositionCount, c.name)
            XCTAssertEqual(consensus.status.map { statusName($0) }, c.consensus.status, c.name)
            XCTAssertEqual(consensus.voted, c.consensus.voted, c.name)
            XCTAssertEqual(consensus.members, c.consensus.members, c.name)

            let verdict = CollabModel.verdict(c.candidate, memberCount: c.memberCount)
            XCTAssertEqual(verdict.text, c.verdict.text, c.name)
            XCTAssertEqual(toneName(verdict.tone), c.verdict.tone, c.name)

            XCTAssertEqual(CollabModel.reactionSummary(c.candidate, memberCount: c.memberCount), c.summary, c.name)
            XCTAssertEqual(CollabModel.attribution(c.candidate), c.attribution, c.name)
        }
    }

    /// 묶음이 정렬보다 먼저다. 정렬은 표시일 뿐 결정이 아니다(§12) — 그래도 웹과 같은 순서여야 같은 보드다.
    func testBoardGroupsAndOrderMatchTheJavaScriptRule() throws {
        let board = try load().board
        let groups = CollabModel.grouped(board.candidates, memberCount: board.memberCount)
        XCTAssertEqual(groups.loved.map(\.id), board.groups.loved)
        XCTAssertEqual(groups.needsOpinion.map(\.id), board.groups.needsOpinion)
        XCTAssertEqual(groups.resting.map(\.id), board.groups.resting)
        XCTAssertEqual(groups.scheduled.map(\.id), board.groups.scheduled)
        XCTAssertEqual(groups.rejected.map(\.id), board.groups.rejected)
        XCTAssertEqual(CollabModel.sorted(board.candidates, byInterest: true, memberCount: board.memberCount).map(\.id),
                       board.byInterest, "관심 순")
        XCTAssertEqual(CollabModel.sorted(board.candidates, byInterest: false, memberCount: board.memberCount).map(\.id),
                       board.recent, "최근 순")
    }

    func testLabelsMatchTheJavaScriptTables() throws {
        let fixture = try load()
        XCTAssertEqual(Reaction.allCases.map(\.rawValue), fixture.reactions.map(\.id), "반응 순서")
        for (reaction, expected) in zip(Reaction.allCases, fixture.reactions) {
            XCTAssertEqual(reaction.label, expected.label, expected.id)
            XCTAssertEqual(reaction.icon, expected.icon, expected.id)
        }

        let moods: [CandidateMood] = [.none, .quiet, .split, .cool, .loved]
        XCTAssertEqual(Set(moods.map { moodName($0) }), Set(fixture.moods.keys))
        for mood in moods { XCTAssertEqual(mood.text, fixture.moods[moodName(mood)], moodName(mood)) }

        let statuses: [ConsensusStatus] = [.strongMatch, .goodMatch, .mixed, .conflict]
        XCTAssertEqual(Set(statuses.map { statusName($0) }), Set(fixture.consensusTexts.keys))
        for status in statuses {
            XCTAssertEqual(status.text, fixture.consensusTexts[statusName(status)], statusName(status))
        }
    }

    /// '아직 고르지 않음'(nil)과 '기타'(ETC)는 다른 상태다 — 모르는 값은 고르지 않음으로 떨어진다.
    func testCategoriesMatchTheJavaScriptRule() throws {
        let categories = try load().categories
        XCTAssertEqual(CandidateCategory.allCases.map(\.rawValue), categories.list)
        for read in categories.reads {
            XCTAssertEqual(CandidateCategory.of(read.raw)?.rawValue, read.value, read.raw ?? "nil")
        }
    }

    /// 점수는 내부값이다 — 화면에 나가는 문장에는 숫자가 없다(§21·§22).
    func testVerdictTextsHaveNoNumbers() throws {
        for c in try load().cases {
            XCTAssertFalse(c.verdict.text.contains(where: \.isNumber), c.name)
        }
    }
}

/// 활동 문장 — 문장 · 을/를 · 묶기 · 상대 시각. 서버는 재료만 주고 문장은 여기서 만든다(§39).
final class ActivityTextParityTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Case: Decodable { let name: String; let event: ActivityView; let count: Int?; let text: String }
        struct Particle: Decodable { let word: String; let particle: String }
        struct Line: Decodable { let id: Int; let count: Int; let text: String }
        struct Condense: Decodable { let name: String; let rows: [ActivityView]; let lines: [Line] }
        struct Relative: Decodable { let iso: String?; let text: String }
        struct RelativeTimes: Decodable { let now: String; let cases: [Relative] }
        let cases: [Case]
        let particles: [Particle]
        let condense: [Condense]
        let relativeTimes: RelativeTimes
    }

    private func load() throws -> Fixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "activity-text", withExtension: "json"),
                                "activity-text.json 픽스처를 테스트 번들에 포함시켜야 합니다")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    func testActivityTextMatchesTheJavaScriptRule() throws {
        let fixture = try load()
        XCTAssertGreaterThan(fixture.cases.count, 0)
        for c in fixture.cases {
            XCTAssertEqual(CollabModel.activityText(c.event, count: c.count ?? 1), c.text, c.name)
        }
    }

    func testObjectParticleMatchesTheJavaScriptRule() throws {
        for p in try load().particles {
            XCTAssertEqual(CollabModel.objectParticle(p.word), p.particle, p.word)
        }
    }

    /// 입력·출력 모두 최신순. 같은 사람의 연속 저장은 한 줄(횟수), 같은 후보 반응은 마지막 것만.
    func testCondensedFeedMatchesTheJavaScriptRule() throws {
        let fixture = try load()
        XCTAssertGreaterThan(fixture.condense.count, 0)
        for c in fixture.condense {
            let lines = CollabModel.condensed(c.rows)
            XCTAssertEqual(lines.map(\.event.id), c.lines.map(\.id), c.name)
            XCTAssertEqual(lines.map(\.count), c.lines.map(\.count), c.name)
            XCTAssertEqual(lines.map { CollabModel.activityText($0.event, count: $0.count) }, c.lines.map(\.text), c.name)
        }
    }

    func testRelativeTimeMatchesTheJavaScriptRule() throws {
        let relative = try load().relativeTimes
        let now = try XCTUnwrap(ISODateText.parseTimestamp(relative.now))
        for c in relative.cases {
            XCTAssertEqual(CollabModel.relativeTime(c.iso, now: now), c.text, c.iso ?? "nil")
        }
    }

    /// 활동 문장에 계정 이메일이 나오지 않는다(§69).
    func testTextsNeverLeakEmails() throws {
        for c in try load().cases { XCTAssertFalse(c.text.contains("@"), c.name) }
    }
}

/// 초대와 역할 — 토큰 · 거절 이유 · 초대 판정 · 기간 한 줄 · 역할 판정 · 멤버 이름.
final class InviteParityTests: XCTestCase {
    private struct Fixture: Decodable {
        struct JoinToken: Decodable { let hash: String; let token: String? }
        struct Reason: Decodable { let reason: String?; let text: String }
        struct Verdict: Decodable {
            let name: String
            let preview: InvitePreview?
            let ok: Bool
            let text: String
            let alreadyMember: Bool
            let role: String?
        }
        struct RangeRow: Decodable { let start: String?; let dayCount: Int?; let text: String }
        struct RoleRow: Decodable {
            let role: String
            let canEdit: Bool, canManage: Bool, canLeave: Bool, canDelete: Bool
            let canPropose: Bool, canReact: Bool, canComment: Bool, canScheduleCandidate: Bool
            let canRemoveMine: Bool, canRemoveOthers: Bool, canDeleteMyComment: Bool, canDeleteOthersComment: Bool
            let label: String
            let icon: String
        }
        struct Member: Decodable { let member: MemberView; let name: String }
        let webBase: String
        let joinTokens: [JoinToken]
        let reasons: [Reason]
        let verdicts: [Verdict]
        let ranges: [RangeRow]
        let roles: [RoleRow]
        let memberNames: [Member]
    }

    private func load() throws -> Fixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "invite", withExtension: "json"),
                                "invite.json 픽스처를 테스트 번들에 포함시켜야 합니다")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    /// 웹은 `location.hash`를, 앱은 붙여넣은 글을 읽는다 — 같은 토큰 규칙을 지나는지 두 모양으로 본다.
    /// 앱만 받는 모양(앱 링크·토큰 자체·앞뒤 공백)은 `CollabModelTests.testJoinTokenParsing`이 본다.
    /// `#join=토큰&x=1`은 픽스처에 없다 — 웹은 해시 전체가 초대여야 해서 거절하고 앱은 꼬리를 잘라 받는다(입력 경로가 다르다).
    func testJoinTokenMatchesTheJavaScriptRule() throws {
        let fixture = try load()
        XCTAssertGreaterThan(fixture.joinTokens.count, 0)
        for c in fixture.joinTokens {
            XCTAssertEqual(CollabModel.joinToken(from: c.hash), c.token, c.hash)
            XCTAssertEqual(CollabModel.joinToken(from: fixture.webBase + c.hash), c.token, "웹 링크 " + c.hash)
        }
    }

    func testReasonTextMatchesTheJavaScriptRule() throws {
        for c in try load().reasons {
            XCTAssertEqual(CollabModel.joinReasonText(c.reason), c.text, c.reason ?? "nil")
            XCTAssertFalse(c.text.isEmpty, "거절 문장이 빈 칸이 되지 않는다")
        }
    }

    func testInviteVerdictMatchesTheJavaScriptRule() throws {
        for c in try load().verdicts {
            let verdict = CollabModel.inviteVerdict(c.preview)
            XCTAssertEqual(verdict.ok, c.ok, c.name)
            XCTAssertEqual(verdict.text, c.text, c.name)
            XCTAssertEqual(verdict.alreadyMember, c.alreadyMember, c.name)
            XCTAssertEqual(verdict.role?.rawValue, c.role, c.name)
        }
    }

    func testInviteRangeMatchesTheJavaScriptRule() throws {
        for c in try load().ranges {
            XCTAssertEqual(CollabModel.inviteRangeText(start: c.start, dayCount: c.dayCount), c.text,
                           "\(c.start ?? "nil") · \(c.dayCount.map(String.init) ?? "nil")")
        }
    }

    /// 보기 권한은 의견만 낸다 — 무엇을 감출지는 `collab.js`와 같아야 한다(경계는 서버다).
    func testRoleRulesMatchTheJavaScriptRule() throws {
        let fixture = try load()
        XCTAssertGreaterThan(fixture.roles.count, 0)
        for r in fixture.roles {
            let role = MemberRole(rawValue: r.role) ?? .unknown
            XCTAssertEqual(CollabModel.canEdit(role), r.canEdit, r.role)
            XCTAssertEqual(CollabModel.canManage(role), r.canManage, r.role)
            XCTAssertEqual(CollabModel.canLeave(role), r.canLeave, r.role)
            XCTAssertEqual(CollabModel.canDelete(role), r.canDelete, r.role)
            XCTAssertEqual(CollabModel.canPropose(role), r.canPropose, r.role)
            XCTAssertEqual(CollabModel.canReact(role), r.canReact, r.role)
            XCTAssertEqual(CollabModel.canComment(role), r.canComment, r.role)
            XCTAssertEqual(CollabModel.canScheduleCandidate(role), r.canScheduleCandidate, r.role)
            XCTAssertEqual(CollabModel.canRemoveCandidate(role, mine: true), r.canRemoveMine, r.role)
            XCTAssertEqual(CollabModel.canRemoveCandidate(role, mine: false), r.canRemoveOthers, r.role)
            XCTAssertEqual(CollabModel.canDeleteComment(role, mine: true), r.canDeleteMyComment, r.role)
            XCTAssertEqual(CollabModel.canDeleteComment(role, mine: false), r.canDeleteOthersComment, r.role)
            XCTAssertEqual(CollabModel.roleLabel(role), r.label, r.role)
            XCTAssertEqual(role.label, r.label, r.role)
            XCTAssertEqual(CollabModel.roleIcon(role), r.icon, r.role)
        }
    }

    /// 이름이 없으면 역할로 부른다 — 계정 정보는 여행에 나오지 않는다(§69).
    func testMemberNameMatchesTheJavaScriptRule() throws {
        for c in try load().memberNames {
            XCTAssertEqual(CollabModel.memberName(c.member), c.name, c.member.userId)
            XCTAssertFalse(c.name.contains("@"), c.member.userId)
        }
    }
}

/// 여행 취향 — 서버(`tc_norm_prefs`)·웹과 같은 화이트리스트, 같은 한 줄 요약, 같은 그룹 정리.
final class TripPrefsParityTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Normalize: Decodable {
            let name: String
            let input: [String: JSONValue]
            let normalized: [String: JSONValue]
            let text: String
        }
        struct Group: Decodable { let name: String; let memberCount: Int; let rows: [PreferenceView]; let lines: [String] }
        let normalize: [Normalize]
        let groups: [Group]
    }

    private func load() throws -> Fixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "trip-prefs", withExtension: "json"),
                                "trip-prefs.json 픽스처를 테스트 번들에 포함시켜야 합니다")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    func testNormalizationMatchesTheJavaScriptRule() throws {
        let fixture = try load()
        XCTAssertGreaterThan(fixture.normalize.count, 0)
        for c in fixture.normalize {
            let prefs = TripPrefs(raw: c.input)
            XCTAssertEqual(prefs.raw, c.normalized, c.name)
            XCTAssertEqual(prefs.text, c.text, c.name)
        }
    }

    /// 정리만 한다 — 자동으로 빼자고 하지 않는다(§23·§62).
    func testGroupContextMatchesTheJavaScriptRule() throws {
        let fixture = try load()
        XCTAssertGreaterThan(fixture.groups.count, 0)
        for c in fixture.groups {
            XCTAssertEqual(CollabModel.groupContextText(c.rows, memberCount: c.memberCount), c.lines, c.name)
        }
    }
}
