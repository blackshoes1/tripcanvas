import SwiftUI

struct SharedInboxView: View {
    let service: TripService
    let trips: [TripSummary]
    let focusKey: String?
    let onOpenTrip: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var items = ShareQueue.pending()
    @State private var selected: SharedTravelInput?

    var body: some View {
        NavigationStack {
            PaperList {
                if items.isEmpty {
                    ContentUnavailableView("받은 자료가 없어요", systemImage: "tray", description: Text("다른 앱의 공유 메뉴에서 With J를 선택해 주세요. 저장할 여행과 내용을 여기서 확인해요."))
                }
                ForEach(items) { item in
                    Button { selected = item } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(item.title ?? item.url ?? "공유한 글").lineLimit(2)
                            Text(item.text ?? item.url ?? "원문 확인").font(.caption).foregroundStyle(Ink.soft).lineLimit(2)
                        }.frame(minHeight: 44)
                    }
                }
                Section {} footer: { Text("받은 원문은 이 기기에 보관돼요. 내용을 확인하고 저장하기 전에는 여행에 추가하지 않아요.") }
            }
            .navigationTitle("받은 자료")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("닫기") { dismiss() } } }
            .sheet(item: $selected, onDismiss: { items = ShareQueue.pending() }) { input in
                SharedImportView(input: input, service: service, trips: trips) { id in
                    selected = nil; dismiss(); onOpenTrip(id)
                }
            }
            .task {
                items = ShareQueue.pending()
                if let focusKey { selected = items.first { $0.id == focusKey } }
            }
            .onChange(of: scenePhase) { _, phase in if phase == .active { items = ShareQueue.pending() } }
        }
    }
}

private struct SharedImportView: View {
    enum Kind: String, CaseIterable { case booking = "예약", place = "장소", note = "준비 메모" }
    let input: SharedTravelInput
    let trips: [TripSummary]
    let onOpenTrip: (String) -> Void
    @State private var model: SharedImportModel
    @State private var tripID = ""
    @State private var kind: Kind = .note
    @State private var editedContent = false
    @State private var title: String
    @State private var bodyText: String
    @State private var day = 0
    @State private var currency = ""
    @State private var bookingSeed: TripBooking?
    @State private var showsBooking = false
    @State private var showsDiscard = false
    @Environment(\.dismiss) private var dismiss

    init(input: SharedTravelInput, service: TripService, trips: [TripSummary], onOpenTrip: @escaping (String) -> Void) {
        self.input = input; self.trips = trips; self.onOpenTrip = onOpenTrip
        _model = State(initialValue: SharedImportModel(input: input, service: service))
        _title = State(initialValue: input.title ?? "")
        _bodyText = State(initialValue: [input.text, input.url].compactMap { $0 }.joined(separator: "\n"))
    }

    var body: some View {
        NavigationStack {
            PaperForm {
                if model.saved {
                    Section {
                        Label("저장했어요", systemImage: "checkmark.circle.fill")
                        Button("여행에서 보기") { onOpenTrip(model.tripID) }
                    }
                } else {
                    Section("어디에 담을까요?") {
                        Picker("여행", selection: $tripID) {
                            Text("여행 선택").tag("")
                            ForEach(trips.filter { ($0.role ?? .owner).canEdit }) { Text($0.name).tag($0.id) }
                        }.disabled(!model.canChooseTrip)
                        if trips.isEmpty { Text("목록으로 돌아가 여행을 먼저 만들어 주세요. 원문은 남아 있어요.") }
                        Picker("분류", selection: $kind) { ForEach(Kind.allCases, id: \.self) { Text($0.rawValue).tag($0) } }
                    }
                    if let preview = model.preview {
                        Section("읽은 내용 확인") {
                            if let candidate = preview.candidate {
                                Text(candidate.title ?? "이름을 확인해 주세요")
                                ForEach(candidate.ambiguities, id: \.self) { Text($0).foregroundStyle(Ink.soft) }
                            }
                            if let duplicate = preview.duplicate {
                                Text("비슷한 예약 ‘\(duplicate.title)’이 있어요. 이미 담은 내용인지 확인해 주세요.")
                            }
                            if let match = preview.tripMatches.first { Text("관련 여행: \(match.name)").font(.caption) }
                        }
                    }
                    if kind == .booking {
                        Section {
                            Picker("예약 통화", selection: $currency) {
                                Text("통화 확인").tag("")
                                ForEach(Currency.allCases, id: \.self) { Text($0.rawValue).tag($0.rawValue) }
                            }
                            Button("예약 내용 확인하기") {
                                bookingSeed = model.bookingSeed(currency: currency); showsBooking = true
                            }.disabled(model.snapshot?.canEdit != true || currency.isEmpty || model.isWorking)
                        } footer: { Text("숙박·항공·렌터카의 금액과 날짜를 확인한 뒤 저장해요. 다른 예약은 준비 메모로 남길 수 있어요.") }
                    } else {
                        Section(kind == .place ? "장소 확인" : "메모 확인") {
                            TextField("이름 또는 제목", text: $title)
                            TextEditor(text: $bodyText).frame(minHeight: 100)
                            if kind == .place {
                                Picker("일자", selection: $day) {
                                    ForEach(0..<(model.snapshot?.document.days.count ?? 0), id: \.self) { Text("Day \($0 + 1)").tag($0) }
                                }
                                Text("선택한 날의 마지막에 담아요. 위치는 저장 후 지도 검색으로 지정해 주세요.").font(.caption)
                            }
                            if title.utf16.count > 120 || bodyText.utf16.count > 4000 { Text("제목은 120자, 본문은 4,000자까지 저장할 수 있어요. 원문은 아래에서 계속 볼 수 있어요.").foregroundStyle(.red) }
                            Button("확인한 내용 저장") { Task { await saveText() } }
                                .disabled(model.snapshot?.canEdit != true || model.isWorking || (title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && (kind == .place || bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)) || title.utf16.count > 120 || bodyText.utf16.count > 4000)
                        }
                    }
                }
                if model.isWorking { ProgressView("확인하는 중") }
                if let error = model.error {
                    Section {
                        Text(error).foregroundStyle(.red)
                        if !tripID.isEmpty { Button("여행 다시 불러오기") { Task { await model.selectTrip(tripID) } }.disabled(model.isWorking) }
                    }
                }
                Section("받은 원문") {
                    Text([input.title, input.text, input.url].compactMap { $0 }.joined(separator: "\n")).textSelection(.enabled)
                }
                if !model.saved { Button("이 자료 버리기", role: .destructive) { showsDiscard = true } }
            }
            .navigationTitle("공유 자료 확인")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() }.disabled(model.isWorking) } }
            .interactiveDismissDisabled(model.isWorking)
            .task {
                await model.previewInput()
                if !editedContent {
                    if model.preview?.kind == .place { kind = .place }
                    if let type = model.preview?.candidate?.type, [.hotel, .flight, .car].contains(type) { kind = .booking }
                }
                // 통화는 사용자가 명시적으로 확인한다. 추측한 원화로 저장하지 않는다.
            }
            .onChange(of: kind) { _, _ in editedContent = true }
            .onChange(of: title) { _, _ in editedContent = true }
            .onChange(of: bodyText) { _, _ in editedContent = true }
            .onChange(of: tripID) { _, id in day = 0; Task { await model.selectTrip(id) } }
            .sheet(isPresented: $showsBooking) {
                if let document = model.snapshot?.document, let bookingSeed {
                    BookingEditorView(target: .create, document: document, seed: bookingSeed, bookingOnly: true, onSave: { booking, links in
                        var raw = booking.raw; raw["importKey"] = .string(input.id)
                        let result = await model.save { $0.upsertBooking(TripBooking(raw: raw), links: links) }
                        if result == nil { markSaved() }
                        return result
                    }, onDelete: { _ in nil })
                }
            }
            .confirmationDialog("받은 원문을 이 기기에서 지울까요?", isPresented: $showsDiscard, titleVisibility: .visible) {
                Button("자료 삭제", role: .destructive) { ShareQueue.remove(id: input.id); dismiss() }
            }
        }
    }

    private func markSaved() { ShareQueue.update(id: input.id) { $0.state = .saved; $0.lastError = nil } }

    private func saveText() async {
        let selectedDay = day
        guard kind != .place || model.snapshot?.document.hasDay(selectedDay) == true else { return }
        let result = await model.save { document in
            if kind == .place {
                var spot = TripSpot(name: title.trimmingCharacters(in: .whitespacesAndNewlines))
                spot.desc = bodyText; spot.setField("importKey", .string(input.id))
                document.insertSpot(spot, dayIndex: selectedDay)
            } else {
                var notes = document.raw["notes"]?.arrayValue ?? []
                guard notes.count < 200 else { throw APIError.badRequest("준비 메모는 200개까지 담을 수 있어요.") }
                notes.append(.object(["id": .string(input.id), "cat": .string("ETC"), "title": .string(title), "body": .string(bodyText), "importKey": .string(input.id)]))
                document.setField("notes", .array(notes))
            }
        }
        if result == nil { markSaved() }
    }
}
