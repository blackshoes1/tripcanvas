import XCTest
@testable import TripCanvas

final class NowFocusTests: XCTestCase {
    func testDecodesTheRealServerCurrentStayFixturePastItsPlannedEnd() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "travel-current-stay", withExtension: "json"))
        let response = try JSONDecoder().decode(TravelStateResponse.self, from: Data(contentsOf: url))
        let focus = try XCTUnwrap(response.today.nowFocus)
        XCTAssertEqual(focus.kind, .currentStay)
        XCTAssertEqual(focus, response.liveActivity.nowFocus)
        let current = try XCTUnwrap(response.today.activities.first(where: { $0.id == focus.currentStay?.target.activityId }))
        XCTAssertLessThan(current.endMinutes, response.today.currentState.nowMinutes)
        XCTAssertEqual(response.today.displayedNextAction?.activityId, current.id)
        XCTAssertNotNil(focus.currentStay?.expiresAtISO)
        XCTAssertNotNil(focus.next?.target)
        let state = TripCanvasActivityAttributes.ContentState(from: response.liveActivity)
        let decoded = try JSONDecoder().decode(TripCanvasActivityAttributes.ContentState.self, from: JSONEncoder().encode(state))
        XCTAssertEqual(decoded.nowFocus, focus)
        XCTAssertEqual(ActivityPresentation.target(decoded), focus.currentStay?.target)
    }
    private let a = LiveActivityTarget(dayIndex: 0, activityId: "d0s0", revision: 2)
    private let b = LiveActivityTarget(dayIndex: 0, activityId: "d0s1", revision: 2)

    private func focus(_ kind: NowFocus.Kind, status: TravelStatus = .inProgress, text: String = "다음 장소로 출발할 때예요") -> NowFocus {
        .init(kind: kind,
              currentStay: kind == .freeTime ? nil : .init(target: a, title: "머무는 카페", status: status, expiresAtISO: "2026-11-01T00:00:00.000Z"),
              next: .init(target: b, title: "다음 미술관", startAtISO: "2026-10-31T14:00:00.000Z",
                          leaveAtISO: "2026-10-31T13:30:00.000Z", travelMinutes: 20, departureText: text),
              switchAtISO: "2026-10-31T13:18:00.000Z")
    }

    private func today(_ focus: NowFocus?, legacy: String = "d0s0") throws -> TodayResponse {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "today", withExtension: "json"))
        var raw = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        raw["nowFocus"] = try focus.map { try JSONSerialization.jsonObject(with: JSONEncoder().encode($0)) }
        var next = raw["nextAction"] as! [String: Any]
        next["activityId"] = legacy; next["title"] = legacy == "d0s0" ? "머무는 카페" : "다음 미술관"
        next["status"] = "IN_PROGRESS"; raw["nextAction"] = next
        var activities = raw["activities"] as! [[String: Any]]
        activities[0]["name"] = "머무는 카페"; activities[1]["name"] = "다음 미술관"; raw["activities"] = activities
        return try JSONDecoder().decode(TodayResponse.self, from: JSONSerialization.data(withJSONObject: raw))
    }

    private func content(_ focus: NowFocus?) throws -> TripCanvasActivityAttributes.ContentState {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "travel-state", withExtension: "json"))
        let response = try JSONDecoder().decode(TravelStateResponse.self, from: Data(contentsOf: url))
        var state = TripCanvasActivityAttributes.ContentState(from: response.liveActivity)
        state.nowFocus = focus; state.nextTitle = "머무는 카페"; state.target = a
        state.status = .inProgress; state.travelMinutes = 0
        return state
    }

    func testVerifiedCurrentStayRemainsPrimaryWhileLegacyNextHasAdvanced() throws {
        let today = try today(focus(.currentStay), legacy: "d0s1")
        XCTAssertEqual(today.displayedNextAction?.activityId, a.activityId)
        XCTAssertEqual(today.displayedNextAction?.title, "머무는 카페")
        XCTAssertEqual(today.displayedNextAction?.status, .inProgress)
        XCTAssertNil(today.displayedNextAction?.travelMinutes)
        let state = try content(focus(.currentStay))
        XCTAssertEqual(ActivityPresentation.title(state), "머무는 카페")
        XCTAssertEqual(ActivityPresentation.target(state), a)
        XCTAssertNil(ActivityPresentation.travelMinutes(state))
        XCTAssertEqual(state.nowFocus?.leaveAt, ISO8601DateFormatter.tripCanvasDate("2026-10-31T13:30:00Z"))
    }

    func testDepartureFocusSelectsFollowingPlaceEvenWhileLegacyStillSaysArrivedAtA() throws {
        let today = try today(focus(.departure, status: .arrived))
        XCTAssertEqual(today.displayedNextAction?.activityId, b.activityId)
        XCTAssertEqual(today.displayedNextAction?.title, "다음 미술관")
        let state = try content(focus(.departure, status: .arrived))
        XCTAssertEqual(ActivityPresentation.title(state), "다음 미술관")
        XCTAssertEqual(ActivityPresentation.target(state), b)
        XCTAssertEqual(ActivityPresentation.heading(state), "다음")
        XCTAssertEqual(ActivityPresentation.travelMinutes(state), 20)
        XCTAssertEqual(ActivityPresentation.headline(state), "다음 장소로 출발할 때예요")
    }

    func testUnverifiedScheduleKeepsLegacyCurrentPlaceEvenIfFollowingPlaceIsHoursAway() throws {
        let today = try today(focus(.schedule))
        XCTAssertEqual(today.displayedNextAction, today.nextAction)
        let state = try content(focus(.schedule))
        XCTAssertEqual(ActivityPresentation.title(state), "머무는 카페")
        XCTAssertEqual(ActivityPresentation.target(state), a)
        XCTAssertEqual(ActivityPresentation.heading(state), "지금")
        XCTAssertEqual(ActivityPresentation.travelMinutes(state), 0)
    }

    func testFreeTimeDoesNotClaimALocationOrLinkToAnUnverifiedPlace() throws {
        XCTAssertNil(try today(focus(.freeTime)).displayedNextAction)
        let state = try content(focus(.freeTime))
        XCTAssertEqual(ActivityPresentation.title(state), "자유시간")
        XCTAssertNil(ActivityPresentation.target(state))
        XCTAssertNil(ActivityPresentation.travelMinutes(state))
        XCTAssertEqual(LiveActivityLink.url(tripId: "trip", target: ActivityPresentation.target(state))?.path, "/trip/today")
    }

    func testEarlyArrivalKeepsTheArrivalAcknowledgement() throws {
        let state = try content(focus(.currentStay, status: .arrived))
        XCTAssertEqual(ActivityPresentation.headline(state), "도착했어요")
        XCTAssertEqual(try today(focus(.currentStay, status: .arrived)).displayedNextAction?.status, .arrived)
    }

    func testLegacyAndUnknownFocusRemainDecodableAndKeepLegacyPresentation() throws {
        for focus in [nil, focus(.unknown)] {
            let today = try today(focus)
            XCTAssertEqual(today.displayedNextAction, today.nextAction)
            let state = try content(focus)
            XCTAssertEqual(ActivityPresentation.title(state), state.nextTitle)
            XCTAssertEqual(ActivityPresentation.target(state), state.target)
        }
    }

    func testRecoveryAddsNewFocusToOldActivityOnceButIgnoresMinuteOnlyCopyChanges() throws {
        let old = try content(nil), current = try content(focus(.currentStay))
        XCTAssertTrue(LiveActivityRecovery.shouldRefresh(current: old, latest: current, changed: false))
        var latest = current
        latest.nowFocus = focus(.currentStay, text: "다음 장소까지 19분 여유가 있어요")
        XCTAssertFalse(LiveActivityRecovery.shouldRefresh(current: current, latest: latest, changed: false))
        latest.stateVersion += "-new-phase"
        XCTAssertTrue(LiveActivityRecovery.shouldRefresh(current: current, latest: latest, changed: false))
    }

    func testNextRefreshIncludesTheServerFocusSwitchBeforeDeparture() throws {
        var today = try today(focus(.currentStay))
        var raw = try JSONSerialization.jsonObject(with: JSONEncoder().encode(today)) as! [String: Any]
        raw["generatedAt"] = "2026-10-31T13:17:30.000Z"
        var day = raw["day"] as! [String: Any]; day["date"] = "2026-10-31"; day["timeZone"] = "UTC"; raw["day"] = day
        raw["activities"] = []; raw["nextAction"] = NSNull()
        today = try JSONDecoder().decode(TodayResponse.self, from: JSONSerialization.data(withJSONObject: raw))
        XCTAssertEqual(TodayRefreshTiming.nextBoundary(for: today), today.nowFocus?.switchAt)
    }

    func testFocusLeaveAndProofExpiryAreRefreshBoundariesWithoutALegacyDeparture() throws {
        for (generated, focus, expected) in [
            ("2026-10-31T13:20:00.000Z", self.focus(.currentStay), "2026-10-31T13:30:00Z"),
            ("2026-10-31T13:20:00.000Z", NowFocus(kind: .currentStay,
                currentStay: .init(target: a, title: "머무는 카페", status: .inProgress, expiresAtISO: "2026-10-31T15:00:00Z"),
                next: nil, switchAtISO: nil), "2026-10-31T15:00:00Z")
        ] {
            var raw = try JSONSerialization.jsonObject(with: JSONEncoder().encode(today(focus))) as! [String: Any]
            raw["generatedAt"] = generated; raw["activities"] = []; raw["nextAction"] = NSNull()
            var day = raw["day"] as! [String: Any]; day["date"] = "2026-10-31"; day["timeZone"] = "UTC"; raw["day"] = day
            let today = try JSONDecoder().decode(TodayResponse.self, from: JSONSerialization.data(withJSONObject: raw))
            XCTAssertEqual(TodayRefreshTiming.nextBoundary(for: today), ISO8601DateFormatter.tripCanvasDate(expected))
        }
    }

    func testDepartureRefreshesAfterLeavingTimeWithoutPollingOtherFocusKinds() throws {
        var raw = try JSONSerialization.jsonObject(with: JSONEncoder().encode(today(focus(.departure)))) as! [String: Any]
        raw["generatedAt"] = "2026-10-31T14:15:00.500Z"; raw["activities"] = []; raw["nextAction"] = NSNull()
        var day = raw["day"] as! [String: Any]; day["date"] = "2026-10-31"; day["timeZone"] = "UTC"; raw["day"] = day
        var state = raw["currentState"] as! [String: Any]; state["live"] = true; raw["currentState"] = state
        var focus = raw["nowFocus"] as! [String: Any]
        var current = focus["currentStay"] as! [String: Any]; current["expiresAtISO"] = "2026-10-31T15:00:00Z"
        focus["currentStay"] = current; focus["switchAtISO"] = "2026-10-31T14:03:00Z"
        var next = focus["next"] as! [String: Any]
        next["startAtISO"] = "2026-10-31T15:00:00Z"; next["leaveAtISO"] = "2026-10-31T14:15:00Z"; focus["next"] = next
        for (kind, expected) in [(NowFocus.Kind.departure, "2026-10-31T14:16:00.500Z"),
                                 (.currentStay, "2026-10-31T15:00:00Z"), (.schedule, "2026-10-31T15:00:00Z")] {
            focus["kind"] = kind.rawValue; raw["nowFocus"] = focus
            let today = try JSONDecoder().decode(TodayResponse.self, from: JSONSerialization.data(withJSONObject: raw))
            XCTAssertEqual(TodayRefreshTiming.nextBoundary(for: today), ISO8601DateFormatter.tripCanvasDate(expected), kind.rawValue)
        }
        focus["kind"] = NowFocus.Kind.departure.rawValue
        current["expiresAtISO"] = "2026-10-31T14:15:30Z"; focus["currentStay"] = current; raw["nowFocus"] = focus
        let nearer = try JSONDecoder().decode(TodayResponse.self, from: JSONSerialization.data(withJSONObject: raw))
        XCTAssertEqual(TodayRefreshTiming.nextBoundary(for: nearer), ISO8601DateFormatter.tripCanvasDate("2026-10-31T14:15:30Z"))
        state["live"] = false; raw["currentState"] = state
        let preview = try JSONDecoder().decode(TodayResponse.self, from: JSONSerialization.data(withJSONObject: raw))
        XCTAssertNil(TodayRefreshTiming.nextBoundary(for: preview))
    }
}
