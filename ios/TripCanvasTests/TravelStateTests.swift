import XCTest
@testable import TripCanvas

/// 픽스처는 실제 서버 응답이다 — next의 swiftParity 테스트가 매번 다시 만든다.
/// 여기서 보는 것은 "그 응답으로 잠금화면·위젯·알림을 제대로 만들 수 있는가"다.
final class TravelStateTests: XCTestCase {

    private func fixture() throws -> TravelStateResponse {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "travel-state", withExtension: "json"),
            "travel-state.json 픽스처를 테스트 번들에 포함시켜야 합니다")
        return try JSONDecoder().decode(TravelStateResponse.self, from: Data(contentsOf: url))
    }

    func testDecodesRealTravelState() throws {
        let state = try fixture()
        XCTAssertEqual(state.schemaVersion, 1)
        XCTAssertFalse(state.stateVersion.isEmpty)
        XCTAssertNotEqual(state.pulse.code, .unknown)
        XCTAssertFalse(state.pulse.text.isEmpty)
        XCTAssertNotNil(state.departure)
    }

    /// 하루 상태를 사용자에게는 문장으로만 보여준다(§51) — 내부 코드가 새면 안 된다.
    ///
    /// ⚠️ "uppercased() == self" 로는 가릴 수 없다. 한글은 대소문자가 없어 그 비교가 **항상 참**이라
    /// 멀쩡한 한국어 문장이 전부 걸린다(이 테스트가 처음 돌자마자 그렇게 깨졌다).
    /// 코드는 영문 대문자·밑줄·숫자로만 이뤄진다(ON_TRACK · AHEAD) — 그 모양인지를 본다.
    func testPulseNeverLeaksInternalCode() throws {
        let state = try fixture()
        XCTAssertFalse(state.pulse.text.contains("_"), "코드가 문장 자리에 들어왔다: \(state.pulse.text)")
        XCTAssertFalse(looksLikeInternalCode(state.pulse.text), "코드가 문장 자리에 들어왔다: \(state.pulse.text)")
        XCTAssertFalse(looksLikeInternalCode(state.pulse.detail), "코드가 설명 자리에 들어왔다: \(state.pulse.detail)")
    }

    /// 영문 대문자·밑줄·숫자로만 이뤄졌으면 사람에게 보일 문장이 아니다.
    private func looksLikeInternalCode(_ text: String) -> Bool {
        guard !text.isEmpty else { return false }
        return text.allSatisfy { $0.isUppercase || $0 == "_" || $0.isNumber }
    }

    func testDepartureCarriesBufferAndSentence() throws {
        let departure = try XCTUnwrap(fixture().departure)
        XCTAssertGreaterThan(departure.bufferMinutes, 0, "안전 여유가 붙어야 한다")
        XCTAssertFalse(departure.text.isEmpty)
        XCTAssertFalse(departure.text.contains("출발하세요"), "명령형을 쓰지 않는다(§14)")
        XCTAssertNotEqual(departure.stage, .unknown)
        // 권장 출발 = 약속 − 이동 − 여유
        XCTAssertEqual(departure.leaveMinutes, departure.targetMinutes - departure.travelMinutes - departure.bufferMinutes)
    }

    /// 잠금화면·위젯 상태는 stateVersion을 공유한다 — 셋이 어긋나면 갱신 판단이 무너진다.
    func testStateVersionIsSharedAcrossSurfaces() throws {
        let state = try fixture()
        XCTAssertEqual(state.stateVersion, state.liveActivity.stateVersion)
        XCTAssertEqual(state.stateVersion, state.widget.stateVersion)
    }

    /// 잠긴 화면에 계속 떠 있는 정보다 — 예약번호·링크를 담지 않는다(§54).
    func testLockScreenCarriesNoSensitiveFields() throws {
        let state = try fixture()
        let data = try JSONEncoder().encode(state.liveActivity)
        let text = String(decoding: data, as: UTF8.self)
        ["confirmation", "bookUrl", "placeId", "bookingId"].forEach {
            XCTAssertFalse(text.contains($0), "\($0)는 잠금화면에 나가면 안 된다")
        }
    }

    func testWidgetSnapshotStaysSmall() throws {
        let widget = try fixture().widget
        XCTAssertLessThanOrEqual(widget.upcoming.count, 3, "위젯은 훑어보는 화면이다")
        XCTAssertFalse(widget.pulseText.isEmpty)
    }

    /// 기기가 판단하는 알림만 로컬로 띄운다 — 서버 것까지 띄우면 두 번 온다(§11).
    func testOnlyDeviceOriginNotificationsAreLocal() throws {
        let state = try fixture()
        let device = state.notifications.filter { $0.origin == .device }
        XCTAssertFalse(state.notifications.isEmpty)
        device.forEach { item in
            XCTAssertFalse(item.dedupeKey.isEmpty, "중복 제거 키가 없으면 같은 알림이 반복된다")
            XCTAssertTrue(item.deepLink.hasPrefix("tripcanvas://"), "홈이 아니라 그 화면으로 간다(§40)")
        }
    }

    func testActivityContentStateMapping() throws {
        let state = try fixture()
        let content = TripCanvasActivityAttributes.ContentState(from: state.liveActivity)
        XCTAssertEqual(content.nextTitle, state.liveActivity.nextTitle)
        XCTAssertEqual(content.stateVersion, state.stateVersion)
        XCTAssertEqual(content.travelMinutes, state.liveActivity.travelMinutes)
        if state.liveActivity.nextStartISO != nil {
            XCTAssertNotNil(content.nextStartAt, "ISO 시각을 Date로 못 읽으면 잠금화면 시계가 빈다")
        }
    }

    func testCompactTravelIsExtremelyShort() {
        XCTAssertEqual(ActivityPresentation.compactTravel(22), "22m")
        XCTAssertEqual(ActivityPresentation.compactTravel(0), "")
        XCTAssertEqual(ActivityPresentation.compactTravel(nil), "")
    }

    func testHeadlinePrefersDepartureSentence() throws {
        let state = try fixture()
        var content = TripCanvasActivityAttributes.ContentState(from: state.liveActivity)
        content.departureText = "이제 출발하면 여유 있게 도착할 수 있어요"
        XCTAssertEqual(ActivityPresentation.headline(content), content.departureText)
        content.departureText = nil
        XCTAssertEqual(ActivityPresentation.headline(content), content.pulseText)
    }
}

final class DeepLinkTests: XCTestCase {
    /// 모든 알림은 그 화면으로 바로 간다(§40) — generic home으로 보내지 않는다.
    func testParsesEveryNotificationDestination() throws {
        XCTAssertEqual(
            DeepLink.parse(URL(string: "tripcanvas://trip/t1/today?focus=d0s1")!),
            .today(tripId: "t1", focusActivityId: "d0s1"))
        XCTAssertEqual(DeepLink.parse(URL(string: "tripcanvas://trip/t1/today")!), .today(tripId: "t1", focusActivityId: nil))
        XCTAssertEqual(DeepLink.parse(URL(string: "tripcanvas://trip/t1/replan")!), .replan(tripId: "t1"))
        XCTAssertEqual(DeepLink.parse(URL(string: "tripcanvas://trip/t1/bookings")!), .bookings(tripId: "t1"))
        XCTAssertEqual(
            DeepLink.parse(URL(string: "tripcanvas://trip/t1/suggestion/abc%7Cdef")!),
            .suggestion(tripId: "t1", suggestionId: "abc|def"))
    }

    func testRejectsForeignOrBrokenLinks() {
        XCTAssertNil(DeepLink.parse(URL(string: "https://tripcanvas-ai.vercel.app/today")!))
        XCTAssertNil(DeepLink.parse(URL(string: "tripcanvas://trip/t1")!))
        XCTAssertNil(DeepLink.parse(URL(string: "tripcanvas://trip/t1/unknown")!))
        XCTAssertNil(DeepLink.parse(URL(string: "tripcanvas://trip/t1/suggestion")!))
    }

    func testTripIdIsAlwaysAvailable() {
        XCTAssertEqual(DeepLink.today(tripId: "x", focusActivityId: nil).tripId, "x")
        XCTAssertEqual(DeepLink.suggestion(tripId: "y", suggestionId: "s").tripId, "y")
    }
}

final class TravelModeSnapshotTests: XCTestCase {
    /// 앱이 죽었다 살아나도 "무엇을 이미 알렸는지"가 남아야 한다 — 안 그러면 같은 알림이 또 간다.
    func testSnapshotRoundTrips() throws {
        let snapshot = TravelModeSnapshot(
            state: .active, tripId: "t1", dayIndex: 0, startedAt: Date(timeIntervalSince1970: 1_800_000_000),
            suppressUntil: nil, lastStateVersion: "vabc", sentNotificationKeys: ["t1|2026-09-01|departureReminder|d0s1|READY_TO_LEAVE"])
        let data = try JSONEncoder().encode(snapshot)
        let decoded = try JSONDecoder().decode(TravelModeSnapshot.self, from: data)
        XCTAssertEqual(decoded, snapshot)
        XCTAssertTrue(decoded.isActive)
    }

    func testInactiveByDefault() {
        XCTAssertFalse(TravelModeSnapshot().isActive)
        XCTAssertTrue(TravelModeSnapshot().sentNotificationKeys.isEmpty)
    }
}
