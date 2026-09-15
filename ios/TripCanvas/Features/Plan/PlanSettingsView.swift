import SwiftUI

/// 날짜가 바뀌어도 기존 일정과 외부 예약의 절대 날짜를 보존한다.
enum PlanCalendarChange {
    static func draft(_ original: TripDocument, start: String, count: Int) -> TripDocument? {
        guard count >= 1 && count <= 60 else { return nil }
        if !start.isEmpty {
            guard let date = ISODateText.date(from: start), ISODateText.text(from: date) == start else { return nil }
        }
        var result = original
        var days = original.days
        if !original.start.isEmpty && start != original.start {
            guard let old = ISODateText.date(from: original.start), let new = ISODateText.date(from: start),
                  let offset = ISODateText.calendar.dateComponents([.day], from: new, to: old).day else { return nil }
            if offset > 0 { days.insert(contentsOf: Array(repeating: TripDay(), count: offset), at: 0) }
            if offset < 0 {
                let removed = days.prefix(-offset)
                guard -offset <= days.count, removed.allSatisfy(isEmpty) else { return nil }
                days.removeFirst(-offset)
            }
        }
        if count < days.count {
            guard days.dropFirst(count).allSatisfy(isEmpty) else { return nil }
            days = Array(days.prefix(count))
        }
        if count > days.count { days.append(contentsOf: Array(repeating: TripDay(), count: count - days.count)) }
        result.start = start; result.days = days
        return result
    }

    static func isEmpty(_ day: TripDay) -> Bool {
        // 시간·예산·메모만 정한 날도 사용자 입력이다. 자동 삭제 대상으로 삼지 않는다.
        day.spots.isEmpty && day.note.isEmpty && day.title.isEmpty && day.budget == nil
            && day.costItems.isEmpty && day.startAt == nil && day.carriesPreviousAnchor
            && day.mode == .car && (day.raw["drive"]?.stringValue ?? "").isEmpty
            && Set(day.raw.keys).isSubset(of: ["spots", "title", "note", "mode", "drive"])
    }
}

struct PlanSettingsView: View {
    let original: TripDocument
    let revision: Int
    let selectedDay: Int
    let onSave: (TripDocument, Int) async -> String?
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var start: String
    @State private var count: Int
    @State private var day: TripDay
    @State private var saving = EditorSaveState()
    @State private var confirmedDates = false
    @State private var showsDiscardConfirm = false

    init(document: TripDocument, revision: Int, selectedDay: Int, onSave: @escaping (TripDocument, Int) async -> String?) {
        self.original = document; self.revision = revision; self.selectedDay = selectedDay; self.onSave = onSave
        _name = State(initialValue: document.name); _start = State(initialValue: document.start)
        _count = State(initialValue: max(1, document.days.count))
        _day = State(initialValue: document.hasDay(selectedDay) ? document.days[selectedDay] : TripDay())
    }

    private var draft: TripDocument? {
        var document = original
        document.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if document.hasDay(selectedDay) {
            var days = document.days
            // 이 화면은 하루 설정만 수정한다. 장소·예산·예약은 원문 그대로 유지한다.
            days[selectedDay].title = day.title; days[selectedDay].startAt = day.startAt
            days[selectedDay].mode = day.mode; days[selectedDay].carriesPreviousAnchor = day.carriesPreviousAnchor
            document.days = days
        }
        return PlanCalendarChange.draft(document, start: start, count: count)
    }
    private var isDirty: Bool {
        name != original.name || datesChanged || day != (original.hasDay(selectedDay) ? original.days[selectedDay] : TripDay())
    }
    private var datesChanged: Bool { start != original.start || count != original.days.count }

    var body: some View {
        NavigationStack {
            Form {
                Section("여행") {
                    TextField("여행 이름", text: $name)
                    TextField("시작일 YYYY-MM-DD", text: $start).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Stepper("\(count)일 여행", value: $count, in: 1...60)
                }
                Section("Day \(selectedDay + 1) 하루 설정") {
                    TextField("하루 제목·지역", text: $day.title)
                    ClockField(title: "출발 시각 직접 정하기", text: $day.startAt)
                    Toggle("전날 종료 장소에서 이어가기", isOn: $day.carriesPreviousAnchor)
                    Picker("기본 이동수단", selection: $day.mode) {
                        ForEach(TravelMode.allCases, id: \.self) { mode in Text(mode.label).tag(mode) }
                    }
                    Text("출발 시각을 비우면 09:00으로 계산해요. 다른 출발 장소는 이 날 맨 처음에 추가하고 전날 이어가기를 꺼 주세요.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if datesChanged {
                    Section("날짜 변경 미리보기") {
                        Text("\(original.start.isEmpty ? "시작일 미정" : original.start) · \(original.days.count)일 → \(start) · \(count)일")
                        Text("기존 일정은 원래 달력 날짜를 유지합니다. 날짜가 있는 숙박·항공·렌터카 예약도 그대로예요.")
                            .font(.caption)
                        if let draft {
                            ForEach(draft.days.indices, id: \.self) { index in
                                Text("\(PlanDateLabel.day(draft, index)): \(draft.days[index].spots.count)곳")
                            }
                            Toggle("일정과 예약 날짜를 확인했어요", isOn: $confirmedDates)
                        } else {
                            Text("입력한 기간으로는 기존 일정을 보존할 수 없어요. 여행 기간을 늘리거나, 제외되는 날의 장소·설정을 먼저 옮기고 정리해 주세요.")
                                .foregroundStyle(.orange)
                        }
                        ForEach(original.bookings, id: \.id) { booking in
                            Text("예약: \(booking.title) · 날짜 변경 없음").font(.caption)
                        }
                    }
                }
                if let error = saving.error { Text(error).foregroundStyle(.red) }
            }
            .paperGround()
            .tint(Ink.accent)
            .navigationTitle("여행·하루 설정")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { if isDirty { showsDiscardConfirm = true } else { dismiss() } }.disabled(saving.isWorking) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("저장") {
                        guard let draft else { return }
                        Task { if await saving.perform({ await onSave(draft, revision) }) { dismiss() } }
                    }.disabled(draft == nil || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving.isWorking || (datesChanged && !confirmedDates))
                }
            }
            .onChange(of: start) { _, _ in confirmedDates = false }
            .onChange(of: count) { _, _ in confirmedDates = false }
        }
        .interactiveDismissDisabled(isDirty || saving.isWorking)
        .confirmationDialog("입력한 설정을 버릴까요?", isPresented: $showsDiscardConfirm, titleVisibility: .visible) {
            Button("내용 버리기", role: .destructive) { dismiss() }
            Button("계속 편집", role: .cancel) {}
        }
    }
}
