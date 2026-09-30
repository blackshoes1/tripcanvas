import SwiftUI

/// 하루 비용은 서버가 계산한다. 앱에서는 원래 금액과 기준을 입력하고, 받은 합계를 표시한다.
struct DayCostSummaryView: View {
    let day: TripDay
    let cost: DayPlanCost?

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            if let cost {
                Text("현재 예상 비용 \(cost.details?.hasForeignCurrency == true ? "약 " : "")\(TimeFormat.money(Double(cost.total), currency: "KRW"))")
                    .font(.subheadline.weight(.semibold))
            } else {
                Text("비용 합계 미확인").font(.subheadline)
            }
            // 가기 전에 낸 돈의 하루치(예약)와 가서 쓰는 돈은 다른 장부다 — 합계에 섞여 있어도 따로 말한다
            if let cost, let onSite = cost.onSiteKRW, onSite != cost.total {
                Text("현지 결제 \(TimeFormat.money(onSite, currency: "KRW")) · 예약 하루치 \(TimeFormat.money(cost.total - onSite, currency: "KRW"))")
                    .font(.caption).foregroundStyle(Ink.soft)
            }
            // 합계 하나로는 "얼마나 남았지"를 알 수 없다 — 예약해 둔 돈과 이미 낸 돈을 따로 보여 준다
            if let cost, !cost.paySplit.isEmpty {
                Text(cost.paySplit.map { "\($0.state.label) \(TimeFormat.money($0.amount, currency: "KRW"))" }
                    .joined(separator: " · "))
                    .font(.caption).foregroundStyle(Ink.soft)
            }
            if let budget = day.budget, let amount = budget.amount {
                Text("하루 예산 \(TimeFormat.money(amount, currency: budget.currency.rawValue)) · \(budget.basis.label)\(budget.basis != .entered ? " · \(budget.people)명" : "")")
                    .font(.caption)
            } else {
                Text("하루 예산 설정하기").font(.caption)
            }
            if let details = cost?.details {
                if let budget = details.budget {
                    let difference = budget.differenceKRW
                    Text("입력된 금액 기준 \(TimeFormat.money(Double(abs(difference)), currency: "KRW")) \(difference < 0 ? "초과" : "여유")")
                        .font(.caption).foregroundStyle(difference < 0 ? Ink.warning : Ink.soft)
                }
                if details.unknownCount > 0 {
                    Text("비용 미정 \(details.unknownCount)개 · 최종 비용은 더 늘어날 수 있어요")
                        .font(.caption).foregroundStyle(Ink.soft)
                }
                if details.transportUnpriced {
                    Text("아직 계산되지 않은 교통비는 합계에서 빠져 있어요")
                        .font(.caption).foregroundStyle(Ink.soft)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct DayCostView: View {
    let cost: DayPlanCost?
    let canEdit: Bool
    let onSave: (TripDay) async -> Bool
    let onRefresh: (() async -> Void)?
    let draftKey: EditorDraftKey?
    let onDeleteSpot: ((Int, Bool) async -> TripDay?)?
    @State private var day: TripDay
    @State private var editing: CostEditTarget?
    /// 일정 장소의 비용을 고치거나 별도 지출을 입력한다.
    @State private var quickAdd = false
    @Environment(\.dismiss) private var dismiss

    init(day: TripDay, cost: DayPlanCost?, canEdit: Bool, draftKey: EditorDraftKey? = nil, onRefresh: (() async -> Void)? = nil, onDeleteSpot: ((Int, Bool) async -> TripDay?)? = nil, onSave: @escaping (TripDay) async -> Bool) {
        _day = State(initialValue: day)
        self.cost = cost
        self.canEdit = canEdit
        self.onSave = onSave
        self.onRefresh = onRefresh
        self.draftKey = draftKey
        self.onDeleteSpot = onDeleteSpot
    }

    var body: some View {
        NavigationStack {
            PaperList {
                Section {
                    DayCostSummaryView(day: day, cost: cost)
                    if cost == nil, let onRefresh { Button("합계 다시 확인") { Task { await onRefresh() } } }
                    if canEdit {
                        // 정산은 금액부터다 — 분류·통화·기준을 다 묻는 폼은 "오늘 얼마 썼지"를 훑어 적는 손을 멈추게 한다.
                        Button { quickAdd = true } label: {
                            Label("쓴 돈 바로 적기", systemImage: "plus.circle.fill").frame(minHeight: 44)
                        }
                        Button(day.budget == nil ? "하루 예산 설정" : "하루 예산 수정") {
                            var entry = day.budget ?? CostEntry()
                            if day.budget == nil { entry.basis = .total }
                            editing = CostEditTarget(kind: .budget, entry: entry)
                        }
                    }
                }
                Section("장소 비용") {
                    ForEach(Array(day.spots.enumerated()), id: \.offset) { index, spot in
                        Button {
                            editing = CostEditTarget(kind: .spot(index), entry: CostEntry(spot: spot))
                        } label: {
                            entryRow(title: spot.name, entry: CostEntry(spot: spot), line: line(source: "SPOT", key: String(index)))
                        }
                        .buttonStyle(.plain).disabled(!canEdit)
                    }
                }
                Section {
                    ForEach(day.costItems) { item in
                        Button { editing = CostEditTarget(kind: .extra(item.id), entry: item) } label: {
                            entryRow(title: item.title, entry: item, line: line(source: "EXTRA", key: item.id))
                        }
                        .buttonStyle(.plain).disabled(!canEdit)
                    }
                    if canEdit {
                        Button {
                            let entry = CostEntry(raw: ["id": .string(UUID().uuidString), "costBasis": .string("TOTAL")])
                            editing = CostEditTarget(kind: .extra(entry.id), entry: entry, isNew: true)
                        } label: { Label("비용 항목 추가", systemImage: "plus") }
                    }
                } header: { Text("추가 비용") } footer: {
                    Text("장소에 적지 않은 식사·입장료·교통·숙박비를 적어요. 교통 항목을 만들면 그날의 자동 교통비 추정을 대신해요.")
                }
                if let details = cost?.details {
                    Section("예약·자동 계산") {
                        // STAY는 앞선 날에 체크인한 연박 숙소의 이 날 몫 — 고치려면 그 장소(체크인 날)에서.
                        ForEach(details.items.filter { $0.source == "BOOKING" || $0.source == "TRANSPORT" || $0.source == "STAY" }) { item in
                            VStack(alignment: .leading, spacing: Space.xs) {
                                Text(item.title)
                                Text("\(TimeFormat.money(item.amount ?? 0, currency: item.currency)) · \(item.source == "BOOKING" ? "예약의 하루 배분액" : item.source == "STAY" ? "연박 숙소의 하루치 · 체크인 날 장소에서 고쳐요" : "이동 경로 추정")")
                                    .font(.caption).foregroundStyle(Ink.soft)
                            }
                        }
                        Text("연결된 장소에 금액을 적은 예약은 중복해서 더하지 않아요. 예약 금액과 날짜는 예약 화면에서 수정할 수 있어요.")
                            .font(.caption).foregroundStyle(Ink.soft)
                        if details.undatedBookings > 0 {
                            Text("날짜 미정 예약 \(details.undatedBookings)건은 하루 합계에 포함되지 않았어요.").font(.caption)
                        }
                    }
                    if details.hasForeignCurrency {
                        Section("원화 환산 기준") {
                            Text(TripCostsView.fxNote(source: details.fxSource, asOf: details.fxAsOf))
                                .font(.caption)
                            ForEach(details.fxRates.keys.filter { $0 != "KRW" }.sorted(), id: \.self) { currency in
                                Text(TripCostsView.fxLine(currency: currency, rate: details.fxRates[currency] ?? 0)).font(.caption)
                            }
                        }
                    }
                } else {
                    Section { Text("상세 계산을 받기 전에는 합계의 포함 범위를 확인할 수 없어요.").font(.caption) }
                }
            }
            .tint(Ink.accent)
            .navigationTitle("하루 비용")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("닫기") { dismiss() } } }
            .sheet(isPresented: $quickAdd) {
                SpendEntryFlow(day: day, draftKey: draftKey) { updated in
                    guard await onSave(updated) else { return false }
                    day = updated
                    return true
                }
            }
            .sheet(item: $editing) { target in
                CostEntryEditor(target: target, onDelete: { includingSource in
                    guard case .spot(let index) = target.kind, let onDeleteSpot,
                          let updated = await onDeleteSpot(index, includingSource) else { return false }
                    day = updated
                    return true
                }) { entry in
                    var updated = day
                    switch target.kind {
                    case .budget: updated.budget = entry?.amount == nil ? nil : entry
                    case .spot(let index):
                        guard updated.spots.indices.contains(index), let entry else { return false }
                        var spots = updated.spots
                        spots[index] = entry.applying(to: spots[index])
                        updated.spots = spots
                    case .extra(let id):
                        var entries = updated.costItems.filter { $0.id != id }
                        if let entry { entries.append(entry) }
                        updated.costItems = entries
                    case .prep:
                        // 여행 단위 준비 비용은 비용 화면(TripCostsView)의 몫이다 — 하루 비용 시트는 열지 않는다.
                        return false
                    }
                    guard await onSave(updated) else { return false }
                    day = updated
                    return true
                }
            }
        }
    }

    private func line(source: String, key: String) -> DayCostLine? {
        cost?.details?.items.first { $0.source == source && $0.key == key }
    }

    private func entryRow(title: String, entry: CostEntry, line: DayCostLine?) -> some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Text(title.isEmpty ? "비용 항목" : title)
            if let amount = entry.amount {
                Text(amount == 0 && !entry.isPartial ? "무료 · 확인한 0원" : "\(TimeFormat.money(amount, currency: entry.currency.rawValue))\(entry.isPartial ? " · 일부 금액만 확인" : "")")
                    .font(.subheadline)
                Text("\(entry.basis.label)\(entry.basis != .entered ? " · \(entry.people)명 적용" : "")")
                    .font(.caption).foregroundStyle(Ink.soft)
            } else {
                Text(line?.state == "BOOKING" ? "연결된 예약 금액에 포함" : "비용 미정")
                    .font(.subheadline).foregroundStyle(Ink.soft)
            }
            // 연박 숙소는 적은 금액 전액이 아니라 하루치만 이 날 합계에 들어간다 — 그 사실을 여기서 말한다.
            if let share = line?.amount, let full = entry.amount, share != full, line?.source == "SPOT" {
                Text("연박 숙소 · 이 날 하루치 \(TimeFormat.money(share, currency: entry.currency.rawValue)) 반영")
                    .font(.caption).foregroundStyle(Ink.soft)
            } else if entry.currency != .krw, let converted = line?.totalKRW {
                Text("합계 반영 약 \(TimeFormat.money(Double(converted), currency: "KRW"))")
                    .font(.caption).foregroundStyle(Ink.soft)
            }
            // 무엇에 쓴 돈인지(분류)와 냈는지(상태)는 다른 질문이다 — 상태는 고른 것만 말한다
            if entry.payState != .none || !entry.photos.isEmpty {
                HStack(spacing: Space.xs) {
                    if entry.payState != .none {
                        Text(entry.payState.label)
                            .font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Ink.accent.opacity(0.12), in: Capsule())
                    }
                    if !entry.photos.isEmpty {
                        Label("\(entry.photos.count)", systemImage: "photo")
                            .font(.caption2).foregroundStyle(Ink.soft)
                    }
                }
            }
        }
    }
}

/// 비용 편집기가 고치는 대상. `prep`은 여행 단위 준비 비용(`TripDocument.costItems`) — 하루 항목과 같은
/// 편집기를 쓰되 낸 날짜를 더 묻는다(가계부 정렬용).
struct CostEditTarget: Identifiable {
    enum Kind { case budget, spot(Int), extra(String), prep(String) }
    let id = UUID()
    let kind: Kind
    let entry: CostEntry
    /// 아직 문서에 없는 새 항목 — 지울 것이 없으니 '삭제'를 두지 않는다(취소가 그 일을 한다).
    var isNew = false
    var isBudget: Bool { if case .budget = kind { true } else { false } }
    /// 이름이 있어야 하고 지울 수 있는 항목 — 하루 추가 비용과 여행 준비 비용.
    var isExtra: Bool {
        switch kind { case .extra, .prep: true; default: false }
    }
    var isPrep: Bool { if case .prep = kind { true } else { false } }
}

struct CostEntryEditor: View {
    let target: CostEditTarget
    let onSave: (CostEntry?) async -> Bool
    let onDelete: ((Bool) async -> Bool)?
    @State private var entry: CostEntry
    @State private var amount: String
    @State private var saving = false
    @State private var failed = false
    @State private var showsDiscardConfirm = false
    @State private var showsDeleteConfirm = false
    @Environment(\.dismiss) private var dismiss

    init(target: CostEditTarget, onDelete: ((Bool) async -> Bool)? = nil, onSave: @escaping (CostEntry?) async -> Bool) {
        self.target = target
        self.onDelete = onDelete
        self.onSave = onSave
        _entry = State(initialValue: target.entry)
        _amount = State(initialValue: MoneyInput.text(amount: target.entry.amount))
    }

    private var valid: Bool {
        (amount.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || MoneyInput.amount(from: amount, currency: entry.currency) != nil)
        && (!target.isExtra || !entry.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    private var isDirty: Bool {
        entry != target.entry || amount != MoneyInput.text(amount: target.entry.amount)
    }

    var body: some View {
        NavigationStack {
            PaperForm {
                if target.isExtra {
                    Section {
                        TextField("항목 이름", text: $entry.title)

                    }
                }
                if !target.isBudget {
                    Section {
                        Picker("카테고리", selection: $entry.kind) {
                            if !target.isExtra { Text("장소 분류에 따름").tag("AUTO") }
                            ForEach(CostCategory.allCases, id: \.rawValue) { Text($0.label).tag($0.rawValue) }
                        }
                    }
                }
                // 결제일이 먼저다 — 있으면 날짜가 상태를 정하므로 고르는 칸을 감춘다(예약 결제 금액의 편집기·웹과 같다).
                if !target.isBudget {
                    Section {
                        Toggle("결제일 정하기", isOn: Binding(
                            get: { entry.paidOn != nil },
                            set: { on in entry.paidOn = on ? (entry.paidOn ?? ISODateText.text(from: Date())) : nil }))
                        if entry.paidOn != nil {
                            DatePicker("결제일", selection: Binding(
                                get: { entry.paidOn.flatMap { ISODateText.date(from: $0) } ?? Date() },
                                set: { entry.paidOn = ISODateText.text(from: $0) }), displayedComponents: .date)
                        }
                    } footer: {
                        Text(entry.paidOn != nil
                             ? "결제일이 오늘이거나 지났으면 결제 완료, 아직이면 결제 예정으로 봐요."
                             : "결제일을 정하면 그 날부터 결제 완료로 봐요. 여행 날짜와 무관해요.")
                    }
                }
                Section {
                    TextField(target.isBudget ? "예산 미설정" : "비용 미정", text: $amount).keyboardType(.decimalPad)
                    Picker("통화", selection: $entry.currency) {
                        ForEach(Currency.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    Picker("금액 기준", selection: $entry.basis) {
                        ForEach(CostBasis.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    if entry.basis != .entered { Stepper("\(entry.people)명 적용", value: $entry.people, in: 1...100) }
                    if !target.isBudget { Toggle("일부 금액만 확인했어요", isOn: $entry.isPartial) }
                } footer: {
                    Text("\(target.isBudget ? "비워 두면 예산 미설정, 0은 예산 0원이에요." : "비워 두면 미정, 0은 확인한 무료예요.") 1인 금액을 선택한 경우에만 적용 인원을 곱해요. 원·엔은 정수, 달러·유로·위안은 소수 둘째 자리까지 입력해 주세요.")
                }
                if !target.isBudget {
                    if entry.paidOn == nil {
                        Section {
                            Picker("결제 상태", selection: $entry.payState) {
                                ForEach(CostPayState.allCases, id: \.self) { Text($0.label).tag($0) }
                            }
                        } footer: {
                            Text("예약해 두고 아직 내지 않은 돈과 이미 낸 돈을 따로 봐요. 고르지 않으면 어느 쪽으로도 세지 않아요.")
                        }
                    }
                    Section {
                        CostPhotosField(refs: $entry.photos)
                    } header: { Text("영수증·품목 사진") } footer: {
                        Text("무엇에 썼는지 기억하려고 붙여요. 사진 자체는 올리지 않고 이 기기 사진 보관함의 위치만 기억해요 — 일행에게는 보이지 않아요.")
                    }
                }
                if failed { Section { Text("비용을 저장하지 못했어요. 입력 내용은 유지되어 있어요.").foregroundStyle(Ink.warning) } }
                // 지우기는 되돌릴 수 없다 — 한 번 묻는다(2026-09-27 UX 검토). 새 항목에는 두지 않는다.
                if !target.isBudget && !target.isNew {
                    Section { Button("항목 삭제", role: .destructive) { showsDeleteConfirm = true }.disabled(saving) }
                }
            }
            .tint(Ink.accent)
            .sheet(isPresented: $showsDeleteConfirm) {
                CostDeleteSheet(title: entry.title, allowsSource: !target.isExtra, saving: saving) { includingSource in
                    if !target.isExtra, let onDelete {
                        saving = true
                        let saved = await onDelete(includingSource)
                        saving = false
                        if saved { dismiss() } else { failed = true }
                        return saved
                    }
                    return await save(nil)
                }
            }
            .navigationTitle(target.isBudget ? "하루 예산" : target.isPrep ? "예약 결제 금액" : "비용 입력")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") {
                        if isDirty { showsDiscardConfirm = true } else { dismiss() }
                    }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("저장") {
                        var updated = entry
                        updated.amount = MoneyInput.amount(from: amount, currency: entry.currency)
                        if updated.paidOn != nil { updated.payState = .none }   // 결제일이 있으면 날짜가 정한다 — 손으로 고른 상태는 두지 않는다
                        Task { await save(updated) }
                    }.disabled(!valid || saving)
                }
            }
            .interactiveDismissDisabled(isDirty || saving)
            .confirmationDialog("입력한 내용을 버릴까요?", isPresented: $showsDiscardConfirm, titleVisibility: .visible) {
                Button("내용 버리기", role: .destructive) { dismiss() }
                Button("계속 편집", role: .cancel) { }
            }
        }
    }

    @discardableResult
    private func save(_ value: CostEntry?) async -> Bool {
        guard !saving else { return false }
        saving = true
        defer { saving = false }
        if await onSave(value) { dismiss(); return true }
        failed = true
        return false
    }
}

/// 삭제 범위를 먼저 고른다. 기본은 비용만 지우고 원본 일정은 남긴다.
struct CostDeleteSheet: View {
    let title: String
    var allowsSource = true
    var saving = false
    let onDelete: (Bool) async -> Bool
    @State private var includingSource = false
    @State private var working = false
    @State private var failed = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            PaperForm {
                Section {
                    Text(title.isEmpty ? "비용을 삭제할까요?" : title)
                    if allowsSource {
                        Button { includingSource.toggle() } label: {
                            Label("일정의 장소·예약도 함께 삭제", systemImage: includingSource ? "checkmark.square.fill" : "square")
                        }
                        .accessibilityAddTraits(includingSource ? [.isSelected] : [])
                        Text(includingSource ? "선택한 항목과 연결된 일정에서도 삭제해요. 실제 예약은 취소되지 않아요." : "금액·통화·결제일 등 비용 정보만 지우고 일정은 남겨요.")
                            .font(.caption).foregroundStyle(Ink.soft)
                    }
                    if failed { Text("삭제하지 못했어요. 다시 시도해 주세요.").foregroundStyle(Ink.warning) }
                    Button("삭제", role: .destructive) {
                        Task {
                            working = true
                            let saved = await onDelete(includingSource)
                            working = false
                            if saved { dismiss() } else { failed = true }
                        }
                    }.disabled(working || saving)
                }
            }
            .navigationTitle("비용 삭제")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() }.disabled(working) } }
            .interactiveDismissDisabled(working)
        }
        .presentationDetents([.medium])
    }
}
