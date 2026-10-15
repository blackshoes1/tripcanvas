import SwiftUI

/// 저장된 문서로 두 이름을 표시하고, 범위는 서버가 확인한 값만 표시한다.
struct SpotChoiceSummaryView: View {
    let spot: TripSpot
    let summary: DayPlanSpotChoice?

    var body: some View {
        if let choice = spot.choice {
            VStack(alignment: .leading, spacing: Space.xs) {
                Label(choice.state == .pending ? "미정 · \(spot.name) / \(choice.alternative.name)" : "선택한 곳 · \(spot.name)",
                      systemImage: choice.state == .pending ? "arrow.triangle.branch" : "checkmark.circle")
                    .font(.caption.weight(.semibold)).foregroundStyle(Ink.accent)
                if choice.state == .pending {
                    if let at = choice.decideBy, !at.isEmpty {
                        Text("이날 \(at)까지 결정 · 여행지 시각").font(.caption).foregroundStyle(Ink.warning)
                    }
                    if let summary {
                        Text(Self.rangeLine(summary)).font(.caption).foregroundStyle(Ink.soft)
                    }
                    if choice.alternative.bookedAt != nil || choice.alternative.needsReservation {
                        Text("다른 선택지의 예약·입장 정보도 확인해 주세요.").font(.caption).foregroundStyle(Ink.warning)
                    }
                }
            }
        }
    }

    static func rangeLine(_ summary: DayPlanSpotChoice) -> String {
        let stay = summary.stayMinutes.map { range in
            range.min == range.max ? "체류 \(range.min)분" : "체류 \(range.min)~\(range.max)분"
        } ?? "체류 시간 미정"
        let cost = summary.cost.map { range in
            let lower = TimeFormat.money(range.min, currency: range.currency)
            return range.min == range.max ? "입력 비용 \(lower)" : "입력 비용 \(lower)~\(TimeFormat.money(range.max, currency: range.currency))"
        } ?? "비용은 각 선택지에서 확인"
        return "\(stay) · \(cost)"
    }
}

struct SpotChoiceTotalsNotice: View {
    var body: some View {
        Label("아직 고르지 않은 곳이 있어요. 이동·시간·하루 비용은 현재 표시된 장소 기준이며, 다른 곳을 고르면 다시 계산해요.",
              systemImage: "arrow.triangle.branch")
            .font(.caption).foregroundStyle(Ink.soft)
    }
}
