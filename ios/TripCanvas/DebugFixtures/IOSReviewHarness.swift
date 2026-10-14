#if DEBUG
import SwiftUI

/// UI 검증 전용 합성 자료. 앱·운영 API에 계정이나 테스트 여행을 만들지 않는다.
@MainActor
struct IOSReviewHarness: View {
    private let arguments = ProcessInfo.processInfo.arguments
    @State private var source = ReviewCostSource()
    @State private var showsSearch = false
    @State private var searchAttempts = 0
    @State private var savedPlace = ""
    @State private var draftTarget: CostEditTarget?
    private var draftKey: EditorDraftKey? { EditorDraftKey(accountID: "ui-review", tripID: "synthetic", editor: "cost-recovery") }

    var body: some View {
        Group {
            if arguments.contains("--review-search") {
                NavigationStack {
                    Text(savedPlace.isEmpty ? "합성 여행" : "추가됨 · \(savedPlace)").accessibilityIdentifier("reviewSavedPlace")
                        .sheet(isPresented: $showsSearch) {
                            PlaceSearchView(near: nil, timeZone: "Europe/Paris", addTitle: "이 장소 일정에 추가", searcher: ReviewSearcher()) { hit in
                                searchAttempts += 1
                                try? await Task.sleep(for: .milliseconds(500))
                                if searchAttempts == 1 { return "합성 저장 실패 · 선택은 유지돼요." }
                                savedPlace = hit.name; return nil
                            }
                        }
                }.task { showsSearch = true }
            } else if arguments.contains("--review-draft") {
                NavigationStack {
                    Button("비용 편집") { openDraft() }.accessibilityIdentifier("reviewOpenDraft")
                        .sheet(item: $draftTarget) { target in
                            CostEntryEditor(target: target, draftKey: draftKey, originalRevision: 1) { _ in true }
                        }
                }.task {
                    if arguments.contains("--review-reset-draft") { EditorDraftStore.shared.remove(draftKey) }
                    openDraft()
                }
            } else {
                NavigationStack {
                    TripCostsView(trip: source.trip, model: TripCostsViewModel(tripId: "t1", documents: source) {
                        try source.costs()
                    })
                }
            }
        }
        .dynamicTypeSize(arguments.contains("--review-large") ? .accessibility3 : .large)
        .preferredColorScheme(arguments.contains("--review-dark") ? .dark : .light)
    }

    private func openDraft() {
        draftTarget = CostEditTarget(kind: .extra("fixture-cost"), entry: CostEntry(raw: ["id": .string("fixture-cost"), "title": .string("커피")]))
    }
}

@MainActor
private final class ReviewSearcher: PlaceSearching {
    func search(_ query: String, near: GeoPoint?) async throws -> [PlaceHit] {
        try await search(query, near: near, region: nil)
    }
    func search(_ query: String, near: GeoPoint?, region: PlaceSearchRegion?) async throws -> [PlaceHit] {
        guard region == .international else { return [] }
        return [PlaceHit(id: "review-place", name: "에펠탑", city: "파리", address: "합성 검색 결과 · 파리",
                         point: GeoPoint(lat: 48.858, lng: 2.294), category: .sight, placeId: nil, provider: "google")]
    }
}

@MainActor
private final class ReviewCostSource: TripDocumentSource {
    struct Fixture: Decodable { let document: JSONValue; let costs: TripCostsResponse }
    private let data: Data
    var snapshot: TripDocumentSnapshot
    let trip = TripSummary(id: "t1", name: "합성 비용 검증", start: "2026-10-01", dayCount: 2, revision: 1,
        updatedAt: "2026-10-01T00:00:00Z", timeZone: "Europe/Madrid", cities: [], todayIndex: 0,
        daysUntilStart: nil, role: .owner, memberCount: 1)
    init() {
        let url = Bundle.main.url(forResource: "ios-review-costs", withExtension: "json")!
        data = try! Data(contentsOf: url)
        let fixture = try! JSONDecoder().decode(Fixture.self, from: data)
        snapshot = .init(document: TripDocument(raw: fixture.document.objectValue!), revision: 1, role: .owner)
    }
    func document(tripId: String) async throws -> TripDocumentSnapshot { snapshot }
    func saveDocument(tripId: String, document: TripDocument, expectedRevision: Int) async throws -> TripDocumentSnapshot {
        guard expectedRevision == snapshot.revision else { throw APIError.revisionConflict(message: "합성 충돌", revision: snapshot.revision) }
        snapshot = .init(document: document, revision: expectedRevision + 1, role: .owner)
        return snapshot
    }
    func costs() throws -> TripCostsResponse {
        var raw = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        var costs = raw["costs"] as! [String: Any]; costs["revision"] = snapshot.revision
        if let amount = snapshot.document.budgetAmount {
            costs["budget"] = ["amount": amount, "currency": "KRW", "totalKRW": amount,
                               "costKRW": costs["totalKRW"]!, "remainingKRW": amount - (costs["totalKRW"] as! Double)]
        } else { costs.removeValue(forKey: "budget") }
        raw["costs"] = costs
        return try JSONDecoder().decode(Fixture.self, from: JSONSerialization.data(withJSONObject: raw)).costs
    }
    func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse> { throw APIError.offline }
    func cachedDayPlan(tripId: String, dayIndex: Int) async -> DayPlanResponse? { nil }
    func tripRoutes(tripId: String) async throws -> TripRoutesResponse { throw APIError.offline }
}
#endif
