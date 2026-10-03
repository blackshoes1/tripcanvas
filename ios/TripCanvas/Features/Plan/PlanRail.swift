import SwiftUI

/// 하루 일정의 세로 선 — 시각 칸 옆을 지나며 장소·구간·숙소를 한 줄기로 잇는다(2026-09-27 시안).
///
/// ⚠️ 선은 **행의 배경**으로 그린다. 행 안에 `maxHeight: .infinity`인 선을 두면 List가 무한 높이를
///    제안받아 행이 화면만큼 늘어난다(`PlanSectionLayoutTests`가 막는다). 배경은 행이 정한 높이만 받는다.
/// ⚠️ 선이 행 사이에서 끊기지 않으려면 그 행들의 **위아래 inset이 0**이어야 한다(`railRowInsets`).
enum PlanRail {
    /// 시각 칸 폭의 기준값 — `07:20`과 고정 핀 자리. 글자 크기에 따라 `@ScaledMetric`으로 커진다.
    static let timeColumn: CGFloat = 64
    /// 표지(원) 칸 폭. 선은 이 칸의 가운데를 지난다.
    static let markerColumn: CGFloat = 32
    /// 표지 원의 지름.
    static let markerSize: CGFloat = 24
    /// 표지 줄의 위 여백. 선이 표지에서 끊기는 높이(위 여백 + 원 반지름)가 여기서 나온다.
    static let rowPadding: CGFloat = Space.m
    static let lineColor = Ink.ink.opacity(0.13)

    /// 행의 위아래 inset을 없애고 좌우만 남긴다 — 선이 행 사이에서 이어진다.
    static let railRowInsets = EdgeInsets(top: 0, leading: Space.m, bottom: 0, trailing: Space.l)
}

/// 행 배경에 까는 선. `split`이 있으면 그 높이에서 위·아래를 따로 켜고 끈다(첫 줄 위·끝 줄 아래는 비운다).
struct PlanRailLine: View {
    let centerX: CGFloat
    var top = true
    var bottom = true
    /// 표지 가운데의 y. nil이면 행 전체가 한 줄기다(구간 줄).
    var split: CGFloat?
    var color: Color = PlanRail.lineColor

    var body: some View {
        VStack(spacing: 0) {
            if let split {
                Rectangle().fill(top ? color : .clear).frame(height: split)
                Rectangle().fill(bottom ? color : .clear)
            } else {
                Rectangle().fill(top && bottom ? color : .clear)
            }
        }
        .frame(width: 2)
        .padding(.leading, centerX - 1)
        .accessibilityHidden(true)
    }
}

/// 선 위의 표지 — 장소 유형 기호를 담은 작은 원. 예약처럼 **상대가 정한 시각**은 채운 원이다(색은 뜻이다: `info`).
struct PlanRailMarker: View {
    enum Style { case plain, fixed, muted, home, event }
    let symbol: String
    var style: Style = .plain
    @ScaledMetric(relativeTo: .body) private var size: CGFloat = PlanRail.markerSize

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.46, weight: .semibold))
            .foregroundStyle(foreground)
            .frame(width: size, height: size)
            .background(background, in: Circle())
            .overlay(Circle().strokeBorder(stroke, lineWidth: 1.5))
            .accessibilityHidden(true)
    }

    private var foreground: Color {
        switch style {
        case .plain: Ink.ink
        case .fixed: Ink.onAccent
        case .muted, .home, .event: Ink.soft
        }
    }

    private var background: Color {
        switch style {
        case .fixed: Ink.info
        case .home, .event: Ink.sunken
        case .plain, .muted: Ink.raised
        }
    }

    private var stroke: Color {
        switch style {
        case .fixed: Ink.info
        case .plain: Ink.ink.opacity(0.22)
        case .muted, .home, .event: Ink.ink.opacity(0.12)
        }
    }
}

/// 장소가 아닌 줄 — 전날 숙소 · 항공편 · 렌터카 · 숙소 복귀. **표시만** 하고 동선 순서에 속하지 않는다.
/// 시각은 ETA 칸이 아니라 부제목에 둔다(그날 계산된 도착 순서가 아니다) — 숙소 복귀만 예외로
/// 하루가 끝나는 시각을 칸에 둔다(`time`).
struct PlanRailEventRow<Trailing: View>: View {
    let symbol: String
    var style: PlanRailMarker.Style = .event
    let title: String
    var subtitle: String?
    var time: String?
    var railTop = true
    var railBottom = true
    @ViewBuilder var trailing: Trailing
    @ScaledMetric(relativeTo: .caption) private var timeColumnWidth: CGFloat = PlanRail.timeColumn
    @ScaledMetric(relativeTo: .body) private var markerSize: CGFloat = PlanRail.markerSize
    @ScaledMetric(relativeTo: .caption) private var pinSlotWidth: CGFloat = 16
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if !typeSize.isAccessibilitySize {
                // 장소 줄의 시각은 고정 핀 자리(16)만큼 들어가 있다 — 같은 x에서 시작하게 그만큼 비운다.
                Text(time ?? "")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Ink.soft)
                    .padding(.leading, pinSlotWidth + 2)
                    .frame(width: timeColumnWidth, alignment: .leading)
                    .padding(.top, 4)
            }
            PlanRailMarker(symbol: symbol, style: style)
                .frame(width: PlanRail.markerColumn)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.medium)).foregroundStyle(Ink.ink)
                    .fixedSize(horizontal: false, vertical: true)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.caption).foregroundStyle(Ink.soft)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.leading, Space.s)
            .padding(.top, 2)
            Spacer(minLength: Space.s)
            trailing
        }
        .padding(.vertical, PlanRail.rowPadding)
        .background(alignment: .leading) {
            if !typeSize.isAccessibilitySize {
                PlanRailLine(centerX: timeColumnWidth + PlanRail.markerColumn / 2, top: railTop, bottom: railBottom,
                             split: PlanRail.rowPadding + markerSize / 2)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

extension PlanRailEventRow where Trailing == EmptyView {
    init(symbol: String, style: PlanRailMarker.Style = .event, title: String, subtitle: String? = nil,
         time: String? = nil, railTop: Bool = true, railBottom: Bool = true) {
        self.init(symbol: symbol, style: style, title: title, subtitle: subtitle, time: time,
                  railTop: railTop, railBottom: railBottom) { EmptyView() }
    }
}

/// 두 줄 사이의 이동 — 선 위에 걸친 옅은 알약. 장소 이름보다 언제나 가볍다.
struct PlanRailLeg: View {
    let mode: TravelMode
    let minutes: Int
    let distanceKm: Double?
    var rail = true
    /// 자차 하루의 가까운 구간을 걸어서 계산했다 — '자차'라고 적으면 거리·시간이 무엇의 값인지 틀린다
    var walkInstead = false
    @ScaledMetric(relativeTo: .caption) private var timeColumnWidth: CGFloat = PlanRail.timeColumn
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        HStack(spacing: 0) {
            if !typeSize.isAccessibilitySize {
                Color.clear.frame(width: SpotRow.secondaryIndent(timeColumnWidth: timeColumnWidth), height: 1)
            }
            HStack(spacing: Space.xs) {
                Image(systemName: walkInstead ? TravelMode.walk.symbol : mode.symbol).accessibilityHidden(true)
                Text(text).fixedSize(horizontal: false, vertical: true)
            }
            .font(.caption)
            .foregroundStyle(Ink.soft)
            .padding(.horizontal, Space.s + 2)
            .padding(.vertical, Space.xs)
            .background(Ink.sunken.opacity(0.6), in: Capsule())
            .padding(.leading, Space.s)
            Spacer(minLength: 0)
        }
        .padding(.vertical, Space.xs)
        .background(alignment: .leading) {
            if rail && !typeSize.isAccessibilitySize {
                PlanRailLine(centerX: timeColumnWidth + PlanRail.markerColumn / 2)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(walkInstead ? "가까워 걸어서" : mode.label + "로") \(TimeFormat.duration(minutes))\(distanceKm.map { ", " + Self.distance($0) } ?? "")")
    }

    private var text: String {
        ([walkInstead ? "가까워 걸어서" : mode.label, TimeFormat.duration(minutes)] + [distanceKm.map(Self.distance)].compactMap { $0 })
            .joined(separator: " · ")
    }

    static func distance(_ km: Double) -> String {
        km < 1 ? "\(Int((km * 1000).rounded()))m" : String(format: "%.1fkm", km)
    }
}
