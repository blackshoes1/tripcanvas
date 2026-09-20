import SwiftUI

/// §24의 "자유시간으로 분리" → §25~§27. **미리보기다** — "일정에 넣기"를 눌러야 저장된다.
///
/// 고르는 것은 **날짜 하나**다. 위치는 그 날 맨 뒤로 고정이고(후보를 넣을 때와 같은 규칙 — 최적 위치를
/// 추측하지 않는다, §12), 자유시간에 무엇을 할지도 고르지 않는다(§23). 묶음 키(`splitId`)는 열 때 한 번
/// 정해져 미리보기와 저장본이 같은 것을 가리킨다.
///
/// 위치를 고르는 `CandidatePlacementSheet`와 달리 revision을 물고 가지 않는다 — 맨 뒤에 붙이는 것은
/// 그 사이 일행이 무엇을 더했든 뜻이 같다. 저장은 저장 직전의 문서에 CAS로 올라간다.
struct CandidateSplitSheet: View {
    let trip: TripSummary
    let candidate: CandidateView
    let plan: SplitPlan
    let source: TripDocumentSource
    let onSave: (Int) async -> String?
    @Environment(\.dismiss) private var dismiss
    @State private var document: TripDocument?
    @State private var day = 0
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Group {
                if let document {
                    List {
                        Section {
                            Text(plan.text).font(.callout)
                            Text("자유시간에 무엇을 할지는 각자 정해요.")
                                .font(.caption).foregroundStyle(Ink.soft)
                        } header: { Text(candidate.title) }

                        Section("넣을 날짜") {
                            Picker("방문 날짜", selection: $day) {
                                ForEach(document.days.indices, id: \.self) { index in
                                    Text(PlanDateLabel.day(document, index)).tag(index)
                                }
                            }
                        }

                        Section("넣은 뒤 순서") {
                            ForEach(Array(draft(document).days[day].spots.enumerated()), id: \.offset) { index, spot in
                                Text("\(index + 1). \(spot.name)")
                            }
                        }

                        if let error { Text(error).foregroundStyle(Ink.danger) }
                    }
                } else if let error {
                    ContentUnavailableView { Label("일정을 확인하지 못했어요", systemImage: "icloud.slash") }
                    description: { Text(error) } actions: { Button("다시 불러오기") { Task { await load() } } }
                } else { ProgressView() }
            }
            .paperGround()
            .tint(Ink.accent)
            .navigationTitle("자유시간으로 분리")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("일정에 넣기") {
                        saving = true
                        Task {
                            error = await onSave(day)
                            saving = false
                            if error == nil { dismiss() }
                        }
                    }.disabled(document == nil || saving)
                }
            }
        }.task { await load() }.interactiveDismissDisabled(saving)
    }

    /// 넣은 뒤의 모습 — 세 줄이 그 날 맨 뒤에 붙는다.
    private func draft(_ document: TripDocument) -> TripDocument {
        var draft = document
        for spot in plan.spots { draft.insertSpot(spot, dayIndex: day) }
        return draft
    }

    private func load() async {
        do {
            let result = try await source.document(tripId: trip.id)
            guard !result.document.days.isEmpty else { error = "여행에 일자를 먼저 추가해 주세요."; return }
            document = result.document; error = nil
        } catch { self.error = error.localizedDescription }
    }
}
