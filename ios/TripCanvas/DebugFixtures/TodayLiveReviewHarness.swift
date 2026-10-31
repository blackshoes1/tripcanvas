#if DEBUG
import SwiftUI
import Observation
import ActivityKit

/// 오늘이 여행 중인 합성 여행으로 **실제 `지금` 화면**(`TodayView`)을 띄운다 — 계정에 로그인하지 않고
/// '여행 중 안내' 띠가 어디에 어떻게 나오는지 본다. 내용은 테스트 픽스처 `today.json`과 같다(`todayIndex` 0 = 여행 중).
@MainActor struct TodayLiveReviewHarness: View {
    @State private var model: TodayViewModel?
    @State private var source: TodayLiveReviewSource?
    @State private var movedActivity: String?
    @State private var openedActivity: String?
    @State private var liveReviewStatus = ""
    private let response: TodayResponse?

    init(response: TodayResponse? = nil) {
        self.response = response ?? Self.makeResponse()
    }

    var body: some View {
        NavigationStack {
            if let response, let model {
                TodayView(trip: response.trip, model: model, onOpenPlan: {}, onOpenActivity: { day, activity in
                    openedActivity = "Day \(day + 1) · \(activity.name)"
                }, onMoveActivity: { day, activity, revision in
                    movedActivity = "Day \(day + 1) · \(activity.name) · 변경 기준 \(revision)"
                })
                    .navigationTitle(response.trip.name)
                    .navigationBarTitleDisplayMode(.inline)
                    .safeAreaInset(edge: .bottom) {
                        if let movedActivity { Text(movedActivity).accessibilityIdentifier("todayMoveRequested") }
                        if let openedActivity { Text(openedActivity).accessibilityIdentifier("todayOpenRequested") }
                        if !liveReviewStatus.isEmpty { Text(liveReviewStatus).accessibilityIdentifier("nowLiveReviewStatus") }
                        if ProcessInfo.processInfo.arguments.contains("--review-today-scroll"), let source {
                            Text("오늘 조회 \(source.loads)회").accessibilityIdentifier("todayReviewLoads")
                        }
                    }
            } else if response == nil {
                Text("합성 오늘 화면을 읽지 못했어요")
            }
        }
        .task {
            guard let response, model == nil else { return }
            let source = TodayLiveReviewSource(response: response)
            self.source = source
            model = TodayViewModel(trip: response.trip, service: source)
            if ProcessInfo.processInfo.arguments.contains("--review-now-lockscreen") {
                try? await Task.sleep(for: .milliseconds(500))
                for old in Activity<TripCanvasActivityAttributes>.activities where old.attributes.tripId == "synthetic-now-focus-review" {
                    await old.end(nil, dismissalPolicy: .immediate)
                }
                let state = LiveActivityState(nowFocus: response.nowFocus, shouldEnd: false, target: response.nowFocus?.focusedTarget,
                    scheduleElapsed: false, tripName: "합성 지금 안내", dayLabel: "Day 1", status: response.nextAction?.status ?? .upcoming,
                    nextTitle: response.nextAction?.title ?? "", nextStartISO: nil, travelMinutes: 20, departureText: nil,
                    fixedTitle: nil, fixedStartISO: nil, pulseText: "합성 자료 · 실제 여행 아님", stateVersion: UUID().uuidString)
                do {
                    _ = try Activity.request(attributes: TripCanvasActivityAttributes(tripId: "synthetic-now-focus-review",
                        tripName: "합성 지금 안내", dayLabel: "Day 1"), content: ActivityContent(state: .init(from: state),
                        staleDate: TodayRefreshTiming.nextBoundary(for: response)?.addingTimeInterval(30)), pushType: nil)
                    liveReviewStatus = "합성 잠금화면 안내 생성 완료"
                } catch { liveReviewStatus = "합성 잠금화면 안내 생성 실패" }
            }
        }
    }

    private static func makeResponse() -> TodayResponse? {
        guard var raw = try? JSONSerialization.jsonObject(with: Data(fixture.utf8)) as? [String: Any] else { return nil }
        raw["generatedAt"] = ISO8601DateFormatter().string(from: Date())
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("--review-now-stay") || arguments.contains("--review-now-departure") || arguments.contains("--review-now-free") {
            let kind = arguments.contains("--review-now-free") ? "FREE_TIME" : (arguments.contains("--review-now-departure") ? "DEPARTURE" : "CURRENT_STAY")
            let formatter = ISO8601DateFormatter(), now = Date()
            let focus: [String: Any] = ["kind": kind,
                "currentStay": kind == "FREE_TIME" ? NSNull() : ["target": ["dayIndex": 0, "activityId": "d0s0", "revision": 2],
                    "title": "머무는 카페", "status": "ARRIVED", "expiresAtISO": formatter.string(from: now.addingTimeInterval(6 * 3600))],
                "next": ["target": ["dayIndex": 0, "activityId": "d0s1", "revision": 2], "title": "다음 미술관",
                    "startAtISO": formatter.string(from: now.addingTimeInterval(90 * 60)),
                    "leaveAtISO": formatter.string(from: now.addingTimeInterval(kind == "DEPARTURE" ? 5 * 60 : 60 * 60)), "travelMinutes": 20,
                    "departureText": "이제 다음 미술관으로 출발하면 여유 있게 도착해요"],
                "switchAtISO": formatter.string(from: now.addingTimeInterval(kind == "DEPARTURE" ? -7 * 60 : 48 * 60))]
            raw["nowFocus"] = focus; raw["calmMoment"] = NSNull()
            for key in ["activities", "remainingActivities"] {
                var activities = raw[key] as? [[String: Any]] ?? []
                activities[0]["name"] = "머무는 카페"; activities[0]["status"] = "IN_PROGRESS"
                activities[1]["name"] = "다음 미술관"; raw[key] = activities
            }
            var next = raw["nextAction"] as? [String: Any] ?? [:]
            next["activityId"] = kind == "DEPARTURE" ? "d0s0" : "d0s1"
            next["title"] = kind == "DEPARTURE" ? "머무는 카페" : "다음 미술관"
            raw["nextAction"] = next
        }
        if ProcessInfo.processInfo.arguments.contains("--review-time-current") {
            var next = raw["nextAction"] as? [String: Any] ?? [:]
            next["status"] = "IN_PROGRESS"
            raw["nextAction"] = next
            for key in ["activities", "remainingActivities"] {
                var activities = raw[key] as? [[String: Any]] ?? []
                for index in activities.indices where activities[index]["id"] as? String == "d0s1" {
                    activities[index]["status"] = "IN_PROGRESS"
                }
                raw[key] = activities
            }
        }
        if ProcessInfo.processInfo.arguments.contains("--review-time-elapsed") {
            raw["nextAction"] = NSNull()
            var activityState = raw["activityState"] as? [String: Any] ?? [:]
            activityState["status"] = "COMPLETED"
            raw["activityState"] = activityState
        }
        if ProcessInfo.processInfo.arguments.contains("--review-today-badges") {
            for key in ["activities", "remainingActivities"] {
                var activities = raw[key] as? [[String: Any]] ?? []
                for index in activities.indices {
                    activities[index]["mustVisit"] = true
                    activities[index]["flexibility"] = "FIXED"
                }
                raw[key] = activities
            }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: raw) else { return nil }
        return try? JSONDecoder().decode(TodayResponse.self, from: data)
    }

    static let fixture = #"""
{"schemaVersion": 1, "generatedAt": "2026-09-01T04:00:00Z", "travelTimeSource": "STRAIGHT_LINE_ESTIMATE", "trip": {"id": "parity", "name": "정합성", "start": "2026-09-01", "dayCount": 2, "revision": 2, "updatedAt": "2026-08-31T00:00:00Z", "timeZone": "Asia/Seoul", "cities": ["마드리드"], "todayIndex": 0, "daysUntilStart": null, "role": "OWNER", "memberCount": 1}, "day": {"index": 0, "date": "2026-09-01", "title": "첫날", "mode": "car", "startMinutes": 540, "spotCount": 2, "timeZone": "Asia/Seoul"}, "currentState": {"currentDay": 0, "todayIndex": 0, "dayCount": 2, "live": true, "nowMinutes": 780, "dayStartMinutes": 540, "dayEndMinutes": 1260, "availableMinutes": 358, "delayMinutes": 240, "travelMinutesToday": 2, "planningMode": "ASSISTED", "energyLevel": "LOW", "completedActivityIds": [], "remainingActivityIds": ["d0s0", "d0s1"], "skippedActivityIds": [], "currentLocation": {"lat": 40.4, "lng": -3.7}}, "nextAction": {"activityId": "d0s1", "title": "저녁 예약", "status": "UPCOMING", "travelMinutes": 2, "etaMinutes": 542, "startMinutes": 1140, "stayMinutes": 90, "departure": {"leaveMinutes": 1138, "slackMinutes": 358, "level": "EARLY", "text": "18:58쯤 출발하면 19:00 예약에 맞춰요 · 그 전까지 5시간 58분 여유가 있어요"}, "location": {"lat": 40.41, "lng": -3.7}, "type": "HOTEL", "flexibility": "FIXED", "reasons": ["18:58쯤 출발하면 19:00 예약에 맞춰요 · 그 전까지 5시간 58분 여유가 있어요"]}, "suggestions": [{"id": "parity|2026-09-01|REST|조금 더 쉬기", "type": "REST", "title": "조금 더 쉬기", "description": "지금 쉬어도 남은 일정에는 여유가 있어요", "reasons": ["지금은 체력을 아끼는 편이 나아요", "저녁 예약까지 5시간 58분 여유가 있어요"], "impact": {"timeChangeMinutes": 90, "addedActivities": [], "removedActivities": []}, "action": {"kind": "REST", "activityId": null, "fromDay": null, "bookingId": null, "dropActivityIds": [], "startMinutes": 780}, "acceptable": true}, {"id": "parity|2026-09-01|RETURN_TO_HOTEL|숙소로 돌아가기", "type": "REST", "title": "숙소로 돌아가기", "description": "지금 쉬어도 남은 일정에는 여유가 있어요", "reasons": ["숙소까지 약 2분", "숙소에 들렀다 가도 저녁 예약 시간에는 여유가 있어요"], "impact": {"timeChangeMinutes": 2, "addedActivities": [], "removedActivities": []}, "action": {"kind": "RETURN_TO_HOTEL", "activityId": null, "fromDay": null, "bookingId": null, "dropActivityIds": [], "startMinutes": 780}, "acceptable": true}, {"id": "parity|2026-09-01|VISIT_PLACE|공원", "type": "NEXT_ACTIVITY", "title": "공원", "description": "약 1분 이동 · 13:01 도착 · 14:31까지", "reasons": ["앞 일정에서 이동 약 1분", "Day 2 일정에서 옮겨올 수 있어요", "다음 일정 저녁 예약 가는 길에 들를 수 있어요", "약 1시간 30분이면 둘러볼 수 있어요"], "impact": {"timeChangeMinutes": 91, "addedActivities": ["공원"], "removedActivities": []}, "action": {"kind": "MOVE_TO_TODAY", "activityId": null, "fromDay": 1, "bookingId": null, "dropActivityIds": [], "startMinutes": 780}, "acceptable": true}], "remainingActivities": [{"id": "d0s0", "choiceState": null, "name": "숙소", "city": "마드리드", "desc": "", "status": "PLANNED", "flexibility": "SEMI_FIXED", "type": "HOTEL", "etaMinutes": 540, "startMinutes": 540, "endMinutes": 540, "stayMinutes": 0, "travelInMinutes": 0, "fixedAtMinutes": null, "location": {"lat": 40.4, "lng": -3.7}, "mustVisit": false, "optional": false, "bookingId": null, "bookUrl": null, "placeId": null}, {"id": "d0s1", "choiceState": null, "name": "저녁 예약", "city": "마드리드", "desc": "", "status": "PLANNED", "flexibility": "FIXED", "type": "HOTEL", "etaMinutes": 542, "startMinutes": 1140, "endMinutes": 1230, "stayMinutes": 90, "travelInMinutes": 2, "fixedAtMinutes": 1140, "location": {"lat": 40.41, "lng": -3.7}, "mustVisit": false, "optional": false, "bookingId": "bk1", "bookUrl": "https://example.com", "placeId": null}], "activities": [{"id": "d0s0", "choiceState": null, "name": "숙소", "city": "마드리드", "desc": "", "status": "PLANNED", "flexibility": "SEMI_FIXED", "type": "HOTEL", "etaMinutes": 540, "startMinutes": 540, "endMinutes": 540, "stayMinutes": 0, "travelInMinutes": 0, "fixedAtMinutes": null, "location": {"lat": 40.4, "lng": -3.7}, "mustVisit": false, "optional": false, "bookingId": null, "bookUrl": null, "placeId": null}, {"id": "d0s1", "choiceState": null, "name": "저녁 예약", "city": "마드리드", "desc": "", "status": "PLANNED", "flexibility": "FIXED", "type": "HOTEL", "etaMinutes": 542, "startMinutes": 1140, "endMinutes": 1230, "stayMinutes": 90, "travelInMinutes": 2, "fixedAtMinutes": 1140, "location": {"lat": 40.41, "lng": -3.7}, "mustVisit": false, "optional": false, "bookingId": "bk1", "bookUrl": "https://example.com", "placeId": null}], "fixedCommitments": [{"id": "fc-d0s0", "activityId": "d0s0", "type": "HOTEL", "title": "숙소", "startMinutes": 540, "endMinutes": 540, "location": {"lat": 40.4, "lng": -3.7}, "flexibility": "SEMI_FIXED"}, {"id": "fc-d0s1", "activityId": "d0s1", "type": "HOTEL", "title": "저녁 예약", "startMinutes": 1140, "endMinutes": 1230, "location": {"lat": 40.41, "lng": -3.7}, "flexibility": "FIXED"}], "replan": {"needed": false, "feasible": true, "lateMinutes": 0, "before": ["저녁 예약"], "after": ["저녁 예약"], "dropActivityIds": [], "dropNames": [], "movesToNextDay": true, "impact": {"timeChangeMinutes": 0, "removedActivities": [], "addedActivities": []}, "note": null}, "activityState": {"tripName": "정합성", "dayLabel": "Day 1", "nextTitle": "저녁 예약", "startAtISO": "2026-09-01T10:00:00Z", "travelMinutes": 2, "status": "UPCOMING"}, "intent": {"text": "오늘 좀 피곤해서 많이 걷기 싫어", "understood": true, "reasons": ["쉬고 싶다고 하셨어요", "많이 걷지 않는 쪽으로 볼게요"], "energyLevel": "LOW", "maxTravelMinutes": 20, "walkAverse": true, "mealFocus": false, "wantRest": false}, "notice": null, "calmMoment": {"state": "CHECK", "text": "이동 정보가 부족해 출발 여유를 확인해야 해요.", "expiresAt": "2026-09-01T04:01:00.000Z"}, "tomorrowBrief": null}
"""#
}

@Observable @MainActor private final class TodayLiveReviewSource: TripDataSource {
    let response: TodayResponse
    var loads = 0
    init(response: TodayResponse) { self.response = response }
    func today(tripId: String, dayIndex: Int?, intent: String?, energy: EnergyLevel?) async throws -> TripService.Fetched<TodayResponse> {
        loads += 1
        return .init(value: response, cachedAt: ProcessInfo.processInfo.arguments.contains("--review-now-offline") ? Date().addingTimeInterval(-600) : nil)
    }
    func trips() async throws -> TripService.Fetched<[TripSummary]> { .init(value: [response.trip], cachedAt: nil) }
    func bookings(tripId: String) async throws -> TripService.Fetched<[BookingSummary]> { throw APIError.offline }
    func createTrip(_ draft: NewTripDraft) async throws -> TripSummary { throw APIError.offline }
    func parseItinerary(text: String) async throws -> ItineraryDraft { throw APIError.offline }
    func createTrip(document: [String: JSONValue]) async throws -> TripSummary { throw APIError.offline }
    func deleteTrip(tripId: String, expectedRevision: Int) async throws { throw APIError.offline }
    func leaveTrip(tripId: String) async throws { throw APIError.offline }
    func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse> { throw APIError.offline }
    func setActivity(tripId: String, activityId: String, action: TripService.ActivityAction, expectedRevision: Int, expectedName: String?) async throws -> MutationResponse { throw APIError.offline }
    func decideSuggestion(tripId: String, suggestionId: String, decision: TripService.SuggestionDecision, expectedRevision: Int) async throws -> MutationResponse { throw APIError.offline }
}
#endif
