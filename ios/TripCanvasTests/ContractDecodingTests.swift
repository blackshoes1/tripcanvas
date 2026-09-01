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
