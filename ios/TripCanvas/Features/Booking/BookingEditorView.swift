import SwiftUI

/// 편집 화면이 무엇을 하러 열렸는지. 새로 만들기와 고치기가 같은 화면을 쓴다.
enum BookingEditorTarget: Identifiable {
    case create
    case edit(TripBooking)

    var id: String {
        switch self {
        case .create: "create"
        case .edit(let booking): "edit-\(booking.id)"
        }
    }

    var booking: TripBooking? {
        if case .edit(let booking) = self { return booking }
        return nil
    }
}

/// 예약 하나를 만들거나 고친다 — 웹의 예약 모달과 같은 항목, 같은 검증.
///
/// 예약은 여러 날에 걸친 **총액**이다(장소 비용은 그날 쓰는 돈). 숙박은 일정의 숙소와, 렌터카는 픽업·반납
/// 장소와 이을 수 있다 — 픽업·반납 장소는 자유 텍스트라 좌표가 없어서, 연결해야 도착 순서에 맞게 놓인다.
/// 가격 관측·시세 비교는 여기 없다: 저장하면 서버가 추적하고, 결과는 예약 목록이 보여준다.
struct BookingEditorView: View {
    let target: BookingEditorTarget
    let document: TripDocument
    let onSave: (TripBooking, BookingLinks) -> Void
    let onDelete: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var draft: TripBooking
    @State private var links: BookingLinks
    @State private var priceText: String
    @State private var feeText: String
    @State private var urlText: String
    @State private var roomNameText: String
    @State private var pickupPlace: String
    @State private var pickupCode: String
    @State private var returnPlace: String
    @State private var returnCode: String
    @State private var problem: BookingDraftError?
    @State private var showsDeleteConfirm = false

    private var isNew: Bool { target.booking == nil }

    init(target: BookingEditorTarget,
         document: TripDocument,
         onSave: @escaping (TripBooking, BookingLinks) -> Void,
         onDelete: @escaping (String) -> Void) {
        self.target = target
        self.document = document
        self.onSave = onSave
        self.onDelete = onDelete
        let booking = target.booking ?? TripBooking()
        _draft = State(initialValue: booking)
        _links = State(initialValue: target.booking.map { document.links(forBooking: $0.id) } ?? .empty)
        _priceText = State(initialValue: booking.price > 0 ? String(booking.price) : "")
        _feeText = State(initialValue: booking.cancelFee.map(String.init) ?? "")
        _urlText = State(initialValue: booking.url ?? "")
        _roomNameText = State(initialValue: booking.roomName ?? "")
        _pickupPlace = State(initialValue: booking.carPickup ?? "")
        _pickupCode = State(initialValue: booking.carPickupCode ?? "")
        _returnPlace = State(initialValue: booking.carReturn ?? "")
        _returnCode = State(initialValue: booking.carReturnCode ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("예약") {
                    Picker("종류", selection: $draft.type) {
                        ForEach(TripBookingType.allCases, id: \.self) { type in
                            Label(type.label, systemImage: type.symbol).tag(type)
                        }
                    }
                    .pickerStyle(.segmented)
                    TextField(titlePlaceholder, text: $draft.title)
                    TextField("예약처 (예: Booking.com)", text: $draft.provider)
                }

                Section {
                    HStack {
                        TextField("총액", text: $priceText)
                            .keyboardType(.numberPad)
                        Picker("통화", selection: currencyBinding) {
                            ForEach(Currency.allCases, id: \.self) { currency in
                                Text(currency.rawValue).tag(currency)
                            }
                        }
                        .labelsHidden()
                    }
                    Toggle("가격 추적", isOn: $draft.track)
                } header: {
                    Text("가격")
                } footer: {
                    Text("켜두면 시세를 계속 확인해 절약 기회를 알려줘요. 자동으로 다시 예약하지는 않습니다.")
                }

                Section("기간") {
                    DateField(title: draft.type.startLabel, text: $draft.start) { Date() }
                    DateField(title: draft.type.endLabel, text: $draft.end) {
                        ISODateText.date(from: draft.start).flatMap { ISODateText.calendar.date(byAdding: .day, value: 1, to: $0) } ?? Date()
                    }
                }

                if draft.type == .hotel { hotelSection }
                if draft.type == .car { carSection }

                Section {
                    Toggle("무료 취소 가능", isOn: $draft.refundable)
                    if draft.refundable {
                        DateField(title: "무료 취소 기한", text: $draft.freeCancelUntil) { Date() }
                    }
                    TextField("취소 수수료", text: $feeText)
                        .keyboardType(.numberPad)
                } header: {
                    Text("취소 조건")
                } footer: {
                    Text("절약액은 취소 수수료를 뺀 실질 금액으로 계산합니다.")
                }

                Section("링크") {
                    TextField("예약 페이지 https://…", text: $urlText)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                if target.booking != nil {
                    Section {
                        Button("이 예약 빼기", role: .destructive) { showsDeleteConfirm = true }
                    } footer: {
                        Text("추적만 그만둡니다. 실제 예약은 취소되지 않아요.")
                    }
                }
            }
            .navigationTitle(isNew ? "예약 추가" : "예약")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("취소") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("완료") { save() }
                        .disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onChange(of: links.stay) { _, ref in prefill(from: ref) }
            .alert("저장할 수 없어요", isPresented: problemBinding, presenting: problem) { _ in
                Button("확인") { problem = nil }
            } message: { problem in
                Text(problem.message)
            }
            .confirmationDialog("이 예약 추적을 뺄까요?", isPresented: $showsDeleteConfirm, titleVisibility: .visible) {
                Button("빼기", role: .destructive) {
                    if let booking = target.booking { onDelete(booking.id) }
                    dismiss()
                }
            } message: {
                Text("실제 예약이 취소되지는 않아요.")
            }
        }
    }

    // MARK: 종류별 항목

    private var hotelSection: some View {
        Section {
            Picker("일정의 숙소와 연결", selection: $links.stay) {
                Text("연결 안 함").tag(SpotRef?.none)
                ForEach(document.stayRefs, id: \.self) { ref in
                    Text(spotLabel(ref)).tag(SpotRef?.some(ref))
                }
            }
            .pickerStyle(.navigationLink)
            Stepper("투숙 인원 \(draft.adults ?? 2)명", value: adultsBinding, in: 1...8)
            Stepper("객실 \(draft.rooms ?? 1)개", value: roomsBinding, in: 1...4)
            TextField("객실명 (예: Deluxe Double)", text: $roomNameText)
            Picker("조식", selection: $draft.breakfast) {
                Text("모름").tag(Bool?.none)
                Text("조식 포함").tag(Bool?.some(true))
                Text("조식 없음").tag(Bool?.some(false))
            }
        } header: {
            Text("숙박")
        } footer: {
            if document.stayRefs.isEmpty {
                Text("일정에 숙소로 표시한 장소가 없어요. 장소 편집에서 '숙소'를 켜면 여기서 이을 수 있습니다.")
            } else {
                Text("연결하면 그 숙소의 비용·연박과 함께 계산됩니다. 인원·객실·조식은 시세 비교의 기준이에요.")
            }
        }
    }

    private var carSection: some View {
        Section {
            HStack {
                TextField("픽업 장소", text: $pickupPlace)
                TextField("PMI", text: $pickupCode)
                    .frame(width: 64)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
            }
            HStack {
                TextField("반납 장소 (비우면 픽업과 동일)", text: $returnPlace)
                TextField("공항", text: $returnCode)
                    .frame(width: 64)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
            }
            ClockField(title: "픽업 시각", text: $draft.carPickupTime)
            ClockField(title: "반납 시각", text: $draft.carReturnTime)
            Picker("차급", selection: carClassBinding) {
                Text("모름").tag("")
                ForEach(carClassOptions) { option in
                    Text(option.label).tag(option.id)
                }
            }
            Picker("변속기", selection: $draft.transmission) {
                Text("모름").tag(CarTransmission?.none)
                ForEach(CarTransmission.allCases, id: \.self) { Text($0.label).tag(CarTransmission?.some($0)) }
            }
            Picker("주행거리", selection: $draft.mileage) {
                Text("모름").tag(CarMileage?.none)
                ForEach(CarMileage.allCases, id: \.self) { Text($0.label).tag(CarMileage?.some($0)) }
            }
            Picker("보험", selection: $draft.insurance) {
                Text("모름").tag(CarInsurance?.none)
                ForEach(CarInsurance.allCases, id: \.self) { Text($0.label).tag(CarInsurance?.some($0)) }
            }
            Picker("픽업을 일정의 장소와 연결", selection: $links.carPickup) {
                Text("연결 안 함").tag(SpotRef?.none)
                ForEach(document.spotRefs, id: \.self) { ref in Text(spotLabel(ref)).tag(SpotRef?.some(ref)) }
            }
            .pickerStyle(.navigationLink)
            Picker("반납을 일정의 장소와 연결", selection: $links.carReturn) {
                Text("연결 안 함").tag(SpotRef?.none)
                ForEach(document.spotRefs, id: \.self) { ref in Text(spotLabel(ref)).tag(SpotRef?.some(ref)) }
            }
            .pickerStyle(.navigationLink)
        } header: {
            Text("렌터카")
        } footer: {
            Text("당일 대여는 픽업 시각과 그보다 늦은 반납 시각이 필요해요. 공항에서 받는다면 도착 장소와 연결해야 순서가 맞습니다. 차급·변속기·보험·주행거리가 다르면 확정 절약으로 보지 않아요.")
        }
    }

    // MARK: 바인딩

    private var currencyBinding: Binding<Currency> {
        Binding(get: { draft.currency ?? .krw }, set: { draft.currency = $0 })
    }

    private var adultsBinding: Binding<Int> {
        Binding(get: { draft.adults ?? 2 }, set: { draft.adults = $0 })
    }

    private var roomsBinding: Binding<Int> {
        Binding(get: { draft.rooms ?? 1 }, set: { draft.rooms = $0 })
    }

    private var carClassBinding: Binding<String> {
        Binding(get: { draft.carClass ?? "" }, set: { draft.carClass = $0.isEmpty ? nil : $0 })
    }

    /// 웹의 선택지에 없는 값(가져온 예약)은 그대로 한 줄 더 보인다 — 저장했다고 사라지지 않게.
    private var carClassOptions: [CarClassOption] {
        var options = CarClassOption.known
        if let current = draft.carClass, !options.contains(where: { $0.id == current }) {
            options.append(CarClassOption(id: current, label: current))
        }
        return options
    }

    private var problemBinding: Binding<Bool> {
        Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })
    }

    private var titlePlaceholder: String {
        switch draft.type {
        case .hotel: "예약 이름 (예: Cap Rocat)"
        case .car: "예약 이름 (예: Hertz Palma)"
        case .flight: "예약 이름 (예: KE001 ICN→PMI)"
        }
    }

    private func spotLabel(_ ref: SpotRef) -> String {
        let name = document.spot(at: ref)?.name ?? ""
        return "Day \(ref.day + 1) · \(name.isEmpty ? "이름 없는 장소" : name)"
    }

    /// 새 예약에서 숙소를 고르면 이름·기간·통화·가격을 채운다(웹과 같다). 이미 적은 값은 덮지 않는다.
    private func prefill(from ref: SpotRef?) {
        guard isNew, let ref, let spot = document.spot(at: ref) else { return }
        if draft.title.trimmingCharacters(in: .whitespaces).isEmpty { draft.title = spot.name }
        if let iso = document.date(ofDay: ref.day) {
            if draft.start == nil { draft.start = iso }
            if draft.end == nil, let start = ISODateText.date(from: iso),
               let end = ISODateText.calendar.date(byAdding: .day, value: max(1, spot.nights ?? 1), to: start) {
                draft.end = ISODateText.text(from: end)
            }
        }
        if let currency = spot.currency { draft.currency = currency }
        if priceText.isEmpty, let cost = spot.cost, cost > 0 { priceText = String(cost) }
    }

    private func save() {
        var booking = draft
        booking.title = booking.title.trimmingCharacters(in: .whitespacesAndNewlines)
        booking.provider = booking.provider.trimmingCharacters(in: .whitespacesAndNewlines)
        booking.price = SpotEditorView.cost(from: priceText) ?? 0
        booking.url = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        booking.cancelFee = SpotEditorView.cost(from: feeText)
        if !booking.refundable { booking.freeCancelUntil = nil }
        if booking.type == .hotel {
            // 웹 폼의 기본값(성인 2·객실 1)과 같다 — 시세 비교에 조건이 있어야 한다.
            booking.adults = booking.adults ?? 2
            booking.rooms = booking.rooms ?? 1
            booking.roomName = roomNameText
        }
        if booking.type == .car {
            booking.carPickup = pickupPlace
            booking.carPickupCode = pickupCode
            booking.carReturn = returnPlace
            booking.carReturnCode = returnCode
        }
        if let problem = booking.validate() {
            self.problem = problem
            return
        }
        var links = links
        if booking.type != .hotel { links.stay = nil }
        if booking.type != .car { links.carPickup = nil; links.carReturn = nil }
        onSave(booking, links)
        dismiss()
    }
}

/// `YYYY-MM-DD` 한 칸. 켜고 끄는 것과 값이 한 곳에 있어야 "날짜 없음"이 분명해진다(`ClockField`와 같은 꼴).
struct DateField: View {
    let title: String
    @Binding var text: String?
    let fallback: () -> Date

    var body: some View {
        Toggle(title, isOn: Binding(
            get: { text != nil },
            set: { text = $0 ? (text ?? ISODateText.text(from: fallback())) : nil }))
        if text != nil {
            DatePicker(title, selection: dateBinding, displayedComponents: .date)
                .labelsHidden()
                .datePickerStyle(.compact)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    private var dateBinding: Binding<Date> {
        Binding(
            get: { ISODateText.date(from: text) ?? fallback() },
            set: { text = ISODateText.text(from: $0) })
    }
}
