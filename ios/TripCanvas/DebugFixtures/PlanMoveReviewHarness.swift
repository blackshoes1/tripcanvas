#if DEBUG
import SwiftUI
import Observation

@MainActor struct PlanMoveReviewHarness: View {
    @State private var source = MoveReviewSource()
    @State private var showsEditor = false
    var body: some View {
        NavigationStack {
            VStack(spacing: Space.m) {
                Text("저장 시도 \(source.attempts)회 · 저장 완료 \(source.saves)회").accessibilityIdentifier("moveReviewSaves")
                if source.saves > 0 { Text(source.snapshot.document.days[1].spots.map(\.name).joined(separator: " → ")) }
                Button("장소 편집") { showsEditor = true }
            }
            .sheet(isPresented: $showsEditor) {
                SpotEditorView(target: .edit(index: 0, spot: source.initialDocument.days[0].spots[0]),
                    dayCount: 2, currentDay: 0, contextLabel: "합성 이동 검토 · 저장 시도 \(source.attempts)회 · 저장 완료 \(source.saves)회",
                    onSave: { _ in "날짜 이동 검토에서 확인해 주세요." }, onDelete: { _ in "이동만 검증해요." },
                    onMoveToDay: { _, _, _ in "이동 미리보기를 먼저 확인해 주세요." },
                    moveContext: SpotMoveContext(tripId: "move-review", document: source.initialDocument,
                        revision: 7, source: source) { document, revision in
                        do { _ = try await source.saveDocument(tripId: "move-review", document: document, expectedRevision: revision); return nil }
                        catch { return error.localizedDescription }
                    })
            }
            .task { showsEditor = true }
        }
    }
}

@Observable @MainActor private final class MoveReviewSource: TripDocumentSource {
    var attempts = 0
    var saves = 0
    var snapshot: TripDocumentSnapshot
    let initialDocument: TripDocument
    init() {
        var moved = TripSpot(name: "이동할 장소"); moved.arriveAt = "11:00"
        moved.setField("moveReview", .bool(true)); moved.setField("unknown", .string("keep"))
        var early = TripSpot(name: "오전 일정"); early.arriveAt = "09:00"
        var late = TripSpot(name: "오후 일정"); late.arriveAt = "13:00"
        let document = TripDocument(raw: ["name": .string("합성 이동"), "start": .string("2026-10-27"), "days": .array([
            .object(["spots": .array([.object(moved.raw)])]),
            .object(["spots": .array([.object(early.raw), .object(late.raw)])])])])
        initialDocument = document
        snapshot = .init(document: document, revision: 7, role: .owner)
    }
    func document(tripId: String) async throws -> TripDocumentSnapshot { snapshot }
    func saveDocument(tripId: String, document: TripDocument, expectedRevision: Int) async throws -> TripDocumentSnapshot {
        attempts += 1
        if ProcessInfo.processInfo.arguments.contains("--review-move-fail"), attempts == 1 { throw APIError.server(status: 503, message: "합성 저장 실패 · 선택은 그대로예요") }
        guard expectedRevision == snapshot.revision else { throw APIError.revisionConflict(message: "합성 충돌", revision: snapshot.revision) }
        saves += 1; snapshot = .init(document: document, revision: expectedRevision + 1, role: .owner)
        return snapshot
    }
    func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse> { throw APIError.offline }
    func cachedDayPlan(tripId: String, dayIndex: Int) async -> DayPlanResponse? { nil }
    func tripRoutes(tripId: String) async throws -> TripRoutesResponse { throw APIError.offline }
    func planPreview(tripId: String, document: TripDocument, dayIndex: Int, revision: Int, sortByTime: Bool) async throws -> PlanChangePreview {
        var canonical = document
        // 합성 서버 응답: 11시는 9시와 13시 사이, 자동 시각은 마지막이다. 실제 앱의 정렬은 서버만 한다.
        if sortByTime, document.hasDay(dayIndex) {
            var days = canonical.days, spots = days[dayIndex].spots
            if let index = spots.firstIndex(where: { $0.raw["moveReview"] == .bool(true) }), spots[index].arriveAt != nil {
                let moved = spots.remove(at: index)
                spots.insert(moved, at: min(1, spots.count))
                days[dayIndex].spots = spots; canonical.days = days
            }
        }
        return .init(before: try response(snapshot.document, day: dayIndex, revision: revision, after: false),
                     after: try response(canonical, day: dayIndex, revision: revision, after: true),
                     document: sortByTime ? canonical.raw : nil)
    }
    private func response(_ document: TripDocument, day: Int, revision: Int, after: Bool) throws -> DayPlanResponse {
        let url = Bundle.main.url(forResource: "move-review-day-plan", withExtension: "json")!
        var raw = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        var trip = raw["trip"] as! [String: Any]; trip["id"] = "move-review"; trip["revision"] = revision; raw["trip"] = trip
        var value = raw["day"] as! [String: Any]
        let template = (value["spots"] as! [[String: Any]])[0]
        value["index"] = day
        value["spots"] = document.days[day].spots.enumerated().map { index, spot in
            var row = template
            row["index"] = index; row["name"] = spot.name; row["bookedAtMinutes"] = NSNull(); row["bookingLateMinutes"] = NSNull()
            row["fixed"] = spot.arriveAt != nil; row["conflict"] = after && day == 1 && spot.raw["moveReview"] == .bool(true) && spot.arriveAt == "11:00"
            row["etaMinutes"] = 540 + index * 120
            return row
        }
        raw["day"] = value
        return try JSONDecoder().decode(DayPlanResponse.self, from: JSONSerialization.data(withJSONObject: raw))
    }
}
#endif
