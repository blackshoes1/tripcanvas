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
    static let card: CGFloat = 14
    static let chip: CGFloat = 999
}

/// 종이빛 바탕과 주홍 강조.
///
/// claude.ai/design의 `Mobile trip planning app`에서 가져온 시각 언어다 — 따뜻한 종이 바탕에
/// 잉크빛 글자, 토리이의 붉은색을 강조로 쓴다. **색은 여기 한 곳에만 있다** — 화면이 직접
/// 시스템 색을 부르면 이 팔레트를 우회하게 된다.
///
/// ⚠️ **어두운 모드 값은 디자인에 없어서 여기서 정했다** — 종이와 잉크를 맞바꾸고 강조는
/// 어두운 바탕에서 읽히도록 한 단계 밝혔다. 원안과 다르므로 바꿀 일이 생기면 여기만 고친다.
enum Ink {
    /// 화면 바탕 — 종이
    static let paper = adaptive(light: 0xF4F1EA, dark: 0x16130F)
    /// 바탕 위에 뜬 것 — 카드·행
    static let raised = adaptive(light: 0xFFFFFF, dark: 0x221E19)
    /// 바탕보다 가라앉은 것 — 구분된 영역
    static let sunken = adaptive(light: 0xEDE7DA, dark: 0x100E0B)
    /// 본문 글자
    static let ink = adaptive(light: 0x16130F, dark: 0xF4F1EA)
    /// 덜 중요한 글자
    static let soft = adaptive(light: 0x6E655A, dark: 0xB5AB98)
    /// 라벨·메타 — 가장 흐리다
    static let faint = adaptive(light: 0x9A8F7E, dark: 0x8A8073)
    /// 강조 — 누를 것, 지금 봐야 할 것.
    /// ⚠️ 에셋 카탈로그의 `AccentColor`와 **같은 값이어야 한다** — 그래야 화면 여기저기의
    /// `Color.accentColor`와 기본 컨트롤 색이 이 팔레트와 갈리지 않는다.
    static let accent = Color.accentColor
    /// 카드 테두리 — 그림자 대신 머리카락 선
    static let hairline = adaptive(light: 0x16130F, dark: 0xF4F1EA).opacity(0.08)

    private static func adaptive(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(rgb: dark) : UIColor(rgb: light) })
    }
}

private extension UIColor {
    convenience init(rgb: UInt32) {
        self.init(red: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255,
                  blue: CGFloat(rgb & 0xFF) / 255, alpha: 1)
    }
}

/// 글자에 **역할**을 준다: 재는 것은 모노, 누르는 것은 시스템 폰트.
///
/// ⚠️ **세리프 층은 아직 없다.** 원안(claude.ai/design)은 날짜·장소명을 Instrument Serif로
/// 두지만, **iOS에 한글 글리프가 있는 서체는 Apple SD Gothic Neo 하나뿐이고 그건 고딕이다**
/// (시뮬레이터에서 86개 중 1개를 확인). 세리프를 지정하면 한글은 고딕으로 떨어지고 라틴 문자만
/// 세리프로 남아 한 문장 안에서 서체가 갈린다. 한글 명조를 번들에 넣기 전에는 쓰지 않는다.
///
/// ⚠️ **폰트 파일을 번들에 넣지 않는다.** 시스템 모노(SF Mono)를 쓰면 앱이 무거워지지 않고
/// **Dynamic Type이 그대로 산다** — 글자 크기를 키운 사람에게 고정 크기 폰트는 접근성 문제다.
enum Typeface {
    /// 날짜·장소명처럼 **읽는** 자리. 지금은 크기·굵기로만 무게를 준다(위 주석 참고).
    static func editorial(_ style: Font.TextStyle) -> Font { .system(style).weight(.semibold) }
    /// `OCT 12 · 6 DAYS` 같은 메타 라벨. 대문자·자간은 `.metaLabel()`이 함께 준다.
    static func meta(_ style: Font.TextStyle = .caption2) -> Font {
        .system(style, design: .monospaced).weight(.medium)
    }
}

extension View {
    /// 메타 라벨 한 벌 — 모노 + 대문자 + 자간 + 흐린 색.
    func metaLabel(_ style: Font.TextStyle = .caption2) -> some View {
        font(Typeface.meta(style))
            .textCase(.uppercase)
            .tracking(1.2)
            .foregroundStyle(Ink.faint)
    }

    /// 종이 바탕을 깐다. List·Form은 자기 배경을 그리므로 그것부터 걷어야 한다.
    func paperGround() -> some View {
        scrollContentBackground(.hidden).background(Ink.paper)
    }
}

/// 상태를 색으로만 구분하지 않는다 — 항상 문구와 기호가 함께 간다(§47).
enum StatusPalette {
    static func tint(for status: TravelStatus) -> Color {
        switch status {
        case .readyToLeave, .traveling: Ink.accent
        case .delayed: Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(rgb: 0xEF7A6A) : UIColor(rgb: 0xB4342A) })
        case .inProgress, .arrived: Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(rgb: 0x7FA9BC) : UIColor(rgb: 0x2E5C6E) })
        case .completed: Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(rgb: 0x8FA894) : UIColor(rgb: 0x4A5D4E) })
        case .noPlan, .upcoming, .unknown: Ink.faint
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

    /// 자정을 넘는 시각. `clock()`은 1440으로 감싸서 `25:10`을 `01:10`으로 만드는데,
    /// 그것만 보면 **오늘 새벽**으로 읽힌다. 넘어간 날을 함께 말한다.
    static func clockAcrossMidnight(_ minutes: Int) -> String {
        let days = Int(floor(Double(minutes) / 1440.0))
        guard days > 0 else { return clock(minutes) }
        return days == 1 ? "\(clock(minutes)) (익일)" : "\(clock(minutes)) (+\(days)일)"
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

    /// 일자 칩의 "10/2 (금)". 서버가 준 `YYYY-MM-DD`를 **그대로 읽기만** 한다 —
    /// 날짜를 여기서 만들지 않는다(어느 날인지는 서버가 정한다).
    /// 날짜가 없는 여행(`""`)이면 nil이라 칩에서 그 줄이 빠진다.
    static func dayChipLabel(_ iso: String) -> String? {
        let parts = iso.split(separator: "-")
        guard parts.count == 3, let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]) else {
            return nil
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .gmt
        guard let date = calendar.date(from: DateComponents(year: year, month: month, day: day)) else { return nil }
        let weekday = ["일", "월", "화", "수", "목", "금", "토"][calendar.component(.weekday, from: date) - 1]
        return "\(month)/\(day) (\(weekday))"
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
            .background(Ink.raised, in: RoundedRectangle(cornerRadius: Radius.card))
            .overlay(RoundedRectangle(cornerRadius: Radius.card).strokeBorder(Ink.hairline))
    }
}

extension View {
    func card() -> some View { modifier(CardBackground()) }
}

struct StatusChip: View {
    let text: String
    let symbol: String
    var tint: Color = Ink.faint

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
        .tint(Ink.ink)
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
                .foregroundStyle(Ink.faint)
            Text(title).font(Typeface.editorial(.title2)).foregroundStyle(Ink.ink)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Ink.soft)
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
                Text(detail).font(.caption).foregroundStyle(Ink.soft)
            }
            Button("다시 시도", action: retry)
                .font(.caption.weight(.semibold))
                .tint(Ink.accent)
        }
        .padding(Space.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Ink.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: Radius.card))
        .overlay(RoundedRectangle(cornerRadius: Radius.card).strokeBorder(Ink.accent.opacity(0.22)))
    }
}
