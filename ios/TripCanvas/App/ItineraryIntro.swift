import SwiftUI

/// 로그인 화면의 브랜드 장면 — 흩어진 '가고 싶은 곳'이 하루의 순서로 자리를 잡고, J가 그 하루에 서명한다.
///
/// 모양은 시각 t(초)의 **순수 함수**다. 승인된 시안(2026-09-25, `withj-brand-scene-v7`)과 같은 시각·같은 곡선을
/// 그대로 옮겼다 — 화면은 이 값을 그리기만 한다. 움직임 줄이기에서는 `final`을 곧바로 쓴다.
enum ItineraryIntroTimeline {
    /// 마지막 버튼까지 나타나는 때. 그 뒤로는 멈춰 있다 — 로그인 화면은 반복 재생하지 않는다.
    static let duration: TimeInterval = 3.6
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
        var signature: Double
        var cap: Double
        var headline: Double
        var subline: Double
        var google: Double
        var email: Double
        var signup: Double
    }

    static func frame(at t: TimeInterval) -> Frame {
        let chips = (0..<stopCount).map { i -> Chip in
            let start = 0.48 + Double(i) * 0.11
            let travel = ease(seg(t, start, start + 0.84))
            // 같은 칩이 제자리에 닿을 때 테두리도 함께 풀린다.
            return Chip(appear: 1, travel: travel, settled: ease(seg(travel, 0.67, 1)))
        }
        let spine = ease(seg(t, 1.18, 1.99))
        let reached = t < 1.18 ? 0 : (0..<stopCount).filter { spine >= Double($0) / Double(stopCount - 1) - 0.001 }.count
        return Frame(card: 1,
                     head: ease(seg(t, 0.8, 1.2)),
                     chips: chips,
                     spine: spine,
                     reachedStops: reached,
                     signature: ease(seg(t, 2.01, 2.8)),
                     cap: ease(seg(t, 2.76, 2.94)),
                     headline: ease(seg(t, 1.85, 2.28)),
                     subline: ease(seg(t, 2.2, 2.55)),
                     google: ease(seg(t, 3.04, 3.36)),
                     email: ease(seg(t, 3.18, 3.5)),
                     signup: ease(seg(t, 3.34, 3.58)))
    }

    static let final = frame(at: duration)

    private static func seg(_ t: Double, _ a: Double, _ b: Double) -> Double { min(max((t - a) / (b - a), 0), 1) }
    private static func ease(_ x: Double) -> Double { x * x * x * (x * (x * 6 - 15) + 10) }
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

    /// 특정 도시가 아니라 어느 여행에나 있는 장소 종류. 앞의 셋은 장소 분류(`CandidateCategory`)와 같은 기호이고,
    /// 노을은 분류에 없어(분류의 '명소'는 카메라다) 시안대로 해 지는 모양을 쓴다.
    static let stops: [Stop] = [
        Stop(time: "09:30", name: "미술관", symbol: "building.columns.fill", scatter: CGSize(width: 68, height: -88), tilt: -6),
        Stop(time: "12:00", name: "현지 시장", symbol: "fork.knife", scatter: CGSize(width: -102, height: -44), tilt: 5),
        Stop(time: "15:00", name: "공원 산책", symbol: "leaf.fill", scatter: CGSize(width: 118, height: -34), tilt: 7),
        Stop(time: "18:30", name: "노을 명소", symbol: "sun.horizon.fill", scatter: CGSize(width: -70, height: 24), tilt: -4),
    ]

    let frame: ItineraryIntroTimeline.Frame
    var compact = false
    @ScaledMetric(relativeTo: .subheadline) private var baseRowHeight: CGFloat = 44
    @ScaledMetric(relativeTo: .caption) private var timeWidth: CGFloat = 46
    /// 기호마다 폭이 달라 이름의 첫 글자가 줄마다 어긋나지 않게 칸을 고정한다.
    @ScaledMetric(relativeTo: .caption) private var iconWidth: CGFloat = 16
    private let nodeColumn: CGFloat = 22

    private var rowHeight: CGFloat { compact ? baseRowHeight * 0.82 : baseRowHeight }

    /// 그림자는 테마와 무관하게 검정이다 — `Ink.ink`는 다크에서 밝은 색이라 그림자 대신 빛번짐이 된다.
    private static let shade = Color.black

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
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(alignment: .topLeading) { route }
        }
        .padding(.horizontal, 22)
        .padding(.top, compact ? 16 : 20)
        .padding(.bottom, compact ? 30 : 34)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: 16)
                .fill(Ink.raised)
                .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Ink.hairline))
                .shadow(color: Self.shade.opacity(0.08), radius: 16, y: 10)
                .opacity(frame.card)
                .offset(y: 10 * (1 - frame.card))
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
        .background(Ink.raised.opacity(1 - chip.settled), in: Capsule())
        .overlay(Capsule().strokeBorder(Ink.hairline).opacity(1 - chip.settled))
        .shadow(color: Self.shade.opacity(0.16 * away), radius: 8 * away, y: 6 * away)
        // 제자리 기준으로 어긋나 있다가 돌아온다 — 글자 크기가 바뀌어도 도착점은 레이아웃이 정한다.
        .rotationEffect(.degrees(stop.tilt * away))
        .offset(x: stop.scatter.width * away, y: stop.scatter.height * away)
        .opacity(chip.appear)
    }

    /// 일정의 세로 동선이 카드 아래를 따라 J로 이어진다. 같은 좌표에서 시작해 획이 끊기지 않는다.
    private var route: some View {
        GeometryReader { geometry in
            let x = timeWidth + nodeColumn / 2
            let lastY = rowHeight * (CGFloat(Self.stops.count) - 0.5)
            let endX = geometry.size.width - 18
            ZStack {
                Path { path in
                    path.move(to: CGPoint(x: x, y: rowHeight / 2))
                    path.addLine(to: CGPoint(x: x, y: lastY))
                }
                .trim(from: 0, to: frame.spine)
                .stroke(Ink.accent, style: StrokeStyle(lineWidth: 1.5, lineCap: .round))

                Path { path in
                    path.move(to: CGPoint(x: x, y: lastY))
                    path.addLine(to: CGPoint(x: x, y: lastY + 10))
                    path.addCurve(to: CGPoint(x: x + 23, y: lastY + 30),
                                  control1: CGPoint(x: x, y: lastY + 23),
                                  control2: CGPoint(x: x + 7, y: lastY + 30))
                    path.addLine(to: CGPoint(x: endX - 50, y: lastY + 30))
                    path.addCurve(to: CGPoint(x: endX, y: lastY + 7),
                                  control1: CGPoint(x: endX - 25, y: lastY + 47),
                                  control2: CGPoint(x: endX, y: lastY + 31))
                    path.addLine(to: CGPoint(x: endX, y: lastY - 19))
                }
                .trim(from: 0, to: frame.signature)
                .stroke(Ink.accent, style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))

                Path { path in
                    path.move(to: CGPoint(x: endX - 16, y: lastY - 18))
                    path.addQuadCurve(to: CGPoint(x: endX + 16, y: lastY - 19),
                                      control: CGPoint(x: endX, y: lastY - 22))
                }
                .trim(from: 0, to: frame.cap)
                .stroke(Ink.accent, style: StrokeStyle(lineWidth: 1.7, lineCap: .round))
            }
        }
    }
}
