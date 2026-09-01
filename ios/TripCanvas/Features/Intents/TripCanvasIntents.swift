import AppIntents
import Foundation

/// Siri·단축어에서 부르는 입구. **여기에 판단을 넣지 않는다**(§5) —
/// 앱의 서비스 계층을 그대로 부르고, 서비스는 서버(=adaptive.js)의 결과를 쓴다.
///
/// Siri는 일정표를 낭독하는 도구가 아니다(§10). 짧고 실행 가능한 것만 돌려준다.
enum IntentSupport {
    /// Intent는 앱 밖에서도 실행되므로 환경을 매번 새로 만든다.
    @MainActor
    static func makeEnvironment() -> AppEnvironment { AppEnvironment() }

    /// 지금 볼 여행 — 여행 중인 것이 있으면 그것, 없으면 가장 최근.
    @MainActor
    static func activeTrip(_ env: AppEnvironment) async throws -> TripSummary {
        let trips = try await env.service.trips().value
        if let live = trips.first(where: { $0.isLive }) { return live }
        guard let recent = trips.sorted(by: { $0.updatedAt > $1.updatedAt }).first else {
            throw IntentError.noTrip
        }
        return recent
    }

    static func clock(_ minutes: Int) -> String {
        let m = ((minutes % 1440) + 1440) % 1440
        return String(format: "%02d:%02d", m / 60, m % 60)
    }
}

enum IntentError: Error, CustomLocalizedStringResourceConvertible {
    case noTrip
    case ambiguous

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .noTrip: "아직 여행이 없어요. 웹 TripCanvas에서 여행을 만들면 여기서도 보여요."
        case .ambiguous: "지금 어떤 일정인지 확실하지 않아요. 앱에서 확인해 주세요."
        }
    }
}

/// "From J 오늘 일정" — 다음 하나와 그 뒤 두 줄까지만(§6).
struct ShowTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "오늘 일정 보기"
    static var description = IntentDescription("오늘 남은 일정과 다음에 할 일을 알려줍니다.")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog & OpensIntent {
        let env = IntentSupport.makeEnvironment()
        let trip = try await IntentSupport.activeTrip(env)
        let today = try await env.service.today(tripId: trip.id, dayIndex: nil).value

        var lines: [String] = ["\(today.trip.name) · Day \(today.day.index + 1)"]
        if let next = today.nextAction {
            lines.append("다음은 \(next.title)")
            if let start = next.startMinutes { lines.append("\(IntentSupport.clock(start))입니다") }
        } else {
            lines.append(today.activities.isEmpty ? "오늘은 정해둔 일정이 없어요" : "오늘 계획한 일정은 다 마쳤어요")
        }
        // 이후 일정은 두 줄까지만 — Siri로 일정표를 읽어 주지 않는다.
        let rest = today.remainingActivities.dropFirst().prefix(2)
            .map { "\(IntentSupport.clock($0.startMinutes)) \($0.name)" }
        if !rest.isEmpty { lines.append("이후 " + rest.joined(separator: ", ")) }

        return .result(
            opensIntent: OpenTodayIntent(tripId: trip.id),
            dialog: IntentDialog(stringLiteral: lines.joined(separator: ". ")))
    }
}

/// "다음 일정 뭐야?" — 무엇을, 얼마나 걸려서, 언제 나서면 되는지(§7).
struct ShowNextActionIntent: AppIntent {
    static var title: LocalizedStringResource = "다음 일정 보기"
    static var description = IntentDescription("다음 일정과 이동 시간, 나서기 좋은 시간을 알려줍니다.")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let env = IntentSupport.makeEnvironment()
        let trip = try await IntentSupport.activeTrip(env)
        let state = try await env.service.travelState(
            tripId: trip.id, location: nil, locationUpdatedAt: nil,
            travelMode: false, suppressUntil: nil, markSent: false)

        guard let next = state.today.nextAction else {
            return .result(dialog: IntentDialog(stringLiteral: state.pulse.text))
        }
        var sentence = "다음 일정은 \(next.title)이에요"
        if let travel = next.travelMinutes, travel > 0 { sentence += ". 약 \(travel)분 걸려요" }
        // 출발 안내 문장은 서버가 만든 것을 그대로 쓴다 — 여기서 다시 쓰면 톤이 갈라진다.
        if let departure = state.departure { sentence += ". \(departure.text)" }
        return .result(dialog: IntentDialog(stringLiteral: sentence))
    }
}

/// "From J 여행 모드 시작" — 이미 켜져 있으면 다시 켜지 않는다(§8, idempotent).
struct StartTravelModeIntent: AppIntent {
    static var title: LocalizedStringResource = "여행 모드 시작"
    static var description = IntentDescription("다음 일정과 이동 시간을 잠금화면에서 바로 볼 수 있게 합니다.")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let env = IntentSupport.makeEnvironment()
        let trip = try await IntentSupport.activeTrip(env)
        if env.travelMode.isActive {
            return .result(dialog: "여행 모드는 이미 켜져 있어요.")
        }
        await env.travelMode.start(trip: trip)
        Analytics.track(.intentUsed, ["intent": "startTravelMode"])
        return .result(dialog: IntentDialog(stringLiteral: "\(trip.name) 여행 모드를 시작했어요."))
    }
}

struct StopTravelModeIntent: AppIntent {
    static var title: LocalizedStringResource = "여행 모드 끄기"
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let env = IntentSupport.makeEnvironment()
        guard env.travelMode.isActive else { return .result(dialog: "여행 모드는 이미 꺼져 있어요.") }
        await env.travelMode.stop()
        Analytics.track(.intentUsed, ["intent": "stopTravelMode"])
        return .result(dialog: "여행 모드를 껐어요.")
    }
}

/// "지금 일정 완료" — 무엇을 완료할지 **확실할 때만** 처리한다(§9).
/// 애매하면 자동으로 고르지 않고 앱에서 확인하게 한다.
struct CompleteCurrentActivityIntent: AppIntent {
    static var title: LocalizedStringResource = "지금 일정 완료"
    static var description = IntentDescription("지금 하고 있는 일정을 다녀온 것으로 표시합니다.")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog & OpensIntent {
        let env = IntentSupport.makeEnvironment()
        let trip = try await IntentSupport.activeTrip(env)
        let today = try await env.service.today(tripId: trip.id, dayIndex: nil).value

        // 진행 중인 것이 하나로 정해질 때만. 아니면 앱을 연다.
        let inProgress = today.activities.filter { $0.status == .inProgress }
        guard inProgress.count == 1, let target = inProgress.first else {
            return .result(
                opensIntent: OpenTodayIntent(tripId: trip.id),
                dialog: "지금 어떤 일정인지 확실하지 않아요. 앱에서 골라 주세요.")
        }
        let response = try await env.service.setActivity(
            tripId: trip.id, activityId: target.id, action: .complete,
            expectedRevision: today.trip.revision, expectedName: target.name)
        Analytics.track(.intentUsed, ["intent": "completeCurrentActivity"])
        let dialog = response.alreadyApplied
            ? "\(target.name)은 이미 다녀온 것으로 되어 있어요."
            : "\(target.name)을 다녀온 것으로 표시했어요."
        return .result(opensIntent: OpenTodayIntent(tripId: trip.id),
                       dialog: IntentDialog(stringLiteral: dialog))
    }
}

/// 화면으로 넘길 때도 딥링크 체계 하나만 쓴다(§40·§41).
struct OpenTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "오늘 화면 열기"
    static var openAppWhenRun: Bool = true

    @Parameter(title: "여행")
    var tripId: String

    init() { self.tripId = "" }
    init(tripId: String) { self.tripId = tripId }

    @MainActor
    func perform() async throws -> some IntentResult {
        IntentSupport.makeEnvironment().router.open(.today(tripId: tripId.isEmpty ? nil : tripId, focusActivityId: nil))
        return .result()
    }
}

/// Siri가 이름을 알아듣게 하는 문구. 앱 이름을 반드시 포함한다.
struct TripCanvasShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: ShowNextActionIntent(),
                    phrases: ["\(.applicationName) 다음 일정", "\(.applicationName)에서 다음 일정 보여줘"],
                    shortTitle: "다음 일정", systemImageName: "arrow.turn.up.right")
        AppShortcut(intent: ShowTodayIntent(),
                    phrases: ["\(.applicationName) 오늘 일정", "\(.applicationName)에서 오늘 일정 보여줘"],
                    shortTitle: "오늘 일정", systemImageName: "list.bullet")
        AppShortcut(intent: StartTravelModeIntent(),
                    phrases: ["\(.applicationName) 여행 모드 시작", "\(.applicationName) 여행 시작"],
                    shortTitle: "여행 모드 시작", systemImageName: "location.circle")
        AppShortcut(intent: StopTravelModeIntent(),
                    phrases: ["\(.applicationName) 여행 모드 끄기"],
                    shortTitle: "여행 모드 끄기", systemImageName: "location.slash")
        AppShortcut(intent: CompleteCurrentActivityIntent(),
                    phrases: ["\(.applicationName) 지금 일정 완료"],
                    shortTitle: "지금 일정 완료", systemImageName: "checkmark.circle")
    }
}
