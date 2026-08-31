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

    func testFixedCommitmentIsDistinguishable() throws {
        let today = try loadTodayFixture()
        let fixed = today.activities.filter(\.isFixedCommitment)
        XCTAssertFalse(fixed.isEmpty, "예약된 일정은 다른 일정과 구분돼야 한다")
        XCTAssertEqual(today.fixedCommitments.first?.title, fixed.first?.name)
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
