#if DEBUG
import SwiftUI

/// 합성 문서만 사용한다. 실제 편집기·문서 저장소·revision 비교를 그대로 지나 UI를 검증한다.
@MainActor
struct ChoiceReviewHarness: View {
    @State private var source = ChoiceReviewSource()
    @State private var model: TripPlanViewModel?
    @State private var editing = false
    @State private var openedRevision = 1
    private let key = EditorDraftKey(accountID: "ui-review", tripID: "choice-synthetic", editor: "choice")

    var body: some View {
        NavigationStack {
            PaperList {
                if let model, let spot = model.day?.spots.first {
                    Text("현재 · \(spot.name) | 다른 곳 · \(spot.choice?.alternative.name ?? "없음") | \(spot.choice?.state.rawValue ?? "NONE") | 행 \(model.day?.spots.count ?? 0) | revision \(model.revision)")
                        .accessibilityIdentifier("choiceSavedState")
                    SpotChoiceSummaryView(spot: spot, summary: nil)
                    Button("선택지 편집") {
                        openedRevision = model.revision
                        editing = true
                    }.accessibilityIdentifier("choiceOpenEditor")
                    Button("다음 저장 한 번 실패") { source.failNextSave = true }
                        .accessibilityIdentifier("choiceFailNextSave")
                } else { ProgressView() }
            }
            .sheet(isPresented: $editing) {
                if let model, let spot = model.day?.spots.first {
                    SpotEditorView(target: .edit(index: 0, spot: spot), dayCount: 1, currentDay: 0,
                                   draftKey: key,
                                   onSave: { draft in
                                       let success = await model.updateSpot(at: 0, with: draft, dayIndex: 0, expectedRevision: openedRevision)
                                       return success ? nil : model.saveFailureMessage
                                   }, onDelete: { _ in "합성 UI 검증에서는 지우지 않아요." }, onMoveToDay: { _, _, _ in nil })
                }
            }
            .task {
                if model == nil {
                    EditorDraftStore.shared.remove(key)
                    EditorDraftStore.shared.remove(key?.appending("alternative"))
                    let value = TripPlanViewModel(tripId: "choice-synthetic", service: source, loadsPlans: false)
                    model = value
                    await value.load()
                }
            }
        }
    }
}

@MainActor
private final class ChoiceReviewSource: TripDocumentSource {
    var failNextSave = false
    var snapshot: TripDocumentSnapshot
    init() {
        var spot = TripSpot(name: "합성 미술관", city: "교토")
        spot.arriveAt = "14:00"
        spot.stayMinutes = 60
        spot.cost = 1000
        let document = TripDocument(raw: ["name": .string("합성 선택지"), "days": .array([
            .object(["spots": .array([.object(spot.raw)])])])])
        snapshot = .init(document: document, revision: 1, role: .owner)
    }
    func document(tripId: String) async throws -> TripDocumentSnapshot { snapshot }
    func saveDocument(tripId: String, document: TripDocument, expectedRevision: Int) async throws -> TripDocumentSnapshot {
        try await Task.sleep(for: .milliseconds(600))
        if failNextSave { failNextSave = false; throw APIError.offline }
        guard expectedRevision == snapshot.revision else { throw APIError.revisionConflict(message: "합성 revision 충돌", revision: snapshot.revision) }
        snapshot = .init(document: document, revision: expectedRevision + 1, role: .owner)
        return snapshot
    }
    func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse> { throw APIError.offline }
    func cachedDayPlan(tripId: String, dayIndex: Int) async -> DayPlanResponse? { nil }
    func tripRoutes(tripId: String) async throws -> TripRoutesResponse { throw APIError.offline }
}
#endif
