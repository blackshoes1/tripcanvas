import SwiftUI

/// Choice rows are fetched only after opening the section, and refreshed for a new document revision.
struct DailyMomentsTodaySection: View {
    let trip: TripSummary
    let dayIndex: Int
    let revision: Int
    var dropActivityIds: [String] = []

    var body: some View {
        DailyMomentsImpactSection(trip: trip, dayIndex: dayIndex, revision: revision,
            changedActivityIds: [], removedActivityIds: dropActivityIds, initiallyExpanded: !dropActivityIds.isEmpty)
    }
}

struct DailyMomentsImpactSection: View {
    let trip: TripSummary
    let dayIndex: Int
    let revision: Int
    var changedActivityIds: [String] = []
    var removedActivityIds: [String] = []
    var initiallyExpanded = true
    @Environment(AppEnvironment.self) private var env
    @State private var model: DailyMomentsViewModel?
    @State private var expanded: Bool

    init(trip: TripSummary, dayIndex: Int, revision: Int, changedActivityIds: [String] = [],
         removedActivityIds: [String] = [], initiallyExpanded: Bool = true) {
        self.trip = trip; self.dayIndex = dayIndex; self.revision = revision
        self.changedActivityIds = changedActivityIds; self.removedActivityIds = removedActivityIds
        self.initiallyExpanded = initiallyExpanded
        _expanded = State(initialValue: initiallyExpanded)
    }

    var body: some View {
        DisclosureGroup("각자 오늘 하나만", isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: Space.s) {
                if let model {
                    if model.isLoading { ProgressView("일행의 바람을 확인하고 있어요") }
                    if let error = model.errorMessage {
                        InlineErrorBanner(message: "일행의 바람을 확인하지 못했어요", detail: error) {
                            Task { await model.load(dayIndex: dayIndex) }
                        }
                    }
                    if let response = model.response, response.revision == revision, model.errorMessage == nil {
                        DailyMomentsSummary(response: response, showsTitle: false)
                        ForEach(DailyMomentImpactText.make(response.moments, changed: changedActivityIds, removed: removedActivityIds), id: \.self) { line in
                            Text(line).font(.subheadline).foregroundStyle(Ink.warning)
                        }
                    } else if model.response != nil && model.errorMessage == nil && !model.isLoading {
                        Text("일정이 바뀌었어요. 최신 일정을 불러온 뒤 일행의 바람을 다시 확인해 주세요.")
                            .font(.caption).foregroundStyle(Ink.warning)
                    }
                }
                NavigationLink {
                    DailyMomentsView(trip: trip, initialDayIndex: dayIndex)
                } label: { Label("내 하나 고르기 · 일행 선택 보기", systemImage: "heart") }
                    .frame(minHeight: 44)
            }
            .padding(.top, Space.s)
        }
        .task(id: "\(expanded)-\(dayIndex)-\(revision)") {
            guard expanded else { return }
            if model == nil { model = DailyMomentsViewModel(tripId: trip.id, dayIndex: dayIndex, service: env.service) }
            await model?.load(dayIndex: dayIndex)
        }
        .onChange(of: expanded) { _, open in
            if !open { model = nil }
        }
        .onChange(of: removedActivityIds) { _, ids in
            if !ids.isEmpty { expanded = true }
        }
        .onChange(of: changedActivityIds) { _, ids in
            if !ids.isEmpty { expanded = true }
        }
    }
}

/// All schedule decisions arrive from the preview. This only attaches the member's name to affected rows.
enum DailyMomentImpactText {
    static func make(_ moments: [DailyMoment], changed: [String], removed: [String]) -> [String] {
        moments.compactMap { row in
            guard !row.needsReview, let activityId = row.activityId else { return nil }
            let subject = "\(row.mine ? "내가" : "\(row.label) 님이") 고른 \(row.spotName)"
            if removed.contains(activityId) { return "\(subject): 이번 조정에서 빠져요. 일행과 확인해 주세요." }
            if changed.contains(activityId) { return "\(subject): 시간이나 순서가 달라져요." }
            return nil
        }
    }
}
