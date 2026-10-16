#if DEBUG
import SwiftUI
import Observation

@MainActor struct CalmTravelReviewHarness: View {
    @State private var source = CalmReviewSource()
    @State private var chooser: QuickChoiceModel?
    @State private var editsOriginal = false
    @State private var original = StaffShowDetails()
    @State private var openedDay = ""
    private let trip = TripSummary(id: "calm-synthetic", name: "합성 저녁 여행", start: "2026-10-16", dayCount: 2,
        revision: 3, updatedAt: "", timeZone: "Asia/Seoul", cities: [], todayIndex: 0, daysUntilStart: nil, role: .owner, memberCount: 2)
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.m) {
                    Text("현재 · \(source.snapshot.document.days[1].spots[0].name) · revision \(source.snapshot.revision)")
                        .accessibilityIdentifier("calmSavedState")
                    Button("두 곳 비교하고 고르기") {
                        chooser = QuickChoiceModel(tripID: trip.id, day: 1, activity: source.activity,
                            revision: source.snapshot.revision, source: source)
                    }.frame(minHeight: 44).accessibilityIdentifier("calmOpenChoice")
                    Button("다음 저장 한 번 실패") { source.failNext = true }.frame(minHeight: 44).accessibilityIdentifier("calmFailNext")
                    Button("원문 입력") { editsOriginal = true }.frame(minHeight: 44).accessibilityIdentifier("calmEditOriginal")
                    Text(original.bookingName).accessibilityIdentifier("calmOriginalName")
                    CalmMomentCard(moment: .init(state: "RELAX", text: "다음 출발까지 30분 여유예요. 지금은 여행을 즐겨도 괜찮아요.",
                        expiresAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(ProcessInfo.processInfo.arguments.contains("--review-calm-expired") ? -60 : 600))), offline: false, onRefresh: {})
                    TomorrowBriefCard(trip: trip, brief: .init(dayIndex: 1, date: "2026-10-17", firstPlace: "합성 미술관",
                        departureMinutes: 540, travelTimeSource: .straightLineEstimate,
                        checkouts: ["합성 숙소"], reservations: ["13:00 · 합성 약속"]), offline: false,
                        onOpenDay: { openedDay = "Day 2 · 10월 17일 일정 열림" }, onPrepareOffline: { openedDay = "오프라인 준비 열림" })
                    Text(openedDay).accessibilityIdentifier("calmOpenedDay")
                }.padding(Space.l)
            }.paperGround().navigationTitle("합성 안심 UX")
            .sheet(item: $chooser) { QuickChoiceView(model: $0, onRefresh: {}) }
            .sheet(isPresented: $editsOriginal) {
                NavigationStack {
                    PaperForm { StaffShowEditorSection(details: $original) }
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("완료") { editsOriginal = false }.accessibilityIdentifier("calmOriginalDone") } }
                }
            }
        }
    }
}

@Observable @MainActor private final class CalmReviewSource: TripDocumentSource, QuickChoiceComparing {
    var snapshot: TripDocumentSnapshot
    var failNext = false
    let activity = ActivitySummary(id: "d1s0", name: "합성 미술관", city: "서울", desc: "", status: .planned,
        flexibility: .flexible, type: .other, etaMinutes: 840, startMinutes: 840, endMinutes: 900,
        stayMinutes: 60, travelInMinutes: 0, fixedAtMinutes: nil, location: nil, mustVisit: false,
        optional: false, bookingId: nil, bookUrl: nil, placeId: nil, choiceState: "PENDING")
    init() {
        var spot = TripSpot(name: "합성 미술관", city: "서울"); spot.stayMinutes = 60; spot.cost = 1000
        var alternate = TripSpot(name: "합성 강변 산책", city: "서울"); alternate.stayMinutes = 30; alternate.cost = 0
        spot.choice = .init(alternative: alternate, state: .pending)
        snapshot = .init(document: TripDocument(raw: ["days": .array([.object(["spots": .array([])]),
            .object(["spots": .array([.object(spot.raw)])])])]), revision: 3, role: .owner)
    }
    func document(tripId: String) async throws -> TripDocumentSnapshot { snapshot }
    func saveDocument(tripId: String, document: TripDocument, expectedRevision: Int) async throws -> TripDocumentSnapshot {
        try await Task.sleep(for: .milliseconds(250))
        if failNext { failNext = false; throw APIError.offline }
        guard snapshot.revision == expectedRevision else { throw APIError.revisionConflict(message: "합성 충돌", revision: snapshot.revision) }
        snapshot = .init(document: document, revision: expectedRevision + 1, role: .owner); return snapshot
    }
    func compareChoice(tripID: String, activityID: String, revision: Int) async throws -> ChoiceComparison {
        let leg = try JSONDecoder().decode(DayPlanLeg.self, from: Data(#"{"from":{"lat":37,"lng":127},"mode":"walk","minutes":12,"distanceKm":0.8,"path":null,"source":"STRAIGHT_LINE_ESTIMATE","walkInstead":false}"#.utf8))
        return .init(revision: revision, activityId: activityID, choices: [.init(alternative: false, travel: leg), .init(alternative: true, travel: leg)])
    }
    func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse> { throw APIError.offline }
    func cachedDayPlan(tripId: String, dayIndex: Int) async -> DayPlanResponse? { nil }
    func tripRoutes(tripId: String) async throws -> TripRoutesResponse { throw APIError.offline }
}
#endif
