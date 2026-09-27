import SwiftUI

/// 여행 준비 메모(`trip.notes`) — 비자·입국 준비·교통 이용법처럼 **날짜에 붙지 않는** 것들.
/// 분류 이름·순서는 `lib.js`의 `TRIP_NOTE_CATEGORIES`와 웹 `NOTE_CAT_LABELS`를 따른다.
struct TripNote: Identifiable, Hashable {
    let id: String
    let category: String
    let title: String
    let body: String
    let done: Bool

    /// 웹 `normalizeTripNote`와 같은 규칙으로 걸러 읽는다 — 제목·본문이 모두 비면 없는 메모다.
    static func notes(in document: TripDocument?) -> [TripNote] {
        (document?.raw["notes"]?.arrayValue ?? []).compactMap { value in
            guard let raw = value.objectValue, let id = raw["id"]?.stringValue else { return nil }
            let title = (raw["title"]?.stringValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let body = raw["body"]?.stringValue ?? ""
            guard !title.isEmpty || !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
            let category = raw["cat"]?.stringValue ?? ""
            return TripNote(id: id, category: categories.contains(category) ? category : "ETC",
                            title: title, body: body, done: raw["done"]?.boolValue == true)
        }
    }

    static let categories = ["VISA", "ENTRY", "TRANSPORT", "MONEY", "COMM", "SHOPPING", "PACKING", "HEALTH", "ETC"]

    static func label(_ category: String) -> String {
        switch category {
        case "VISA": "비자"
        case "ENTRY": "입국 준비"
        case "TRANSPORT": "교통"
        case "MONEY": "환전·결제"
        case "COMM": "통신·유심"
        case "SHOPPING": "특산품·쇼핑"
        case "PACKING": "짐 챙기기"
        case "HEALTH": "건강·보험"
        default: "기타"
        }
    }
}

struct TripNotesView: View {
    let model: TripPlanViewModel
    @State private var showsAdd = false

    private var notes: [TripNote] { TripNote.notes(in: model.document) }

    var body: some View {
        List {
            if let date = model.documentCachedAt { OfflineNotice(savedAt: date) }
            if let error = model.conflict ?? model.errorMessage {
                Section {
                    Text(error).foregroundStyle(.red)
                    Button("최신 메모 불러오기") { Task { await model.reloadFromServer() } }
                }
            }
            if model.document == nil && model.isLoading {
                ProgressView("메모를 불러오는 중").frame(maxWidth: .infinity, minHeight: 120)
            } else if notes.isEmpty {
                EmptyStateView(symbol: "note.text", title: "아직 준비 메모가 없어요",
                               message: "비자·입국 준비·짐 챙기기를 메모하고 준비가 끝나면 확인 표시를 해 보세요.")
                    .listRowBackground(Color.clear)
            } else {
                // 같은 분류끼리 모은다 — 준비물을 훑어보려면 흩어져 있으면 안 된다(웹과 같은 순서).
                ForEach(TripNote.categories.filter { cat in notes.contains { $0.category == cat } }, id: \.self) { cat in
                    let rows = notes.filter { $0.category == cat && !$0.done } + notes.filter { $0.category == cat && $0.done }
                    Section {
                        ForEach(rows) { note in
                            VStack(alignment: .leading, spacing: Space.xs) {
                                Button {
                                    Task { await model.setNoteDone(id: note.id, done: !note.done) }
                                } label: {
                                    Label(note.title.isEmpty ? "(제목 없음)" : note.title,
                                          systemImage: note.done ? "checkmark.circle.fill" : "circle")
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(note.done ? Ink.soft : Ink.ink)
                                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                }
                                .buttonStyle(.plain)
                                .disabled(!model.canEdit || model.isSaving)
                                .accessibilityValue(note.done ? "확인 완료" : "준비 중")
                                .accessibilityHint(note.done ? "확인 표시를 해제해요" : "준비가 끝났다고 표시해요")
                                if !note.body.isEmpty {
                                    Text(note.body).font(.subheadline).foregroundStyle(Ink.soft).textSelection(.enabled)
                                }
                            }
                            .padding(.vertical, Space.xs)
                        }
                    } header: {
                        let done = rows.filter(\.done).count
                        Text(done > 0 ? "\(TripNote.label(cat)) · \(done)/\(rows.count) 확인" : TripNote.label(cat))
                    }
                }
                Section {} footer: {
                    Text("웹에서 쓴 메모도 함께 보여요. 연결이 없을 때는 저장한 메모를 읽을 수 있어요.")
                }
            }
        }
        .listStyle(.insetGrouped)
        .paperGround()
        .navigationTitle("여행 준비 메모")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("메모 추가", systemImage: "plus") { showsAdd = true }
                    .disabled(!model.canEdit || model.isSaving)
            }
        }
        .sheet(isPresented: $showsAdd) { AddTripNoteView(model: model) }
        .refreshable { await model.load() }
        .task { await model.loadIfStale() }
    }
}

private struct AddTripNoteView: View {
    let model: TripPlanViewModel
    @State private var title = ""
    @State private var text = ""
    @State private var category = "ETC"
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                Picker("분류", selection: $category) {
                    ForEach(TripNote.categories, id: \.self) { Text(TripNote.label($0)).tag($0) }
                }
                TextField("제목", text: $title)
                TextField("짧은 메모", text: $text, axis: .vertical).lineLimit(3...8)
                if let error = model.conflict ?? model.errorMessage {
                    Text(error).foregroundStyle(.red)
                    if model.conflict != nil { Button("최신 메모 불러오기") { Task { await model.reloadFromServer() } } }
                }
            }
            .navigationTitle("준비 메모 추가")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() }.disabled(model.isSaving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("저장") {
                        Task { if await model.addNote(title: title, body: text, category: category) { dismiss() } }
                    }.disabled(model.isSaving || !model.canEdit || (title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                }
            }
            .interactiveDismissDisabled(model.isSaving)
        }
    }
}
