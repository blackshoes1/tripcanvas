import SwiftUI

/// 편집 화면이 무엇을 하러 열렸는지. 새로 만들기와 고치기가 같은 화면을 쓴다.
enum SpotEditorTarget: Identifiable {
    case create
    case edit(index: Int, spot: TripSpot)

    var id: String {
        switch self {
        case .create: "create"
        case .edit(let index, _): "edit-\(index)"
        }
    }

    var spot: TripSpot {
        switch self {
        case .create: TripSpot(name: "")
        case .edit(_, let spot): spot
        }
    }

    var index: Int? {
        if case .edit(let index, _) = self { return index }
        return nil
    }
}

/// 장소 하나를 만들거나 고친다.
///
/// 시각을 세 가지로 나눠 묻는다 — **예약·입장 시각**(상대가 정한 약속)과 **도착 시각**(내가 정한 계획)은
/// 뜻이 다르고, 머무는 시간은 또 다르다. 웹과 같은 구분이라 어느 쪽에서 고쳐도 같은 뜻이 된다.
struct SpotEditorView: View {
    let target: SpotEditorTarget
    let dayCount: Int
    let currentDay: Int
    let onSave: (TripSpot) -> Void
    let onDelete: (Int) -> Void
    let onMoveToDay: (Int, Int) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var draft: TripSpot
    @State private var costText: String
    @State private var showsDeleteConfirm = false
    @State private var showsMapPicker = false

    init(target: SpotEditorTarget,
         dayCount: Int,
         currentDay: Int,
         onSave: @escaping (TripSpot) -> Void,
         onDelete: @escaping (Int) -> Void,
         onMoveToDay: @escaping (Int, Int) -> Void) {
        self.target = target
        self.dayCount = dayCount
        self.currentDay = currentDay
        self.onSave = onSave
        self.onDelete = onDelete
        self.onMoveToDay = onMoveToDay
        _draft = State(initialValue: target.spot)
        _costText = State(initialValue: target.spot.cost.map(String.init) ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("장소") {
                    TextField("이름", text: $draft.name)
                    TextField("도시", text: $draft.city)
                    Picker("종류", selection: $draft.category) {
                        Text("미지정").tag(SpotCategory?.none)
                        ForEach(SpotCategory.allCases, id: \.self) { category in
                            Text("\(category.icon) \(category.label)").tag(SpotCategory?.some(category))
                        }
                    }
                }

                Section {
                    if let point = draft.point {
                        LabeledContent("좌표", value: String(format: "%.5f, %.5f", point.lat, point.lng))
                            .font(.subheadline)
                    } else {
                        Label("위치 없음 — 동선·도착 예상에서 빠집니다", systemImage: "mappin.slash")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Button {
                        showsMapPicker = true
                    } label: {
                        Label(draft.point == nil ? "지도에서 자리 고르기" : "지도에서 자리 바꾸기", systemImage: "map")
                    }
                    if draft.point != nil {
                        Button("좌표 지우기", role: .destructive) {
                            draft.point = nil
                            draft.placeId = nil
                        }
                    }
                } header: {
                    Text("위치")
                }

                Section {
                    ClockField(title: "예약·입장 시각", text: $draft.bookedAt)
                    ClockField(title: "도착 시각", text: $draft.arriveAt)
                    Picker("머무는 시간", selection: $draft.stayMinutes) {
                        Text("정하지 않음").tag(Int?.none)
                        ForEach([15, 30, 45, 60, 90, 120, 180, 240], id: \.self) { minutes in
                            Text(TimeFormat.duration(minutes)).tag(Int?.some(minutes))
                        }
                    }
                } header: {
                    Text("시간")
                } footer: {
                    Text("예약·입장 시각은 상대가 정한 약속이고, 도착 시각은 내가 정한 계획입니다. 비워 두면 앞 장소에서 계산합니다.")
                }

                Section("이동·비용") {
                    Picker("이동수단", selection: $draft.legMode) {
                        Text("그날 기본").tag(TravelMode?.none)
                        ForEach(TravelMode.allCases, id: \.self) { mode in
                            Label(mode.label, systemImage: mode.symbol).tag(TravelMode?.some(mode))
                        }
                    }
                    HStack {
                        TextField("비용", text: $costText)
                            .keyboardType(.numberPad)
                        Picker("통화", selection: $draft.currency) {
                            Text("KRW").tag(Currency?.none)
                            ForEach(Currency.allCases, id: \.self) { currency in
                                Text(currency.rawValue).tag(Currency?.some(currency))
                            }
                        }
                        .labelsHidden()
                    }
                }

                Section {
                    Toggle("꼭 가기", isOn: $draft.isMust)
                    Picker("상태", selection: $draft.status) {
                        ForEach(SpotStatus.allCases, id: \.self) { status in
                            Text(status.label).tag(status)
                        }
                    }
                    // 숙소는 종류와 별개의 표시다 — 그날의 종료 기준점이 되고 숙박 예약과 이어진다(웹의 체크박스와 같다).
                    Toggle("숙소", isOn: $draft.isStay)
                    if draft.isStay || draft.category == .stay {
                        Stepper("연박 \(draft.nights ?? 1)박", value: nightsBinding, in: 1...60)
                    }
                } header: {
                    Text("계획")
                } footer: {
                    if draft.isStay {
                        Text("숙소는 그날의 마지막 기준점이 됩니다. 숙박 예약은 예약 화면에서 이 숙소와 연결합니다.")
                    }
                }

                Section("메모") {
                    TextField("메모", text: $draft.desc, axis: .vertical)
                        .lineLimit(2...6)
                }

                if let index = target.index {
                    Section {
                        if dayCount > 1 {
                            Menu("다른 날로 옮기기") {
                                ForEach(0..<dayCount, id: \.self) { day in
                                    if day != currentDay {
                                        Button("Day \(day + 1)") {
                                            onMoveToDay(index, day)
                                            dismiss()
                                        }
                                    }
                                }
                            }
                        }
                        Button("이 장소 빼기", role: .destructive) { showsDeleteConfirm = true }
                    }
                }
            }
            .navigationTitle(target.index == nil ? "장소 추가" : "장소")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("취소") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("완료") { save() }
                        .disabled(draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .sheet(isPresented: $showsMapPicker) {
                // 이름이 비어 있고 해외 POI를 탭했으면 그 이름을 받는다. 있는 이름을 덮지는 않는다.
                MapPickerView(initial: draft.point, regionHint: MapRegion.isKoreanSearch(draft.name, near: nil)) { pick in
                    draft.point = pick.point
                    draft.placeId = pick.placeId
                    if draft.name.trimmingCharacters(in: .whitespaces).isEmpty, let name = pick.name { draft.name = name }
                }
            }
            .confirmationDialog("이 장소를 일정에서 뺄까요?", isPresented: $showsDeleteConfirm, titleVisibility: .visible) {
                Button("빼기", role: .destructive) {
                    if let index = target.index { onDelete(index) }
                    dismiss()
                }
            }
        }
    }

    private var nightsBinding: Binding<Int> {
        Binding(get: { draft.nights ?? 1 }, set: { draft.nights = $0 })
    }

    private func save() {
        var spot = draft
        spot.name = spot.name.trimmingCharacters(in: .whitespacesAndNewlines)
        spot.city = spot.city.trimmingCharacters(in: .whitespacesAndNewlines)
        spot.cost = SpotEditorView.cost(from: costText)
        onSave(spot)
        dismiss()
    }

    /// 숫자가 아닌 것은 비용이 아니다 — 0으로 굳히지 않고 '없음'으로 둔다.
    static func cost(from text: String) -> Int? {
        let digits = text.filter(\.isNumber)
        guard !digits.isEmpty, let value = Int(digits) else { return nil }
        return value > 0 ? value : nil
    }
}

/// `HH:MM` 한 칸. 켜고 끄는 것과 값이 한 곳에 있어야 "비워 두면 계산"이 분명해진다.
struct ClockField: View {
    let title: String
    @Binding var text: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Toggle(title, isOn: Binding(
                get: { text != nil },
                set: { text = $0 ? (text ?? "09:00") : nil }))
            if text != nil {
                HStack(spacing: Space.s) {
                    Picker("시", selection: hourBinding) {
                        ForEach(0..<24, id: \.self) { Text(String(format: "%02d", $0)).tag($0) }
                    }
                    .labelsHidden()
                    Text(":")
                    Picker("분", selection: minuteBinding) {
                        ForEach(Array(stride(from: 0, to: 60, by: 5)), id: \.self) { Text(String(format: "%02d", $0)).tag($0) }
                    }
                    .labelsHidden()
                }
                .pickerStyle(.menu)
            }
        }
    }

    private var hourBinding: Binding<Int> {
        Binding(get: { ClockText.parts(text).hour }, set: { text = ClockText.text(hour: $0, minute: ClockText.parts(text).minute) })
    }

    private var minuteBinding: Binding<Int> {
        Binding(get: { ClockText.parts(text).minute }, set: { text = ClockText.text(hour: ClockText.parts(text).hour, minute: $0) })
    }
}

/// `HH:MM` 문자열과 시·분 사이의 변환. 문서에 들어가는 값이라 화면 밖에서도 검사한다.
enum ClockText {
    static func parts(_ text: String?) -> (hour: Int, minute: Int) {
        guard let text else { return (9, 0) }
        let pieces = text.split(separator: ":", maxSplits: 1).map(String.init)
        guard pieces.count == 2, let hour = Int(pieces[0]), let minute = Int(pieces[1]) else { return (9, 0) }
        return (min(23, max(0, hour)), min(59, max(0, minute)))
    }

    static func text(hour: Int, minute: Int) -> String {
        String(format: "%02d:%02d", min(23, max(0, hour)), min(59, max(0, minute)))
    }

    /// `lib.js`의 `_hm`과 같은 판정 — `H:MM`·`HH:MM`, 24시간.
    static func isValid(_ text: String) -> Bool {
        let pieces = text.split(separator: ":", omittingEmptySubsequences: false)
        guard pieces.count == 2, pieces[0].count >= 1, pieces[0].count <= 2, pieces[1].count == 2,
              let hour = Int(pieces[0]), let minute = Int(pieces[1]),
              pieces[0].allSatisfy(\.isNumber), pieces[1].allSatisfy(\.isNumber) else { return false }
        return (0...23).contains(hour) && (0...59).contains(minute)
    }

    /// 자정부터의 분. 형식이 아니면 0 — 앞뒤 비교 전에 `isValid`로 거른다.
    static func minutes(_ text: String) -> Int {
        guard isValid(text) else { return 0 }
        let split = Self.parts(text)
        return split.hour * 60 + split.minute
    }
}
