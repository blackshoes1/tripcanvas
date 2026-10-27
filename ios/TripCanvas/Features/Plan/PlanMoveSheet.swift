import SwiftUI
import Observation

/// 검토한 원문만 저장한다. 날짜·도착 시각을 바꾸면 이전 미리보기는 즉시 무효다.
@Observable @MainActor
final class PlanMovePreviewModel {
    let document: TripDocument
    let revision: Int
    let sourceDay: Int
    let indexes: IndexSet
    private let tripId: String
    private let source: TripDocumentSource
    var day: Int {
        didSet {
            if day != oldValue {
                position = document.hasDay(day) ? document.days[day].spots.count : 0
                invalidate()
            }
        }
    }
    var position: Int { didSet { if position != oldValue { invalidate() } } }
    var arrivalAt: String? { didSet { if arrivalAt != oldValue { invalidate() } } }
    private(set) var previews: [Int: PlanChangePreview] = [:]
    private(set) var error: String?
    private(set) var isLoading = false
    private var generation = 0
    private(set) var inputVersion = 0
    private var reviewedInput: TripDocument?
    private var reviewedDocument: TripDocument?

    init(tripId: String, document: TripDocument, revision: Int, sourceDay: Int, indexes: IndexSet,
         initialDay: Int? = nil, source: TripDocumentSource) {
        self.tripId = tripId; self.document = document; self.revision = revision
        self.sourceDay = sourceDay; self.indexes = indexes; self.source = source
        let day = initialDay ?? sourceDay
        self.day = day
        self.position = document.hasDay(day) ? document.days[day].spots.count : 0
        self.arrivalAt = indexes.count == 1 && document.hasDay(sourceDay)
            ? indexes.first.flatMap { document.days[sourceDay].spots.indices.contains($0) ? document.days[sourceDay].spots[$0].arriveAt : nil } : nil
    }

    var singleSpot: TripSpot? {
        guard indexes.count == 1, let index = indexes.first, document.hasDay(sourceDay),
              document.days[sourceDay].spots.indices.contains(index) else { return nil }
        return document.days[sourceDay].spots[index]
    }
    var inputDocument: TripDocument {
        var result = document
        if let index = indexes.first, var spot = singleSpot {
            spot.arriveAt = arrivalAt
            result.updateSpot(dayIndex: sourceDay, at: index, with: spot)
        }
        result.moveSpots(fromDay: sourceDay, indexes: indexes, toDay: day, position: position)
        return result
    }
    var confirmedDocument: TripDocument? {
        guard !isLoading, error == nil, reviewedInput == inputDocument else { return nil }
        return reviewedDocument
    }

    private func invalidate() {
        generation += 1; inputVersion += 1
        reviewedInput = nil; reviewedDocument = nil; previews = [:]; error = nil
    }

    func refresh() async {
        generation += 1
        let request = generation, destination = day, input = inputDocument
        reviewedInput = nil; reviewedDocument = nil; previews = [:]; error = nil; isLoading = true
        defer { if generation == request { isLoading = false } }
        do {
            guard document.hasDay(sourceDay), document.hasDay(destination), !indexes.isEmpty,
                  indexes.allSatisfy({ document.days[sourceDay].spots.indices.contains($0) }) else {
                throw APIError.badRequest("옮길 장소와 날짜를 확인해 주세요.")
            }
            let target = try await source.planPreview(tripId: tripId, document: input, dayIndex: destination,
                                                      revision: revision, sortByTime: destination != sourceDay)
            guard generation == request, !Task.isCancelled else { return }
            let canonical: TripDocument
            if destination == sourceDay { canonical = input }
            else {
                guard let received = target.canonicalDocument else {
                    throw APIError.stale("이동 후 순서를 확인하지 못했어요. 다시 확인해 주세요.")
                }
                canonical = received
            }
            var results = [destination: target]
            if destination != sourceDay {
                results[sourceDay] = try await source.planPreview(tripId: tripId, document: canonical,
                    dayIndex: sourceDay, revision: revision, sortByTime: false)
            }
            guard generation == request, !Task.isCancelled else { return }
            guard results.allSatisfy({ day, value in
                value.before.trip.id == tripId && value.after.trip.id == tripId
                    && value.before.trip.revision == revision && value.after.trip.revision == revision
                    && value.before.day.index == day && value.after.day.index == day
            }) else { throw APIError.stale("일정이 바뀌었어요. 최신 일정에서 다시 선택해 주세요.") }
            previews = results; reviewedInput = input; reviewedDocument = canonical
        } catch {
            guard generation == request, !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
    }
}

struct PlanMoveSheet: View {
    let tripId: String
    let revision: Int
    let source: TripDocumentSource
    let onSave: (TripDocument, Int) async -> String?
    @Environment(\.dismiss) private var dismiss
    @State private var model: PlanMovePreviewModel
    @State private var saving = EditorSaveState()

    init(tripId: String, document: TripDocument, revision: Int, sourceDay: Int, indexes: IndexSet,
         source: TripDocumentSource, initialDay: Int? = nil,
         onSave: @escaping (TripDocument, Int) async -> String?) {
        self.tripId = tripId; self.revision = revision; self.source = source; self.onSave = onSave
        _model = State(initialValue: PlanMovePreviewModel(tripId: tripId, document: document, revision: revision,
            sourceDay: sourceDay, indexes: indexes, initialDay: initialDay, source: source))
    }

    var body: some View {
        NavigationStack {
            PaperList {
                Section("\(model.indexes.count)곳 이동") {
                    Picker("방문 날짜", selection: $model.day) {
                        ForEach(model.document.days.indices, id: \.self) { day in
                            Text(PlanDateLabel.day(model.document, day)).tag(day)
                        }
                    }
                    if model.document.hasDay(model.day) {
                        Picker("넣을 위치", selection: $model.position) {
                            Text("맨 처음").tag(0)
                            ForEach(Array(model.document.days[model.day].spots.enumerated()), id: \.offset) { index, spot in
                                Text("\(spot.name) 뒤").tag(index + 1)
                            }
                        }
                        .accessibilityIdentifier("movePosition")
                    }
                    if model.day != model.sourceDay {
                        Text("도착 시각이 있는 곳은 시간순으로 맞추고, 시각이 없는 곳은 고른 위치를 기준으로 두어요.")
                            .font(.caption).foregroundStyle(Ink.soft)
                    }
                }
                if let spot = model.singleSpot {
                    Section(spot.name) {
                        ClockField(title: "내가 정한 도착 시각", text: $model.arrivalAt)
                        if let bookedAt = spot.bookedAt {
                            Text("예약·입장 \(bookedAt)은 그대로 유지해요.").font(.caption).foregroundStyle(Ink.info)
                        }
                    }
                }
                if model.isLoading { Section { ProgressView("변경 전후 확인 중") } }
                if let reviewed = model.confirmedDocument, reviewed.hasDay(model.day) {
                    Section("이동 후 순서") {
                        ForEach(Array(reviewed.days[model.day].spots.enumerated()), id: \.offset) { index, spot in
                            Text("\(index + 1). \(spot.name)")
                        }
                    }
                    PlanPreviewSection(tripId: tripId, document: reviewed, revision: revision,
                        days: Array(Set([model.sourceDay, model.day])), source: source, precomputed: model.previews)
                }
                if let error = model.error {
                    Section {
                        Text("변경을 확인하지 못했어요. \(error)").foregroundStyle(Ink.danger)
                        Button("변경 다시 확인") { Task { await model.refresh() } }
                    }
                }
                if let error = saving.error { Section { Text(error).foregroundStyle(Ink.danger) } }
            }
            .disabled(saving.isWorking)
            .tint(Ink.accent)
            .navigationTitle("날짜·순서 옮기기")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() }.disabled(saving.isWorking) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("이대로 옮기기") {
                        guard let confirmed = model.confirmedDocument else { return }
                        Task { if await saving.perform({ await onSave(confirmed, revision) }) { dismiss() } }
                    }.disabled(saving.isWorking || model.confirmedDocument == nil)
                }
            }
        }
        .task(id: model.inputVersion) {
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            await model.refresh()
        }
        .interactiveDismissDisabled(saving.isWorking)
    }
}
