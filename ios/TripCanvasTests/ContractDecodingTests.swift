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

    /// 항공편은 실제 응답에서 디코딩되고, 한 줄 표기는 웹 `flightHtml`과 같은 짜임이다.
    func testDecodesTheDayFlight() throws {
        let flight = try XCTUnwrap(loadFixture().day.flight, "픽스처의 첫날에는 항공편이 있다")
        XCTAssertEqual(flight.code, "IB3100")
        XCTAssertEqual(flight.dep, "MAD")
        XCTAssertEqual(flight.arr, "SVQ")
        XCTAssertEqual(flight.depMinutes, 8 * 60 + 5)
        XCTAssertEqual(flight.arrMinutes, 9 * 60)
        XCTAssertEqual(flight.line, "IB3100 · MAD 08:05 → SVQ 09:00")
    }

    /// 없는 조각은 말하지 않는다 — 빈 칸을 지어내면 `MAD  → ` 같은 줄이 나온다.
    func testFlightLineLeavesOutWhatIsNotWritten() {
        XCTAssertEqual(DayPlanFlight(code: "KE703", dep: "", arr: "", depMinutes: nil, arrMinutes: nil).line, "KE703")
        XCTAssertEqual(DayPlanFlight(code: "", dep: "ICN", arr: "NRT", depMinutes: nil, arrMinutes: nil).line, "ICN → NRT")
        XCTAssertEqual(DayPlanFlight(code: "", dep: "", arr: "", depMinutes: 550, arrMinutes: nil).line, "09:10")
        // 아무것도 없으면 빈 문자열이고, 그때 화면은 줄을 그리지 않는다.
        XCTAssertEqual(DayPlanFlight(code: "", dep: "", arr: "", depMinutes: nil, arrMinutes: nil).line, "")
    }

    /// 조회되지 않은 구간이 섞여 있으면 추정이다 — 화면이 "예상"이라고 말할 수 있어야 한다.
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

/// 자연어 요청의 에코(M8 ③). **해석은 서버가 한다** — 앱은 값을 디코딩하고 문장을 그릴 뿐이다.
final class IntentEchoDecodingTests: XCTestCase {
    private func loadToday() throws -> TodayResponse {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "today", withExtension: "json"),
                                "today.json 픽스처를 테스트 번들에 포함시켜야 합니다")
        return try JSONDecoder().decode(TodayResponse.self, from: Data(contentsOf: url))
    }

    func testDecodesWhatTheServerUnderstood() throws {
        let echo = try XCTUnwrap(loadToday().intent, "파리티 요청에 문장이 있다")
        XCTAssertEqual(echo.text, "오늘 좀 피곤해서 많이 걷기 싫어")
        XCTAssertTrue(echo.understood)
        XCTAssertEqual(echo.energyLevel, .low)
        XCTAssertEqual(echo.maxTravelMinutes, 20)
        XCTAssertTrue(echo.walkAverse)
        XCTAssertFalse(echo.mealFocus)
        XCTAssertEqual(echo.echoLine, "이렇게 이해했어요 — 쉬고 싶다고 하셨어요 · 많이 걷지 않는 쪽으로 볼게요")
    }

    /// 못 알아들었으면 **그렇게 말한다** — 알아들은 척하고 아무 제안이나 내놓지 않는다.
    func testSaysSoWhenItDidNotUnderstand() {
        let echo = IntentEcho(text: "asdfgh", understood: false, reasons: [], energyLevel: .normal,
                              maxTravelMinutes: nil, walkAverse: false, mealFocus: false, wantRest: false)
        XCTAssertEqual(echo.echoLine, "그 문장은 아직 못 알아들었어요 — 아래 컨디션으로 알려 주세요")
    }

    /// ⚠️ 옛 서버는 이 키를 보내지 않는다 — 옵셔널이 아니면 앱이 오늘 화면을 통째로 못 읽는다.
    func testOlderServersWithoutTheKeyStillDecode() throws {
        var raw = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf:
            XCTUnwrap(Bundle(for: Self.self).url(forResource: "today", withExtension: "json")))) as? [String: Any])
        raw.removeValue(forKey: "intent")
        let data = try JSONSerialization.data(withJSONObject: raw)
        let decoded = try JSONDecoder().decode(TodayResponse.self, from: data)
        XCTAssertNil(decoded.intent)
    }
}

/// 밖에서 들어온 주소를 여는 규칙(M8). 웹 `safeUrl()`과 같다 — `http`·`https`만 연다.
final class SafeURLTests: XCTestCase {
    func testOpensOnlyWebLinks() {
        XCTAssertEqual(SafeURL.web("https://example.com/booking")?.absoluteString, "https://example.com/booking")
        XCTAssertEqual(SafeURL.web("  http://example.com  ")?.absoluteString, "http://example.com")
    }

    /// 스킴 하나 잘못 열면 그건 우리가 연 것이 된다.
    func testRefusesEverythingElse() {
        for raw in ["javascript:alert(1)", "file:///etc/passwd", "tripcanvas://trip/1", "data:text/html,<b>x", "", "   "] {
            XCTAssertNil(SafeURL.web(raw), "\(raw)는 열지 않는다")
        }
        XCTAssertNil(SafeURL.web(nil))
    }

    /// ⚠️ `scheme.hasPrefix("http")`로 봤으면 통과했을 것들.
    func testDoesNotFallForSchemesThatMerelyStartWithHttp() {
        XCTAssertNil(SafeURL.web("httpfoo://example.com"))
        XCTAssertNil(SafeURL.web("https-evil://example.com"))
    }

    /// 호스트가 없으면 열 곳이 없다.
    func testRefusesLinksWithoutAHost() {
        XCTAssertNil(SafeURL.web("https://"))
        XCTAssertNil(SafeURL.web("http:///path"))
    }
}
