import SwiftUI

/// 제안 카드 — 이유 없이 결과만 내밀지 않는다(§15). 최소한 왜 이걸 권하는지 한두 줄이 함께 간다.
/// 점수 같은 내부 값은 절대 보여주지 않는다.
struct SuggestionCard: View {
    let suggestion: TripSuggestion
    let isBusy: Bool
    /// 제안이 가리키는 일정(들를 곳·숙소)이 있으면 그 자리. 수락할 수 없는 제안에도 **할 수 있는 일**을 둔다 —
    /// 예전에는 대부분의 카드에 '이번엔 건너뛰기'만 있었다(2026-09-27 UX 검토, 웹의 지도·다녀왔어요와 같게).
    var target: ActivitySummary? = nil
    var onComplete: (() -> Void)? = nil
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
                    .foregroundStyle(Ink.soft)
                Spacer()
            }

            Text(suggestion.title)
                .font(Typeface.editorial(.title3))
                .foregroundStyle(Ink.ink)
                .fixedSize(horizontal: false, vertical: true)

            if !suggestion.description.isEmpty {
                Text(suggestion.description)
                    .font(.subheadline)
                    .foregroundStyle(Ink.soft)
            }

            if !suggestion.reasons.isEmpty {
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text(suggestion.type == .rest ? "왜 지금인가요?" : "왜 이곳인가요?")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Ink.soft)
                    ForEach(Array(suggestion.reasons.prefix(3).enumerated()), id: \.offset) { _, reason in
                        Label(reason, systemImage: "circle.fill")
                            .font(.caption)
                            .foregroundStyle(Ink.soft)
                            .labelStyle(BulletLabelStyle())
                    }
                }
            }

            if let saving = suggestion.impact.costChange, saving < 0 {
                StatusChip(text: "\(TimeFormat.money(-saving, currency: "KRW")) 절약 가능", symbol: "tag.fill", tint: Ink.positive)
            }

            // 꽉 찬 버튼은 쓰지 않는다 — 화면의 주 버튼은 '다음 일정'의 것 하나다. 제안은 옅은 버튼으로 권한다.
            // 한 줄에 안 들어가면(버튼 셋·큰 글자) 빠져나가는 길을 아랫줄로 내린다 — 글자가 두 줄로 부서지지 않게.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Space.s) { actions; dismiss }
                VStack(alignment: .leading, spacing: Space.xs) {
                    HStack(spacing: Space.s) { actions }
                    dismiss
                }
            }
        }
        .card()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("From J \(kicker.text) 제안: \(suggestion.title)")
    }

    @ViewBuilder
    private var actions: some View {
        if suggestion.acceptable {
            TonalActionButton(title: acceptTitle, systemImage: "plus", isBusy: isBusy, action: onAccept)
        } else if let target, let location = target.location,
                  [.visitPlace, .checkIn, .returnToHotel].contains(suggestion.action.kind) {
            TonalActionButton(title: "길찾기", systemImage: "arrow.triangle.turn.up.right.diamond") {
                MapLauncher.open(location: location, name: target.name)
            }
        }
        if !suggestion.acceptable, let onComplete, [.visitPlace, .checkIn].contains(suggestion.action.kind) {
            TonalActionButton(title: "다녀왔어요", systemImage: "checkmark", isBusy: isBusy, action: onComplete)
        }
    }

    /// 빠져나갈 길은 언제나 있다 — J는 대신 결정하지 않는다.
    private var dismiss: some View {
        QuietActionButton(title: "이번엔 건너뛰기", action: onDismiss)
    }

    private var acceptTitle: String {
        switch suggestion.action.kind {
        case .moveToToday: "오늘 일정에 넣기"
        case .rest, .returnToHotel: "그렇게 할게요"
        case .replan: "이대로 조정"
        default: "추가하기"
        }
    }

    private var kicker: (text: String, symbol: String, tint: Color) {
        switch suggestion.type {
        case .rest: ("쉬어도 괜찮아요", "cup.and.saucer", Ink.soft)
        case .priceSaving: ("예약 다시 보기", "tag", Ink.positive)
        case .replan: ("일정 조정 제안", "arrow.triangle.branch", Ink.warning)
        case .nextActivity, .unknown: ("지금 한 곳 더 들를 수 있어요", "sparkles", Ink.info)
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
