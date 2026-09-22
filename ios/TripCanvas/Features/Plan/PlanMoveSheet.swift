import SwiftUI

struct PlanMoveSheet: View {
    let tripId: String
    let document: TripDocument
    let revision: Int
    let sourceDay: Int
    let indexes: IndexSet
    let source: TripDocumentSource
    let onSave: (TripDocument, Int) async -> String?
    @Environment(\.dismiss) private var dismiss
    @State private var day = 0
    @State private var position = 0
    @State private var saving = EditorSaveState()

    private var draft: TripDocument {
        var result = document
        result.moveSpots(fromDay: sourceDay, indexes: indexes, toDay: day, position: position)
        return result
    }

    var body: some View {
        NavigationStack {
            List {
                Section("\(indexes.count)곳 이동") {
                    DayPositionFields(document: document, day: $day, position: $position)
                }
                Section("이동 후 순서") {
                    ForEach(Array(draft.days[day].spots.enumerated()), id: \.offset) { index, spot in
                        Text("\(index + 1). \(spot.name)")
                    }
                }
                PlanPreviewSection(tripId: tripId, document: draft, revision: revision,
                                   days: Array(Set([sourceDay, day])), source: source)
                if let error = saving.error { Text(error).foregroundStyle(Ink.danger) }
            }
            .paperGround()
            .tint(Ink.accent)
            .navigationTitle("날짜·순서 옮기기")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() }.disabled(saving.isWorking) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("이대로 옮기기") {
                        Task { if await saving.perform({ await onSave(draft, revision) }) { dismiss() } }
                    }.disabled(saving.isWorking)
                }
            }
        }
        .onAppear { day = sourceDay }
        .interactiveDismissDisabled(saving.isWorking)
    }
}
