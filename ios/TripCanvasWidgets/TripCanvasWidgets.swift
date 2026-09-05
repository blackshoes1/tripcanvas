import ActivityKit
import SwiftUI
import WidgetKit

@main
struct TripCanvasWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        TripCanvasLiveActivity()
    }
}

// MARK: - Today Widget (§23~29)
//
// 위젯에는 네트워크도 인증도 없다. 앱이 App Group에 써 둔 압축본만 읽는다(§28).

struct TodayEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
    /// 앱이 마지막으로 갱신한 시각. 오래된 값을 최신처럼 보여주지 않기 위해 함께 표시한다(§29).
    let savedAt: Date?
}

struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry {
        TodayEntry(date: Date(), snapshot: nil, savedAt: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        completion(current())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        // 시계로 자주 깨우지 않는다 — 실제 갱신은 앱이 상태를 바꿀 때 reloadTimelines로 밀어준다(§56).
        let entry = current()
        completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(30 * 60))))
    }

    private func current() -> TodayEntry {
        let stored = SharedStore.loadWidgetSnapshot()
        return TodayEntry(date: Date(), snapshot: stored?.value, savedAt: stored?.savedAt)
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TripCanvasTodayWidget", provider: TodayProvider()) { entry in
            TodayWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("오늘 일정")
        .description("다음 일정과 오늘 남은 일정을 앱을 열지 않고 확인해요.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct TodayWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TodayEntry

    var body: some View {
        if let snapshot = entry.snapshot {
            switch family {
            case .systemSmall: SmallWidget(snapshot: snapshot, savedAt: entry.savedAt)
            default: MediumWidget(snapshot: snapshot, savedAt: entry.savedAt)
            }
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Text("With J").font(.caption.weight(.semibold))
                Text("앱에서 여행을 한 번 열면 오늘 일정이 여기에 나타나요.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// Small — "다음 하나"만. 그 이상은 이 크기에서 읽히지 않는다(§25).
struct SmallWidget: View {
    let snapshot: WidgetSnapshot
    let savedAt: Date?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("다음").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            if let next = snapshot.nextActivity {
                Text(next.title).font(.headline).lineLimit(2)
                Text(WidgetFormat.clock(next.startMinutes))
                    .font(.subheadline.monospacedDigit())
                if let travel = snapshot.nextTravelMinutes, travel > 0 {
                    Label("\(travel)분", systemImage: "arrow.triangle.turn.up.right.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text(snapshot.pulseText).font(.subheadline).lineLimit(3)
            }
            Spacer(minLength: 0)
            StaleFooter(savedAt: savedAt)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .widgetURL(WidgetFormat.todayLink(tripId: snapshot.tripId, focus: snapshot.nextActivity?.id))
    }
}

/// Medium — 오늘 흐름 세 줄 + 다음까지 얼마나(§26).
struct MediumWidget: View {
    let snapshot: WidgetSnapshot
    let savedAt: Date?

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text("\(snapshot.tripName) · \(snapshot.dayLabel)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ForEach(snapshot.upcoming) { activity in
                    HStack(spacing: 6) {
                        Text(WidgetFormat.clock(activity.startMinutes))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .frame(width: 40, alignment: .leading)
                        if activity.isFixed {
                            Image(systemName: "lock.fill").font(.system(size: 8)).foregroundStyle(.secondary)
                        }
                        Text(activity.title).font(.caption).lineLimit(1)
                    }
                }
                if snapshot.upcoming.isEmpty {
                    Text(snapshot.pulseText).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                StaleFooter(savedAt: savedAt)
            }
            Divider()
            VStack(alignment: .leading, spacing: 4) {
                Text("다음").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                Text(snapshot.nextActivity?.title ?? "없음").font(.subheadline.weight(.semibold)).lineLimit(2)
                if let travel = snapshot.nextTravelMinutes, travel > 0 {
                    Text("\(travel)분 거리").font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .frame(width: 110, alignment: .leading)
        }
        .widgetURL(WidgetFormat.todayLink(tripId: snapshot.tripId, focus: snapshot.nextActivity?.id))
    }
}

struct StaleFooter: View {
    let savedAt: Date?
    var body: some View {
        if let savedAt, Date().timeIntervalSince(savedAt) > 30 * 60 {
            // 30분이 지났으면 "언제 받은 정보인지"를 밝힌다 — 최신인 척하지 않는다.
            Text("업데이트 \(WidgetFormat.shortTime(savedAt))")
                .font(.system(size: 9))
                .foregroundStyle(.tertiary)
        }
    }
}

enum WidgetFormat {
    static func clock(_ minutes: Int) -> String {
        let m = ((minutes % 1440) + 1440) % 1440
        return String(format: "%02d:%02d", m / 60, m % 60)
    }
    static func shortTime(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: date)
    }
    static func todayLink(tripId: String, focus: String?) -> URL? {
        var text = "tripcanvas://trip/\(tripId)/today"
        if let focus { text += "?focus=\(focus)" }
        return URL(string: text)
    }
}

// MARK: - Live Activity (§17~21)

struct TripCanvasLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TripCanvasActivityAttributes.self) { context in
            LockScreenActivityView(context: context)
                .activityBackgroundTint(Color.black.opacity(0.35))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.attributes.dayLabel, systemImage: ActivityPresentation.symbol(for: context.state.status))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let travel = context.state.travelMinutes, travel > 0 {
                        Text("\(travel)분").font(.caption.monospacedDigit())
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("다음").font(.caption2).foregroundStyle(.secondary)
                        Text(context.state.nextTitle).font(.headline).lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    // 확장 상태에서도 한 줄 이상 욕심내지 않는다(§20).
                    if let fixed = context.state.fixedTitle, let at = context.state.fixedStartAt {
                        Text("\(at, style: .time) \(fixed)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text(ActivityPresentation.headline(context.state))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
            } compactLeading: {
                Image(systemName: ActivityPresentation.symbol(for: context.state.status))
            } compactTrailing: {
                Text(ActivityPresentation.compactTravel(context.state.travelMinutes))
                    .font(.caption2.monospacedDigit())
            } minimal: {
                Image(systemName: ActivityPresentation.symbol(for: context.state.status))
            }
            .keylineTint(.orange)
        }
    }
}

/// 잠금화면 — 여행 전체 일정표가 아니라 "지금 필요한 것"만(§17).
struct LockScreenActivityView: View {
    let context: ActivityViewContext<TripCanvasActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("\(context.attributes.tripName) · \(context.attributes.dayLabel)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Image(systemName: ActivityPresentation.symbol(for: context.state.status))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("다음").font(.caption2).foregroundStyle(.secondary)
                    Text(context.state.nextTitle).font(.title3.weight(.semibold)).lineLimit(1)
                }
                Spacer()
                if let travel = context.state.travelMinutes, travel > 0 {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("이동").font(.caption2).foregroundStyle(.secondary)
                        Text("\(travel)분").font(.title3.monospacedDigit().weight(.semibold))
                    }
                }
            }

            Text(ActivityPresentation.headline(context.state))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            if let fixed = context.state.fixedTitle, let at = context.state.fixedStartAt {
                Divider().opacity(0.4)
                HStack(spacing: 6) {
                    Image(systemName: "lock.fill").font(.system(size: 9)).foregroundStyle(.secondary)
                    Text("\(at, style: .time)").font(.caption.monospacedDigit())
                    Text(fixed).font(.caption).lineLimit(1)
                }
                .foregroundStyle(.secondary)
            }
        }
        .padding(14)
    }
}
