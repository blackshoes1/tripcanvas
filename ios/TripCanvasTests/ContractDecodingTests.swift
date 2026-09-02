import XCTest
@testable import TripCanvas

/// 픽스처는 손으로 쓴 것이 아니라 **실제 서버 응답**이다 —
/// next 워크스페이스의 swiftParity 테스트가 매번 다시 만든다(`ios/TripCanvasTests/Fixtures/today.json`).
/// 계약이 바뀌면 픽스처가 바뀌고, 여기가 먼저 깨진다.
final class ContractDecodingTests: XCTestCase {

    private func loadTodayFixture() throws -> TodayResponse {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "today", withExtension: "json"),
            "today.json 픽스처를 테스트 번들에 포함시켜야 합니다")
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(TodayResponse.self, from: data)
    }

    func testDecodesRealServerResponse() throws {
        let today = try loadTodayFixture()
        XCTAssertEqual(today.schemaVersion, 1)
        XCTAssertEqual(today.trip.name, "정합성")
        XCTAssertEqual(today.day.index, 0)
        XCTAssertTrue(today.currentState.live)
        XCTAssertEqual(today.currentState.nowMinutes, 13 * 60)
        XCTAssertFalse(today.activities.isEmpty)
        XCTAssertFalse(today.suggestions.isEmpty)
    }

    func testNextActionCarriesDepartureSentence() throws {
        let today = try loadTodayFixture()
        let next = try XCTUnwrap(today.nextAction)
        XCTAssertEqual(next.title, "저녁 예약")
        // 출발 안내 문장은 서버가 만든다 — 클라이언트가 다시 쓰지 않는다.
        let departure = try XCTUnwrap(next.departure)
        XCTAssertFalse(departure.text.isEmpty)
        XCTAssertNotEqual(next.status, .unknown, "서버가 보내는 상태를 Swift가 모르면 안 된다")
    }

    func testEverySuggestionExplainsItself() throws {
        let today = try loadTodayFixture()
        for suggestion in today.suggestions {
            XCTAssertFalse(suggestion.reasons.isEmpty, "\(suggestion.title)에 추천 이유가 없다")
            XCTAssertNotEqual(suggestion.type, .unknown)
            XCTAssertNotEqual(suggestion.action.kind, .unknown)
        }
    }

    /// ⚠️ 두 목록은 **범위가 다르다.** 서버의 fixedCommitments는 FLEXIBLE이 아닌 것 전부(= SEMI_FIXED 포함,
    /// adaptive.js)이고, 화면이 눈에 띄게 표시하는 isFixedCommitment는 FIXED만이다. 그래서 .first끼리
    /// 비교하면 정렬·구성이 다를 때 헛되이 깨진다(이 테스트가 처음 돌자마자 그렇게 깨졌다).
    /// 지켜야 할 것은 포함 관계다 — 화면이 약속이라 부르는 것은 서버도 약속으로 잡고 있어야 한다.
    func testFixedCommitmentIsDistinguishable() throws {
        let today = try loadTodayFixture()
        let fixed = today.activities.filter(\.isFixedCommitment)
        XCTAssertFalse(fixed.isEmpty, "예약된 일정은 다른 일정과 구분돼야 한다")

        let commitmentIds = Set(today.fixedCommitments.map(\.activityId))
        for activity in fixed {
            XCTAssertTrue(commitmentIds.contains(activity.id),
                          "화면이 약속으로 표시하는 \(activity.name)이 서버 약속 목록에 없다")
        }
    }

    /// §10 — 서버가 새 값을 추가해도 구버전 앱이 즉시 깨지지 않아야 한다.
    func testUnknownEnumValueFallsBackInsteadOfThrowing() throws {
        struct Wrapper: Decodable { let status: TravelStatus }
        let data = Data(#"{"status":"TELEPORTING"}"#.utf8)
        let decoded = try JSONDecoder().decode(Wrapper.self, from: data)
        XCTAssertEqual(decoded.status, .unknown)
    }

    func testActivityStatusKnowsWhatIsDone() {
        XCTAssertTrue(ActivityStatus.completed.isDone)
        XCTAssertTrue(ActivityStatus.skipped.isDone)
        XCTAssertFalse(ActivityStatus.planned.isDone)
        XCTAssertFalse(ActivityStatus.inProgress.isDone)
    }
}

/// 함께하기 계약 — 후보 보드가 서버 응답 그대로 디코딩되는가.
///
/// 여기서 확인하는 것은 "묶음·문장·선택지가 이미 만들어져 오는가"다. iOS가 다시 계산할 것이
/// 남아 있으면 웹과 답이 갈린다(§8). 그리고 점수는 아예 오지 않아야 한다(§21·§22).
final class CandidateBoardDecodingTests: XCTestCase {

    private func loadBoard() throws -> CandidateBoardResponse {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "candidate-board", withExtension: "json"),
            "candidate-board.json 픽스처를 테스트 번들에 포함시켜야 합니다")
        return try JSONDecoder().decode(CandidateBoardResponse.self, from: Data(contentsOf: url))
    }

    func testDecodesBoardWithGroupsAndVerdicts() throws {
        let board = try loadBoard()
        XCTAssertEqual(board.schemaVersion, 1)
        XCTAssertEqual(board.role, .editor)
        XCTAssertTrue(board.canPropose)
        XCTAssertTrue(board.canReact)
        XCTAssertFalse(board.groups.isEmpty)
        for group in board.groups {
            XCTAssertNotEqual(group.key, .unknown, "서버가 보내는 묶음을 Swift가 모르면 안 된다")
            XCTAssertFalse(group.title.isEmpty)
        }
    }

    /// 결정하지 못한 것이 맨 위다 — 순위가 아니라 어디에 한마디가 필요한지다(§57·§58).
    func testUndecidedGroupComesFirst() throws {
        let board = try loadBoard()
        XCTAssertEqual(board.groups.first?.key, .needsOpinion)
    }

    func testEveryCandidateCarriesAFinishedSentence() throws {
        let board = try loadBoard()
        let candidates = board.groups.flatMap(\.candidates)
        XCTAssertFalse(candidates.isEmpty)
        for candidate in candidates {
            XCTAssertFalse(candidate.verdict.text.isEmpty, "배지 문장은 서버가 만든다")
            XCTAssertNotEqual(candidate.verdict.tone, .unknown)
            XCTAssertFalse(candidate.proposedBy.isEmpty)
            XCTAssertNotEqual(candidate.status, .unknown)
            // 점수는 화면에 없다 — 문장에 숫자가 섞여 있으면 계약이 새고 있는 것이다.
            XCTAssertNil(candidate.verdict.text.rangeOfCharacter(from: .decimalDigits),
                         "배지 문장에 숫자가 있으면 안 된다: \(candidate.verdict.text)")
        }
    }

    /// 갈렸다고 자동으로 빼지 않는다 — 선택지를 주고 사람이 고른다(§23·§24).
    func testSplitCandidateOffersThreeChoicesAndStaysProposed() throws {
        let board = try loadBoard()
        let split = try XCTUnwrap(board.groups.flatMap(\.candidates).first { $0.conflict != nil })
        XCTAssertEqual(split.status, .proposed)
        let conflict = try XCTUnwrap(split.conflict)
        XCTAssertFalse(conflict.must.isEmpty)
        XCTAssertFalse(conflict.pass.isEmpty)
        XCTAssertEqual(conflict.options.map(\.key), ["TOGETHER", "SPLIT", "SKIP"])
        // 자유시간 분리는 아직 안내만이라 누를 동작이 없다.
        XCTAssertEqual(conflict.options.map(\.action), ["SCHEDULE", nil, "REJECT"])
    }

    /// 제안은 미리보기다 — 이유가 함께 오고, 누르기 전에는 아무것도 저장되지 않는다(§79).
    func testProposalExplainsItself() throws {
        let board = try loadBoard()
        let proposal = try XCTUnwrap(board.proposal)
        XCTAssertFalse(proposal.headline.isEmpty)
        XCTAssertFalse(proposal.picks.isEmpty)
        for pick in proposal.picks {
            XCTAssertFalse(pick.reasons.isEmpty, "왜 그 날인지 말하지 않는 제안은 없다")
            XCTAssertGreaterThanOrEqual(pick.dayIndex, 0)
        }
    }

    func testGroupContextSummarizesWithoutDeciding() throws {
        let board = try loadBoard()
        XCTAssertFalse(board.groupContext.isEmpty)
        for line in board.groupContext {
            XCTAssertFalse(line.isEmpty)
        }
    }

    /// 서버가 모르는 값을 보내도 앱이 죽지 않는다(§10) — 화면은 '알 수 없음'으로 그리고 계속 간다.
    func testUnknownEnumValuesDecodeSafely() throws {
        let json = Data("""
        {"schemaVersion":1,"tripId":"t","role":"ARCHIVIST","memberCount":2,
         "canPropose":true,"canReact":true,"groups":[{"key":"BRAND_NEW","title":"새 묶음","candidates":[]}],
         "proposal":null,"groupContext":[]}
        """.utf8)
        let board = try JSONDecoder().decode(CandidateBoardResponse.self, from: json)
        XCTAssertEqual(board.role, .unknown)
        XCTAssertEqual(board.groups.first?.key, .unknown)
        XCTAssertEqual(board.groups.first?.title, "새 묶음")
    }
}
