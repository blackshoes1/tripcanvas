import SwiftUI

/// 앱 전체가 공유하는 간격·타이포·색. 화면마다 숫자를 흩뿌리지 않는다(§37).
enum Space {
    static let xs: CGFloat = 4
    static let s: CGFloat = 8
    static let m: CGFloat = 12
    static let l: CGFloat = 16
    static let xl: CGFloat = 24
}

/// 모서리는 네 단계뿐이다. 2026-09-27 전에는 6·8·10·12·14·16·18·20·22·26이 섞여 있어
/// 같은 화면의 카드와 버튼이 제각각 둥글었다 — 숫자를 새로 만들지 말고 여기서 고른다.
enum Radius {
    /// 사진 썸네일·작은 배지
    static let small: CGFloat = 8
    /// 카드 **안의** 칸 — 안내 상자·타일·배너
    static let control: CGFloat = 12
    /// 카드·행
    static let card: CGFloat = 16
    /// 화면을 크게 차지하는 판 — 표지 편집·온보딩 미리보기
    static let panel: CGFloat = 24
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
    /// 라벨·메타 — 가장 흐리다. 그래도 **어느 바탕 위에서든 4.5:1**이다 — 2026-09-27 전 값(라이트 #766F62·다크 #8A8073)은
    /// 가라앉은 바탕(sunken)·카드(raised) 위에서 4.0~4.3이었다. 라이트는 `soft`와 거의 같아졌고, 위계는 글자 크기가 맡는다.
    static let faint = adaptive(light: 0x6E6659, dark: 0x968C7E)
    /// 강조 — 누를 것, 지금 봐야 할 것. **올리브**(2026-09-20 승인 시안).
    /// ⚠️ 에셋 카탈로그의 `AccentColor`와 **같은 값이어야 한다** — 그래야 화면 여기저기의
    /// `Color.accentColor`와 기본 컨트롤 색이 이 팔레트와 갈리지 않는다.
    /// ⚠️ 웹도 같은 값이다(`style.css`의 `--primary`) — 한쪽만 바꾸면 기기마다 다른 색으로
    ///    '누를 것'을 말하게 된다.
    static let accent = Color.accentColor
    /// 강조색 **위의** 글자. 라이트의 올리브 위에는 흰색, 다크의 밝은 연두 위에는 짙은 글자다 —
    /// 다크에서 흰 글자는 1.9:1로 읽히지 않았다(2026-09-27, 웹 `.btn.primary`와 같은 규칙).
    static let onAccent = adaptive(light: 0xFFFFFF, dark: 0x16130F)
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
    /// 라이트는 종이 위 4.5:1을 넘게 한 톤 어둡다(전 값 #B8650F는 3.9:1 — 경고 문구가 가장 안 읽혔다).
    static let warning = adaptive(light: 0x9E5508, dark: 0xF0A050)
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
    /// 내비게이션 제목 — UIKit 외형(`applyUIKitAppearance`)과 **같은 크기**다. 제목을 직접 그리는 화면이 쓴다.
    static let navigationTitle: Font = .custom("NanumMyeongjo", size: navigationTitleSize, relativeTo: .headline)
    static let navigationTitleSize: CGFloat = 19

    /// `OCT 12 · 6 DAYS` 같은 메타 라벨. 대문자·자간은 `.metaLabel()`이 함께 준다.
    static func meta(_ style: Font.TextStyle = .caption2) -> Font {
        .system(style, design: .monospaced).weight(.medium)
    }
}

extension Typeface {
    /// SwiftUI가 글꼴·색을 열어 주지 않는 UIKit 컨트롤을 팔레트에 맞춘다(2026-09-27). 앱 시작 때 한 번.
    /// - 내비게이션 제목은 명조 — 입구(온보딩·여행 목록)만 명조이고 안쪽 화면은 시스템 고딕이라
    ///   들어가면 다른 앱처럼 보였다. 글자 크기 설정을 따른다.
    /// - 세그먼트는 가라앉은 바탕 위에 뜬 칸 — 시스템 회색은 종이 위에서 차갑게 떴다.
    @MainActor
    static func applyUIKitAppearance() {
        let segment = UISegmentedControl.appearance()
        segment.backgroundColor = UIColor(Ink.sunken)
        segment.selectedSegmentTintColor = UIColor(Ink.raised)
        segment.setTitleTextAttributes([.foregroundColor: UIColor(Ink.soft)], for: .normal)
        segment.setTitleTextAttributes([.foregroundColor: UIColor(Ink.ink)], for: .selected)

        guard let base = UIFont(name: "NanumMyeongjo", size: 17) else { return }
        let bar = UINavigationBar.appearance()
        bar.titleTextAttributes = [
            .font: UIFontMetrics(forTextStyle: .headline).scaledFont(for: base.withSize(navigationTitleSize)),
        ]
        bar.largeTitleTextAttributes = [
            .font: UIFontMetrics(forTextStyle: .largeTitle).scaledFont(for: base.withSize(34)),
        ]
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

/// 종이 바탕의 Form·List — 바탕은 `paper`, 행은 카드와 같은 `raised`다.
/// 시스템 행은 다크에서 차가운 회색(#1C1C1E)이라 따뜻한 종이 위에서 떴다(2026-09-27).
/// ⚠️ `listRowBackground`는 List·Form 자체에 붙이면 행에 닿지 않는다 — 안쪽 묶음(Group)에 붙여야 한다.
/// `.plain` 목록에는 쓰지 않는다(그 행은 종이 위에 바로 놓인다).
struct PaperForm<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        Form { Group { content }.listRowBackground(Ink.raised) }.paperGround()
    }
}

struct PaperList<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        List { Group { content }.listRowBackground(Ink.raised) }.paperGround()
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
        .prominentButton()
        .disabled(isBusy)
    }
}

/// 보조 버튼 — 주 버튼과 **같은 높이·같은 모양**에 색만 가라앉힌다.
/// 2026-09-27 전에는 `.bordered`의 시스템 회색이라 종이 바탕 위에서 차갑게 떴고, 글자 길이만큼만 넓어
/// 세로로 쌓이면 폭이 제각각인 알약이 가운데 줄지어 섰다.
///
/// `expands`: 세로로 쌓이거나 보조끼리 나란하면 넓게(기본), **주 버튼 옆**이나 빈 화면 가운데서는
/// 글자만큼 — 그래야 주 버튼이 여전히 먼저 읽힌다.
struct SecondaryActionButton: View {
    let title: String
    var systemImage: String?
    var expands: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Space.s) {
                if let systemImage { Image(systemName: systemImage) }
                Text(title)
            }
            .font(.body.weight(.medium))
            .padding(.horizontal, Space.xl)
            .frame(maxWidth: expands ? .infinity : nil, minHeight: 48)
            .background(Ink.sunken, in: Capsule())
            .foregroundStyle(Ink.ink)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .fixedSize(horizontal: !expands, vertical: false)
    }
}

/// 강조색을 옅게 깐 버튼 — **한 화면에 꽉 찬 주 버튼은 하나**라서, 그다음으로 권하는 일(From J의 '일정에 넣기')은
/// 이것을 쓴다. 글자만큼 넓다.
struct TonalActionButton: View {
    let title: String
    var systemImage: String?
    var isBusy: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Space.xs + 2) {
                if isBusy { ProgressView().controlSize(.small) }
                else if let systemImage { Image(systemName: systemImage) }
                Text(title).lineLimit(1)
            }
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, Space.l + 2)
            .frame(minHeight: 44)
            .background(Ink.accent.opacity(0.13), in: Capsule())
            .foregroundStyle(Ink.accent)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isBusy)
    }
}

/// 빠져나가는 길 — 배경 없는 흐린 글자. '이번엔 건너뛰기'처럼 권하지 않지만 언제나 있는 선택지.
struct QuietActionButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) { Text(title).lineLimit(1) }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(Ink.soft)
            .padding(.horizontal, Space.m)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
            .buttonStyle(.plain)
    }
}

/// 이름 옆의 아주 작은 표지 — `예약`·`다음`·`꼭 가기`. `StatusChip`은 한 줄을 차지하는 상태라 목록 줄에는 무겁다.
struct TagChip: View {
    let text: String
    var tint: Color = Ink.soft

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(tint.opacity(0.14), in: Capsule())
            .foregroundStyle(tint)
            .fixedSize()
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
    /// 지금 칸에 **못 읽는 글자**가 들어 있는가. 저장하는 화면은 이게 참이면 저장을 막는다 —
    /// 칸에 보이는 것과 다른(이전) 날짜가 저장되면 안 된다(2026-09-27 UX 검토).
    var invalid: Binding<Bool>? = nil
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
            invalid?.wrappedValue = !value.isEmpty && ISODateText.parseLoose(value) == nil
        }
        // 칸을 나가면 정규화된 모양으로 — **읽을 수 있을 때만.** 못 읽는 글자는 그대로 두고 경고도 남긴다.
        // 예전에는 이전 날짜로 되돌려 경고가 사라지고, 사용자는 고쳤다고 믿은 채 이전 날짜가 저장됐다.
        .onChange(of: focused) { _, on in
            if !on, typed.isEmpty || ISODateText.parseLoose(typed) != nil { typed = text ?? "" }
        }
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
    /// 버튼이 **실제로 하는 일**을 말한다(예: '다시 불러오기'). 기본은 '다시 시도'.
    var actionTitle: String = "다시 시도"
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
        let button = Button(actionTitle, action: retry)
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
                .background(isOn ? Ink.accent.opacity(0.18) : Ink.sunken, in: Capsule())
                .foregroundStyle(isOn ? Ink.accent : Ink.ink)
                // 겉모양은 그대로 두고 **누르는 칸만** 44pt — 칩이 줄지어 있어 옆 칩을 잘못 누르기 쉽다.
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? [.isSelected] : [])
    }
}

extension View {
    /// 강조 버튼 한 벌 — `.borderedProminent`의 기본 흰 글자는 다크의 밝은 강조색 위에서 읽히지 않는다.
    func prominentButton() -> some View {
        buttonStyle(.borderedProminent).foregroundStyle(Ink.onAccent)
    }
}
