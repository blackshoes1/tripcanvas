import SwiftUI

/// 가진 일정을 붙여넣어 여행 만들기.
///
/// 흐름은 웹과 **같은 계약**이다: `붙여넣기 → 읽어 보기 → 담을 것 고르기 → 만들기`.
/// ⚠️ **확인 전에는 아무것도 저장되지 않는다**(§밖에서 들어온 것은 확인 없이 저장하지 않는다).
/// ⚠️ 파서는 서버에 있다 — 규칙을 Swift로 복제하면 웹과 앱이 같은 글을 다르게 읽는다.
struct PasteItineraryView: View {
    let service: TripDataSource
    let places: PlaceSearching
    /// 만든 여행. 부모가 그 여행으로 들어간다.
    let onCreated: (TripSummary) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var draft: ItineraryDraft?
    @State private var rows: [Row] = []
    @State private var tripName = ""
    @State private var start = ""
    @State private var isBusy = false
    @State private var errorMessage: String?

    /// 한 줄. 담을지(`include`)와 찾은 좌표(`found`)는 화면에서 바뀐다.
    struct Row: Identifiable, Equatable {
        let id = UUID()
        let dayIndex: Int
        let item: ItineraryDraftItem
        var include: Bool
        var found: PlaceHit?
        var searched = false
    }

    var body: some View {
        NavigationStack {
            Group {
                if draft == nil { input } else { preview }
            }
            .navigationTitle(draft == nil ? "일정 붙여넣기" : "이렇게 읽었어요")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") { dismiss() }.disabled(isBusy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isBusy { ProgressView() } else if draft == nil {
                        Button("읽어 보기") { Task { await parse() } }
                            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    } else {
                        Button("만들기") { Task { await create() } }
                    }
                }
            }
        }
        .interactiveDismissDisabled(isBusy)
    }

    /// 프롬프트를 복사했는지 — 클립보드는 눈에 안 보여서 눌렸는지 알 수 없다.
    @State private var promptCopied = false

    /// ⚠️ `app.js`의 `AI_ASK_PROMPT` 복사본이다. **문구를 바꿀 때는 웹을 먼저 고친다** —
    /// 같은 안내가 기기마다 다르면 사용자가 무엇이 맞는지 알 수 없다.
    static let aiAskPrompt = """
    아래 조건에 맞춰 여행 일정을 짜 줘.

    - 하루마다 머리글에 **날짜**를 넣어 줘. 예) ## 10월 3일 (금) — 난바 도착
    - **한 줄에 한 곳**, 줄 앞에 시각. 예) - 13:00 도톤보리 | 오사카 | 글리코 간판 앞
    - 장소 이름은 **지도에서 검색되는 정식 상호**로. '유명한 라멘집' 말고 실제 가게 이름으로 써 줘.
    - 이름 뒤에 **| 도시**를 붙여 줘. 같은 이름이 여러 곳에 있어서 필요해.
    - 숙소는 이름 앞에 (숙소), 안 가도 되는 곳은 (선택).
    - **모르는 시각은 비워 둬** — 지어내지 마.

    목록이든 표든 편한 대로 써도 되고, 설명이나 인사말이 섞여도 괜찮아.

    여행: 
    """

    // MARK: 붙여넣기

    private var input: some View {
        Form {
            Section {
                TextEditor(text: $text)
                    .frame(minHeight: 220)
                    .font(.callout)
            } header: {
                Text("가진 일정을 그대로 붙여넣으세요")
            } footer: {
                Text("AI·블로그·메일에서 받은 일정도 됩니다. 마크다운·표·이모지·\"오후 3시\"까지 읽어요. 읽은 결과를 보여 드릴 테니 담을 것만 고르시면 돼요.")
            }
            Section {
                Button {
                    text = UIPasteboard.general.string ?? text
                } label: {
                    Label("클립보드에서 붙여넣기", systemImage: "doc.on.clipboard")
                }
                Button {
                    UIPasteboard.general.string = Self.aiAskPrompt
                    promptCopied = true
                } label: {
                    Label(promptCopied ? "복사했어요 — AI에 붙여넣고 답을 가져오세요" : "AI에게 시킬 프롬프트 복사",
                          systemImage: promptCopied ? "checkmark" : "sparkles")
                }
            } footer: {
                Text("아직 일정이 없다면 이걸 복사해 ChatGPT·Claude에 붙여넣고, 받은 답을 그대로 위에 넣으세요.")
            }
            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(.red).font(.footnote) }
            }
        }
    }

    // MARK: 미리보기

    private var preview: some View {
        List {
            Section {
                TextField("여행 이름", text: $tripName)
                LabeledContent("시작일", value: start.isEmpty ? "글에 없어요" : start)
                if draft?.startAmbiguous == true {
                    Text("연도가 글에 없어서 올해로 봤어요 — 맞는지 확인해 주세요.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            } header: {
                Text(summaryText)
            }

            ForEach(draft?.days ?? [], id: \.index) { day in
                Section(dayTitle(day)) {
                    ForEach($rows.filter { $0.wrappedValue.dayIndex == day.index }) { $row in
                        rowView($row)
                    }
                }
            }

            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(.red).font(.footnote) }
            }
        }
    }

    private func rowView(_ row: Binding<Row>) -> some View {
        HStack(alignment: .top, spacing: Space.s) {
            Button {
                row.wrappedValue.include.toggle()
                if row.wrappedValue.include { Task { await locate(row.wrappedValue.id) } }
            } label: {
                Image(systemName: row.wrappedValue.include ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(row.wrappedValue.include ? Color.accentColor : .secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(row.wrappedValue.item.name) 담기")

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Space.xs) {
                    if let at = row.wrappedValue.item.at {
                        Text(at).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    }
                    Text(row.wrappedValue.item.name).font(.subheadline)
                }
                Text(statusText(row.wrappedValue)).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .opacity(row.wrappedValue.include ? 1 : 0.55)
    }

    /// 무엇이 일어났는지 줄마다 말한다 — 찾았으면 찾은 이름을, 못 찾았으면 못 찾았다고.
    private func statusText(_ row: Row) -> String {
        if !row.include { return row.item.reasons.first ?? "메모로 남겨요" }
        if let found = row.found { return "📍 \(found.name)\(found.city.isEmpty ? "" : " · \(found.city)")" }
        return row.searched ? "위치를 못 찾았어요 — 담고 나서 지정할 수 있어요" : "위치 찾는 중…"
    }

    private func dayTitle(_ day: ItineraryDraftDay) -> String {
        let parts = ["\(day.index + 1)일차", day.date, day.title.isEmpty ? nil : day.title]
        return parts.compactMap { $0 }.joined(separator: " · ")
    }

    private var summaryText: String {
        let kept = rows.filter(\.include).count
        let dropped = rows.count - kept
        return "담을 장소 \(kept)곳" + (dropped > 0 ? " · 메모로 남길 줄 \(dropped)개" : "")
    }

    // MARK: 동작

    private func parse() async {
        isBusy = true
        errorMessage = nil
        do {
            let parsed = try await service.parseItinerary(text: text)
            draft = parsed
            tripName = parsed.name.isEmpty ? NewTripView.fallbackName : parsed.name
            start = parsed.start ?? ""
            rows = parsed.days.flatMap { day in
                day.items.map { Row(dayIndex: day.index, item: $0, include: $0.kind == .place) }
            }
            isBusy = false
            await locateAll()
        } catch {
            isBusy = false
            errorMessage = message(for: error, fallback: "일정을 읽지 못했어요. 잠시 후 다시 시도해 주세요.")
        }
    }

    /// 담기로 한 줄만 찾는다 — 활동·이동을 조회하면 할당량만 먹고 엉뚱한 좌표가 붙는다.
    private func locateAll() async {
        for row in rows where row.include && !row.searched {
            await locate(row.id)
        }
    }

    private func locate(_ id: UUID) async {
        guard let index = rows.firstIndex(where: { $0.id == id }), rows[index].found == nil else { return }
        let row = rows[index]
        guard row.include, !row.item.name.isEmpty else { return }
        // 이미 찾은 장소의 도시를 물려받는다 — 같은 여행이면 대개 같은 동네다(웹과 같은 사다리).
        let hint = row.item.city.isEmpty ? (rows.compactMap(\.found).first?.city ?? "") : row.item.city
        let query = hint.isEmpty ? row.item.name : "\(row.item.name) \(hint)"
        let hits = (try? await places.search(query, near: rows.compactMap(\.found).first?.point)) ?? []
        guard let current = rows.firstIndex(where: { $0.id == id }) else { return }
        rows[current].found = hits.first
        rows[current].searched = true
    }

    private func create() async {
        guard let draft else { return }
        isBusy = true
        errorMessage = nil
        do {
            let summary = try await service.createTrip(document: ItineraryDocument.make(
                draft: draft,
                lines: rows.map { .init(dayIndex: $0.dayIndex, item: $0.item, include: $0.include, found: $0.found) },
                name: tripName, start: start))
            isBusy = false
            onCreated(summary)
            dismiss()
        } catch {
            isBusy = false
            errorMessage = message(for: error, fallback: "여행을 만들지 못했어요. 잠시 후 다시 시도해 주세요.")
        }
    }

    private func message(for error: Error, fallback: String) -> String {
        guard let api = error as? APIError else { return fallback }
        switch api {
        case .unauthorized: return "로그인이 필요해요 — 다시 로그인한 뒤 시도해 주세요."
        case .offline: return "서버에 닿지 못했어요 — 연결을 확인해 주세요."
        case .notFound: return "이 버전의 서버는 아직 붙여넣기를 읽지 못해요 — 웹에서 붙여넣어 주세요."
        case .badRequest(let m): return m
        default: return fallback
        }
    }
}

/// 초안 + 사람이 고른 것 → 여행 문서.
///
/// **화면 밖에서 판정한다.** 무엇이 장소가 되고 무엇이 메모로 남는지는 눈으로 확인하기 어려운 규칙이라
/// 화면과 떼어 놓고 테스트한다(§판정은 순수 모듈에, 화면은 배선·표시만).
enum ItineraryDocument {
    struct Line {
        let dayIndex: Int
        let item: ItineraryDraftItem
        let include: Bool
        let found: PlaceHit?
    }

    /// 담기로 한 것만 장소가 된다. **담지 않은 줄은 버리지 않고** 그 날 메모로 남는다.
    static func make(draft: ItineraryDraft, lines: [Line], name: String, start: String) -> [String: JSONValue] {
        let days: [JSONValue] = draft.days.map { day in
            let mine = lines.filter { $0.dayIndex == day.index }
            var spots: [JSONValue] = []
            var notes: [String] = day.note.isEmpty ? [] : [day.note]
            for line in mine {
                guard line.include else { notes.append("· \(line.item.raw)"); continue }
                var spot = TripSpot(name: line.item.name, city: line.found?.city ?? line.item.city)
                spot.desc = line.item.desc
                spot.arriveAt = line.item.at
                spot.stayMinutes = line.item.stayMinutes
                spot.isStay = line.item.stay
                if let point = line.found?.point ?? line.item.location { spot.point = point }
                if let placeId = line.found?.placeId { spot.placeId = placeId }
                if let category = line.found?.category { spot.category = category }
                spots.append(.object(spot.raw))
            }
            return .object([
                "title": .string(day.title),
                "note": .string(notes.joined(separator: "\n")),
                "spots": .array(spots)
            ])
        }
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        return [
            "name": .string(trimmed.isEmpty ? NewTripView.fallbackName : trimmed),
            "start": .string(start),
            // 일자가 하나도 없는 글이어도 여행은 하루로 선다 — 빈 문서를 만들지 않는다
            "days": .array(days.isEmpty ? [.object(["title": .string(""), "spots": .array([])])] : days)
        ]
    }
}
