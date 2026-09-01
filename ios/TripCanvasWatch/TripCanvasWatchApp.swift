import SwiftUI
import WatchKit

/// Apple Watch — iPhone 앱의 축소판이 아니다(§32·§76.4).
/// 다루는 질문은 하나다: **다음 뭐지?**
///
/// 도메인을 다시 구현하지 않는다(§36). iPhone이 App Group에 써 둔 압축본을 읽어 그린다.
/// 연결이 없으면 마지막 값을 보여주되 언제 받은 것인지 반드시 밝힌다(§58).
@main
struct TripCanvasWatchApp: App {
    var body: some Scene {
        WindowGroup {
            WatchNextView()
        }
    }
}

struct WatchNextView: View {
    @State private var stamped: SharedStore.Stamped<LiveActivityState>?
    @State private var travelMode: TravelModeSnapshot?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if let state = stamped?.value {
                    Text(state.tripName)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)

                    Text("다음").font(.caption2).foregroundStyle(.secondary)
                    Text(state.nextTitle)
                        .font(.headline)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)

                    HStack(spacing: 6) {
                        if let start = state.nextStartISO,
                           let date = ISO8601DateFormatter.tripCanvas.date(from: start) {
                            Text(date, style: .time).font(.title3.monospacedDigit())
                        }
                        if let travel = state.travelMinutes, travel > 0 {
                            Text("· \(travel)분").font(.footnote).foregroundStyle(.secondary)
                        }
                    }

                    // 하루 상태 한 마디. 내부 코드가 아니라 문장이 온다.
                    Text(state.pulseText)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)

                    if let fixed = state.fixedTitle,
                       let iso = state.fixedStartISO,
                       let at = ISO8601DateFormatter.tripCanvas.date(from: iso) {
                        Divider()
                        HStack(spacing: 4) {
                            Image(systemName: "lock.fill").font(.system(size: 9))
                            Text(at, style: .time).font(.caption.monospacedDigit())
                            Text(fixed).font(.caption).lineLimit(1)
                        }
                        .foregroundStyle(.secondary)
                    }

                    StaleNotice(savedAt: stamped?.savedAt)
                } else {
                    // 빈 화면을 두지 않는다 — 무엇을 하면 되는지 한 줄이라도 말한다.
                    VStack(alignment: .leading, spacing: 6) {
                        Image(systemName: "iphone.gen3").font(.title3).foregroundStyle(.secondary)
                        Text("아직 받은 일정이 없어요").font(.headline)
                        Text("iPhone에서 From J를 한 번 열면 여기에 다음 일정이 나타나요.")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
        }
        .navigationTitle("From J")
        .onAppear(perform: reload)
        // 워치에서 시계로 자주 깨우지 않는다 — 화면이 다시 보일 때만 읽는다.
        .onReceive(NotificationCenter.default.publisher(for: WKApplication.didBecomeActiveNotification)) { _ in
            reload()
        }
    }

    private func reload() {
        stamped = SharedStore.loadActivityState()
        travelMode = SharedStore.loadTravelMode()?.value
    }
}

/// 오래된 값을 최신인 것처럼 보여주지 않는다(§58).
struct StaleNotice: View {
    let savedAt: Date?

    var body: some View {
        if let savedAt, Date().timeIntervalSince(savedAt) > 20 * 60 {
            Text("마지막 업데이트 \(WatchFormat.time(savedAt))")
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)
                .padding(.top, 2)
        }
    }
}

enum WatchFormat {
    static func time(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: date)
    }
}
