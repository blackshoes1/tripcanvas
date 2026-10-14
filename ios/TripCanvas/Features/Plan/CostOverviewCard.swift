import SwiftUI

/// 숫자는 서버가 정하고, 기본 화면은 내역 확인에 필요한 핵심 정보부터 보여 준다.
struct CostOverviewSummary: View {
    let response: TripCostsResponse
    var onReviewUnknown: (() -> Void)? = nil
    var onEditBudget: (() -> Void)? = nil
    @State private var expanded = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            Text(typeSize.isAccessibilitySize ? "전체 예상 비용" : "여행 전체 예상 비용")
                .font(.subheadline).foregroundStyle(Ink.soft)
            Text(TimeFormat.money(response.totalKRW, currency: "KRW"))
                .font(Typeface.editorial(.title)).monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("costOverviewTotal")
            if let budget = response.budget {
                let line = TripCostsView.budgetLine(budget)
                Text(line.title).font(.subheadline.weight(.semibold))
                    .foregroundStyle(line.over ? Ink.danger : Ink.ink)
                if incomplete {
                    Text(typeSize.isAccessibilitySize ? "미정 비용 제외" : "확인된 금액 기준 · 미정 비용 제외")
                        .font(.caption).foregroundStyle(Ink.warning)
                        .accessibilityLabel("확인된 금액 기준이에요. 미정 비용은 제외돼 있어요.")
                }
            }
            if let overview = response.overview, overview.unknownCount > 0 {
                if let onReviewUnknown {
                    Button(action: onReviewUnknown) {
                        Label(typeSize.isAccessibilitySize ? "미정·일부 \(overview.unknownCount)건" : "미정·일부 금액 \(overview.unknownCount)건 확인", systemImage: "exclamationmark.circle")
                            .font(.subheadline).frame(minHeight: 44)
                    }.accessibilityIdentifier("reviewUnknownCosts")
                        .accessibilityLabel("미정·일부 금액 \(overview.unknownCount)건 확인")
                } else {
                    Text("미정·일부 금액 \(overview.unknownCount)건").font(.caption).foregroundStyle(Ink.warning)
                }
            }
            if let onEditBudget {
                Button(response.budget == nil ? "예산 정하기" : "예산 고치기", action: onEditBudget)
                    .font(.subheadline).frame(minHeight: 44).accessibilityIdentifier("editTripBudget")
            }
            DisclosureGroup("결제·환산 상세", isExpanded: $expanded) {
                VStack(alignment: .leading, spacing: Space.m) {
                    if let budget = response.budget {
                        ProgressView(value: min(budget.costKRW, max(1, budget.totalKRW)), total: max(1, budget.totalKRW))
                            .tint(budget.remainingKRW < 0 ? Ink.danger : Ink.accent)
                            .accessibilityLabel("예산 대비 예상 비용")
                        Text("총예산 \(TimeFormat.money(budget.amount, currency: budget.currency))")
                            .font(.caption).foregroundStyle(Ink.soft)
                    }
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: Space.xl) { payment(.paid); payment(.reserved); Spacer(minLength: 0) }
                        VStack(alignment: .leading, spacing: Space.m) { payment(.paid); payment(.reserved) }
                    }
                    if (response.payTotals["NONE"] ?? 0) > 0 {
                        Text("결제 상태 미구분 \(TimeFormat.money(response.payTotals["NONE"] ?? 0, currency: "KRW"))")
                            .font(.caption).foregroundStyle(Ink.soft)
                    }
                    if response.transportUnpriced {
                        Text("아직 적지 않은 교통비는 합계에 포함되지 않아요.")
                            .font(.caption).foregroundStyle(Ink.soft)
                    }
                    if response.hasForeignCurrency {
                        Text(TripCostsView.fxNote(source: response.fxSource, asOf: response.fxAsOf))
                            .font(.caption).foregroundStyle(Ink.soft)
                    }
                }.padding(.top, Space.s)
            }
            .font(.subheadline).accessibilityIdentifier("costSummaryDetails")
        }
        .padding(Space.l).frame(maxWidth: .infinity, alignment: .leading)
        .background(Ink.raised, in: RoundedRectangle(cornerRadius: Radius.panel))
        .overlay(RoundedRectangle(cornerRadius: Radius.panel).strokeBorder(Ink.hairline))
        .tint(Ink.accent)
    }

    private var incomplete: Bool { (response.overview?.unknownCount ?? response.unknownCount) > 0 || response.transportUnpriced }
    private func payment(_ state: CostPayState) -> some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Label(state.label, systemImage: state == .paid ? "checkmark.circle" : "clock")
                .font(.caption).foregroundStyle(state == .paid ? Ink.positive : Ink.warning)
            Text(TimeFormat.money(response.payTotals[state.rawValue] ?? 0, currency: "KRW"))
                .font(.subheadline.weight(.semibold)).monospacedDigit().foregroundStyle(Ink.ink)
        }
    }
}

struct CostOverviewRow: View {
    let item: TripCostOverviewItem
    @Environment(\.dynamicTypeSize) private var typeSize
    private var line: TripCostLine { item.line }
    private var kind: CostCategory { CostCategory(rawValue: line.kind) ?? .other }

    var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: Space.m) { identity; amount }
            } else {
                HStack(alignment: .top, spacing: Space.m) {
                    identity
                    Spacer(minLength: Space.s)
                    amount
                }
            }
        }
        .padding(Space.l).frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
        .background(Ink.raised, in: RoundedRectangle(cornerRadius: Radius.card))
        .overlay(RoundedRectangle(cornerRadius: Radius.card).strokeBorder(Ink.hairline))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("costItem-\(item.id)")
    }

    private var identity: some View {
        HStack(alignment: .top, spacing: Space.m) {
            Image(systemName: kind.symbol).font(.body)
                .foregroundStyle(Ink.soft).frame(width: 36, height: 36)
                .background(Ink.sunken, in: RoundedRectangle(cornerRadius: Radius.control))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Space.xs) {
                Text(line.title).font(.body.weight(.semibold)).foregroundStyle(Ink.ink)
                    .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                Text([kind.label, period].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(Ink.soft)
                if line.payState != .none {
                    Text(line.payState.label).font(.caption2.weight(.medium))
                        .foregroundStyle(line.payState == .paid ? Ink.positive : Ink.warning)
                }
                if let reservationLabel {
                    Label(reservationLabel, systemImage: item.reservation == "LINKED" ? "link" : "ticket")
                        .font(.caption2).foregroundStyle(Ink.info)
                }
                if item.amountSource == "PLACE", item.bookingId != nil {
                    Text("장소에 입력한 금액").font(.caption2).foregroundStyle(Ink.soft)
                }
            }
        }
    }

    private var amount: some View {
        VStack(alignment: typeSize.isAccessibilitySize ? .leading : .trailing, spacing: Space.xs) {
            Text(Self.amountLabel(line)).font(.body.weight(.semibold)).monospacedDigit()
                .foregroundStyle(line.state == "UNKNOWN" ? Ink.soft : Ink.ink)
                .fixedSize(horizontal: false, vertical: true)
            if line.state == "PARTIAL" { Text("일부 금액").font(.caption2).foregroundStyle(Ink.warning) }
            if line.basis == .perPerson { Text("1인 금액 · \(line.people)명").font(.caption2).foregroundStyle(Ink.soft) }
            if let total = line.totalKRW, line.currency != "KRW" || line.basis == .perPerson {
                Text("합계 \(TimeFormat.money(total, currency: "KRW"))").font(.caption2).foregroundStyle(Ink.soft)
            }
            if item.amountSource == "ESTIMATE" { Text("추정").font(.caption2).foregroundStyle(Ink.soft) }
        }
        .multilineTextAlignment(typeSize.isAccessibilitySize ? .leading : .trailing)
    }

    static func amountLabel(_ line: TripCostLine) -> String {
        if line.state == "FREE" { return "무료" }
        guard line.state != "UNKNOWN", let amount = line.amount else { return "금액 미정" }
        return TimeFormat.money(amount, currency: line.currency)
    }

    private var period: String {
        [item.date, item.end].compactMap { $0 }.map { TimeFormat.dayChipLabel($0) ?? $0 }.joined(separator: "–")
    }
    private var reservationLabel: String? {
        switch item.reservation { case "LINKED": "예약 연결"; case "BOOKED": "예약 완료"; case "INFO": "예약 정보"; default: nil }
    }
}
