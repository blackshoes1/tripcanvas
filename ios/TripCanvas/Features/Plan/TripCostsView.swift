import SwiftUI

/// 비용은 **두 장부**다 — 가기 전에 내는 돈과 가서 쓰는 돈은 적는 순간이 다르다(2026-09-17).
///
/// - **예약 결제 금액**(가계부): 여행 단위 **한 목록**. 예약(항공·숙박·렌트)이 전액 한 줄씩, 예약이 아닌 사전 지출
///   (보험·유심·미리 산 입장권 — `trip.costItems`)도 같은 줄 모양으로, 결제일 순으로 쌓인다(`PaymentRow`). 둘은 한 편집기로
///   다룬다(`BookingEditorView`). 위에는 '결제 완료 / 결제 예정' 둘뿐이고, **결제일이 있으면 날짜가 상태를 정한다**(2026-09-18).
/// - **현지 결제 금액**(정산): 하루 단위. 그날 쓴 돈 합계와 날짜별 줄이 있고, 적는 것은 **금액부터** 친다(`QuickSpendEditor`).
///
/// 합계·환산·나누기는 전부 서버가 한다(`/costs`의 `prep`·`onSite`) — 앱은 그리고, 문서를 고쳐 저장할 뿐이다.
/// ⚠️ 옛 API(NAS를 아직 안 올렸을 때)는 `prep`·`onSite`를 주지 않는다. 그때 목록은 문서에서 짓고
/// 합계 자리에는 **그 사실을 쓴다** — 조용히 감추면 아무 오류 없이 기능만 사라진 것처럼 보인다.
struct TripCostsView: View {
    let trip: TripSummary
    @Environment(AppEnvironment.self) private var env
    @State private var response: TripCostsResponse?
    @State private var snapshot: TripDocumentSnapshot?
    @State private var loading = false
    @State private var saving = false
    @State private var error: String?
    @State private var ledger: CostLedger
    @State private var editingDay: TripCostDay?
    /// 편집기를 연 순간의 revision. 그 사이 다른 기기가 바꿨으면 저장하지 않는다.
    @State private var editingRevision = 0
    @State private var bookingEditor: BookingEditorTarget?
    /// 목록에서 밀어서 결제일만 고칠 때.
    @State private var paidOnEditor: PaymentRow?
    @State private var quickSpend: QuickSpendTarget?

    init(trip: TripSummary) {
        self.trip = trip
        // 여행 중이면 오늘 쓴 돈부터, 아니면 가계부부터 — 그때 적을 것이 그것이다.
        _ledger = State(initialValue: trip.isLive ? .onSite : .prep)
    }

    /// 두 장부.
    enum CostLedger: String, CaseIterable, Hashable {
        case prep, onSite
        var label: String { self == .prep ? "예약 결제 금액" : "현지 결제 금액" }
    }

    struct QuickSpendTarget: Identifiable {
        let day: Int
        var id: Int { day }
    }

    private var canEdit: Bool { snapshot?.canEdit == true }
    private var todayIndex: Int? { trip.todayIndex >= 0 ? trip.todayIndex : nil }

    var body: some View {
        VStack(spacing: 0) {
            Picker("장부", selection: $ledger) {
                ForEach(CostLedger.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, Space.l)
            .padding(.vertical, Space.s)
            List {
                if loading && response == nil && snapshot == nil { ProgressView("비용을 확인하는 중…") }
                if let error {
                    Section {
                        Text(error).foregroundStyle(.orange)
                        Button("다시 불러오기") { Task { await load() } }.disabled(loading || saving)
                    }
                }
                switch ledger {
                case .prep: prepSections
                case .onSite: onSiteSections
                }
                if let response, response.hasForeignCurrency {
                    Section("원화 환산 기준") {
                        // 서버가 무엇으로 환산했는지 그대로 말한다 — 받은 날짜가 있으면 그 날, 없으면 근사값이라고.
                        Text(Self.fxNote(source: response.fxSource, asOf: response.fxAsOf)).font(.caption)
                        ForEach(response.fxRates.keys.filter { $0 != "KRW" }.sorted(), id: \.self) { currency in
                            Text(Self.fxLine(currency: currency, rate: response.fxRates[currency] ?? 0)).font(.caption)
                        }
                    }
                }
            }
        }
        .paperGround()
        .tint(Ink.accent)
        .navigationTitle("비용")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $editingDay) { day in
            if let snapshot, snapshot.document.hasDay(day.index) {
                DayCostView(day: snapshot.document.days[day.index],
                            cost: response?.days.first(where: { $0.index == day.index })?.cost,
                            canEdit: snapshot.canEdit,
                            onRefresh: { await load() }) { edited in
                    await save(edited, index: day.index)
                }
            }
        }
        .sheet(item: $quickSpend) { target in
            if let snapshot, snapshot.document.hasDay(target.day) {
                QuickSpendEditor(dayLabel: dayLabel(target.day)) { entry in
                    var day = snapshot.document.days[target.day]
                    day.costItems = day.costItems + [entry]
                    return await save(day, index: target.day)
                }
            }
        }
        .sheet(item: $paidOnEditor) { row in
            PaidOnSheet(row: row) { iso in await setPaidOn(row, iso) }
        }
        .sheet(item: $bookingEditor) { target in
            if let snapshot {
                BookingEditorView(
                    target: target,
                    document: snapshot.document,
                    onSave: { booking, links in
                        if let problem = booking.validate() { return problem.message }
                        let saved = await saveDocument(expected: editingRevision) { $0.upsertBooking(booking, links: links) }
                        return saved ? nil : (error ?? "예약을 저장하지 못했어요.")
                    },
                    onDelete: { id in
                        let saved = await saveDocument(expected: editingRevision) { $0.removeBooking(id: id) }
                        return saved ? nil : (error ?? "예약을 빼지 못했어요.")
                    },
                    onSaveItem: { entry in
                        // 고친 항목은 제자리에, 새 항목은 뒤에 — 목록 순서가 저장할 때마다 바뀌지 않게.
                        let saved = await saveDocument(expected: editingRevision) { draft in
                            var items = draft.costItems
                            if let index = items.firstIndex(where: { $0.id == entry.id }) { items[index] = entry } else { items.append(entry) }
                            draft.costItems = items
                        }
                        return saved ? nil : (error ?? "결제 항목을 저장하지 못했어요.")
                    },
                    onDeleteItem: { id in
                        let saved = await saveDocument(expected: editingRevision) { draft in draft.costItems = draft.costItems.filter { $0.id != id } }
                        return saved ? nil : (error ?? "결제 항목을 지우지 못했어요.")
                    })
            }
        }
    }

    // MARK: 예약 결제 금액 — 가계부

    /// 기기 날짜 — 응답이 없을 때(옛 API·오프라인) 결제일 규칙을 같은 식으로 적용하려는 것. 응답이 있으면 서버 값이 먼저다.
    private var deviceToday: String { ISODateText.text(from: Date()) }

    /// 예약과 여행 단위 비용을 한 목록으로 — 결제일이 최근인 것부터.
    private var paymentRows: [PaymentRow] {
        guard let document = snapshot?.document else { return [] }
        return PaymentRow.rows(bookings: document.bookings, items: document.costItems)
    }

    @ViewBuilder
    private var prepSections: some View {
        Section {
            if let prep = response?.prep {
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text("예약 결제 금액").font(.subheadline)
                    Text(money(prep.totalKRW)).font(.title.bold())
                    // 가계부가 답할 것은 둘뿐이다 — 냈는가, 아직인가.
                    HStack(spacing: Space.m) {
                        Label("\(CostPayState.paid.label) \(money(prep.group.amount(.paid)))", systemImage: "checkmark.circle")
                        Label("\(CostPayState.reserved.label) \(money(prep.group.amount(.reserved)))", systemImage: "clock")
                    }
                    .font(.caption).foregroundStyle(.secondary)
                    if prep.group.amount(.none) > 0 {
                        Text("결제 상태를 고르지 않은 \(money(prep.group.amount(.none)))은 어느 쪽으로도 세지 않았어요")
                            .font(.caption).foregroundStyle(.orange)
                    }
                }
            } else if response != nil {
                Label("합계는 API를 새 버전으로 올린 뒤 보여요. 목록과 입력은 지금도 됩니다.", systemImage: "server.rack")
                    .font(.caption).foregroundStyle(.orange)
            }
        } footer: {
            Text("가기 전에 내는 돈 — 항공·숙박·렌트 예약과 보험·유심·미리 산 입장권. 결제일을 정해 두면 그 날부터 결제 완료로 셉니다. 항공은 날짜로 나누지 않고, 숙박·렌터카는 날짜별 비용에도 하루치로 보여요.")
        }
        Section {
            // 추가는 목록 위에 — 긴 목록의 끝까지 내려가지 않게.
            if canEdit, let snapshot {
                Button { editingRevision = snapshot.revision; bookingEditor = .create } label: {
                    Label("결제 항목 추가", systemImage: "plus")
                }
            }
            let rows = paymentRows
            if rows.isEmpty { Text("예약과 미리 낸 비용을 적으면 여기에 모여요").foregroundStyle(.secondary) }
            ForEach(rows) { row in paymentRow(row) }
        } header: { Text("결제 항목") } footer: {
            Text("줄을 오른쪽으로 밀어 결제일을 정하거나 결제 완료·결제 예정을 바꿀 수 있어요. 결제일이 있으면 날짜가 상태를 정합니다.")
        }
    }

    /// 한 줄의 상태 — 서버 응답이 있으면 그 값(여행 시간대의 오늘로 정했다), 없으면 기기 날짜로 같은 규칙.
    private func payState(of row: PaymentRow) -> CostPayState {
        if let line = response?.prep?.items.first(where: { $0.source == row.lineSource && $0.key == row.key }) { return line.payState }
        return CostPayState.resolved(paidOn: row.paidOn, manual: row.manualPayState, today: deviceToday)
    }

    private func paymentRow(_ row: PaymentRow) -> some View {
        let line = response?.prep?.items.first { $0.source == row.lineSource && $0.key == row.key }
        let state = payState(of: row)
        let period = row.booking.map { booking in
            [booking.start, booking.end].compactMap { $0 }.map { TimeFormat.dayChipLabel($0) ?? $0 }.joined(separator: " ~ ")
        } ?? ""
        let paidOnLabel = row.paidOn.map { "결제일 \(TimeFormat.dayChipLabel($0) ?? $0)" } ?? ""
        return Button {
            guard let snapshot else { return }
            editingRevision = snapshot.revision
            if let booking = row.booking { bookingEditor = .edit(booking) } else if let item = row.item { bookingEditor = .editItem(item) }
        } label: {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: Space.xs) {
                    Label(row.title, systemImage: row.kind.symbol)
                    Text([row.kind.label, period, row.booking?.provider ?? "", paidOnLabel].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                    HStack(spacing: Space.xs) {
                        if state != .none { payChip(state) }
                        if row.currencyCode != "KRW", let krw = line?.totalKRW {
                            Text("약 \(money(krw))").font(.caption2).foregroundStyle(.secondary)
                        }
                        if !row.photos.isEmpty {
                            Label("\(row.photos.count)", systemImage: "photo").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
                Spacer(minLength: Space.s)
                if let amount = row.amount {
                    Text(TimeFormat.money(amount, currency: row.currencyCode)).monospacedDigit()
                } else {
                    Text("금액 미정").foregroundStyle(Ink.soft)
                }
            }
            .padding(.vertical, Space.xs)
        }
        .buttonStyle(.plain)
        .disabled(!canEdit)
        .swipeActions(edge: .leading, allowsFullSwipe: false) {
            if canEdit {
                Button { paidOnEditor = row } label: { Label("결제일", systemImage: "calendar") }
                    .tint(Ink.accent)
                if row.paidOn == nil {
                    // 결제일이 없을 때만 손으로 바꾼다 — 있으면 날짜가 정한다.
                    let paid = state == .paid
                    Button {
                        Task { await setPayState(row, paid ? .reserved : .paid) }
                    } label: {
                        Label(paid ? CostPayState.reserved.label : CostPayState.paid.label, systemImage: paid ? "clock" : "checkmark.circle")
                    }
                    .tint(paid ? .orange : .green)
                }
            }
        }
        .accessibilityHint(canEdit ? "탭하면 고칩니다. 오른쪽으로 밀면 결제일이나 결제 상태를 바꿉니다." : "")
    }

    private func payChip(_ state: CostPayState) -> some View {
        Text(state.label)
            .font(.caption2)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background((state == .paid ? Color.green : state == .reserved ? Color.orange : Ink.soft).opacity(0.14), in: Capsule())
    }

    // MARK: 가서 쓰는 비용 — 정산

    @ViewBuilder
    private var onSiteSections: some View {
        Section {
            if let response, let onSite = response.onSite {
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text("현지 결제 금액").font(.subheadline)
                    Text(money(onSite.totalKRW)).font(.title.bold())
                    if !response.days.isEmpty {
                        Text("하루 평균 \(money((onSite.totalKRW / Double(response.days.count)).rounded())) · \(response.days.count)일 기준")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if !onSite.paySplit.isEmpty {
                        Text(onSite.paySplit.map { "\($0.state.label) \(money($0.amount))" }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if response.transportUnpriced {
                        Text("아직 계산되지 않은 교통비는 포함되지 않았어요").font(.caption).foregroundStyle(.secondary)
                    }
                }
            } else if response != nil {
                Label("합계는 API를 새 버전으로 올린 뒤 보여요. 날짜별 입력은 지금도 됩니다.", systemImage: "server.rack")
                    .font(.caption).foregroundStyle(.orange)
            }
            if canEdit, let today = todayIndex {
                Button { quickSpend = QuickSpendTarget(day: today) } label: {
                    Label("오늘 쓴 돈 적기", systemImage: "plus.circle.fill")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
            }
        } footer: {
            Text("장소 비용·추가 비용·교통비만 셉니다. 예약 하루치는 예약 결제 금액에 있어요.")
        }
        Section("날짜별") {
            if let response {
                if response.days.isEmpty { Text("여행 날짜를 추가하면 하루 비용을 볼 수 있어요").foregroundStyle(.secondary) }
                ForEach(response.days) { day in dayRow(day, revision: response.revision) }
            } else if let snapshot, error == nil {
                // 합계가 아직 없어도 날짜는 문서가 안다 — 입력까지 막지 않는다.
                ForEach(Array(snapshot.document.days.indices), id: \.self) { index in
                    HStack {
                        Text("Day \(index + 1)")
                        Spacer()
                        if canEdit {
                            Button { quickSpend = QuickSpendTarget(day: index) } label: {
                                Image(systemName: "plus.circle").frame(width: 44, height: 44)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Day \(index + 1)에 쓴 돈 적기")
                        }
                    }
                }
            }
        }
    }

    private func dayRow(_ day: TripCostDay, revision: Int) -> some View {
        HStack(spacing: Space.s) {
            Button {
                editingRevision = revision; editingDay = day
            } label: {
                VStack(alignment: .leading, spacing: Space.xs) {
                    HStack(spacing: Space.s) {
                        Text("Day \(day.index + 1) · \(day.date.isEmpty ? "날짜 미정" : (TimeFormat.dayChipLabel(day.date) ?? day.date))")
                        if day.index == todayIndex {
                            Text("오늘").font(.caption2.weight(.bold))
                                .padding(.horizontal, 5).padding(.vertical, 1)
                                .background(Ink.accent, in: Capsule()).foregroundStyle(.white)
                        }
                        Spacer()
                        Text(money(day.cost.onSiteKRW ?? day.cost.total)).monospacedDigit()
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                    }
                    if !day.title.isEmpty { Text(day.title).font(.caption).foregroundStyle(.secondary) }
                    if day.cost.onSiteKRW == nil {
                        Text("예약 하루치 포함 · API 갱신 전").font(.caption2).foregroundStyle(.orange)
                    }
                    if let count = day.cost.details?.unknownCount, count > 0 {
                        Text("미정·일부 금액 \(count)개").font(.caption).foregroundStyle(.orange)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if canEdit {
                Button { quickSpend = QuickSpendTarget(day: day.index) } label: {
                    Image(systemName: "plus.circle").frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Day \(day.index + 1)에 쓴 돈 적기")
            }
        }
    }

    private func dayLabel(_ index: Int) -> String {
        let date = response?.days.first { $0.index == index }?.date ?? ""
        let title = snapshot?.document.days[index].title ?? ""
        return ["Day \(index + 1)", TimeFormat.dayChipLabel(date) ?? "", title].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func money(_ value: Double) -> String { TimeFormat.money(value, currency: "KRW") }

    /// 환율 한 줄 — **원 단위로 반올림**하고, 엔은 100엔 기준으로 말한다("100 JPY ≈ 931원"). 소수점 환율은 시세표의 말이지
    /// 여행자의 말이 아니다. 자릿수 구분은 로케일과 무관하게 쉼표다(테스트가 문자열을 본다).
    static func fxLine(currency: String, rate: Double) -> String {
        let unit = currency == "JPY" ? 100 : 1
        let krw = Int((rate * Double(unit)).rounded())
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.groupingSeparator = ","
        formatter.usesGroupingSeparator = true
        formatter.maximumFractionDigits = 0
        let text = formatter.string(from: NSNumber(value: krw)) ?? String(krw)
        return "\(unit) \(currency) ≈ \(text)원"
    }

    /// 환산 기준 한 줄. 서버가 시세를 받았으면 그 날짜(하루 한 번 갱신)를, 못 받았으면 근사값임을 말한다.
    /// ⚠️ 받은 날이 오늘이 아닐 수 있다 — 상류가 죽은 날은 마지막으로 받은 날을 쓴다. 그래서 날짜를 숨기지 않는다.
    static func fxNote(source: String, asOf: String?) -> String {
        guard source == "API", let asOf, !asOf.isEmpty else { return "기본 참고 환율 · 실시간 시세 아님 · 시세 기준일 없음" }
        return "\(TimeFormat.dayChipLabel(asOf) ?? asOf) 환율 · 하루 한 번 갱신"
    }

    // MARK: 읽기·쓰기

    /// 문서와 계산을 따로 받는다 — 계산이 실패해도 문서로 목록은 짓는다(입력을 막지 않는다).
    private func load() async {
        guard !loading, !saving else { return }
        loading = true
        defer { loading = false }
        do {
            let fresh = try await env.service.document(tripId: trip.id)
            try Task.checkCancellation()
            snapshot = fresh; error = nil
        } catch {
            guard !Task.isCancelled else { return }
            self.error = "비용을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요."
            return
        }
        do {
            let received = try await env.service.tripCosts(tripId: trip.id)
            try Task.checkCancellation()
            guard received.revision == snapshot?.revision else {
                response = nil
                error = "여행 내용이 변경됐어요. 다시 불러와 주세요."; return
            }
            response = received
        } catch {
            guard !Task.isCancelled else { return }
            response = nil
            self.error = "합계를 계산하지 못했어요. 목록과 입력은 그대로 됩니다."
        }
    }

    /// 문서를 고쳐 저장한다. 편집기를 연 뒤 다른 기기가 바꿨으면(`expected`) 저장하지 않는다 — 조용히 덮어쓰지 않는다.
    @discardableResult
    private func saveDocument(expected: Int? = nil, _ change: (inout TripDocument) -> Void) async -> Bool {
        guard !saving, !loading, let snapshot, snapshot.canEdit else { return false }
        if let expected, expected != snapshot.revision {
            error = "여행 내용이 그새 바뀌었어요. 다시 불러온 뒤 고쳐 주세요."
            return false
        }
        saving = true
        var draft = snapshot.document
        change(&draft)
        do {
            let saved = try await env.service.saveDocument(tripId: trip.id, document: draft, expectedRevision: snapshot.revision)
            self.snapshot = saved; editingRevision = saved.revision
            response = nil; saving = false
            await load()
            return true
        } catch {
            saving = false
            self.error = "비용 저장에 실패했어요. 다른 기기의 변경이 있다면 닫은 뒤 다시 불러와 주세요."
            return false
        }
    }

    private func save(_ day: TripDay, index: Int) async -> Bool {
        guard let snapshot, snapshot.document.hasDay(index) else { return false }
        return await saveDocument(expected: editingRevision) { draft in
            var days = draft.days
            days[index] = day; draft.days = days
        }
    }

    private func setPayState(_ row: PaymentRow, _ state: CostPayState) async {
        await mutate(row, booking: { $0.payState = state }, item: { $0.payState = state })
    }

    /// 결제일을 두면 날짜가 상태를 정한다 — 손으로 고른 상태는 지운다(편집기와 같다). nil이면 결제일을 지운다.
    private func setPaidOn(_ row: PaymentRow, _ iso: String?) async -> Bool {
        await mutate(row, booking: { booking in
            booking.paidOn = iso
            if iso != nil { booking.payState = .reserved }
        }, item: { item in
            item.paidOn = iso
            if iso != nil { item.payState = .none }
        })
    }

    @discardableResult
    private func mutate(_ row: PaymentRow, booking change: (inout TripBooking) -> Void, item changeItem: (inout CostEntry) -> Void) async -> Bool {
        guard let snapshot else { return false }
        editingRevision = snapshot.revision
        return await saveDocument(expected: editingRevision) { draft in
            if row.booking != nil {
                var all = draft.bookings
                guard let index = all.firstIndex(where: { $0.id == row.key }) else { return }
                change(&all[index])
                draft.bookings = all
            } else {
                var all = draft.costItems
                guard let index = all.firstIndex(where: { $0.id == row.key }) else { return }
                changeItem(&all[index])
                draft.costItems = all
            }
        }
    }
}

/// 결제일만 고치는 작은 시트 — 목록에서 밀어서 연다. 지우면 다시 손으로 고른 상태로 돌아간다.
struct PaidOnSheet: View {
    let row: PaymentRow
    let onSave: (String?) async -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var date: Date
    @State private var saving = false
    @State private var failed = false

    init(row: PaymentRow, onSave: @escaping (String?) async -> Bool) {
        self.row = row
        self.onSave = onSave
        _date = State(initialValue: row.paidOn.flatMap { ISODateText.date(from: $0) } ?? Date())
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker("결제일", selection: $date, displayedComponents: .date)
                } header: { Text(row.title) } footer: {
                    Text(ISODateText.text(from: date) <= ISODateText.text(from: Date())
                         ? "이 날이 지났으니 결제 완료로 셉니다."
                         : "이 날부터 결제 완료로 셉니다 — 그 전까지는 결제 예정이에요.")
                }
                if row.paidOn != nil {
                    Section {
                        Button("결제일 지우기", role: .destructive) { Task { await save(nil) } }.disabled(saving)
                    } footer: { Text("지우면 결제 상태를 다시 손으로 고릅니다.") }
                }
                if failed { Section { Text("저장하지 못했어요. 다시 시도해 주세요.").foregroundStyle(.orange) } }
            }
            .paperGround()
            .tint(Ink.accent)
            .navigationTitle("결제일")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("저장") { Task { await save(ISODateText.text(from: date)) } }.disabled(saving)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func save(_ iso: String?) async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        if await onSave(iso) { dismiss() } else { failed = true }
    }
}
