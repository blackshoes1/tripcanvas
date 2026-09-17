import SwiftUI

struct TripCostsView: View {
    let trip: TripSummary
    @Environment(AppEnvironment.self) private var env
    @State private var response: TripCostsResponse?
    @State private var snapshot: TripDocumentSnapshot?
    @State private var loading = false
    @State private var saving = false
    @State private var error: String?
    @State private var editingDay: TripCostDay?
    @State private var editingRevision = 0

    var body: some View {
        List {
            if loading && response == nil { ProgressView("비용을 확인하는 중…") }
            if let error {
                Section {
                    Text(error).foregroundStyle(.orange)
                    Button("다시 불러오기") { Task { await load() } }.disabled(loading || saving)
                }
            }
            if let response {
                Section {
                    VStack(alignment: .leading, spacing: Space.s) {
                        Text("여행 전체 예상 비용").font(.subheadline)
                        Text(money(response.totalKRW)).font(.title.bold())
                        if let average = response.averagePerDayKRW {
                            Text("하루 평균 \(money(average)) · \(response.days.count)일 기준").font(.subheadline)
                        }
                        Text("입력된 금액과 교통비 추정 기준 · 최종 결제 금액이 아닙니다").font(.caption).foregroundStyle(.secondary)
                        if response.unknownCount > 0 {
                            Text("미정·일부 금액 \(response.unknownCount)개 · 비용이 더 늘어날 수 있어요").font(.caption).foregroundStyle(.orange)
                        }
                        if response.transportUnpriced {
                            Text("아직 계산되지 않은 교통비는 포함되지 않았어요").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                Section("날짜별 비용") {
                    if response.days.isEmpty { Text("여행 날짜를 추가하면 하루 비용을 볼 수 있어요").foregroundStyle(.secondary) }
                    ForEach(response.days) { day in
                        Button {
                            editingRevision = response.revision; editingDay = day
                        } label: {
                            VStack(alignment: .leading, spacing: Space.xs) {
                                HStack {
                                    Text("Day \(day.index + 1) · \(day.date.isEmpty ? "날짜 미정" : day.date)")
                                    Spacer()
                                    Text(money(day.cost.total)).monospacedDigit()
                                    Image(systemName: "chevron.right").font(.caption)
                                }
                                if !day.title.isEmpty { Text(day.title).font(.caption).foregroundStyle(.secondary) }
                                // 그날 얼마를 이미 냈고 얼마가 예약으로 남아 있는지 — 합계 하나로는 안 보인다
                                if !day.cost.paySplit.isEmpty {
                                    Text(day.cost.paySplit.map { "\($0.state.label) \(money($0.amount))" }.joined(separator: " · "))
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                if let count = day.cost.details?.unknownCount, count > 0 {
                                    Text("미정·일부 금액 \(count)개").font(.caption).foregroundStyle(.orange)
                                }
                            }
                        }.buttonStyle(.plain)
                    }
                }
                Section {
                    ForEach(payRows(response), id: \.0) { row in
                        HStack { Text(row.0); Spacer(); Text(money(row.1)).monospacedDigit() }
                    }
                } header: { Text("예약·결제") } footer: {
                    Text("예약해 두고 아직 내지 않은 돈과 이미 낸 돈을 나눠 봅니다. 상태를 고르지 않은 비용은 미구분으로 남습니다.")
                }
                Section("카테고리별 비용") {
                    ForEach(response.categories) { category in
                        DisclosureGroup {
                            if category.items.isEmpty { Text("입력된 비용이 없어요").font(.caption).foregroundStyle(.secondary) }
                            ForEach(category.items) { item in costRow(item) }
                        } label: {
                            HStack {
                                Text(CostCategory(rawValue: category.kind)?.label ?? "기타")
                                Spacer()
                                Text(money(category.totalKRW)).monospacedDigit()
                            }
                        }
                    }
                }
                if !response.unallocated.isEmpty {
                    Section {
                        ForEach(response.unallocated) { item in costRow(item) }
                    } header: { Text("날짜에 배분되지 않은 예약 비용") } footer: {
                        Text("날짜가 없거나 여행 기간 밖에 해당하는 예약 금액입니다. 전체·카테고리 합계에는 포함되며, 날짜별 합계에는 포함되지 않아요. 예약 메뉴에서 날짜와 금액을 수정할 수 있어요.")
                    }
                }
                if response.hasForeignCurrency {
                    Section("원화 환산 기준") {
                        Text("기본 참고 환율 · 실시간 시세 아님 · 시세 기준일 없음").font(.caption)
                        ForEach(response.fxRates.keys.filter { $0 != "KRW" }.sorted(), id: \.self) { currency in
                            Text("1 \(currency) ≈ \(MoneyInput.text(amount: response.fxRates[currency]))원").font(.caption)
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
    }

    private func money(_ value: Double) -> String { TimeFormat.money(value, currency: "KRW") }

    /// 값이 있는 상태만, 표시 순서대로. 전부 0이면 줄을 짓지 않는다.
    private func payRows(_ response: TripCostsResponse) -> [(String, Double)] {
        [CostPayState.reserved, .paid, .none].compactMap { state in
            let amount = response.payTotals[state.rawValue] ?? 0
            return amount > 0 ? (state.label, amount) : nil
        }
    }

    private func costRow(_ item: TripCostLine) -> some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Text(item.title)
            if let amount = item.amount {
                Text("\(TimeFormat.money(amount, currency: item.currency))\(item.basis == .perPerson ? " × \(item.people)명" : "")")
                if item.currency != "KRW", let total = item.totalKRW { Text("원화 환산 약 \(money(total))").font(.caption) }
            } else { Text("비용 미정").foregroundStyle(.secondary) }
            if item.state == "PARTIAL" { Text("일부 금액만 확인").font(.caption).foregroundStyle(.orange) }
            Text(item.dayIndex.map { "Day \($0 + 1)" } ?? "날짜 미배분").font(.caption).foregroundStyle(.secondary)
            if item.source == "TRANSPORT" { Text("자동 교통비 추정").font(.caption).foregroundStyle(.secondary) }
        }.padding(.vertical, Space.xs)
    }

    private func load() async {
        guard !loading, !saving else { return }
        loading = true
        defer { loading = false }
        do {
            async let costs = env.service.tripCosts(tripId: trip.id)
            async let document = env.service.document(tripId: trip.id)
            let (received, fresh) = try await (costs, document)
            try Task.checkCancellation()
            guard received.revision == fresh.revision else {
                response = nil
                error = "여행 내용이 변경됐어요. 다시 불러와 주세요."; return
            }
            response = received; snapshot = fresh; error = nil
        } catch {
            guard !Task.isCancelled else { return }
            response = nil
            self.error = "비용을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요."
        }
    }

    private func save(_ day: TripDay, index: Int) async -> Bool {
        guard !saving, !loading, let snapshot, snapshot.canEdit,
              snapshot.revision == editingRevision, snapshot.document.hasDay(index) else { return false }
        saving = true
        var draft = snapshot.document
        var days = draft.days
        days[index] = day; draft.days = days
        do {
            let saved = try await env.service.saveDocument(tripId: trip.id, document: draft, expectedRevision: editingRevision)
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
}
