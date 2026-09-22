import SwiftUI

struct CandidatePlacementSheet: View {
    let trip: TripSummary
    let candidate: CandidateView
    let source: TripDocumentSource
    let onSave: (Int, Int, Int) async -> String?
    @Environment(\.dismiss) private var dismiss
    @State private var snapshot: TripDocumentSnapshot?
    @State private var day = 0
    @State private var position = 0
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Group {
                if let snapshot {
                    List {
                        Section(candidate.title) {
                            DayPositionFields(document: snapshot.document, day: $day, position: $position)
                        }
                        Section("넣은 뒤 순서") {
                            ForEach(Array(draft(snapshot).days[day].spots.enumerated()), id: \.offset) { index, spot in
                                Text("\(index + 1). \(spot.name)")
                            }
                        }
                        PlanPreviewSection(tripId: trip.id, document: draft(snapshot), revision: snapshot.revision,
                                           days: [day], source: source)
                        if let error { Text(error).foregroundStyle(Ink.danger) }
                    }
                } else if let error {
                    ContentUnavailableView { Label("일정을 확인하지 못했어요", systemImage: "icloud.slash") }
                    description: { Text(error) } actions: { Button("다시 불러오기") { Task { await load() } } }
                } else { ProgressView() }
            }
            .paperGround()
            .tint(Ink.accent)
            .navigationTitle("날짜와 위치 선택")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("일정에 넣기") {
                        guard let snapshot else { return }
                        saving = true
                        Task {
                            error = await onSave(day, position, snapshot.revision)
                            saving = false
                            if error == nil { dismiss() }
                        }
                    }.disabled(snapshot == nil || saving)
                }
            }
        }.task { await load() }.interactiveDismissDisabled(saving)
    }

    private func draft(_ snapshot: TripDocumentSnapshot) -> TripDocument {
        var draft = snapshot.document
        for (fromDay, value) in draft.days.enumerated() {
            if let index = value.spots.firstIndex(where: { $0.raw["candidateId"]?.intValue == candidate.id }) {
                draft.moveSpots(fromDay: fromDay, indexes: IndexSet(integer: index), toDay: day, position: position)
                return draft
            }
        }
        draft.insertSpot(CandidateBoardViewModel.spot(from: candidate), dayIndex: day, after: position - 1)
        return draft
    }
    private func load() async {
        do {
            let result = try await source.document(tripId: trip.id)
            guard !result.document.days.isEmpty else { error = "여행에 일자를 먼저 추가해 주세요."; return }
            snapshot = result; error = nil
        } catch { self.error = error.localizedDescription }
    }
}

struct DayPositionFields: View {
    let document: TripDocument
    @Binding var day: Int
    @Binding var position: Int
    var body: some View {
        Picker("방문 날짜", selection: $day) {
            ForEach(document.days.indices, id: \.self) { index in
                Text(PlanDateLabel.day(document, index)).tag(index)
            }
        }
        .onChange(of: day) { _, _ in position = 0 }
        if document.hasDay(day) {
            Picker("넣을 위치", selection: $position) {
                Text("맨 처음").tag(0)
                ForEach(Array(document.days[day].spots.enumerated()), id: \.offset) { index, spot in
                    Text("\(spot.name) 뒤").tag(index + 1)
                }
            }
        }
    }
}

enum PlanDateLabel {
    static func day(_ document: TripDocument, _ index: Int) -> String {
        var parts = ["Day \(index + 1)"]
        if let first = ISODateText.date(from: document.start),
           let date = ISODateText.calendar.date(byAdding: .day, value: index, to: first) {
            let formatter = DateFormatter()
            formatter.calendar = ISODateText.calendar; formatter.timeZone = ISODateText.calendar.timeZone
            formatter.locale = Locale(identifier: "ko_KR"); formatter.dateFormat = "M/d(E)"
            parts.append(formatter.string(from: date))
        }
        if document.hasDay(index), !document.days[index].title.isEmpty { parts.append(document.days[index].title) }
        return parts.joined(separator: " · ")
    }
}
