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

/// 따뜻한 종이 바탕·잉크·올리브 강조. 밝은 모드와 어두운 모드를 함께 정의한다.
enum Ink {
    /// 화면 바탕 — 종이
    static let paper = adaptive(light: 0xF7F5EF, dark: 0x16130F)
    /// 바탕 위에 뜬 것 — 카드·행
    static let raised = adaptive(light: 0xFFFFFF, dark: 0x221E19)
    /// 바탕보다 가라앉은 것 — 구분된 영역
    static let sunken = adaptive(light: 0xEDE7DA, dark: 0x100E0B)
    /// 본문 글자
    static let ink = adaptive(light: 0x16130F, dark: 0xF7F5EF)
    /// 덜 중요한 글자
    static let soft = adaptive(light: 0x6E655A, dark: 0xB5AB98)
    /// 라벨·메타 — 가장 흐리다
    static let faint = adaptive(light: 0x766F62, dark: 0x8A8073)
    /// 강조 — 누를 것, 지금 봐야 할 것. **올리브**(2026-09-20 승인 시안).
    /// ⚠️ 에셋 카탈로그의 `AccentColor`와 **같은 값이어야 한다** — 그래야 화면 여기저기의
    /// `Color.accentColor`와 기본 컨트롤 색이 이 팔레트와 갈리지 않는다.
    /// ⚠️ 웹도 같은 값이다(`style.css`의 `--primary`) — 한쪽만 바꾸면 기기마다 다른 색으로
    ///    '누를 것'을 말하게 된다.
    static let accent = Color.accentColor
    /// 카드 테두리 — 그림자 대신 머리카락 선
    static let hairline = adaptive(light: 0x16130F, dark: 0xF7F5EF).opacity(0.08)

    private static func adaptive(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(rgb: dark) : UIColor(rgb: light) })
    }
}

/// **뜻이 있는 색** — 강조(`accent`)는 누를 것·고른 것이고, 아래는 상태다. 화면이 `.orange`·`.red`를 직접 부르면
/// 기능마다 다른 색이 생긴다(2026-09-18 정리). 색만으로 말하지 않는다 — 문구·기호가 늘 함께 간다(§47).
extension Ink {
    /// 주의 — 시간 관련 경고 · 비용 미정 · 확인이 필요한 것
    static let warning = adaptive(light: 0xB8650F, dark: 0xF0A050)
    /// 오류 · 삭제 · 예산 초과 · 취소
    static let danger = adaptive(light: 0xB4342A, dark: 0xEF7A6A)
    /// 완료 · 결제 완료
    static let positive = adaptive(light: 0x3E7A4C, dark: 0x8FC79B)
    /// 정보 — 상대가 정한 것(예약된 일정)
    static let info = adaptive(light: 0x2E5C6E, dark: 0x7FA9BC)
}

private extension UIColor {
    convenience init(rgb: UInt32) {
        self.init(red: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255,
                  blue: CGFloat(rgb & 0xFF) / 255, alpha: 1)
    }
}

/// 제목은 번들 나눔명조, 조작·본문은 시스템 글꼴. 모두 Dynamic Type을 따른다.
enum Typeface {
    static func editorial(_ style: Font.TextStyle) -> Font {
        let size: CGFloat
        switch style {
        case .largeTitle: size = 34
        case .title: size = 28
        case .title2: size = 24
        case .title3: size = 20
        default: size = 17
        }
        return .custom("NanumMyeongjo", size: size, relativeTo: style)
    }
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
        case .noPlan, .upcoming, .unknown: Ink.soft
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
        formatter.maximumFractionDigits = ["USD", "EUR", "CNY"].contains(currency) ? 2 : 0
        let number = formatter.string(from: NSNumber(value: amount)) ?? "\(Int(amount))"
        let symbol = ["KRW": "₩", "USD": "$", "EUR": "€", "JPY": "¥", "CNY": "元"][currency]
        return symbol.map { "\($0)\(number)" } ?? "\(number) \(currency)"
    }

    /// 일자 칩의 "10/2 (금)". 서버가 준 `YYYY-MM-DD`를 **그대로 읽기만** 한다 —
    /// 날짜를 여기서 만들지 않는다(어느 날인지는 서버가 정한다).
    /// 날짜가 없는 여행(`""`)이면 nil이라 칩에서 그 줄이 빠진다.
    /// 날짜 칩 아랫줄 `10.25 일`. **고른 날과 안 고른 날이 같은 모양이다** —
    /// 달라지면 칩 높이가 오가며 스트립이 흔들린다(승인 시안).
    static func dayChipDate(_ iso: String) -> String? {
        let parts = iso.split(separator: "-")
        guard parts.count == 3, let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]) else {
            return nil
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .gmt
        guard let date = calendar.date(from: DateComponents(year: year, month: month, day: day)) else { return nil }
        let weekday = ["일", "월", "화", "수", "목", "금", "토"][calendar.component(.weekday, from: date) - 1]
        return String(format: "%d.%02d %@", month, day, weekday)
    }

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

    /// 고르지 않은 날의 칩 "10/26" — 요일은 고른 날에서만 말한다(정보량을 줄인다). 날짜가 없으면 nil.
    static func dayChipShort(_ iso: String) -> String? {
        let parts = iso.split(separator: "-")
        guard parts.count == 3, Int(parts[0]) != nil, let month = Int(parts[1]), let day = Int(parts[2]) else { return nil }
        return "\(month)/\(day)"
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
    var tint: Color = Ink.soft

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

/// 날짜 한 칸 — **숫자로 쳐도 되고 달력을 눌러도 된다**(2026-09-18). 값은 `YYYY-MM-DD` 문자열 하나다.
/// 글자 칸은 자릿수를 다 치면(8자리) 정규화하고, 달력(compact DatePicker)은 누르면 시스템 달력이 뜬다.
/// 잘못 친 날짜는 지우지 않는다 — 칸 아래에 그렇다고만 말한다(다시 치게).
struct DateEntryField: View {
    let title: String
    @Binding var text: String?
    /// 달력을 처음 열 때의 기준 — 보통 시작일이나 오늘.
    var fallback: () -> Date = { Date() }
    @State private var typed = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: Space.s) {
                Text(title)
                Spacer(minLength: Space.s)
                TextField("YYYY-MM-DD", text: $typed)
                    .keyboardType(.numbersAndPunctuation)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .multilineTextAlignment(.trailing)
                    .focused($focused)
                    .frame(maxWidth: 132)
                    .accessibilityLabel("\(title) 직접 입력")
                DatePicker("", selection: dateBinding, displayedComponents: .date)
                    .labelsHidden()
                    .datePickerStyle(.compact)
                    .accessibilityLabel("\(title) 달력")
            }
            if !typed.isEmpty, ISODateText.parseLoose(typed) == nil {
                Text("2026-10-25처럼 여덟 자리로 적어 주세요").font(.caption2).foregroundStyle(Ink.warning)
            }
        }
        .onAppear { typed = text ?? "" }
        .onChange(of: text) { _, value in if !focused { typed = value ?? "" } }
        .onChange(of: typed) { _, value in
            if let iso = ISODateText.parseLoose(value) { if iso != text { text = iso } }
            else if value.isEmpty { text = nil }
        }
        .onChange(of: focused) { _, on in if !on { typed = text ?? "" } }   // 칸을 나가면 정규화된 모양으로
    }

    private var dateBinding: Binding<Date> {
        Binding(
            get: { ISODateText.date(from: text) ?? fallback() },
            set: { text = ISODateText.text(from: $0) })
    }
}

/// 지도가 뜨기 전 자리. 빈 화면에 스피너만 두지 않는다 — 무엇을 기다리는지 말한다(§34).
/// 지도 뷰 **뒤**에 깔아 두면 SDK가 첫 프레임을 그리기 전까지 이것이 보이고, 그 뒤로는 지도가 덮는다.
struct MapLoadingPlaceholder: View {
    var message = "지도를 불러오는 중이에요"

    var body: some View {
        ZStack {
            Ink.sunken
            VStack(spacing: Space.s) {
                ProgressView()
                Text(message).font(.caption).foregroundStyle(Ink.soft)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(message)
    }
}

/// 이동 정보 한 알 — `택시 · 26분 · 19.7km`. 장소 이름보다 가볍게, 카드가 아니라 알약으로.
/// ⚠️ 글은 문장 하나다 — 조각 Text를 늘어놓으면 접근성 글자 크기에서 `12.4k` / `m`처럼 단어가 잘린다.
struct LegPill: View {
    let symbol: String
    let text: String

    var body: some View {
        HStack(spacing: Space.xs) {
            Image(systemName: symbol)
            Text(text)
        }
        .font(.caption2.monospacedDigit())
        .foregroundStyle(Ink.soft)
        .padding(.horizontal, Space.s)
        .padding(.vertical, 3)
        .background(Ink.sunken, in: Capsule())
    }
}

/// API가 실패해도 화면 전체를 못 쓰게 만들지 않는다(§33).
struct InlineErrorBanner: View {
    let message: String
    var detail: String?
    var tint: Color = Ink.accent
    var compact: Bool = false
    let retry: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Group {
            if compact && !typeSize.isAccessibilitySize {
                HStack(alignment: .center, spacing: Space.m) {
                    messageContent.frame(maxWidth: .infinity, alignment: .leading)
                    retryButton.fixedSize()
                }
            } else {
                VStack(alignment: .leading, spacing: Space.s) {
                    messageContent
                    retryButton
                }
            }
        }
        .padding(Space.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.10), in: RoundedRectangle(cornerRadius: Radius.card))
        .overlay(RoundedRectangle(cornerRadius: Radius.card).strokeBorder(tint.opacity(0.22)))
    }

    private var messageContent: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            Label(message, systemImage: "exclamationmark.circle")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(tint)
            if let detail {
                Text(detail).font(.caption).foregroundStyle(Ink.soft)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private var retryButton: some View {
        let button = Button("다시 시도", action: retry)
            .font(.caption.weight(.semibold))
            .tint(tint)
        if compact {
            button.frame(minHeight: 44).buttonStyle(.bordered)
        } else {
            button
        }
    }
}

/// 켜고 끄는 칩 하나. 고른 것은 `Ink.accent`다 — 색은 뜻이고 여기서는 '고른 것'이다(§색은 뜻이다).
///
/// 참여자('누가 가나요')와 컨디션이 같은 것을 쓴다 — 같은 뜻의 컨트롤이 화면마다 다르게 보이지 않게.
struct PickChip: View {
    let label: String
    let isOn: Bool
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            Text(label)
                .font(.subheadline.weight(isOn ? .semibold : .regular))
                .padding(.horizontal, Space.m)
                .padding(.vertical, Space.xs + 2)
                .background(isOn ? Ink.accent.opacity(0.18) : Color(.tertiarySystemFill), in: Capsule())
                .foregroundStyle(isOn ? Ink.accent : .primary)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? [.isSelected] : [])
    }
}
