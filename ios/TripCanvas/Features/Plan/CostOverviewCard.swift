import SwiftUI

/// 금액의 위계와 상태를 한 장에 모은다. 합계·환산·예산 차이는 받은 값만 표시한다.
struct CostOverviewSummary: View {
    let response: TripCostsResponse

    var body: some View {
        VStack(alignment: .leading, spacing: Space.l) {
            HStack {
                Text("여행 전체 예상 비용").font(.subheadline).foregroundStyle(Ink.soft)
                Spacer()
                Image(systemName: "wallet.pass").foregroundStyle(Ink.soft)
            }
            Text(TimeFormat.money(response.totalKRW, currency: "KRW"))
                .font(Typeface.editorial(.largeTitle)).monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("costOverviewTotal")
            if let budget = response.budget {
                let line = TripCostsView.budgetLine(budget)
                VStack(alignment: .leading, spacing: Space.s) {
                    Text(line.title).font(.subheadline.weight(.semibold))
                        .foregroundStyle(line.over ? Ink.danger : Ink.ink)
                    ProgressView(value: min(budget.costKRW, max(1, budget.totalKRW)), total: max(1, budget.totalKRW))
                        .tint(line.over ? Ink.danger : Ink.accent)
                        .accessibilityLabel("예산 대비 예상 비용")
                    Text("총예산 \(TimeFormat.money(budget.amount, currency: budget.currency))")
                        .font(.caption).foregroundStyle(Ink.soft)
                }
            }
            Divider().overlay(Ink.hairline)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Space.xl) { payment(.paid); payment(.reserved); Spacer(minLength: 0) }
                VStack(alignment: .leading, spacing: Space.m) { payment(.paid); payment(.reserved) }
            }
            if (response.payTotals["NONE"] ?? 0) > 0 {
                Text("결제 상태 미구분 \(TimeFormat.money(response.payTotals["NONE"] ?? 0, currency: "KRW"))")
                    .font(.caption).foregroundStyle(Ink.soft)
            }
            if let overview = response.overview, overview.unknownCount > 0 {
                Label("금액 미정·일부 입력 \(overview.unknownCount)건", systemImage: "exclamationmark.circle")
                    .font(.caption).foregroundStyle(Ink.warning)
            }
            if response.transportUnpriced {
                Text("아직 적지 않은 교통비는 합계에 포함되지 않아요.")
                    .font(.caption).foregroundStyle(Ink.soft)
            }
        }
        .padding(Space.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Ink.raised, in: RoundedRectangle(cornerRadius: Radius.panel))
        .overlay(RoundedRectangle(cornerRadius: Radius.panel).strokeBorder(Ink.hairline))
    }

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
