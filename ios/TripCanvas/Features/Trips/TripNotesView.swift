import SwiftUI

/// 여행 준비 메모(`trip.notes`) — 비자·입국 준비·교통 이용법처럼 **날짜에 붙지 않는** 것들.
/// 웹에서 적은 것을 여행지에서 못 보면 쓸모가 반이다(2026-09-27 UX 검토). 여기서는 **읽기만** 한다 —
/// 추가·수정은 웹의 ☰ '여행 준비 메모'다. 분류 이름·순서는 `lib.js`의 `TRIP_NOTE_CATEGORIES`와 웹 `NOTE_CAT_LABELS`를 따른다.
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

    private var notes: [TripNote] { TripNote.notes(in: model.document) }

    var body: some View {
        List {
            if model.document == nil && model.isLoading {
                ProgressView("메모를 불러오는 중").frame(maxWidth: .infinity, minHeight: 120)
            } else if notes.isEmpty {
                EmptyStateView(symbol: "note.text", title: "아직 준비 메모가 없어요",
                               message: "비자·입국 준비처럼 날짜에 붙지 않는 것은 웹의 ☰ ‘여행 준비 메모’에 적어 두면 여기서 볼 수 있어요.")
                    .listRowBackground(Color.clear)
            } else {
                // 같은 분류끼리 모은다 — 준비물을 훑어보려면 흩어져 있으면 안 된다(웹과 같은 순서).
                ForEach(TripNote.categories.filter { cat in notes.contains { $0.category == cat } }, id: \.self) { cat in
                    let rows = notes.filter { $0.category == cat }
                    Section {
                        ForEach(rows) { note in
                            VStack(alignment: .leading, spacing: Space.xs) {
                                Label(note.title.isEmpty ? "(제목 없음)" : note.title,
                                      systemImage: note.done ? "checkmark.circle.fill" : "circle")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(note.done ? Ink.soft : Ink.ink)
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
                    Text("메모 추가·수정은 웹에서 할 수 있어요.")
                }
            }
        }
        .listStyle(.insetGrouped)
        .paperGround()
        .navigationTitle("여행 준비 메모")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.load() }
        .task { await model.loadIfStale() }
    }
}
