import SwiftUI

/// 제안 카드 — 이유 없이 결과만 내밀지 않는다(§15). 최소한 왜 이걸 권하는지 한두 줄이 함께 간다.
/// 점수 같은 내부 값은 절대 보여주지 않는다.
struct SuggestionCard: View {
    let suggestion: TripSuggestion
    let isBusy: Bool
    let onAccept: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            HStack(spacing: Space.s) {
                // **From J는 앱 이름이 아니라 J가 보내는 제안의 서명이다** — 앱은 With J고,
                // 이 서명이 붙은 것만 제안이다(일정 표시·오류 안내에는 붙지 않는다).
                Text("From J")
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, Space.s).padding(.vertical, 2)
                    .background(kicker.tint.opacity(0.15), in: Capsule())
                    .foregroundStyle(kicker.tint)
                Image(systemName: kicker.symbol).foregroundStyle(kicker.tint)
                Text(kicker.text)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
            }

            Text(suggestion.title).font(.headline)

            if !suggestion.description.isEmpty {
                Text(suggestion.description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            if !suggestion.reasons.isEmpty {
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text("왜 이곳인가요?")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    ForEach(Array(suggestion.reasons.prefix(3).enumerated()), id: \.offset) { _, reason in
                        Label(reason, systemImage: "circle.fill")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .labelStyle(BulletLabelStyle())
                    }
                }
            }

            if let saving = suggestion.impact.costChange, saving < 0 {
                StatusChip(text: "\(TimeFormat.money(-saving, currency: "KRW")) 절약 가능", symbol: "tag.fill", tint: .green)
            }

            HStack(spacing: Space.s) {
                if suggestion.acceptable {
                    PrimaryActionButton(title: acceptTitle, systemImage: "plus", isBusy: isBusy, action: onAccept)
                }
                SecondaryActionButton(title: "이번엔 건너뛰기", action: onDismiss)
            }
        }
        .card()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("From J \(kicker.text) 제안: \(suggestion.title)")
    }

    private var acceptTitle: String {
        switch suggestion.action.kind {
        case .moveToToday: "오늘 일정에 추가"
        case .rest, .returnToHotel: "그렇게 할게요"
        case .replan: "이대로 조정"
        default: "추가하기"
        }
    }

    private var kicker: (text: String, symbol: String, tint: Color) {
        switch suggestion.type {
        case .rest: ("쉬어도 괜찮아요", "cup.and.saucer", .secondary)
        case .priceSaving: ("예약 다시 보기", "tag", .green)
        case .replan: ("일정 조정", "arrow.triangle.branch", .orange)
        case .nextActivity, .unknown: ("지금 한 곳 더 들를 수 있어요", "sparkles", .blue)
        }
    }
}

/// Label 기본 아이콘이 너무 커서 불릿처럼 보이게 줄인다.
struct BulletLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Space.s) {
            configuration.icon.font(.system(size: 4))
            configuration.title
        }
    }
}
