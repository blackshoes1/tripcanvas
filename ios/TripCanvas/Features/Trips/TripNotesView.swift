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

    /// 웹이 고칠 때 넣는 `updatedAt`과 같은 모양(ISO 8601, 밀리초) — `new Date().toISOString()`.
    static func timestamp(_ date: Date = Date()) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
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
    @State private var editing: TripNote?

    private var notes: [TripNote] { TripNote.notes(in: model.document) }

    var body: some View {
        PaperList {
            if let date = model.documentCachedAt { OfflineNotice(savedAt: date) }
            if let error = model.conflict ?? model.errorMessage {
                Section {
                    Text(error).foregroundStyle(Ink.danger)
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
                            HStack(alignment: .top, spacing: Space.s) {
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
                                // 보기 권한에는 고치기·지우기가 없다 — 화면은 감출 뿐이고 결정은 서버가 한다.
                                if model.canEdit {
                                    Button { editing = note } label: {
                                        Image(systemName: "pencil").frame(minWidth: 44, minHeight: 44)
                                    }
                                    .buttonStyle(.plain)
                                    .foregroundStyle(Ink.accent)
                                    .disabled(model.isSaving)
                                    .accessibilityLabel("메모 고치기")
                                    .accessibilityIdentifier("noteEdit")
                                }
                            }
                            .padding(.vertical, Space.xs)
                            .swipeActions(edge: .trailing) {
                                if model.canEdit {
                                    // 확인창은 없다 — 지운 뒤 토스트의 '되돌리기'가 있다.
                                    Button("지우기", role: .destructive) { Task { await model.removeNote(id: note.id) } }
                                }
                            }
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
        .navigationTitle("여행 준비 메모")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("메모 추가", systemImage: "plus") { showsAdd = true }
                    .disabled(!model.canEdit || model.isSaving)
            }
        }
        .sheet(isPresented: $showsAdd) { AddTripNoteView(model: model) }
        .sheet(item: $editing) { note in EditTripNoteView(model: model, note: note) }
        .overlay(alignment: .bottom) {
            if let toast = model.toast {
                // 방금 한 일(고치기·지우기 포함)을 되돌릴 수 있으면 그 자리에서 말한다.
                let undoable = model.canUndo && toast != "변경을 되돌렸어요"
                ToastView(text: toast, actionTitle: undoable ? "되돌리기" : nil) {
                    model.clearToast()
                    Task { await model.undoLastChange() }
                }
                .padding(Space.l)
                .task(id: toast) {
                    try? await Task.sleep(for: .seconds(undoable ? 5 : 2))
                    model.clearToast()
                }
            }
        }
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
            PaperForm {
                Picker("분류", selection: $category) {
                    ForEach(TripNote.categories, id: \.self) { Text(TripNote.label($0)).tag($0) }
                }
                TextField("제목", text: $title)
                TextField("짧은 메모", text: $text, axis: .vertical).lineLimit(3...8)
                if let error = model.conflict ?? model.errorMessage {
                    Text(error).foregroundStyle(Ink.danger)
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

/// 메모 하나를 고친다. 열 때의 revision을 고정해 두고 저장한다 — 편집하는 동안 원격 변경이 오면 다른 메모를 덮지 않고 이유를 말한다.
private struct EditTripNoteView: View {
    let model: TripPlanViewModel
    let note: TripNote
    @State private var title: String
    @State private var text: String
    @State private var category: String
    @State private var revision: Int
    @Environment(\.dismiss) private var dismiss

    init(model: TripPlanViewModel, note: TripNote) {
        self.model = model
        self.note = note
        _title = State(initialValue: note.title)
        _text = State(initialValue: note.body)
        _category = State(initialValue: note.category)
        _revision = State(initialValue: model.revision)
    }

    private var isEmpty: Bool {
        title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            PaperForm {
                Picker("분류", selection: $category) {
                    ForEach(TripNote.categories, id: \.self) { Text(TripNote.label($0)).tag($0) }
                }
                TextField("제목", text: $title)
                TextField("짧은 메모", text: $text, axis: .vertical).lineLimit(3...8)
                if isEmpty { Text("제목이나 내용을 적어 주세요.").font(.caption).foregroundStyle(Ink.danger) }
                if let error = model.conflict ?? model.errorMessage {
                    Text(error).foregroundStyle(Ink.danger)
                    if model.conflict != nil { Button("최신 메모 불러오기") { Task { await model.reloadFromServer() } } }
                }
                Button("메모 지우기", role: .destructive) {
                    Task { if await model.removeNote(id: note.id, expectedRevision: revision) { dismiss() } }
                }
                .disabled(model.isSaving || !model.canEdit)
                .accessibilityIdentifier("noteDelete")
            }
            .navigationTitle("준비 메모 고치기")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() }.disabled(model.isSaving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("저장") {
                        Task { if await model.updateNote(id: note.id, title: title, body: text, category: category, expectedRevision: revision) { dismiss() } }
                    }.disabled(model.isSaving || !model.canEdit || isEmpty)
                }
            }
            .interactiveDismissDisabled(model.isSaving)
        }
    }
}
