import SwiftUI

/// 일정을 자동으로 바꾸지 않는다(§18). 무엇이 어떻게 달라지는지 먼저 보여주고 사용자가 정한다.
struct ReplanCard: View {
    let suggestion: TripSuggestion
    let preview: ReplanPreview
    let isBusy: Bool
    let onApply: () -> Void
    let onKeep: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            Label("일정 조정 제안", systemImage: "arrow.triangle.branch")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.orange)

            Text(headline).font(.headline)

            if !preview.feasible {
                Text("일정을 줄여도 예약 시간을 맞추기 어려워요 — 예약을 옮기는 편이 나을 수 있어요.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: Space.s) {
                ComparisonRow(label: "기존", names: preview.before, muted: true)
                ComparisonRow(label: "제안", names: preview.after, muted: false)
            }
            .padding(Space.m)
            .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: Radius.card - 4))

            if !preview.dropNames.isEmpty {
                Text(dropNote)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: Space.s) {
                PrimaryActionButton(title: "이대로 조정", systemImage: "checkmark", isBusy: isBusy, action: onApply)
                SecondaryActionButton(title: "그대로 두기", action: onKeep)
            }
        }
        .card()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("일정 조정 제안. \(headline)")
    }

    private var headline: String {
        preview.lateMinutes > 0
            ? "\(TimeFormat.duration(preview.lateMinutes)) 늦어지고 있어요"
            : suggestion.title
    }

    private var dropNote: String {
        let names = preview.dropNames.joined(separator: ", ")
        return preview.movesToNextDay
            ? "\(names)은(는) 다음 날 앞쪽으로 옮겨요. 예약된 일정은 그대로 둡니다."
            : "\(names)은(는) '건너뜀'으로 표시돼요. 예약된 일정은 그대로 둡니다."
    }
}

private struct ComparisonRow: View {
    let label: String
    let names: [String]
    let muted: Bool

    var body: some View {
        HStack(alignment: .top, spacing: Space.s) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 32, alignment: .leading)
            Text(names.isEmpty ? "없음" : names.joined(separator: " → "))
                .font(.caption)
                .foregroundStyle(muted ? .secondary : .primary)
                .strikethrough(muted)
        }
        .accessibilityElement(children: .combine)
    }
}
