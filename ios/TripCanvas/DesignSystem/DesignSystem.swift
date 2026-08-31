import SwiftUI

/// 앱 전체가 공유하는 간격·타이포·색. 화면마다 숫자를 흩뿌리지 않는다(§37).
enum Space {
    static let xs: CGFloat = 4
    static let s: CGFloat = 8
    static let m: CGFloat = 12
    static let l: CGFloat = 16
    static let xl: CGFloat = 24
}

enum Radius {
    static let card: CGFloat = 16
    static let chip: CGFloat = 999
}

/// 상태를 색으로만 구분하지 않는다 — 항상 문구와 기호가 함께 간다(§47).
enum StatusPalette {
    static func tint(for status: TravelStatus) -> Color {
        switch status {
        case .readyToLeave, .traveling: .orange
        case .delayed: .red
        case .inProgress, .arrived: .blue
        case .completed: .green
        case .noPlan, .upcoming, .unknown: .secondary
        }
    }

    static func label(for status: TravelStatus) -> String {
        switch status {
        case .noPlan: "일정 없음"
        case .upcoming: "여유 있음"
        case .readyToLeave: "지금 나서기 좋아요"
        case .traveling: "이동 중"
        case .arrived: "도착 · 시간 대기"
        case .inProgress: "진행 중"
        case .delayed: "늦어지는 중"
        case .completed: "오늘 일정 완료"
        case .unknown: "상태 확인 필요"
        }
    }

    static func symbol(for status: TravelStatus) -> String {
        switch status {
        case .noPlan: "sparkles"
        case .upcoming: "clock"
        case .readyToLeave: "figure.walk.departure"
        case .traveling: "arrow.triangle.turn.up.right.circle"
        case .arrived: "mappin.circle"
        case .inProgress: "play.circle"
        case .delayed: "exclamationmark.triangle"
        case .completed: "checkmark.circle"
        case .unknown: "questionmark.circle"
        }
    }
}

/// 서버가 주는 '자정부터의 분'을 사람이 읽는 시각으로. 기기 시간대로 환산하지 않는다 —
/// 이 숫자는 이미 여행지 현지 시각이다.
enum TimeFormat {
    static func clock(_ minutes: Int) -> String {
        let wrapped = ((minutes % 1440) + 1440) % 1440
        return String(format: "%02d:%02d", wrapped / 60, wrapped % 60)
    }

    static func duration(_ minutes: Int) -> String {
        let m = max(0, minutes)
        if m < 60 { return "\(m)분" }
        let hours = m / 60
        let rest = m % 60
        return rest == 0 ? "\(hours)시간" : "\(hours)시간 \(rest)분"
    }

    static func money(_ amount: Double, currency: String) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        let number = formatter.string(from: NSNumber(value: amount)) ?? "\(Int(amount))"
        let symbol = ["KRW": "₩", "USD": "$", "EUR": "€", "JPY": "¥", "CNY": "元"][currency]
        return symbol.map { "\($0)\(number)" } ?? "\(number) \(currency)"
    }

    /// "10:32에 받아온 정보예요" 같은 오프라인 표기용.
    static func shortTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
}

struct CardBackground: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(Space.l)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: Radius.card))
    }
}

extension View {
    func card() -> some View { modifier(CardBackground()) }
}

struct StatusChip: View {
    let text: String
    let symbol: String
    var tint: Color = .secondary

    var body: some View {
        Label(text, systemImage: symbol)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, Space.m)
            .padding(.vertical, Space.xs + 2)
            .background(tint.opacity(0.14), in: Capsule())
            .foregroundStyle(tint)
            .accessibilityElement(children: .combine)
    }
}

/// 여행 중에는 장갑 낀 손으로도 눌린다 — 터치 타깃을 충분히 크게(§47).
struct PrimaryActionButton: View {
    let title: String
    var systemImage: String?
    var isBusy: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Space.s) {
                if isBusy { ProgressView().controlSize(.small) }
                else if let systemImage { Image(systemName: systemImage) }
                Text(title)
            }
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: 48)
        }
        .buttonStyle(.borderedProminent)
        .disabled(isBusy)
    }
}

struct SecondaryActionButton: View {
    let title: String
    var systemImage: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Space.s) {
                if let systemImage { Image(systemName: systemImage) }
                Text(title)
            }
            .frame(minHeight: 44)
        }
        .buttonStyle(.bordered)
    }
}

/// 빈 화면을 그냥 두지 않는다 — 무엇을 하면 되는지 한 줄이라도 말한다(§34).
struct EmptyStateView: View {
    let symbol: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: Space.m) {
            Image(systemName: symbol)
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text(title).font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(Space.xl)
        .frame(maxWidth: .infinity)
    }
}

/// API가 실패해도 화면 전체를 못 쓰게 만들지 않는다(§33).
struct InlineErrorBanner: View {
    let message: String
    var detail: String?
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            Label(message, systemImage: "exclamationmark.circle")
                .font(.subheadline.weight(.semibold))
            if let detail {
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            Button("다시 시도", action: retry)
                .font(.caption.weight(.semibold))
        }
        .padding(Space.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: Radius.card))
    }
}
