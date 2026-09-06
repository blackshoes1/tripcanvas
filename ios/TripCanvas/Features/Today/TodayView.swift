import SwiftUI
import MapKit

/// iOS의 중심 화면. 전체 일정표가 아니라 "지금 무엇을 하면 되는가"에 먼저 답한다(§11·§21).
struct TodayView: View {
    let trip: TripSummary
    @Environment(AppEnvironment.self) private var env
    @State private var model: TodayViewModel?
    /// 시작 전 여행에서 '여행 보기'를 눌렀는가. 이 여행을 보는 동안만 유지된다 —
    /// 다시 들어오면 D-day부터 보인다(어느 화면이 왜 떴는지 예측할 수 있게).
    @State private var showsPlanPreview = false

    var body: some View {
        ScrollView {
            if let model {
                // 아직 시작하지 않은 여행에서는 '지금'이 할 말이 없다 — 며칠 남았는지부터 말한다.
                if let days = model.daysUntilStart, !showsPlanPreview {
                    countdown(days: days, startDate: trip.start)
                } else {
                VStack(alignment: .leading, spacing: Space.l) {
                    header(model)
                    if model.isOffline, let cachedAt = model.cachedAt {
                        Label("오프라인 상태예요 · 마지막 동기화 \(TimeFormat.shortTime(cachedAt))", systemImage: "wifi.slash")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let error = model.errorMessage {
                        InlineErrorBanner(
                            message: "일정을 새로 불러오지 못했어요",
                            detail: model.today == nil ? error : "저장된 일정은 계속 볼 수 있어요."
                        ) { Task { await model.load() } }
                    }

                    if let today = model.today {
                        if let next = today.nextAction, let activity = model.activity(id: next.activityId) {
                            NextActionCard(next: next, activity: activity, isEstimate: model.travelTimeIsEstimate,
                                           isBusy: model.pending.contains(activity.id)) {
                                Task { await model.complete(activity) }
                            }
                        } else if today.activities.isEmpty {
                            EmptyStateView(
                                symbol: "sparkles",
                                title: "오늘은 정해둔 일정이 없어요",
                                message: "아래 제안 중에서 골라 시작해도 되고, 그냥 쉬어도 괜찮아요.")
                                .card()
                        } else {
                            DoneForTodayCard()
                        }

                        if let replan = model.replanSuggestion {
                            ReplanCard(suggestion: replan, preview: today.replan,
                                       isBusy: model.pending.contains(replan.id),
                                       onApply: { Task { await model.accept(replan) } },
                                       onKeep: { Task { await model.dismiss(replan) } })
                        }

                        if !model.otherSuggestions.isEmpty {
                            SectionHeader(title: "지금 하기 좋은 것")
                            ForEach(model.otherSuggestions) { suggestion in
                                SuggestionCard(suggestion: suggestion,
                                               isBusy: model.pending.contains(suggestion.id),
                                               onAccept: { Task { await model.accept(suggestion) } },
                                               onDismiss: { Task { await model.dismiss(suggestion) } })
                            }
                        }

                        if !model.upcomingAfterNext.isEmpty {
                            SectionHeader(title: "오늘 남은 일정")
                            VStack(spacing: Space.s) {
                                ForEach(model.upcomingAfterNext) { activity in
                                    ActivityRow(activity: activity,
                                                isBusy: model.pending.contains(activity.id),
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
                                                isBusy: model.pending.contains(activity.id)) {
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
            } else {
                ProgressView().padding(Space.xl)
            }
        }
        .background(Color(.systemGroupedBackground))
        // 제목(여행 이름)은 `TripHomeView`가 정한다 — 두 형제 화면이 같은 제목을 써야 한다.
        .toolbar {
            // 일정으로 가는 길은 여기 없다 — `TripHomeView`의 세그먼트가 형제로 나란히 놓는다.
            // 함께하기는 여행 하나에 붙는 것이라 여기서 들어간다 — 로그아웃·로컬 전용 여행에는 없다.
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    NavigationLink { CandidateBoardView(trip: trip) } label: { Label("가고 싶은 곳", systemImage: "mappin.and.ellipse") }
                    NavigationLink { CollabView(trip: trip) } label: { Label("함께하기", systemImage: "person.2") }
                } label: {
                    Image(systemName: "person.2")
                }
                .accessibilityLabel("함께하기")
            }
        }
        .refreshable { await model?.load() }
        .task {
            if model == nil { model = TodayViewModel(trip: trip, service: env.service) }
            await model?.load()
        }
        .overlay(alignment: .bottom) {
            if let toast = model?.toast {
                ToastView(text: toast)
                    .padding(Space.l)
                    .task {
                        try? await Task.sleep(for: .seconds(2.5))
                        model?.clearToast()
                    }
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
            SecondaryActionButton(title: "여행 보기", systemImage: "eye") {
                showsPlanPreview = true
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
    let onComplete: () -> Void

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

            HStack(spacing: Space.m) {
                if let travel = next.travelMinutes, travel > 0 {
                    Label(TimeFormat.duration(travel) + (isEstimate ? " (예상)" : ""), systemImage: "arrow.triangle.turn.up.right.circle")
                }
                if let start = next.startMinutes {
                    Label(TimeFormat.clock(start), systemImage: "clock")
                }
                if let stay = next.stayMinutes, stay > 0 {
                    Label(TimeFormat.duration(stay), systemImage: "hourglass")
                }
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)

            if let departure = next.departure {
                // 명령하지 않는다 — 서버가 만든 문장을 그대로 쓴다(§38).
                Text(departure.text)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(departure.level == .late ? Color.red : .primary)
            }

            if activity.isFixedCommitment {
                StatusChip(text: "예약된 일정", symbol: "lock.fill", tint: .blue)
            }

            HStack(spacing: Space.s) {
                if let location = next.location {
                    SecondaryActionButton(title: "길찾기", systemImage: "map") {
                        MapLauncher.open(location: location, name: next.title)
                    }
                }
                PrimaryActionButton(title: "다녀왔어요", systemImage: "checkmark", isBusy: isBusy, action: onComplete)
            }
        }
        .card()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("다음 일정 \(next.title), \(StatusPalette.label(for: next.status))")
    }
}

struct ActivityRow: View {
    let activity: ActivitySummary
    let isBusy: Bool
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
                        StatusChip(text: "예약됨", symbol: "lock.fill", tint: .blue)
                    }
                    if activity.mustVisit {
                        StatusChip(text: "꼭 가기", symbol: "star.fill", tint: .orange)
                    }
                }
                if !activity.desc.isEmpty {
                    Text(activity.desc).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
        .card()
        // 한 번의 터치로 처리되게 — 메뉴 안으로 숨기지 않는다(§17).
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(action: onSkip) { Label("건너뛰기", systemImage: "arrow.uturn.forward") }.tint(.orange)
            Button(action: onComplete) { Label("다녀옴", systemImage: "checkmark") }.tint(.green)
        }
        .contextMenu {
            Button("다녀왔어요", systemImage: "checkmark", action: onComplete)
            Button("건너뛰기", systemImage: "arrow.uturn.forward", action: onSkip)
        }
        .overlay(alignment: .topTrailing) {
            if isBusy { ProgressView().controlSize(.small).padding(Space.m) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityActions {
            Button("다녀왔어요", action: onComplete)
            Button("건너뛰기", action: onSkip)
        }
    }
}

struct FinishedRow: View {
    let activity: ActivitySummary
    let isBusy: Bool
    let onUndo: () -> Void

    var body: some View {
        HStack(spacing: Space.m) {
            Image(systemName: activity.status == .completed ? "checkmark.circle.fill" : "arrow.uturn.forward.circle")
                .foregroundStyle(activity.status == .completed ? Color.green : .secondary)
            Text(activity.name)
                .strikethrough(activity.status == .completed)
                .foregroundStyle(.secondary)
            Spacer()
            Button("되돌리기", action: onUndo)
                .font(.caption)
                .disabled(isBusy)
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
                                .tint(activity.id == next?.activityId ? .red : .blue)
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
