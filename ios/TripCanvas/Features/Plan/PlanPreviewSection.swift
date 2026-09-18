import SwiftUI

struct PlanPreviewSection: View {
    let tripId: String
    let document: TripDocument
    let revision: Int
    let days: [Int]
    let source: TripDocumentSource
    @State private var previews: [Int: PlanChangePreview] = [:]
    @State private var error: String?
    @State private var working = false
    @State private var generation = 0

    var body: some View {
        Section {
            if working { ProgressView("변경 전후 확인 중") }
            ForEach(days.sorted(), id: \.self) { day in
                if let preview = previews[day] {
                    VStack(alignment: .leading, spacing: Space.xs) {
                        Text("Day \(day + 1)").font(.subheadline.weight(.semibold))
                        comparison("변경 전", response: preview.before)
                        comparison("변경 후", response: preview.after)
                        let unknown = document.days[day].spots.filter { $0.stayMinutes == nil }.count
                        if unknown > 0 {
                            Text("머무는 시간 미정 \(unknown)곳은 0분으로 계산했어요.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            if let error {
                Text("시간 비교를 확인하지 못했어요. \(error)").font(.caption).foregroundStyle(.secondary)
                Button("비교 다시 확인") { Task { await refresh() } }
            }
        } header: { Text("변경 영향 · 아직 저장 전") } footer: {
            Text("예약·입장 시각은 그대로 유지합니다. 추정 경로는 실제 이동과 다를 수 있어요. 날짜를 옮기면 실제 예약일과 맞는지 확인해 주세요.")
        }
        .task(id: document) {
            // 피커를 훑는 동안 요청을 묶는다(2026-09-18) — id가 바뀌면 이 task가 취소되므로 잠깐 기다렸다 살아 있는 것만 나간다.
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            await refresh()
        }
    }

    private func comparison(_ title: String, response: DayPlanResponse) -> some View {
        let day = response.day
        return VStack(alignment: .leading, spacing: 2) {
            Text("\(title): 이동 \(TimeFormat.duration(day.totals.travelMinutes)) · 종료 \(day.totals.endMinutes.map(TimeFormat.clockAcrossMidnight) ?? "미정")")
                .font(.caption)
            if response.travelTimeSource != .routed { Text("이동시간에 추정 포함").font(.caption2).foregroundStyle(.secondary) }
            ForEach(day.spots.filter { $0.bookedAtMinutes != nil }, id: \.index) { spot in
                Text("\(spot.name): 예상 도착 \(TimeFormat.clockAcrossMidnight(spot.etaMinutes)) · 예약 \(TimeFormat.clockAcrossMidnight(spot.bookedAtMinutes ?? 0))\(spot.conflict ? " · 시간 확인 필요" : "")")
                    .font(.caption2).foregroundStyle(spot.conflict ? Color.orange : .secondary)
                if let late = spot.bookingLateMinutes, late > 0 {
                    Text("예약보다 \(TimeFormat.duration(late)) 늦게 도착할 수 있어요")
                        .font(.caption2).foregroundStyle(.orange)
                }
            }
        }
    }

    private func refresh() async {
        generation += 1
        let request = generation
        previews = [:]; working = true; error = nil
        do {
            for day in days where document.hasDay(day) {
                let result = try await source.planPreview(tripId: tripId, document: document, dayIndex: day, revision: revision)
                guard generation == request, !Task.isCancelled else { return }
                previews[day] = result
            }
        } catch {
            guard generation == request, !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
        if generation == request { working = false }
    }
}
