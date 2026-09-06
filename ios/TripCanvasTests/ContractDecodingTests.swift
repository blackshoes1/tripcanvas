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

/// 일자 계획 — 일정 화면이 쓰는 하루치.
///
/// 픽스처는 `swiftParity.test.ts`가 **실제 응답으로** 다시 쓴다. 계약이 바뀌면 여기가 먼저 깨진다.
/// ⚠️ 특히 '분'은 서버 타임라인에서 소수로 나오는데, 계약이 정수로 반올림해 보낸다 —
///    안 그러면 이 디코딩이 죽는다. 그 사고는 앱 빌드까지 아무도 모른다.
final class DayPlanDecodingTests: XCTestCase {

    private func loadFixture() throws -> DayPlanResponse {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "day-plan", withExtension: "json"),
            "day-plan.json 픽스처를 테스트 번들에 포함시켜야 합니다")
        return try JSONDecoder().decode(DayPlanResponse.self, from: Data(contentsOf: url))
    }

    func testDecodesRealServerResponse() throws {
        let plan = try loadFixture()
        XCTAssertEqual(plan.schemaVersion, 1)
        XCTAssertEqual(plan.day.index, 0)
        XCTAssertFalse(plan.day.spots.isEmpty)
        XCTAssertEqual(plan.trip.name, "정합성")
    }

    /// 서버에는 구간 캐시가 없다 — 화면이 "예상"이라고 말할 수 있어야 한다.
    func testSaysWhenTravelTimeIsAnEstimate() throws {
        let plan = try loadFixture()
        XCTAssertEqual(plan.travelTimeSource, .straightLineEstimate)
        for spot in plan.day.spots {
            if let leg = spot.incomingLeg { XCTAssertEqual(leg.source, .straightLineEstimate) }
        }
    }

    /// 시각 3종을 구분해 받는다 — 예상 도착 · 도착 고정(📌) · 상대가 정한 약속.
    func testKeepsTheThreeKindsOfTimeApart() throws {
        let plan = try loadFixture()
        let booked = plan.day.spots.first { $0.bookedAtMinutes != nil }
        XCTAssertNotNil(booked, "픽스처에 예약 시각이 있는 장소가 있어야 한다")
        XCTAssertGreaterThan(booked!.waitMinutes, 0, "일찍 도착하면 기다리는 시간이 잡힌다")
    }

    /// 계약이 문장이 아니라 값을 싣는지 — 앱이 서버가 만든 한국어를 그리면 안 된다.
    func testCarriesValuesNotSentences() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "day-plan", withExtension: "json"))
        let raw = try String(contentsOf: url, encoding: .utf8)
        XCTAssertFalse(raw.contains("📏"), "완성된 문장이 계약에 들어오면 앱이 표기를 정할 수 없다")
        XCTAssertFalse(raw.contains("하루 동선"))
    }
}
