import SwiftUI

/// 전체 비용에서 원본 예약·장소·지출을 함께 찾는다. 옛 API에서는 두 장부를 유지한다.
///
/// - **예약 결제 금액**(가계부): 여행 단위 **한 목록**. 예약(항공·숙박·렌트)이 전액 한 줄씩, 예약이 아닌 사전 지출
///   (보험·유심·미리 산 입장권 — `trip.costItems`)도 같은 줄 모양으로, 결제일 순으로 쌓인다(`PaymentRow`). 둘은 한 편집기로
///   다룬다(`BookingEditorView`). 위에는 '결제 완료 / 결제 예정' 둘뿐이고, **날짜가 지나도 결제 상태는 자동으로 바뀌지 않는다**(2026-10-04).
/// - **현지 결제 금액**(정산): 하루 단위. 그날 쓴 돈 합계와 날짜별 줄이 있고, 적는 것은 **금액부터** 친다(`QuickSpendEditor`).
///
/// 합계·환산·나누기는 전부 서버가 한다(`/costs`의 `prep`·`onSite`) — 앱은 그리고, 문서를 고쳐 저장할 뿐이다.
/// ⚠️ 옛 API(NAS를 아직 안 올렸을 때)는 `prep`·`onSite`를 주지 않는다. 그때 목록은 문서에서 짓고
/// 합계 자리에는 **그 사실을 쓴다** — 조용히 감추면 아무 오류 없이 기능만 사라진 것처럼 보인다.
struct TripCostsView: View {
    let trip: TripSummary
    /// 여행 화면(`TripScreenModels`)이 들고 있는 기억. 있으면 시트를 닫았다 열어도 방금 받은 것을 다시 받지 않는다(2026-09-18).
    let memory: TripCostsMemory?
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
    @State private var filter = OverviewFilter.all
    @State private var showsDays = false
    @State private var visibleCostID: String?
    @State private var directCost: DirectCostTarget?

    enum OverviewFilter: String, CaseIterable {
        case all, reservations, other
        var label: String { switch self { case .all: "전체"; case .reservations: "예약"; case .other: "그 외 비용" } }
        func includes(_ item: TripCostOverviewItem) -> Bool {
            self == .all || (self == .reservations ? item.reservation != "NONE" : item.reservation == "NONE")
        }
    }
    struct DirectCostTarget: Identifiable {
        let day: Int
        let target: CostEditTarget
        var id: String { "\(day):\(target.id)" }
    }

    init(trip: TripSummary, memory: TripCostsMemory? = nil) {
        self.trip = trip
        self.memory = memory
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
        Group {
        if let overview = response?.overview {
            overviewContent(overview)
        } else {
        VStack(spacing: 0) {
            Picker("장부", selection: $ledger) {
                ForEach(CostLedger.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, Space.l)
            .padding(.vertical, Space.s)
            PaperList {
                if loading && response == nil && snapshot == nil { ProgressView("비용을 확인하는 중…") }
                if let error {
                    Section {
                        Text(error).foregroundStyle(Ink.warning)
                        Button("다시 불러오기") { Task { await load() } }.disabled(loading || saving)
                    }
                }
                // 총예산은 두 장부를 더한 전체 비용과 비교한다 — 어느 장부를 보든 같은 줄이다(웹 필터바와 같은 `tripBudgetStatus`)
                if let budget = response?.budget {
                    let line = Self.budgetLine(budget)
                    Section {
                        VStack(alignment: .leading, spacing: Space.xs) {
                            Text(line.title).font(.headline).foregroundStyle(line.over ? Ink.danger : Ink.ink)
                            Text(line.detail).font(.caption).foregroundStyle(Ink.soft)
                        }
                        .accessibilityElement(children: .combine)
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
        }
        }
        .paperGround()
        .tint(Ink.accent)
        .navigationTitle("비용")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadIfStale() }
        .refreshable { await load() }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if response?.overview != nil, canEdit {
                Menu {
                    Button("예약·미리 낸 비용", systemImage: "ticket") {
                        editingRevision = snapshot?.revision ?? 0; bookingEditor = .create
                    }
                    Menu("날짜별 쓴 돈", systemImage: "calendar") {
                        ForEach(response?.days ?? []) { day in
                            Button("Day \(day.index + 1) · \(day.title)") {
                                editingRevision = snapshot?.revision ?? 0; quickSpend = QuickSpendTarget(day: day.index)
                            }
                        }
                    }
                } label: {
                    Label("비용 추가", systemImage: "plus").font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .prominentButton()
                .disabled(saving || loading || response?.revision != snapshot?.revision)
                .padding(.horizontal, Space.l).padding(.vertical, Space.s)
                .background(Ink.paper)
            }
        }
        .sheet(item: $directCost) { target in
            CostEntryEditor(target: target.target, onDelete: { includingSource in
                guard case .spot(let index) = target.target.kind else { return false }
                return await saveDocument(expected: editingRevision) {
                    $0.deleteSpotCost(day: target.day, index: index, includingSource: includingSource)
                }
            }) { entry in
                await saveDocument(expected: editingRevision) { document in
                    var days = document.days
                    guard days.indices.contains(target.day) else { return }
                    switch target.target.kind {
                    case .spot(let index):
                        var spots = days[target.day].spots
                        guard spots.indices.contains(index) else { return }
                        spots[index] = entry?.applying(to: spots[index]) ?? CostEntry.clearing(spots[index])
                        days[target.day].spots = spots
                    case .extra(let id):
                        var items = days[target.day].costItems
                        if let index = items.firstIndex(where: { $0.id == id }) {
                            if let entry { items[index] = entry } else { items.remove(at: index) }
                        }
                        days[target.day].costItems = items
                    default: break
                    }
                    document.days = days
                }
            }
        }
        .sheet(item: $editingDay) { day in
            if let snapshot, snapshot.document.hasDay(day.index) {
                DayCostView(day: snapshot.document.days[day.index],
                            cost: response?.days.first(where: { $0.index == day.index })?.cost,
                            canEdit: snapshot.canEdit,
                            draftKey: EditorDraftKey(accountID: env.auth.session?.userId, tripID: trip.id, editor: "spend-\(day.index)"),
                            onRefresh: { await load() },
                            onDeleteSpot: { index, includingSource in
                                let saved = await saveDocument(expected: editingRevision) {
                                    $0.deleteSpotCost(day: day.index, index: index, includingSource: includingSource)
                                }
                                return saved ? self.snapshot?.document.days[day.index] : nil
                            }) { edited in
                    await save(edited, index: day.index)
                }
            }
        }
        .sheet(item: $quickSpend) { target in
            if let snapshot, snapshot.document.hasDay(target.day) {
                SpendEntryFlow(day: snapshot.document.days[target.day], draftKey: EditorDraftKey(accountID: env.auth.session?.userId, tripID: trip.id, editor: "spend-\(target.day)")) { day in
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
                    onDeleteCost: { id, includingSource in
                        let saved = await saveDocument(expected: editingRevision) { $0.deleteBookingCost(id: id, includingSource: includingSource) }
                        return saved ? nil : (error ?? "비용을 삭제하지 못했어요.")
                    },
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

    private func overviewContent(_ overview: TripCostOverview) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Space.l) {
                if let response {
                    CostOverviewSummary(response: response)
                        .redacted(reason: response.revision == snapshot?.revision ? [] : .placeholder)
                        .accessibilityHidden(response.revision != snapshot?.revision)
                }
                if let error {
                    InlineErrorBanner(message: error, tint: Ink.danger, compact: true) { Task { await load() } }
                }
                HStack(spacing: Space.s) {
                    ForEach(OverviewFilter.allCases, id: \.self) { value in
                        PickChip(label: value.label, isOn: filter == value) { filter = value }
                    }
                    Spacer(minLength: 0)
                }
                HStack {
                    Text("비용 내역").font(Typeface.editorial(.title3))
                    Spacer()
                    Button { showsDays.toggle() } label: { Label("날짜별", systemImage: "calendar") }
                        .font(.subheadline).frame(minHeight: 44)
                        .accessibilityValue(showsDays ? "펼침" : "접힘")
                }
                if showsDays, let response {
                    ForEach(response.days) { day in
                        dayRow(day, revision: response.revision).padding(Space.m)
                            .background(Ink.raised, in: RoundedRectangle(cornerRadius: Radius.card))
                    }
                }
                let rows = overview.items.filter { filter.includes($0) }
                if rows.isEmpty {
                    VStack(alignment: .leading, spacing: Space.s) {
                        Image(systemName: "wallet.pass").font(.title).foregroundStyle(Ink.accent)
                        Text(filter == .all ? "여행에 드는 돈을 한곳에" : "이 묶음에 비용이 없어요").font(.headline)
                        Text("예약과 쓴 돈을 추가하면 여기에 모여요.").font(.subheadline).foregroundStyle(Ink.soft)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(Space.xl)
                }
                ForEach(rows) { item in
                    Button { openOverviewItem(item) } label: { CostOverviewRow(item: item) }
                        .buttonStyle(.plain)
                        .disabled(saving || loading || response?.revision != snapshot?.revision || (!canEdit && item.line.source != "TRANSPORT"))
                        .redacted(reason: response?.revision == snapshot?.revision ? [] : .placeholder)
                        .accessibilityHidden(response?.revision != snapshot?.revision)
                        .id(item.id)
                }
                .scrollTargetLayout()
                if let response, response.hasForeignCurrency {
                    Text(Self.fxNote(source: response.fxSource, asOf: response.fxAsOf))
                        .font(.caption).foregroundStyle(Ink.soft)
                }
            }
            .padding(Space.l)
        }
        .scrollPosition(id: $visibleCostID, anchor: .top)
    }

    private func openOverviewItem(_ item: TripCostOverviewItem) {
        guard let snapshot else { return }
        editingRevision = snapshot.revision
        let line = item.line
        if line.source == "BOOKING", let booking = snapshot.document.booking(id: item.bookingId ?? line.key) {
            bookingEditor = .edit(booking)
        } else if line.source == "TRIP", let entry = snapshot.document.costItems.first(where: { $0.id == line.key }) {
            bookingEditor = .editItem(entry)
        } else if let di = line.dayIndex, snapshot.document.hasDay(di) {
            let day = snapshot.document.days[di]
            if line.source == "SPOT", let si = item.spotIndex, day.spots.indices.contains(si) {
                directCost = DirectCostTarget(day: di, target: CostEditTarget(kind: .spot(si), entry: CostEntry(spot: day.spots[si])))
            } else if line.source == "EXTRA", let entry = day.costItems.first(where: { $0.id == line.key }) {
                directCost = DirectCostTarget(day: di, target: CostEditTarget(kind: .extra(line.key), entry: entry))
            } else if let costDay = response?.days.first(where: { $0.index == di }) { editingDay = costDay }
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
                    .font(.caption).foregroundStyle(Ink.soft)
                    if prep.group.amount(.none) > 0 {
                        Text("결제 상태를 고르지 않은 \(money(prep.group.amount(.none)))은 어느 쪽으로도 세지 않았어요")
                            .font(.caption).foregroundStyle(Ink.warning)
                    }
                }
            } else if response != nil {
                Label("합계는 아직 준비 중이에요. 목록과 입력은 지금도 할 수 있어요.", systemImage: "clock")
                    .font(.caption).foregroundStyle(Ink.warning)
            }
        } footer: {
            Text("가기 전에 내는 돈 — 항공·숙박·렌트 예약과 보험·유심·미리 산 입장권. 실제로 결제한 뒤 결제 완료를 선택해 주세요. 항공은 날짜로 나누지 않고, 숙박·렌터카는 날짜별 비용에도 하루치로 보여요.")
        }
        Section {
            // 추가는 목록 위에 — 긴 목록의 끝까지 내려가지 않게.
            if canEdit, let snapshot {
                Button { editingRevision = snapshot.revision; bookingEditor = .create } label: {
                    Label("결제 항목 추가", systemImage: "plus")
                }
            }
            let rows = paymentRows
            if rows.isEmpty { Text("예약과 미리 낸 비용을 적으면 여기에 모여요").foregroundStyle(Ink.soft) }
            ForEach(rows) { row in paymentRow(row) }
        } header: { Text("결제 항목") } footer: {
            Text("줄을 오른쪽으로 밀어 결제일을 정하거나 결제 완료·결제 예정을 바꿀 수 있어요. 날짜가 지나도 자동으로 완료되지 않아요.")
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
                        .font(.caption).foregroundStyle(Ink.soft)
                    HStack(spacing: Space.xs) {
                        if state != .none { payChip(state) }
                        if row.currencyCode != "KRW", let krw = line?.totalKRW {
                            Text("약 \(money(krw))").font(.caption2).foregroundStyle(Ink.soft)
                        }
                        if !row.photos.isEmpty {
                            Label("\(row.photos.count)", systemImage: "photo").font(.caption2).foregroundStyle(Ink.soft)
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
                Group {
                    // 날짜가 있어도 사용자가 실제 결제 상태를 확인한다.
                    let paid = state == .paid
                    Button {
                        Task { await setPayState(row, paid ? .reserved : .paid) }
                    } label: {
                        Label(paid ? CostPayState.reserved.label : CostPayState.paid.label, systemImage: paid ? "clock" : "checkmark.circle")
                    }
                    .tint(paid ? Ink.warning : Ink.positive)
                }
            }
        }
        .accessibilityHint(canEdit ? "탭하면 고쳐요. 오른쪽으로 밀면 결제일이나 결제 상태를 바꿔요." : "")
    }

    private func payChip(_ state: CostPayState) -> some View {
        Text(state.label)
            .font(.caption2)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background((state == .paid ? Ink.positive : state == .reserved ? Ink.warning : Ink.soft).opacity(0.14), in: Capsule())
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
                            .font(.caption).foregroundStyle(Ink.soft)
                    }
                    if !onSite.paySplit.isEmpty {
                        Text(onSite.paySplit.map { "\($0.state.label) \(money($0.amount))" }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Ink.soft)
                    }
                    if response.transportUnpriced {
                        Text("주유·통행료·대중교통 요금처럼 적지 않은 교통비는 합계에 없어요").font(.caption).foregroundStyle(Ink.soft)
                    }
                    // 날짜별 줄은 웹 일자 카드와 같은 '그날 비용'이다 — 예약 하루치(숙박은 밤마다·렌터카는 빌린 날마다)를 더한다.
                    // 위 합계는 가서 쓰는 돈만이라 둘이 다르다는 것을 여기서 말한다(2026-09-18 "웹은 나오는데 앱만 안 나온다").
                    // 거꾸로 위 합계에만 있는 돈도 있다 — 일정 밖으로 넘친 연박 숙소의 몫은 날짜가 없어 어느 줄에도 없다(2026-10-02).
                    if let note = Self.dayRowsNote(share: Self.bookingShareTotal(response),
                                                   overflow: Self.stayOverflowTotal(response.unallocated),
                                                   dayRows: Self.dayRowsTotal(response)) {
                        Text(note).font(.caption).foregroundStyle(Ink.soft)
                    }
                }
            } else if response != nil {
                Label("합계는 아직 준비 중이에요. 날짜별 입력은 지금도 할 수 있어요.", systemImage: "clock")
                    .font(.caption).foregroundStyle(Ink.warning)
            }
            if canEdit, let today = todayIndex {
                Button { editingRevision = snapshot?.revision ?? 0; quickSpend = QuickSpendTarget(day: today) } label: {
                    Label("오늘 쓴 돈 적기", systemImage: "plus.circle.fill")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .prominentButton()
            }
        } footer: {
            Text("합계는 장소 비용·추가 비용·교통비만 더해요. 날짜별 줄에는 숙박·렌터카 예약의 그날 몫도 더해 보여요(웹 일자 카드와 같아요). 연박 숙소가 일정 밖으로 넘친 밤의 몫은 날짜가 없어 합계에만 들어가요. 예약 전액은 예약 결제 금액에 있어요.")
        }
        Section("날짜별") {
            if let response {
                if response.days.isEmpty { Text("여행 날짜를 추가하면 하루 비용을 볼 수 있어요").foregroundStyle(Ink.soft) }
                ForEach(response.days) { day in dayRow(day, revision: response.revision) }
            } else if let snapshot, error == nil {
                // 합계가 아직 없어도 날짜는 문서가 안다 — 입력까지 막지 않는다.
                ForEach(Array(snapshot.document.days.indices), id: \.self) { index in
                    HStack {
                        Text("Day \(index + 1)")
                        Spacer()
                        if canEdit {
                            Button { editingRevision = snapshot.revision; quickSpend = QuickSpendTarget(day: index) } label: {
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
                                .background(Ink.accent, in: Capsule()).foregroundStyle(Ink.onAccent)
                        }
                        Spacer()
                        // 웹 일자 카드의 "하루 비용"과 같은 값 — 장소·추가 비용·교통 + 예약 하루치.
                        Text(money(day.cost.total)).monospacedDigit()
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(Ink.soft)
                    }
                    if !day.title.isEmpty { Text(day.title).font(.caption).foregroundStyle(Ink.soft) }
                    if let onSite = day.cost.onSiteKRW, day.cost.total - onSite > 0 {
                        Text("현지 \(money(onSite)) · 예약 하루치 \(money(day.cost.total - onSite))")
                            .font(.caption2).foregroundStyle(Ink.soft)
                    }
                    if let count = day.cost.details?.unknownCount, count > 0 {
                        Text("미정·일부 금액 \(count)개").font(.caption).foregroundStyle(Ink.warning)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if canEdit {
                Button { editingRevision = snapshot?.revision ?? 0; quickSpend = QuickSpendTarget(day: day.index) } label: {
                    Image(systemName: "plus.circle").frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Day \(day.index + 1)에 쓴 돈 적기")
            }
        }
    }

    private func money(_ value: Double) -> String { TimeFormat.money(value, currency: "KRW") }

    /// 날짜별 줄에 더해진 예약 하루치의 합 — 그날 비용(`total`)에서 가서 쓰는 돈(`onSiteKRW`)을 뺀 것. 옛 API(`onSiteKRW` 없음)는 0.
    static func bookingShareTotal(_ response: TripCostsResponse) -> Double {
        response.days.reduce(0) { sum, day in
            guard let onSite = day.cost.onSiteKRW else { return sum }
            return sum + max(0, day.cost.total - onSite)
        }
    }

    /// 날짜별 줄의 합 — 줄마다 말하는 그날 비용(`total`)을 그대로 더한다. 현지 결제 금액(`onSite`)에는 일정 밖으로 넘친
    /// 연박 숙소의 몫이 들어 있어(어느 날에도 없다, 2026-10-02) 거기에 예약 하루치를 더하면 날짜별 줄의 합보다 커진다.
    static func dayRowsTotal(_ response: TripCostsResponse) -> Double {
        response.days.reduce(0) { sum, day in sum + day.cost.total }
    }

    /// 일정 밖으로 넘친 연박 숙소의 몫 — 날짜 없는 `STAY` 줄(`unallocated`)의 합. 현지 결제 금액(`onSite`)에는 들어 있지만
    /// 어느 날짜별 줄에도 없다(서버 `stayCostOverflow`, 2026-10-02). 날짜 없는 예약 잔액(`BOOKING`)은 현지 결제가 아니라 세지 않는다.
    static func stayOverflowTotal(_ unallocated: [TripCostLine]) -> Double {
        unallocated.reduce(0) { sum, line in
            line.source == "STAY" && line.dayIndex == nil ? sum + (line.totalKRW ?? 0) : sum
        }
    }

    /// 현지 결제 금액(머리글)과 날짜별 줄이 왜 다른지 한 줄로. 날짜별 줄에만 있는 돈(예약 하루치 `share`)과 머리글에만 있는
    /// 돈(일정 밖 숙박 `overflow`)을 **각자** 말한다 — 한쪽만 보고 숨기면 다른 쪽 차이가 설명 없이 남는다. 둘 다 없으면 nil.
    /// 총예산 한 줄 — 남은 예산(넘으면 넘친 만큼)과 그 근거. 넘친 것을 숨기지 않는다.
    static func budgetLine(_ budget: TripBudgetStatus) -> (title: String, detail: String, over: Bool) {
        let won = { (value: Double) in TimeFormat.money(value, currency: "KRW") }
        let over = budget.remainingKRW < 0
        let title = over ? "예산보다 \(won(-budget.remainingKRW)) 많아요" : "남은 예산 \(won(budget.remainingKRW))"
        let amount = budget.currency == "KRW" ? won(budget.totalKRW)
            : "\(TimeFormat.money(budget.amount, currency: budget.currency)) ≈ \(won(budget.totalKRW))"
        var parts = ["예산 \(amount)", "전체 예상 비용 \(won(budget.costKRW))"]
        if let perDay = budget.perDayKRW { parts.append("하루 평균 약 \(won(perDay))") }
        return (title, parts.joined(separator: " · "), over)
    }

    static func dayRowsNote(share: Double, overflow: Double, dayRows: Double) -> String? {
        let won = { (value: Double) in TimeFormat.money(value, currency: "KRW") }
        var parts: [String] = []
        if share > 0 { parts.append("날짜별 줄은 예약 하루치 \(won(share))를 더한 그날 비용이에요") }
        if overflow > 0 { parts.append("합계에는 일정 밖으로 넘친 숙박 \(won(overflow))이 들어 있어요") }
        guard !parts.isEmpty else { return nil }
        return (parts + ["날짜별 합계 \(won(dayRows))"]).joined(separator: " · ")
    }

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

    /// 시트를 열 때 — 방금 받은 것이 기억에 있으면 그대로 쓴다(Today·Plan과 같은 60초 규칙).
    private func loadIfStale() async {
        if let memory, memory.isFresh(), let remembered = memory.snapshot {
            snapshot = remembered; response = memory.response; error = nil
            return
        }
        await load()
    }

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
        await loadCosts()
    }

    /// 계산만 다시 받는다 — 저장 응답이 이미 최신 문서라 문서를 또 받지 않는다(2026-09-18, 편집 한 번에 GET이 둘 나갔다).
    private func loadCosts() async {
        do {
            let received = try await env.service.tripCosts(tripId: trip.id)
            try Task.checkCancellation()
            guard received.revision == snapshot?.revision else {
                response = nil
                error = "여행 내용이 변경됐어요. 다시 불러와 주세요."; return
            }
            response = received
            error = nil
            memory?.remember(snapshot: snapshot, response: received)
        } catch {
            guard !Task.isCancelled else { return }
            response = nil
            self.error = "합계를 계산하지 못했어요. 목록과 입력은 그대로 할 수 있어요."
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
            if response?.overview == nil { response = nil }
            saving = false
            await loadCosts()   // 문서는 저장 응답이 최신이다 — 계산만 다시 받는다
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

    /// 날짜 편집은 사용자가 확인한 결제 상태를 바꾸지 않는다.
    private func setPaidOn(_ row: PaymentRow, _ iso: String?) async -> Bool {
        await mutate(row, booking: { booking in
            booking.paidOn = iso
        }, item: { item in
            item.paidOn = iso
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

/// 결제(예정)일만 고치는 작은 시트 — 상태는 그대로 둔다.
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
            PaperForm {
                Section {
                    DatePicker("결제일", selection: $date, displayedComponents: .date)
                } header: { Text(row.title) } footer: {
                    Text("날짜가 지나도 자동으로 완료되지 않아요. 실제 결제 상태는 목록이나 편집기에서 직접 선택해 주세요.")
                }
                if row.paidOn != nil {
                    Section {
                        Button("결제일 지우기", role: .destructive) { Task { await save(nil) } }.disabled(saving)
                    } footer: { Text("날짜만 지우고 결제 상태는 그대로 둬요.") }
                }
                if failed { Section { Text("저장하지 못했어요. 다시 시도해 주세요.").foregroundStyle(Ink.warning) } }
            }
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

/// 비용 시트의 기억 — 닫았다 다시 열 때 방금 받은 것을 다시 받지 않기 위해 여행 화면(`TripScreenModels`)이 든다(2026-09-18).
/// 문서와 계산이 **같은 revision으로 함께** 받아졌을 때만 남긴다.
@MainActor
final class TripCostsMemory {
    private(set) var snapshot: TripDocumentSnapshot?
    private(set) var response: TripCostsResponse?
    private(set) var loadedAt: Date?

    init() {}

    func invalidate() { snapshot = nil; response = nil; loadedAt = nil }

    func remember(snapshot: TripDocumentSnapshot?, response: TripCostsResponse) {
        guard let snapshot, snapshot.revision == response.revision else { return }
        self.snapshot = snapshot
        self.response = response
        loadedAt = Date()
    }

    func isFresh(maxAge: TimeInterval = 60, now: Date = Date()) -> Bool {
        guard snapshot != nil, response != nil, let loadedAt else { return false }
        return now.timeIntervalSince(loadedAt) < maxAge
    }
}
