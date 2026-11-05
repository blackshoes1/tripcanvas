#if DEBUG
import SwiftUI
import Observation

/// 실제 일정 목록(`TripPlanView` → `PlanSpotList`)에서 장소를 끌어 순서를 바꾸는 흐름을 검증한다.
/// 운영과 같은 자리 — `NavigationStack`에 **push된 화면** — 에 둔다(`TripListView` → `TripHomeView`).
/// 문서 소스만 합성이고 저장은 메모리에서 revision을 올린다. 지도는 열지 않는다.
@MainActor
struct PlanReorderReviewHarness: View {
    @Environment(AppEnvironment.self) private var env
    @State private var source = PlanReorderReviewSource()
    @State private var model: TripPlanViewModel?
    @State private var discovery: MapDiscoveryModel?
    @State private var showsMap = false
    @State private var path: [String] = ["plan"]

    var body: some View {
        NavigationStack(path: $path) {
            Text("합성 순서 바꾸기 여행 목록")
                .navigationDestination(for: String.self) { _ in
                    VStack(spacing: 0) {
                        Text("order=\(model?.day?.spots.map(\.name).joined(separator: ",") ?? "none"); saves=\(source.saves)")
                            .font(.caption).accessibilityIdentifier("reorderState")
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, Space.l)
                        if let model, let discovery {
                            TripPlanView(trip: source.trip, model: model, discovery: discovery, showsMap: $showsMap)
                        } else { ProgressView("합성 일정 준비 중") }
                    }
                    .background(Ink.paper)
                    .navigationTitle(source.trip.name)
                    .navigationBarTitleDisplayMode(.inline)
                }
        }
        .task {
            guard model == nil else { return }
            discovery = MapDiscoveryModel(trip: source.trip, searcher: env.places, source: env.service)
            model = TripPlanViewModel(tripId: source.trip.id, service: source, loadsPlans: false, documentFreshness: 600)
        }
    }
}

@Observable @MainActor
private final class PlanReorderReviewSource: TripDocumentSource {
    private(set) var saves = 0
    private var current: TripDocumentSnapshot
    let trip = TripSummary(id: "synthetic-reorder", name: "합성 순서 여행", start: "2026-10-16", dayCount: 1,
        revision: 1, updatedAt: "", timeZone: "Asia/Seoul", cities: [], todayIndex: 0,
        daysUntilStart: 0, role: .owner, memberCount: 1)

    init() {
        let spots = ["가장소", "나장소", "다장소", "라장소"].map {
            JSONValue.object(["name": .string($0), "city": .string("합성 도시"), "stayMin": .number(30)])
        }
        current = .init(document: TripDocument(raw: ["name": .string("합성 순서 여행"),
            "start": .string("2026-10-16"), "days": .array([.object(["title": .string("순서 바꾸기"),
                "spots": .array(spots)])])]), revision: 1, role: .owner)
    }

    func document(tripId: String) async throws -> TripDocumentSnapshot { current }

    func saveDocument(tripId: String, document: TripDocument, expectedRevision: Int) async throws -> TripDocumentSnapshot {
        guard expectedRevision == current.revision else { throw APIError.revisionConflict(message: "합성 충돌", revision: current.revision) }
        saves += 1
        current = .init(document: document, revision: current.revision + 1, role: .owner)
        return current
    }
    func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse> {
        throw APIError.badRequest("합성 검증은 문서만 사용해요.")
    }
    func cachedDayPlan(tripId: String, dayIndex: Int) async -> DayPlanResponse? { nil }
    func tripRoutes(tripId: String) async throws -> TripRoutesResponse {
        throw APIError.badRequest("합성 검증에서는 지도를 열지 않아요.")
    }
}
#endif
