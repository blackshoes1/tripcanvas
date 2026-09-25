import SwiftUI

/// 로그인 화면의 브랜드 장면 — 흩어진 '가고 싶은 곳'이 하루의 순서로 자리를 잡고, J가 그 하루에 서명한다.
///
/// 모양은 시각 t(초)의 **순수 함수**다. 승인된 시안(2026-09-25, `withj-brand-scene-v5`)과 같은 시각·같은 곡선을
/// 그대로 옮겼다 — 화면은 이 값을 그리기만 한다. 움직임 줄이기에서는 `final`을 곧바로 쓴다.
enum ItineraryIntroTimeline {
    /// 마지막 획(서명)이 끝나는 때. 그 뒤로는 멈춰 있다 — 로그인 화면은 반복 재생하지 않는다.
    static let duration: TimeInterval = 2.95
    static let stopCount = 4

    struct Chip: Equatable {
        /// 떠오름(0→1) · 제자리로 내려앉음(0→1) · 내려앉은 뒤 테두리가 풀리고 시각이 보임(0→1)
        var appear: Double
        var travel: Double
        var settled: Double
    }

    struct Frame: Equatable {
        var card: Double
        var head: Double
        var chips: [Chip]
        /// 경로 선이 첫 줄에서 마지막 줄까지 그려진 정도
        var spine: Double
        /// 경로가 지나가 점이 찍힌 줄의 수
        var reachedStops: Int
        var dash: Double
        var cap: Double
        var stem: Double
        var headline: Double
        var subline: Double
    }

    static func frame(at t: TimeInterval) -> Frame {
        let chips = (0..<stopCount).map { i -> Chip in
            let d = Double(i)
            return Chip(appear: out(seg(t, 0.05 + d * 0.07, 0.4 + d * 0.07)),
                        travel: ease(seg(t, 0.6 + d * 0.12, 1.3 + d * 0.1)),
                        settled: out(seg(t, 1.1 + d * 0.1, 1.4 + d * 0.1)))
        }
        let spine = ease(seg(t, 1.35, 2.05))
        let reached = t < 1.35 ? 0 : (0..<stopCount).filter { spine >= Double($0) / Double(stopCount - 1) - 0.001 }.count
        return Frame(card: out(seg(t, 0.45, 0.85)),
                     head: out(seg(t, 1.2, 1.55)),
                     chips: chips,
                     spine: spine,
                     reachedStops: reached,
                     dash: ease(seg(t, 2.1, 2.24)),
                     cap: ease(seg(t, 2.26, 2.42)),
                     stem: ease(seg(t, 2.44, 2.95)),
                     headline: out(seg(t, 2.0, 2.6)),
                     subline: out(seg(t, 2.3, 2.9)))
    }

    static let final = frame(at: duration)

    private static func seg(_ t: Double, _ a: Double, _ b: Double) -> Double { min(max((t - a) / (b - a), 0), 1) }
    private static func ease(_ x: Double) -> Double { x < 0.5 ? 4 * x * x * x : 1 - pow(-2 * x + 2, 3) / 2 }
    private static func out(_ x: Double) -> Double { 1 - pow(1 - x, 3) }
}

/// 일정 카드. 장식이라 VoiceOver에서는 숨긴다 — 같은 말은 아래 헤드라인이 한다.
struct ItineraryIntroScene: View {
    struct Stop {
        let time: String
        let name: String
        let symbol: String
        /// 흩어져 있던 자리(제자리 기준 어긋남)와 기울기
        let scatter: CGSize
        let tilt: Double
    }

    /// 특정 도시가 아니라 어느 여행에나 있는 장소 종류. 기호는 장소 분류(`CandidateCategory`)와 같은 벌이다.
    static let stops: [Stop] = [
        Stop(time: "09:30", name: "미술관", symbol: "building.columns.fill", scatter: CGSize(width: 68, height: -88), tilt: -6),
        Stop(time: "12:00", name: "현지 시장", symbol: "fork.knife", scatter: CGSize(width: -102, height: -44), tilt: 5),
        Stop(time: "15:00", name: "공원 산책", symbol: "leaf.fill", scatter: CGSize(width: 118, height: -34), tilt: 7),
        Stop(time: "18:30", name: "노을 명소", symbol: "sun.horizon.fill", scatter: CGSize(width: -70, height: 24), tilt: -4),
    ]

    let frame: ItineraryIntroTimeline.Frame
    var compact = false
    @ScaledMetric(relativeTo: .subheadline) private var baseRowHeight: CGFloat = 40
    @ScaledMetric(relativeTo: .caption) private var timeWidth: CGFloat = 46
    /// 기호마다 폭이 달라 이름의 첫 글자가 줄마다 어긋나지 않게 칸을 고정한다.
    @ScaledMetric(relativeTo: .caption) private var iconWidth: CGFloat = 16
    private let nodeColumn: CGFloat = 22

    private var rowHeight: CGFloat { compact ? baseRowHeight * 0.82 : baseRowHeight }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: Space.xs) {
                Text("Day 1 · Oct 25").metaLabel()
                Text("여행 첫날").font(Typeface.editorial(.title3)).foregroundStyle(Ink.ink)
            }
            .opacity(frame.head)
            .padding(.bottom, compact ? Space.s : Space.m)

            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(Self.stops.enumerated()), id: \.offset) { index, stop in
                    row(stop, chip: frame.chips[index], reached: index < frame.reachedStops)
                }
            }
            .background(alignment: .topLeading) { spine }
        }
        .padding(.horizontal, 22)
        .padding(.top, compact ? 16 : 20)
        .padding(.bottom, compact ? 14 : 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: 16)
                .fill(Ink.raised)
                .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Ink.hairline))
                .shadow(color: Ink.ink.opacity(0.08), radius: 16, y: 10)
                .opacity(frame.card)
                .offset(y: 10 * (1 - frame.card))
        }
        .overlay(alignment: .bottomTrailing) {
            JSignature(dash: frame.dash, cap: frame.cap, stem: frame.stem)
                .frame(width: 62, height: 64)
                .padding(.trailing, 16)
                .padding(.bottom, compact ? 8 : 12)
        }
        .accessibilityHidden(true)
    }

    private func row(_ stop: Stop, chip: ItineraryIntroTimeline.Chip, reached: Bool) -> some View {
        HStack(spacing: 0) {
            Text(stop.time)
                .font(.caption.monospacedDigit())
                .foregroundStyle(Ink.soft)
                .frame(width: timeWidth, alignment: .leading)
                .opacity(chip.settled)
            Circle()
                .fill(reached ? Ink.accent : Color.clear)
                .frame(width: 8, height: 8)
                .frame(width: nodeColumn)
            chipLabel(stop, chip: chip)
                .padding(.leading, Space.s)
        }
        .frame(height: rowHeight)
        .zIndex(1 - chip.travel)
    }

    private func chipLabel(_ stop: Stop, chip: ItineraryIntroTimeline.Chip) -> some View {
        let away = 1 - chip.travel
        return HStack(spacing: 7) {
            Image(systemName: stop.symbol)
                .font(.caption)
                .foregroundStyle(Ink.accent)
                .frame(width: iconWidth)
            Text(stop.name)
                .font(.subheadline)
                .foregroundStyle(Ink.ink)
                .lineLimit(1)
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 7)
        .background(Ink.raised, in: Capsule())
        .overlay(Capsule().strokeBorder(Ink.hairline).opacity(1 - chip.settled))
        .shadow(color: Ink.ink.opacity(0.16 * away), radius: 8 * away, y: 6 * away)
        // 제자리 기준으로 어긋나 있다가 돌아온다 — 글자 크기가 바뀌어도 도착점은 레이아웃이 정한다.
        .rotationEffect(.degrees(stop.tilt * away))
        .offset(x: stop.scatter.width * away, y: stop.scatter.height * away)
        .opacity(chip.appear)
    }

    /// 첫 줄의 점에서 마지막 줄의 점까지 내려가는 경로.
    private var spine: some View {
        let x = timeWidth + nodeColumn / 2
        return Path { path in
            path.move(to: CGPoint(x: x, y: rowHeight / 2))
            path.addLine(to: CGPoint(x: x, y: rowHeight * (CGFloat(Self.stops.count) - 0.5)))
        }
        .trim(from: 0, to: frame.spine)
        .stroke(Ink.accent, style: StrokeStyle(lineWidth: 2, lineCap: .round))
    }
}

/// 카드 모서리의 "—J" 서명. 짧은 줄 → J의 머리획 → 줄기와 갈고리 순으로 쓴다.
private struct JSignature: View {
    let dash: Double
    let cap: Double
    let stem: Double

    var body: some View {
        ZStack {
            stroke(part(.dash), dash, width: 1.8)
            stroke(part(.cap), cap, width: 2.2)
            stroke(part(.stem), stem, width: 2.4)
        }
    }

    private enum Part { case dash, cap, stem }

    /// 62×64 칸 기준 좌표(시안의 SVG 경로를 그대로 옮겼다).
    private func part(_ part: Part) -> Path {
        Path { p in
            switch part {
            case .dash:
                p.move(to: CGPoint(x: 0, y: 38))
                p.addLine(to: CGPoint(x: 14, y: 38))
            case .cap:
                p.move(to: CGPoint(x: 32, y: 5))
                p.addCurve(to: CGPoint(x: 60, y: 3), control1: CGPoint(x: 40, y: 3), control2: CGPoint(x: 50, y: 2))
            case .stem:
                p.move(to: CGPoint(x: 50, y: 3))
                p.addCurve(to: CGPoint(x: 45, y: 48), control1: CGPoint(x: 50, y: 20), control2: CGPoint(x: 49, y: 36))
                p.addCurve(to: CGPoint(x: 27, y: 57), control1: CGPoint(x: 41, y: 60), control2: CGPoint(x: 32, y: 62))
                p.addCurve(to: CGPoint(x: 28, y: 44), control1: CGPoint(x: 23, y: 53), control2: CGPoint(x: 24, y: 47))
            }
        }
    }

    private func stroke(_ path: Path, _ progress: Double, width: CGFloat) -> some View {
        path.trim(from: 0, to: progress)
            .stroke(Ink.accent, style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round))
    }
}
