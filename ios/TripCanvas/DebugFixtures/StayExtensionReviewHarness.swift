#if DEBUG
import SwiftUI

@MainActor
struct StayExtensionReviewHarness: View {
    @State private var source = StayExtensionReviewSource()
    @State private var show = true
    @State private var applied = false
    var body: some View {
        NavigationStack {
            VStack {
                Text(applied ? "머무름 저장 확인" : "원래 일정 유지").accessibilityIdentifier("stayResult")
                Button("미리보기 열기") { show = true }
            }
            .sheet(isPresented: $show) {
                StayExtensionSheet(model: StayExtensionModel(tripID: "parity", activityID: "d0s0", revision: 2, source: source),
                    onApplied: { _ in applied = true }, onRefresh: {})
            }
        }
    }
}

@MainActor
final class StayExtensionReviewSource: StayExtensionSource {
    var failure = ProcessInfo.processInfo.arguments.contains("--review-stay-failure")
    static func preview(_ minutes: Int) -> StayExtensionPreview {
        .init(schemaVersion: 1, revision: 2, generatedAt: "2026-10-15T00:30:00Z", dayIndex: 0,
              activityId: "d0s0", currentName: "합성 카페", extraMinutes: minutes,
              oldDepartureMinutes: 600, newDepartureMinutes: 600 + minutes, feasible: true, reason: nil,
              hasUnknownTravel: false,
              changes: [.init(activityId: "d0s0", name: "합성 카페", beforeStayMinutes: 60, afterStayMinutes: 60 + minutes)],
              fixedCommitments: [.init(activityId: "d0s1", name: "저녁 예약", atMinutes: 1140,
                                       arrivalMinutes: 1100, slackMinutes: 40, bufferMinutes: 15)],
              dayEndBeforeMinutes: 1200, dayEndAfterMinutes: 1200,
              travelTimeSource: "STRAIGHT_LINE_ESTIMATE", previewKey: "synthetic-\(minutes)")
    }
    func previewStay(tripId: String, activityId: String, minutes: Int, revision: Int) async throws -> StayExtensionPreview {
        Self.preview(minutes)
    }
    func applyStay(tripId: String, preview: StayExtensionPreview) async throws -> MutationResponse {
        if failure { throw APIError.offline }
        guard let url = Bundle.main.url(forResource: "ios-review-stay-today", withExtension: "json") else { throw APIError.offline }
        let today = try JSONDecoder().decode(TodayResponse.self, from: Data(contentsOf: url))
        return .init(schemaVersion: 1, applied: true, alreadyApplied: false, revision: 3, today: today)
    }
}
#endif
