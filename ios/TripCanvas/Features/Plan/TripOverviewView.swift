import SwiftUI

/// 날짜별 계산은 서버 응답으로 비교한다. 장소 개수만 보고 일정이 빡빡하다고 판정하지 않는다.
struct TripOverviewView: View {
    let model: TripPlanViewModel
    let onPickDay: (Int) -> Void
    @State private var loadingID: UUID?
    @State private var completedRevision: Int?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Space.m) {
                Text("날짜를 골라 일정과 동선을 확인하세요.")
                    .font(.subheadline).foregroundStyle(.secondary)
                if let document = model.document {
                    ForEach(Array(document.days.enumerated()), id: \.offset) { index, day in
                        Button { onPickDay(index) } label: {
                            dayCard(index, day: day, plan: model.overviewPlan(index))
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("이 날짜의 일정 열기")
                    }
                }
                if loadingID != nil {
                    ProgressView("날짜별 계산을 확인하는 중")
                        .frame(maxWidth: .infinity, minHeight: 44)
                } else if hasMissingCalculation {
                    Button { Task { await reload() } } label: {
                        Label("확인하지 못한 계산 다시 불러오기", systemImage: "arrow.clockwise")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding(Space.l)
        }
        .background(Ink.paper)
        .navigationTitle("여행 전체 보기")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: model.revision) { await reload() }
        .refreshable { await reload() }
    }

    private var hasMissingCalculation: Bool {
        (0..<model.dayCount).contains { model.overviewPlan($0) == nil }
    }

    private func reload() async {
        let id = UUID()
        let revision = model.revision
        loadingID = id
        await model.loadOverview()
        guard loadingID == id, model.revision == revision, !Task.isCancelled else { return }
        completedRevision = revision
        loadingID = nil
    }

    private func dayCard(_ index: Int, day: TripDay, plan: DayPlanResponse?) -> some View {
        VStack(alignment: .leading, spacing: Space.s) {
            HStack(alignment: .firstTextBaseline) {
                Text("Day \(index + 1)").font(.headline)
                Text(dateLabel(index, plan: plan)).font(.subheadline).foregroundStyle(.secondary)
                Spacer(minLength: Space.s)
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
            }
            if !day.title.isEmpty { Text(day.title).font(.title3.weight(.semibold)) }
            if day.spots.isEmpty {
                Text("아직 정한 장소가 없어요").foregroundStyle(.secondary)
            } else {
                Text(day.spots.prefix(4).map(\.name).joined(separator: " → "))
                    .font(.subheadline)
                if day.spots.count > 4 {
                    Text("외 \(day.spots.count - 4)곳").font(.caption).foregroundStyle(.secondary)
                }
                let unspecified = day.spots.filter { $0.stayMinutes == nil }.count
                if unspecified > 0 {
                    Label("머무는 시간 미정 \(unspecified)곳", systemImage: "hourglass")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            if let plan {
                let totals = plan.day.totals
                VStack(alignment: .leading, spacing: Space.xs) {
                    Label("이동 \(TimeFormat.duration(totals.travelMinutes)) · 약 \(totals.distanceKm.formatted(.number.precision(.fractionLength(1))))km", systemImage: "arrow.triangle.turn.up.right.diamond")
                    if let end = totals.endMinutes {
                        Label("종료 예상 \(TimeFormat.clockAcrossMidnight(end))", systemImage: "clock")
                    }
                    if plan.travelTimeSource != .routed || plan.legsPending > 0 {
                        Text("이동시간에 추정 구간이 포함돼요").foregroundStyle(.secondary)
                    }
                    if totals.overloaded {
                        Label("일정이 자정을 넘어요", systemImage: "moon")
                            .foregroundStyle(Ink.warning)
                    }
                    let conflicts = plan.day.spots.filter(\.conflict).count
                    if conflicts > 0 {
                        Label("정한 시각에 도착하기 어려운 곳 \(conflicts)곳", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(Ink.warning)
                    }
                    if plan.day.spotsWithoutLocation > 0 {
                        Text("위치 미정 \(plan.day.spotsWithoutLocation)곳은 동선에 포함되지 않아요")
                            .foregroundStyle(.secondary)
                    }
                }
                .font(.caption)
            } else if completedRevision == model.revision && loadingID == nil {
                Label("계산을 확인하지 못했어요 · 장소는 그대로 있어요", systemImage: "exclamationmark.circle")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                Label(loadingID == nil ? "아직 계산을 확인하지 않았어요" : "이동·종료 시각을 확인하는 중", systemImage: "clock")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .card()
        .accessibilityElement(children: .combine)
    }

    private func dateLabel(_ index: Int, plan: DayPlanResponse?) -> String {
        let iso = plan?.day.date ?? model.strip.first(where: { $0.index == index })?.date ?? ""
        if let formatted = TimeFormat.dayChipLabel(iso) { return formatted }
        return model.document?.start.isEmpty == false ? "날짜 확인 중" : "날짜 미정"
    }
}
