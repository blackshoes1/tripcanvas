import SwiftUI
import MapKit

/// iOS의 중심 화면. 전체 일정표가 아니라 "지금 무엇을 하면 되는가"에 먼저 답한다(§11·§21).
struct TodayView: View {
    let trip: TripSummary
    /// **여행이 들고 있는** 모델(`TripScreenModels`). 이 화면은 탭을 바꾸면 죽지만 모델은 남는다 —
    /// 그래서 돌아왔을 때 서버를 기다리지 않고 마지막 내용이 그대로 보인다.
    let model: TodayViewModel
    @Environment(AppEnvironment.self) private var env
    @Environment(\.scenePhase) private var scenePhase
    @State private var showsTravelSetup = false

    var body: some View {
        ScrollView {
                // 아직 시작하지 않은 여행에서는 '지금'이 할 말이 없다 — 며칠 남았는지부터 말한다.
                // '여행 보기'를 눌렀는지는 모델이 기억한다 — 탭을 오갔다고 D-day로 되돌아가지 않는다.
                if let days = model.daysUntilStart, !model.showsPlanPreview {
                    countdown(days: days, startDate: trip.start)
                } else {
                VStack(alignment: .leading, spacing: Space.l) {
                    header(model)
                    if model.isOffline, let cachedAt = model.cachedAt {
                        Label("오프라인 상태예요 · 마지막 동기화 \(TimeFormat.shortTime(cachedAt))", systemImage: "wifi.slash")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    travelModeSection
                    if !model.canEdit {
                        Label("일정을 볼 수 있는 권한이에요", systemImage: "eye")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if let error = model.loadErrorMessage {
                        InlineErrorBanner(
                            message: "일정을 새로 불러오지 못했어요",
                            detail: error
                        ) { Task { await model.load() } }
                    }

                    if let error = model.actionErrorMessage {
                        VStack(alignment: .leading, spacing: Space.s) {
                            Label(model.actionErrorTitle ?? "변경을 확인해 주세요", systemImage: "exclamationmark.circle")
                                .font(.subheadline.weight(.semibold))
                            Text(error).font(.caption).foregroundStyle(.secondary)
                            HStack {
                                if model.canRetryAction {
                                    Button(model.isRetrying ? "확인 중…" : "다시 저장") { Task { await model.retryAction() } }
                                        .disabled(model.isRetrying || !model.pending.isEmpty).frame(minHeight: 44)
                                }
                                Button("닫기") { model.dismissActionError() }.frame(minHeight: 44)
                            }
                        }
                        .card()
                    }
                    if let today = model.today {
                        if let next = today.nextAction, let activity = model.activity(id: next.activityId) {
                            NextActionCard(next: next, activity: activity, isEstimate: model.travelTimeIsEstimate,
                                           isBusy: !model.pending.isEmpty || model.isRetrying, canEdit: model.canEdit,
                                           onComplete: { Task { await model.complete(activity) } },
                                           onSkip: { Task { await model.skip(activity) } })
                        } else if today.activities.isEmpty {
                            EmptyStateView(
                                symbol: "sparkles",
                                title: "오늘은 정해둔 일정이 없어요",
                                message: model.canEdit
                                    ? "아래 제안 중에서 골라 시작해도 되고, 그냥 쉬어도 괜찮아요."
                                    : "일행이 일정을 추가하면 여기서 확인할 수 있어요.")
                                .card()
                        } else {
                            DoneForTodayCard()
                        }

                        if model.canEdit, let replan = model.replanSuggestion {
                            ReplanCard(suggestion: replan, preview: today.replan,
                                       isBusy: !model.pending.isEmpty || model.isRetrying,
                                       onApply: { Task { await model.accept(replan) } },
                                       onKeep: { Task { await model.dismiss(replan) } })
                        }

                        if model.canEdit && !model.otherSuggestions.isEmpty {
                            SectionHeader(title: "지금 하기 좋은 것")
                            ForEach(model.otherSuggestions) { suggestion in
                                SuggestionCard(suggestion: suggestion,
                                               isBusy: !model.pending.isEmpty || model.isRetrying,
                                               onAccept: { Task { await model.accept(suggestion) } },
                                               onDismiss: { Task { await model.dismiss(suggestion) } })
                            }
                        }

                        if !model.upcomingAfterNext.isEmpty {
                            SectionHeader(title: "오늘 남은 일정")
                            VStack(spacing: Space.s) {
                                ForEach(model.upcomingAfterNext) { activity in
                                    ActivityRow(activity: activity,
                                                isBusy: !model.pending.isEmpty || model.isRetrying, canEdit: model.canEdit,
                                                onComplete: { Task { await model.complete(activity) } },
                                                onSkip: { Task { await model.skip(activity) } })
                                }
                            }
                        }

                        let done = today.activities.filter { $0.status.isDone }
                        if !done.isEmpty {
                            SectionHeader(title: "마무리한 일정")
                            VStack(spacing: Space.s) {
                                ForEach(done) { activity in
                                    FinishedRow(activity: activity,
                                                isBusy: !model.pending.isEmpty || model.isRetrying, canEdit: model.canEdit) {
                                        Task { await model.undo(activity) }
                                    }
                                }
                            }
                        }

                        TodayMapCard(activities: today.activities, next: today.nextAction)

                        NavigationLink {
                            BookingListView(trip: trip)
                        } label: {
                            Label("예약 정보 보기", systemImage: "ticket")
                                .frame(maxWidth: .infinity, minHeight: 48)
                        }
                        .buttonStyle(.bordered)
                    } else if model.isLoading {
                        ProgressView("오늘 일정을 불러오는 중")
                            .frame(maxWidth: .infinity, minHeight: 200)
                    }
                }
                .padding(Space.l)
                }
        }
        .background(Color(.systemGroupedBackground))
        // 제목(여행 이름)은 `TripHomeView`가 정한다 — 두 형제 화면이 같은 제목을 써야 한다.
        .paperGround()
        .refreshable { await refreshToday(reason: .manual) }
        .task {
            // 탭 진입 — 방금 받은 내용이 있으면 그대로 두고, 오래됐을 때만 뒤에서 새로 받는다.
            // 여행 모드 갱신도 실제로 서버에 물었을 때만 따라간다(탭 전환은 앱 복귀가 아니다).
            if await model.loadIfStale() { await refreshTravelMode(reason: .foreground) }
        }
        .onChange(of: scenePhase) { _, phase in
            // 앱 복귀 — 방금 받은 것이면 오늘을 다시 묻지 않는다(2026-09-18, 짧은 앱 전환마다 2건이 나갔다).
            // 여행 모드는 위치·시각이 바뀌었으니 그대로 갱신한다(`refreshTravelMode`는 켜져 있을 때만 나간다).
            if phase == .active { Task { await model.loadIfStale(); await refreshTravelMode(reason: .foreground) } }
        }
        .onChange(of: model.revision) { old, new in
            if old != new { Task { await refreshTravelMode(reason: .userAction) } }
        }
        .sheet(isPresented: $showsTravelSetup) {
            TravelModeSetupView {
                await env.travelMode.start(trip: model.today?.trip ?? trip)
            }
        }
        .overlay(alignment: .bottom) {
            if let toast = model.toast {
                ToastView(text: toast)
                    .padding(Space.l)
                    .task {
                        try? await Task.sleep(for: .seconds(2.5))
                        model.clearToast()
                    }
            }
        }
    }

    private func refreshToday(reason: TravelModeController.RefreshReason) async {
        await model.load()
        await refreshTravelMode(reason: reason)
    }

    private func refreshTravelMode(reason: TravelModeController.RefreshReason) async {
        guard env.travelMode.isActive, env.travelMode.snapshot.tripId == trip.id else { return }
        await env.push.refreshPermission()
        await env.travelMode.refresh(tripId: trip.id, reason: reason)
    }

    private func stopTravelMode() async {
        model.deferredTravelInvite = true
        await env.travelMode.stop()
    }

    @ViewBuilder
    private var travelModeSection: some View {
        if env.travelMode.isActive, env.travelMode.snapshot.tripId == trip.id {
            if let pulse = env.travelMode.travelState?.pulse {
                TripPulseBar(pulse: pulse, travelModeOn: true) { Task { await stopTravelMode() } }
            } else {
                HStack {
                    Label("여행 중", systemImage: "location.fill")
                    Spacer()
                    Button("여행 종료") { Task { await stopTravelMode() } }.frame(minHeight: 44)
                }
                .card()
            }
            if let error = env.travelMode.lastError {
                InlineErrorBanner(message: "여행 안내를 새로 확인하지 못했어요", detail: error) {
                    Task { await refreshTravelMode(reason: .manual) }
                }
            }
        } else if env.travelMode.shouldOfferStart(for: model.today?.trip ?? trip) {
            if model.deferredTravelInvite {
                Button { showsTravelSetup = true } label: {
                    Label("여행 시작", systemImage: "play.fill").frame(minHeight: 44)
                }
            } else {
                TravelModeInviteCard(tripName: trip.name, isBusy: false,
                                     onStart: { showsTravelSetup = true },
                                     onLater: { model.deferredTravelInvite = true })
            }
        }
    }

    @ViewBuilder
    /// 출발까지 며칠 남았는지. 숫자는 서버가 센다 — 앱이 세면 여행지의 오늘과 어긋난다.
    private func countdown(days: Int, startDate: String) -> some View {
        VStack(spacing: Space.m) {
            Spacer(minLength: Space.xl)
            Text("D-\(days)")
                .font(.system(size: 56, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(Color.accentColor)
            if let label = TimeFormat.dayChipLabel(startDate) {
                Text("\(label) 출발").font(.headline).foregroundStyle(.secondary)
            }
            Text("아직 여행 전이에요. 일정 탭에서 계획을 다듬어 두세요.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            // 막아 두는 것이 아니라 기본이 D-day라는 뜻이다 — 눌러서 볼 수 있다.
            // 여행 전의 '지금'은 준비다 — 예약 정보로 바로 간다(항공·숙박·렌터카).
            HStack(spacing: Space.s) {
                SecondaryActionButton(title: "여행 보기", systemImage: "eye") {
                    model.showsPlanPreview = true
                }
                NavigationLink { BookingListView(trip: trip) } label: {
                    Label("예약 정보", systemImage: "ticket").frame(minHeight: 44)
                }
                .buttonStyle(.bordered)
                .tint(Ink.ink)
            }
            .padding(.top, Space.s)
            Spacer(minLength: Space.xl)
        }
        .frame(maxWidth: .infinity)
        .padding(Space.l)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("출발까지 \(days)일 남았어요")
    }

    private func header(_ model: TodayViewModel) -> some View {
        VStack(alignment: .leading, spacing: Space.s) {
            HStack(spacing: Space.s) {
                Text(model.today.map { "Day \($0.day.index + 1)" } ?? "Day —")
                    .font(.subheadline.weight(.semibold))
                if let state = model.today?.currentState, state.live {
                    Text(TimeFormat.clock(state.nowMinutes))
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                Spacer()
                StatusChip(text: StatusPalette.label(for: model.status),
                           symbol: StatusPalette.symbol(for: model.status),
                           tint: StatusPalette.tint(for: model.status))
            }
            if let title = model.today?.day.title, !title.isEmpty {
                Text(title).font(.title3.weight(.bold))
            }
        }
    }
}

struct SectionHeader: View {
    let title: String
    var body: some View {
        Text(title)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.top, Space.s)
            .accessibilityAddTraits(.isHeader)
    }
}

struct ToastView: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.subheadline)
            .padding(.horizontal, Space.l)
            .padding(.vertical, Space.m)
            .background(.thinMaterial, in: Capsule())
            .accessibilityAddTraits(.updatesFrequently)
    }
}

struct DoneForTodayCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            Label("오늘 계획한 일정은 다 마쳤어요", systemImage: "checkmark.circle")
                .font(.headline)
            Text("남은 시간은 그냥 쉬어도 좋아요.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .card()
    }
}

/// 다음 일정 — 화면에서 가장 큰 덩어리. 여기서 길찾기와 완료가 한 번에 끝나야 한다(§46).
struct NextActionCard: View {
    let next: NextAction
    let activity: ActivitySummary
    let isEstimate: Bool
    let isBusy: Bool
    var canEdit = true
    let onComplete: () -> Void
    var onSkip: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            Text("다음 일정")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            HStack(alignment: .firstTextBaseline, spacing: Space.s) {
                Image(systemName: next.type.symbol)
                    .foregroundStyle(.secondary)
                Text(next.title).font(.title2.weight(.bold))
            }

            // 실행에 필요한 사실만 — 출발 · 도착 · 이동 · 머무름. 두 알씩 줄을 바꿔 좁은 화면에서도 넘치지 않는다.
            let facts = NextActionCard.facts(next, isEstimate: isEstimate)
            if !facts.isEmpty {
                VStack(alignment: .leading, spacing: Space.xs) {
                    ForEach(Array(stride(from: 0, to: facts.count, by: 2)), id: \.self) { start in
                        HStack(spacing: Space.xs) {
                            ForEach(facts[start..<min(start + 2, facts.count)], id: \.self) { fact in
                                LegPill(symbol: fact.symbol, text: fact.text)
                            }
                        }
                    }
                }
            }

            if let departure = next.departure {
                // 명령하지 않는다 — 서버가 만든 문장을 그대로 쓴다(§38).
                Text(departure.text)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(departure.level == .late ? Ink.danger : Ink.ink)
            }

            if activity.isFixedCommitment {
                StatusChip(text: "예약된 일정", symbol: "lock.fill", tint: Ink.info)
            }

            VStack(spacing: Space.s) {
                if !NextActionCard.prioritizesCompletion(next.status), let location = next.location {
                    PrimaryActionButton(title: "길찾기", systemImage: "map") {
                        MapLauncher.open(location: location, name: next.title)
                    }
                }
                if canEdit {
                    if NextActionCard.prioritizesCompletion(next.status) || next.location == nil {
                        PrimaryActionButton(title: "다녀왔어요", systemImage: "checkmark", isBusy: isBusy, action: onComplete)
                    } else {
                        SecondaryActionButton(title: "다녀왔어요", systemImage: "checkmark", action: onComplete)
                            .disabled(isBusy)
                    }
                }
                HStack {
                    if NextActionCard.prioritizesCompletion(next.status), let location = next.location {
                        SecondaryActionButton(title: "길찾기", systemImage: "map") {
                            MapLauncher.open(location: location, name: next.title)
                        }
                    }
                    if canEdit {
                        SecondaryActionButton(title: "건너뛰기", systemImage: "arrow.uturn.forward", action: onSkip)
                            .disabled(isBusy)
                    }
                }
            }
        }
        .card()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("다음 일정 \(next.title), \(StatusPalette.label(for: next.status))")
    }
}

extension NextActionCard {
    static func prioritizesCompletion(_ status: TravelStatus) -> Bool {
        status == .arrived || status == .inProgress || status == .completed
    }

    struct Fact: Hashable {
        let symbol: String
        let text: String
    }

    /// 카드에 보일 사실들 — 출발(서버가 정한 시각) → 도착 예정 → 이동 → 머무름. 없는 것은 말하지 않는다.
    /// 도착 예정이 없을 때만 시작 시각을 대신 말한다(둘 다 두면 같은 시각이 두 번 보인다).
    static func facts(_ next: NextAction, isEstimate: Bool) -> [Fact] {
        var out: [Fact] = []
        if let departure = next.departure {
            out.append(Fact(symbol: "figure.walk.departure", text: "출발 \(TimeFormat.clock(departure.leaveMinutes))"))
        }
        if let eta = next.etaMinutes {
            out.append(Fact(symbol: "mappin.and.ellipse", text: "도착 \(TimeFormat.clock(eta))"))
        } else if let start = next.startMinutes {
            out.append(Fact(symbol: "clock", text: TimeFormat.clock(start)))
        }
        if let travel = next.travelMinutes, travel > 0 {
            out.append(Fact(symbol: "arrow.triangle.turn.up.right.circle", text: "이동 \(TimeFormat.duration(travel))\(isEstimate ? " 예상" : "")"))
        }
        if let stay = next.stayMinutes, stay > 0 {
            out.append(Fact(symbol: "hourglass", text: "\(TimeFormat.duration(stay)) 머무름"))
        }
        return out
    }
}

struct ActivityRow: View {
    let activity: ActivitySummary
    let isBusy: Bool
    var canEdit = true
    let onComplete: () -> Void
    let onSkip: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: Space.m) {
            VStack(spacing: Space.xs) {
                Text(TimeFormat.clock(activity.startMinutes))
                    .font(.subheadline.monospacedDigit().weight(.semibold))
                Image(systemName: activity.type.symbol)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(width: 52)

            VStack(alignment: .leading, spacing: Space.xs) {
                HStack(spacing: Space.s) {
                    Text(activity.name).font(.body.weight(.semibold))
                    if activity.isFixedCommitment {
                        StatusChip(text: "예약됨", symbol: "lock.fill", tint: Ink.info)
                    }
                    if activity.mustVisit {
                        StatusChip(text: "꼭 가기", symbol: "star.fill", tint: Ink.warning)
                    }
                }
                if !activity.desc.isEmpty {
                    Text(activity.desc).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            if canEdit {
                Menu {
                    Button("다녀왔어요", systemImage: "checkmark", action: onComplete)
                    Button("건너뛰기", systemImage: "arrow.uturn.forward", action: onSkip)
                } label: {
                    Image(systemName: "ellipsis").frame(minWidth: 44, minHeight: 44)
                }
                .disabled(isBusy)
                .accessibilityLabel("\(activity.name) 작업")
            }
        }
        .card()
        // 한 번의 터치로 처리되게 — 메뉴 안으로 숨기지 않는다(§17).
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if canEdit {
                Button(action: onSkip) { Label("건너뛰기", systemImage: "arrow.uturn.forward") }.tint(Ink.warning)
                Button(action: onComplete) { Label("다녀옴", systemImage: "checkmark") }.tint(Ink.positive)
            }
        }
        .contextMenu {
            if canEdit {
                Button("다녀왔어요", systemImage: "checkmark", action: onComplete)
                Button("건너뛰기", systemImage: "arrow.uturn.forward", action: onSkip)
            }
        }
        .overlay(alignment: .topTrailing) {
            if isBusy { ProgressView().controlSize(.small).padding(Space.m) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityActions {
            if canEdit {
                Button("다녀왔어요", action: onComplete)
                Button("건너뛰기", action: onSkip)
            }
        }
    }
}

struct FinishedRow: View {
    let activity: ActivitySummary
    let isBusy: Bool
    var canEdit = true
    let onUndo: () -> Void

    var body: some View {
        HStack(spacing: Space.m) {
            Image(systemName: activity.status == .completed ? "checkmark.circle.fill" : "arrow.uturn.forward.circle")
                .foregroundStyle(activity.status == .completed ? Ink.positive : Ink.soft)
            Text(activity.name)
                .strikethrough(activity.status == .completed)
                .foregroundStyle(.secondary)
            Spacer()
            if canEdit {
                Button("되돌리기", action: onUndo)
                    .font(.caption)
                    .disabled(isBusy)
                    .frame(minWidth: 44, minHeight: 44)
            }
        }
        .padding(.horizontal, Space.l)
        .padding(.vertical, Space.m)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: Radius.card))
        .accessibilityElement(children: .combine)
    }
}

/// 지도는 보기용이다 — 편집기를 만들지 않는다(§21).
struct TodayMapCard: View {
    let activities: [ActivitySummary]
    let next: NextAction?

    private var points: [ActivitySummary] { activities.filter { $0.location != nil } }

    var body: some View {
        if points.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: Space.s) {
                Text("오늘의 위치").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                Map {
                    ForEach(points) { activity in
                        if let location = activity.location {
                            Marker(activity.name, systemImage: activity.type.symbol,
                                   coordinate: CLLocationCoordinate2D(latitude: location.lat, longitude: location.lng))
                                .tint(activity.id == next?.activityId ? Ink.accent : Ink.info)
                        }
                    }
                    UserAnnotation()
                }
                .mapControls { MapUserLocationButton() }
                .frame(height: 220)
                .clipShape(RoundedRectangle(cornerRadius: Radius.card))
                .accessibilityLabel("오늘 방문할 장소 \(points.count)곳이 표시된 지도")
            }
        }
    }
}

/// 앱 안에 길찾기 엔진을 만들지 않는다 — Apple 지도로 넘긴다(§23).
enum MapLauncher {
    static func open(location: GeoPoint, name: String) {
        let placemark = MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: location.lat, longitude: location.lng))
        let item = MKMapItem(placemark: placemark)
        item.name = name
        item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDefault])
    }
}
