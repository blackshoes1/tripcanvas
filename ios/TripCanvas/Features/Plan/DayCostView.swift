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
                Text("가서 쓰는 돈 \(TimeFormat.money(onSite, currency: "KRW")) · 예약 하루치 \(TimeFormat.money(cost.total - onSite, currency: "KRW"))")
                    .font(.caption).foregroundStyle(.secondary)
            }
            // 합계 하나로는 "얼마나 남았지"를 알 수 없다 — 예약해 둔 돈과 이미 낸 돈을 따로 보여 준다
            if let cost, !cost.paySplit.isEmpty {
                Text(cost.paySplit.map { "\($0.state.label) \(TimeFormat.money($0.amount, currency: "KRW"))" }
                    .joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary)
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
                        .font(.caption).foregroundStyle(difference < 0 ? Ink.warning : .secondary)
                }
                if details.unknownCount > 0 {
                    Text("비용 미정 \(details.unknownCount)개 · 최종 비용은 더 늘어날 수 있어요")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if details.transportUnpriced {
                    Text("아직 계산되지 않은 교통비는 합계에서 빠져 있어요")
                        .font(.caption).foregroundStyle(.secondary)
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
    @State private var day: TripDay
    @State private var editing: CostEditTarget?
    /// 현지에서 방금 쓴 돈 — 금액부터 치는 짧은 길(`QuickSpendEditor`).
    @State private var quickAdd = false
    @Environment(\.dismiss) private var dismiss

    init(day: TripDay, cost: DayPlanCost?, canEdit: Bool, onRefresh: (() async -> Void)? = nil, onSave: @escaping (TripDay) async -> Bool) {
        _day = State(initialValue: day)
        self.cost = cost
        self.canEdit = canEdit
        self.onSave = onSave
        self.onRefresh = onRefresh
    }

    var body: some View {
        NavigationStack {
            List {
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
                            editing = CostEditTarget(kind: .extra(entry.id), entry: entry)
                        } label: { Label("비용 항목 추가", systemImage: "plus") }
                    }
                } header: { Text("추가 비용") } footer: {
                    Text("장소에 적지 않은 식사·입장료·교통·숙박비를 적습니다. 교통 항목을 만들면 그날의 자동 교통비 추정을 대신합니다.")
                }
                if let details = cost?.details {
                    Section("예약·자동 계산") {
                        ForEach(details.items.filter { $0.source == "BOOKING" || $0.source == "TRANSPORT" }) { item in
                            VStack(alignment: .leading, spacing: Space.xs) {
                                Text(item.title)
                                Text("\(TimeFormat.money(item.amount ?? 0, currency: item.currency)) · \(item.source == "BOOKING" ? "예약의 하루 배분액" : "이동 경로 추정")")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Text("연결된 장소에 금액을 적은 예약은 중복해서 더하지 않습니다. 예약 금액과 날짜는 예약 화면에서 수정할 수 있어요.")
                            .font(.caption).foregroundStyle(.secondary)
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
            .paperGround()
            .tint(Ink.accent)
            .navigationTitle("하루 비용")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("닫기") { dismiss() } } }
            .sheet(isPresented: $quickAdd) {
                QuickSpendEditor(dayLabel: day.title.isEmpty ? "하루 비용" : day.title) { entry in
                    var updated = day
                    updated.costItems = updated.costItems + [entry]
                    guard await onSave(updated) else { return false }
                    day = updated
                    return true
                }
            }
            .sheet(item: $editing) { target in
                CostEntryEditor(target: target) { entry in
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
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                Text(line?.state == "BOOKING" ? "연결된 예약 금액에 포함" : "비용 미정")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            if entry.currency != .krw, let converted = line?.totalKRW {
                Text("합계 반영 약 \(TimeFormat.money(Double(converted), currency: "KRW"))")
                    .font(.caption).foregroundStyle(.secondary)
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
                            .font(.caption2).foregroundStyle(.secondary)
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
    @State private var entry: CostEntry
    @State private var amount: String
    @State private var saving = false
    @State private var failed = false
    @State private var showsDiscardConfirm = false
    @Environment(\.dismiss) private var dismiss

    init(target: CostEditTarget, onSave: @escaping (CostEntry?) async -> Bool) {
        self.target = target
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
            Form {
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
                             ? "결제일이 오늘이거나 지났으면 결제 완료, 아직이면 결제 예정으로 셉니다."
                             : "결제일을 정하면 그 날부터 결제 완료로 셉니다. 여행 날짜와 무관해요.")
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
                    Text("\(target.isBudget ? "비워 두면 예산 미설정, 0은 예산 0원입니다." : "비워 두면 미정, 0은 확인한 무료입니다.") 1인 금액을 선택한 경우에만 적용 인원을 곱합니다. 원·엔은 정수, 달러·유로·위안은 소수 둘째 자리까지 입력해 주세요.")
                }
                if !target.isBudget {
                    if entry.paidOn == nil {
                        Section {
                            Picker("결제 상태", selection: $entry.payState) {
                                ForEach(CostPayState.allCases, id: \.self) { Text($0.label).tag($0) }
                            }
                        } footer: {
                            Text("예약해 두고 아직 내지 않은 돈과 이미 낸 돈을 따로 봅니다. 고르지 않으면 어느 쪽으로도 세지 않아요.")
                        }
                    }
                    Section {
                        CostPhotosField(refs: $entry.photos)
                    } header: { Text("영수증·품목 사진") } footer: {
                        Text("무엇에 썼는지 기억하려고 붙입니다. 사진 자체는 올리지 않고 이 기기 사진 보관함의 위치만 기억해요 — 일행에게는 보이지 않습니다.")
                    }
                }
                if failed { Section { Text("비용을 저장하지 못했어요. 입력 내용은 유지되어 있어요.").foregroundStyle(Ink.warning) } }
                if target.isExtra {
                    Section { Button("항목 삭제", role: .destructive) { Task { await save(nil) } }.disabled(saving) }
                }
            }
            .paperGround()
            .tint(Ink.accent)
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

    private func save(_ value: CostEntry?) async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        if await onSave(value) { dismiss() } else { failed = true }
    }
}
