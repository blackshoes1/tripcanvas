import SwiftUI

/// 시작일이 바뀔 때 두 가지 뜻이 있다 — 사용자가 고른다(웹은 늘 '통째로 옮기기'였다).
/// - `keepDates`: 여행 **기간**만 바꾼다. 기존 일정은 원래 달력 날짜에 남는다(앞에 빈 날이 생기거나, 빈 날만 잘린다).
/// - `moveSchedule`: 일정 **전체**를 새 시작일로 옮긴다. 1일차는 여전히 1일차다 — 웹 `tripSave`와 같은 문서가 된다.
/// 어느 쪽이든 외부 예약(`trip.bookings`)의 날짜는 바꾸지 않는다. 예약은 상대와 맺은 약속이다.
enum PlanCalendarChange {
    enum Mode: Hashable { case keepDates, moveSchedule }

    static func draft(_ original: TripDocument, start: String, count: Int, mode: Mode = .keepDates) -> TripDocument? {
        // 이미 한계보다 긴 문서(레거시 경로로 들어온 것)는 **편집을 막지 않는다** — 막으면
        // 이름만 고치려는 사람에게도 저장이 꺼진 채 이유가 화면에 없다. 늘리는 것만 막는다.
        guard count >= 1 && count <= TripLimits.maxDays(editing: original.days.count) else { return nil }
        if !start.isEmpty {
            guard let date = ISODateText.date(from: start), ISODateText.text(from: date) == start else { return nil }
        }
        var result = original
        var days = original.days
        if mode == .keepDates && !original.start.isEmpty && start != original.start {
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

    /// 날짜가 있는 예약 중 새 기간 밖에 걸리는 것 — 예약은 옮기지 않으므로 일정과 어긋난다.
    static func misalignedBookings(_ bookings: [TripBooking], start: String, count: Int) -> [TripBooking] {
        guard let base = ISODateText.date(from: start),
              let last = ISODateText.calendar.date(byAdding: .day, value: max(0, count - 1), to: base) else { return [] }
        let first = ISODateText.text(from: base), end = ISODateText.text(from: last)
        return bookings.filter { booking in
            guard let from = booking.start?.prefix(10), !from.isEmpty else { return false }
            return String(from) < first || String(from) > end
        }
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
    @State private var startInvalid = false
    @State private var endInvalid = false
    @State private var name: String
    @State private var start: String
    @State private var count: Int
    /// 종료일 — 시작일과 일수에서 파생되고, 고르면 일수가 따라온다. 시작일이 없으면 nil이다(그때는 일수로만 정한다).
    private var end: String? {
        guard let base = ISODateText.date(from: start), !start.isEmpty,
              let date = ISODateText.calendar.date(byAdding: .day, value: max(0, count - 1), to: base) else { return nil }
        return ISODateText.text(from: date)
    }
    @State private var day: TripDay
    @State private var saving = EditorSaveState()
    @State private var confirmedDates = false
    @State private var showsDiscardConfirm = false
    /// 시작일을 옮길 때 일정도 함께 옮길지. 기본은 웹과 같은 '통째로 옮기기' — 두 플랫폼이 같은 문서를 만든다.
    @State private var dateMode: PlanCalendarChange.Mode = .moveSchedule

    init(document: TripDocument, revision: Int, selectedDay: Int, onSave: @escaping (TripDocument, Int) async -> String?) {
        self.original = document; self.revision = revision; self.selectedDay = selectedDay; self.onSave = onSave
        _name = State(initialValue: document.name); _start = State(initialValue: document.start)
        _count = State(initialValue: max(1, document.days.count))
        _day = State(initialValue: document.hasDay(selectedDay) ? document.days[selectedDay] : TripDay())
    }

    /// 이 화면에서 고를 수 있는 최대 일수. 원문이 이미 한계보다 길면 그 길이까지 허용한다(줄이는 건 되어야 한다).
    private var maxDays: Int { TripLimits.maxDays(editing: original.days.count) }

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
        return PlanCalendarChange.draft(document, start: start, count: count, mode: startMoved ? dateMode : .keepDates)
    }
    /// 이미 있던 시작일을 다른 날로 바꿨는가 — 이때만 '어떻게 옮길지'를 묻는다.
    private var startMoved: Bool { !original.start.isEmpty && !start.isEmpty && start != original.start }
    private var isDirty: Bool {
        name != original.name || datesChanged || day != (original.hasDay(selectedDay) ? original.days[selectedDay] : TripDay())
    }
    private var datesChanged: Bool { start != original.start || count != original.days.count }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("여행 이름", text: $name)
                    // 시작일·종료일 — 숫자로 쳐도 되고 달력을 눌러도 된다. 일수는 그 둘에서 나온다.
                    DateEntryField(title: "시작일", text: Binding(get: { start.isEmpty ? nil : start }, set: { start = $0 ?? "" }), invalid: $startInvalid)
                    if start.isEmpty {
                        Stepper("\(count)일 여행", value: $count, in: 1...maxDays)
                    } else {
                        DateEntryField(title: "종료일", text: Binding(get: { end }, set: { iso in
                            guard let iso, let base = ISODateText.date(from: start), let date = ISODateText.date(from: iso) else { return }
                            let days = (ISODateText.calendar.dateComponents([.day], from: base, to: date).day ?? 0) + 1
                            count = min(maxDays, max(1, days))
                        }), fallback: { ISODateText.date(from: end) ?? Date() }, invalid: $endInvalid)
                        LabeledContent("기간", value: "\(count)일")
                    }
                } header: { Text("여행") } footer: {
                    Text(start.isEmpty ? "시작일을 정하면 종료일을 고를 수 있어요." : "종료일을 시작일보다 앞으로 두면 하루짜리가 되고, 최대 \(maxDays)일이에요.")
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
                        Text("\(original.start.isEmpty ? "시작일 미정" : ReadableDate.day(original.start)) · \(original.days.count)일 → \(start.isEmpty ? "시작일 미정" : ReadableDate.day(start)) · \(count)일")
                        if startMoved {
                            Picker("기존 일정", selection: $dateMode) {
                                Text("통째로 옮기기").tag(PlanCalendarChange.Mode.moveSchedule)
                                Text("날짜 그대로").tag(PlanCalendarChange.Mode.keepDates)
                            }
                            .pickerStyle(.segmented)
                        }
                        Text(startMoved && dateMode == .moveSchedule
                             ? "Day 1은 새 시작일부터 시작해요. 장소는 같은 Day에 그대로 있고 날짜만 옮겨져요. 예약 날짜는 바꾸지 않아요."
                             : "기존 일정은 원래 달력 날짜에 남아요. 예약 날짜도 바꾸지 않아요.")
                            .font(.caption)
                        let misaligned = PlanCalendarChange.misalignedBookings(original.bookings, start: start, count: count)
                        if !misaligned.isEmpty {
                            Label("예약 \(misaligned.count)건이 새 기간 밖이에요 — 예약처에서 날짜를 바꿨는지 확인해 주세요.",
                                  systemImage: "exclamationmark.triangle")
                                .font(.caption).foregroundStyle(Ink.warning)
                        }
                        if let draft {
                            ForEach(draft.days.indices, id: \.self) { index in
                                Text("\(PlanDateLabel.day(draft, index)): \(draft.days[index].spots.count)곳")
                            }
                            Toggle("일정과 예약 날짜를 확인했어요", isOn: $confirmedDates)
                        } else {
                            Text("입력한 기간으로는 기존 일정을 보존할 수 없어요. 여행 기간을 늘리거나, 제외되는 날의 장소·설정을 먼저 옮기고 정리해 주세요.")
                                .foregroundStyle(Ink.warning)
                        }
                        ForEach(original.bookings, id: \.id) { booking in
                            Text("예약: \(booking.title) · 날짜 변경 없음").font(.caption)
                        }
                    }
                }
                if let error = saving.error { Text(error).foregroundStyle(Ink.danger) }
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
                    }.disabled(draft == nil || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving.isWorking || (datesChanged && !confirmedDates) || startInvalid || endInvalid)
                }
            }
            .onChange(of: start) { _, _ in confirmedDates = false }
            .onChange(of: dateMode) { _, _ in confirmedDates = false }
            .onChange(of: count) { _, _ in confirmedDates = false }
        }
        .interactiveDismissDisabled(isDirty || saving.isWorking)
        .confirmationDialog("입력한 설정을 버릴까요?", isPresented: $showsDiscardConfirm, titleVisibility: .visible) {
            Button("내용 버리기", role: .destructive) { dismiss() }
            Button("계속 편집", role: .cancel) {}
        }
    }
}
