import SwiftUI

struct TodayPlaceChangeView: View {
    @State var model: TodayPlaceChangeModel
    let trip: TripSummary
    let source: TripDocumentSource
    let onChanged: () async -> Void
    let onOpenPlan: () -> Void
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var showsSearch = false
    @State private var editor: PlaceDraft?
    @State private var selectedDraft: TripSpot?

    private struct PlaceDraft: Identifiable {
        let id = UUID()
        let spot: TripSpot
    }

    var body: some View {
        NavigationStack {
            PaperList {
                Section("지금 일정") {
                    Text(model.activity.name).font(.headline)
                    if let time = model.slotTime { Text("도착 \(time) · 같은 시간대의 장소를 바꿔요.").font(.subheadline) }
                    Text("원래 장소는 보관하며, 바꾸기 전 시간 충돌을 확인해요.")
                        .font(.caption).foregroundStyle(Ink.soft)
                }
                if model.isSaved {
                    Section {
                        Label("변경을 저장했어요", systemImage: "checkmark.circle.fill")
                            .accessibilityIdentifier("todayPlaceChangeSaved")
                        if model.canUndo {
                            Button("이번 변경 되돌리기") {
                                Task { if await model.undo() != nil { await onChanged() } }
                            }.accessibilityIdentifier("todayPlaceChangeUndo")
                        }
                    }
                } else if let reason = model.blockedReason {
                    Section { Text(reason).foregroundStyle(Ink.warning) }
                } else if model.requiresQuickChoice {
                    Section { Text("먼저 ‘지금’ 화면에서 두 곳을 비교하고 골라 주세요.") }
                } else if !model.requiresRefresh, model.spot != nil {
                    Section("다른 장소") {
                        if model.canChooseNewPlace {
                            Button("장소 검색", systemImage: "magnifyingglass") { showsSearch = true }
                                .accessibilityIdentifier("todayPlaceChangeSearch")
                            Button("장소 직접 입력", systemImage: "square.and.pencil") {
                                editor = PlaceDraft(spot: model.newPlaceDraft)
                            }.accessibilityIdentifier("todayPlaceChangeManual")
                        }
                        if model.canRestore, let alternative = model.alternative {
                            Button("\(CollabModel.withJosa(alternative.name, "으로", "로")) 되돌리기", systemImage: "arrow.uturn.backward") {
                                Task { await model.restore() }
                            }.accessibilityIdentifier("todayPlaceChangeRestore")
                            Text("보관한 \(CollabModel.withJosa(alternative.name, "은", "는")) 새 장소를 골라도 남아요.")
                                .font(.caption).foregroundStyle(Ink.soft)
                        }
                    }
                    if let replacement = model.replacement {
                        Section("변경할 장소 · 아직 저장 전") {
                            Text(replacement.name).font(.headline)
                            if let stay = replacement.stayMinutes { Text("머무름 \(TimeFormat.duration(stay))") }
                            Text("장소를 바꿔도 기존 예약은 취소되지 않아요.")
                                .font(.caption).foregroundStyle(Ink.warning)
                        }
                    }
                    if let preview = model.preview, let document = model.reviewedDocument {
                        PlanPreviewSection(tripId: model.tripID, document: document, revision: model.revision,
                            days: [model.day], source: source, precomputed: [model.day: preview],
                            footerText: "기존 예약은 취소되지 않아요. 이동시간에 추정이 포함되면 실제 이동과 다를 수 있어요.")
                    }
                    if model.replacement != nil {
                        Section {
                            PrimaryActionButton(title: "이 장소로 변경하기", systemImage: "checkmark", isBusy: model.isWorking) {
                                Task { if await model.save() != nil { await onChanged() } }
                            }.disabled(!model.canSave).accessibilityIdentifier("todayPlaceChangeSave")
                        }
                    }
                }
                if model.isWorking { Section { ProgressView("변경을 확인하고 있어요") } }
                if let error = model.error {
                    Section {
                        Text(error).foregroundStyle(Ink.danger).accessibilityIdentifier("todayPlaceChangeError")
                        if model.requiresRefresh {
                            Button("최신 일정 확인") { Task { await onChanged(); dismiss() } }
                        } else if model.spot == nil {
                            Button("다시 불러오기") { Task { await model.load() } }
                        }
                    }
                }
                Section {
                    Button("이 장소를 일정에서 확인") { dismiss(); onOpenPlan() }
                        .accessibilityIdentifier("todayPlaceChangeOpenPlan")
                }
            }
            .disabled(model.isWorking)
            .navigationTitle("다른 장소로 바꾸기")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() }.disabled(model.isWorking) } }
        }
        .interactiveDismissDisabled(model.isWorking)
        .task(id: phase) { if phase == .active { await model.load() } }
        .sheet(isPresented: $showsSearch, onDismiss: {
            if let selectedDraft { editor = PlaceDraft(spot: selectedDraft); self.selectedDraft = nil }
        }) {
            PlaceSearchView(near: model.spot?.point, timeZone: trip.timeZone, onManual: { name in
                var draft = model.newPlaceDraft
                draft.name = name
                selectedDraft = draft
            }) { hit in
                var draft = hit.makeSpot()
                draft.arriveAt = model.slotTime
                draft.stayMinutes = model.newPlaceDraft.stayMinutes
                selectedDraft = draft
                return nil
            }
        }
        .sheet(item: $editor) { draft in
            SpotEditorView(target: .createFromMap(draft.spot), dayCount: 1, currentDay: model.day,
                contextLabel: model.slotTime.map { "도착 \($0) · 같은 시간대" },
                draftKey: EditorDraftKey(accountID: env.auth.session?.userId, tripID: model.tripID,
                    editor: "today-place-\(model.day)-\(model.activity.id)"),
                allowsChoice: false,
                onSave: { spot in
                    await model.review(spot)
                    return model.preview == nil ? model.error ?? "변경 영향을 다시 확인해 주세요." : nil
                }, onDelete: { _ in nil }, onMoveToDay: { _, _, _ in nil })
        }
    }
}
