#if DEBUG
import SwiftUI

@MainActor
struct DailyMomentsReviewHarness: View {
    @State private var source = DailyMomentsReviewSource()
    private let trip = TripSummary(id: "synthetic-moments", name: "합성 하루 검증", start: "2026-10-15", dayCount: 1,
        revision: 4, updatedAt: "", timeZone: "Asia/Seoul", cities: [], todayIndex: 0, daysUntilStart: nil, role: .viewer, memberCount: 2)
    var body: some View { NavigationStack {
        DailyMomentsView(trip: trip, service: source).toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("일행 변경") {
                    source.changeCompanion()
                    NotificationCenter.default.post(name: .dailyMomentsChanged, object: trip.id)
                }.accessibilityIdentifier("simulateMomentChange")
            }
        }
    } }
}

@MainActor
private final class DailyMomentsReviewSource: DailyMomentsSource {
    func changeCompanion() {
        response = .init(dayIndex: response.dayIndex, dayKey: response.dayKey, revision: response.revision,
            options: response.options, moments: [.init(userId: "friend", label: "영희", mine: false,
                spotKey: "new", spotName: "바뀐 선택", activityId: "d0s1", status: "ACTIVE")])
    }
    private var failNextWrite = ProcessInfo.processInfo.arguments.contains("--review-moments-failure")
    private var response = DailyMomentsResponse(dayIndex: 0, dayKey: "date:2026-10-15", revision: 4,
        options: [.init(key: "cafe", name: "합성 카페", activityId: "d0s0", selectable: true)],
        moments: [.init(userId: "friend", label: "영희", mine: false, spotKey: "sunset", spotName: "노을 보기", activityId: "d0s1", status: "ACTIVE")])
    func dailyMoments(tripId: String, dayIndex: Int) async throws -> DailyMomentsResponse { response }
    func saveDailyMoment(tripId: String, dayIndex: Int, expectedRevision: Int, spotKey: String?) async throws -> DailyMomentsResponse {
        try await Task.sleep(for: .milliseconds(300))
        if failNextWrite { failNextWrite = false; throw APIError.offline }
        var rows = response.moments.filter { !$0.mine }
        if let spotKey { rows.insert(.init(userId: "me", label: "나", mine: true, spotKey: spotKey,
            spotName: "합성 카페", activityId: "d0s0", status: "ACTIVE"), at: 0) }
        response = .init(dayIndex: dayIndex, dayKey: response.dayKey, revision: response.revision, options: response.options, moments: rows)
        return response
    }
}
#endif
