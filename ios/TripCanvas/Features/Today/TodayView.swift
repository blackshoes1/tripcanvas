import SwiftUI
import MapKit

/// iOS의 중심 화면. 전체 일정표가 아니라 "지금 무엇을 하면 되는가"에 먼저 답한다(§11·§21).
struct TodayView: View {
    let trip: TripSummary
    /// **여행이 들고 있는** 모델(`TripScreenModels`). 이 화면은 탭을 바꾸면 죽지만 모델은 남는다 —
    /// 그래서 돌아왔을 때 서버를 기다리지 않고 마지막 내용이 그대로 보인다.
    let model: TodayViewModel
    let onOpenPlan: () -> Void
    @State private var coverRefresh = UUID()
    @Environment(AppEnvironment.self) private var env
    @Environment(\.scenePhase) private var scenePhase
    @State private var showsTravelSetup = false
    /// 입력 중인 문장. 모델이 든 것(`intentText`)은 **적용된** 문장이라 따로 둔다 —
    /// 타이핑마다 서버를 부르지 않고, 보낸 뒤에도 고치던 글이 사라지지 않는다.
    @State private var intentDraft = ""

    var body: some View {
        ScrollView {
                // 아직 시작하지 않은 여행에서는 '지금'이 할 말이 없다 — 며칠 남았는지부터 말한다.
                // '여행 보기'를 눌렀는지는 모델이 기억한다 — 탭을 오갔다고 D-day로 되돌아가지 않는다.
                if let days = countdownDays, !model.showsPlanPreview {
                    countdown(days: days)
                } else if isFinished, !model.showsPlanPreview {
                    finished
                } else {
                VStack(alignment: .leading, spacing: Space.l) {
                    if (countdownDays != nil || isFinished), model.showsPlanPreview {
                        Button { model.showsPlanPreview = false } label: {
                            Label(isFinished ? "지난 여행으로 돌아가기" : "여행 준비로 돌아가기", systemImage: "chevron.left")
                                .font(.subheadline).frame(minHeight: 44)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Ink.accent)
                    }
                    header(model)
                    if model.isOffline, let cachedAt = model.cachedAt {
                        Label("오프라인 상태예요 · 마지막 동기화 \(TimeFormat.shortTime(cachedAt))", systemImage: "wifi.slash")
                            .font(.caption)
                            .foregroundStyle(Ink.soft)
                    }
                    travelModeActiveSection
                    if model.today != nil, model.isOutsideTrip {
                        // 기간 밖의 1일차는 오늘이 아니다 — 보기만 하고, 바꾸는 것은 `일정`에서 한다.
                        Label("여행 기간이 아니라서 Day 1을 미리 보여 드려요. 완료·건너뛰기는 여행 중에만 할 수 있어요.",
                              systemImage: "eye")
                            .font(.caption).foregroundStyle(Ink.soft)
                    }
                    if !model.canEdit {
                        Label("일정을 볼 수 있는 권한이에요", systemImage: "eye")
                            .font(.caption).foregroundStyle(Ink.soft)
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
                            Text(error).font(.caption).foregroundStyle(Ink.soft)
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
                                           isBusy: !model.pending.isEmpty || model.isRetrying, canEdit: model.canAct,
                                           onComplete: { Task { await model.complete(activity) } },
                                           onSkip: { Task { await model.skip(activity) } })
                        } else if today.activities.isEmpty {
                            EmptyStateView(
                                symbol: "sparkles",
                                title: "오늘은 정해둔 일정이 없어요",
                                message: model.canAct
                                    ? "아래 제안 중에서 골라 시작해도 되고, 그냥 쉬어도 괜찮아요."
                                    : "일행이 일정을 추가하면 여기서 확인할 수 있어요.")
                                .card()
                        } else {
                            DoneForTodayCard(tone: env.jTone.selected)
                        }

                        if model.canAct, let replan = model.replanSuggestion {
                            ReplanCard(suggestion: replan, preview: today.replan,
                                       isBusy: !model.pending.isEmpty || model.isRetrying, tone: env.jTone.selected,
                                       onApply: { Task { await model.accept(replan) } },
                                       onKeep: { Task { await model.dismiss(replan) } })
                        } else if let notice = today.notice, !notice.isEmpty {
                            // 뺄 수 있는 일정이 없거나 조정 카드를 오늘 넘겼을 때도 늦는다는 사실은 말한다 — 웹과 같은 엔진 문장.
                            // 전에는 이 경우 하루 한 마디('일정을 조금 손보면 좋겠어요')뿐이라 무엇이 문제인지 몰랐다.
                            Label(notice, systemImage: "clock.badge.exclamationmark")
                                .font(.subheadline)
                                .foregroundStyle(Ink.warning)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .card()
                        }

                        // 하루 전체를 한 장에 — 다녀온 곳은 흐리게, 다음 일정은 표시만(할 일은 위 카드에 있다).
                        // 2026-09-27 전에는 '남은 일정'과 '마무리한 일정'이 따로였고 줄마다 카드라 하루의 흐름이 안 보였다.
                        if today.activities.contains(where: { $0.id != today.nextAction?.activityId }) {
                            SectionHeader(title: "오늘 일정", actionTitle: "일정 전체", action: onOpenPlan)
                            TodayTimelineCard(activities: today.activities, nextId: today.nextAction?.activityId,
                                              isBusy: !model.pending.isEmpty || model.isRetrying, canEdit: model.canAct,
                                              onComplete: { activity in Task { await model.complete(activity) } },
                                              onSkip: { activity in Task { await model.skip(activity) } },
                                              onUndo: { activity in Task { await model.undo(activity) } })
                        }

                        if model.canAct && !model.otherSuggestions.isEmpty {
                            SectionHeader(title: "지금 하기 좋은 것")
                            ForEach(model.otherSuggestions) { suggestion in
                                let target = model.activity(id: suggestion.action.activityId)
                                SuggestionCard(suggestion: suggestion,
                                               isBusy: !model.pending.isEmpty || model.isRetrying, tone: env.jTone.selected,
                                               target: target,
                                               onComplete: target.map { activity in { Task { await model.complete(activity) } } },
                                               onAccept: { Task { await model.accept(suggestion) } },
                                               onDismiss: { Task { await model.dismiss(suggestion) } })
                            }
                        }

                        if model.canAct {
                            IntentField(text: $intentDraft,
                                        echo: model.intentEcho,
                                        energy: model.energy,
                                        isBusy: model.isLoading,
                                        onSubmit: { Task { await model.applyIntent(intentDraft) } },
                                        onClear: { intentDraft = ""; Task { await model.clearIntent() } },
                                        onEnergy: { level in Task { await model.setEnergy(level) } })
                        }

                        // '여행 중' 권유는 할 일들 **아래**의 얇은 띠다 — 지금 할 일보다 먼저 읽히면 안 된다.
                        travelModeInviteSection

                        TodayMapCard(activities: today.activities, next: today.nextAction)

                        NavigationLink {
                            BookingListView(trip: trip)
                        } label: {
                            HStack(spacing: Space.m) {
                                Image(systemName: "ticket").foregroundStyle(Ink.accent)
                                Text("예약 정보 보기").foregroundStyle(Ink.ink)
                                Spacer()
                                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Ink.faint)
                            }
                            .frame(minHeight: 32)
                            .card()
                        }
                        .buttonStyle(.plain)
                    } else if model.isLoading {
                        ProgressView("오늘 일정을 불러오는 중")
                            .frame(maxWidth: .infinity, minHeight: 200)
                    }
                }
                .padding(Space.l)
                }
        }
        // ⚠️ 여기에 배경을 두지 않는다 — 먼저 붙은 배경이 위에 깔려 `paperGround()`의 종이를 덮는다.
        // 제목(여행 이름)은 `TripHomeView`가 정한다 — 두 형제 화면이 같은 제목을 써야 한다.
        .paperGround()
        .onChange(of: env.jTone.refreshVersion) { _, _ in
            Task { await refreshToday(reason: .userAction) }
        }
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
        coverRefresh = UUID()
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
    private var travelModeActiveSection: some View {
        if env.travelMode.isActive, env.travelMode.snapshot.tripId == trip.id {
            if let pulse = env.travelMode.travelState?.pulse {
                TripPulseBar(pulse: pulse, travelModeOn: true) { Task { await stopTravelMode() } }
            } else {
                HStack {
                    Label("여행 중", systemImage: "location.fill")
                    Spacer()
                    // '여행 종료'는 여행 자체를 끝내는 말로 읽힌다 — 끄는 것은 안내다.
                    Button("안내 끄기") { Task { await stopTravelMode() } }.frame(minHeight: 44)
                }
                .card()
            }
            if let error = env.travelMode.lastError {
                InlineErrorBanner(message: "여행 안내를 새로 확인하지 못했어요", detail: error) {
                    Task { await refreshTravelMode(reason: .manual) }
                }
            }
        }
    }

    @ViewBuilder
    private var travelModeInviteSection: some View {
        let active = env.travelMode.isActive && env.travelMode.snapshot.tripId == trip.id
        if !active, !model.isOutsideTrip, env.travelMode.shouldOfferStart(for: model.today?.trip ?? trip) {
            if model.deferredTravelInvite {
                Button { showsTravelSetup = true } label: {
                    Label("여행 중 안내 켜기", systemImage: "location").frame(minHeight: 44)
                }
            } else {
                TravelModeInviteCard(tripName: trip.name, isBusy: false,
                                     onStart: { showsTravelSetup = true },
                                     onLater: { model.deferredTravelInvite = true })
            }
        }
    }

    /// 끝난 여행 — '오늘'이 없다. 1일차를 오늘처럼 보이지 않고 다시 보기로 보낸다.
    private var isFinished: Bool { (model.today?.trip ?? trip).isFinished }

    private var finished: some View {
        let summary = model.today?.trip ?? trip
        return VStack(spacing: Space.m) {
            TripCoverView(trip: summary, api: env.service.api, cache: env.service.cache, cacheScope: env.service.cacheScope,
                          refresh: coverRefresh, isHero: true, onOpen: {})
            VStack(alignment: .leading, spacing: Space.s) {
                Text("여행이 끝났어요").font(.title3.weight(.bold))
                Text("다녀온 일정과 비용은 그대로 남아 있어요. 일정에서 다시 보거나 고칠 수 있어요.")
                    .font(.subheadline).foregroundStyle(Ink.soft)
                Button(action: onOpenPlan) {
                    Label("일정 다시 보기", systemImage: "list.bullet").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
            if let error = model.loadErrorMessage {
                InlineErrorBanner(message: "여행 정보를 새로 불러오지 못했어요", detail: error) {
                    Task { await model.load() }
                }
            }
            Button("Day 1 화면 미리보기") { model.showsPlanPreview = true }
                .font(.footnote)
                .foregroundStyle(Ink.soft)
                .buttonStyle(.plain)
                .frame(minHeight: 44)
        }
        .padding(Space.l)
    }

    // 첫 응답 전에도 목록에서 받은 서버 요약으로 출발 안내를 보여 준다.
    private var countdownDays: Int? {
        model.daysUntilStart ?? (model.today == nil && trip.isUpcoming ? trip.daysUntilStart : nil)
    }

    private func countdown(days: Int) -> some View {
        let summary = model.today?.trip ?? trip
        return VStack(spacing: Space.m) {
            VStack(spacing: -Space.l) {
                TripCoverView(trip: summary, api: env.service.api, cache: env.service.cache, cacheScope: env.service.cacheScope,
                              refresh: coverRefresh, isHero: true, onOpen: {})
                TripDepartureCard(trip: summary, days: days, onOpenPlan: onOpenPlan, tone: env.jTone.selected)
            }
            if model.isOffline, let cachedAt = model.cachedAt {
                OfflineNotice(savedAt: cachedAt)
            }
            if let error = model.loadErrorMessage {
                InlineErrorBanner(message: "여행 정보를 새로 불러오지 못했어요", detail: error) {
                    Task { await model.load() }
                }
            }
            Button("Day 1 화면 미리보기") { model.showsPlanPreview = true }
                .font(.footnote)
                .foregroundStyle(Ink.soft)
                .buttonStyle(.plain)
                .frame(minHeight: 44)
        }
        .padding(Space.l)
    }

    /// 머리 — 모노 메타 한 줄(몇째 날 · 날짜 · 지금 시각)과 명조 제목 하나. 제목이 화면에서 가장 먼저 읽힌다.
    private func header(_ model: TodayViewModel) -> some View {
        VStack(alignment: .leading, spacing: Space.s) {
            HStack(spacing: Space.s) {
                Text(Self.metaLine(model.today, dayCount: (model.today?.trip ?? trip).dayCount,
                                   preview: model.isOutsideTrip))
                    .metaLabel()
                Spacer()
                // 아직 받지 못했으면 상태를 말하지 않는다 — '일정 없음'은 받아 본 뒤에만 할 수 있는 말이다.
                if model.today != nil, !model.isOutsideTrip {
                    StatusChip(text: StatusPalette.label(for: model.status),
                               symbol: StatusPalette.symbol(for: model.status),
                               tint: StatusPalette.tint(for: model.status))
                }
            }
            if let day = model.today?.day {
                Text(day.title.isEmpty ? "Day \(day.index + 1)" : day.title)
                    .font(Typeface.editorial(.title))
                    .foregroundStyle(Ink.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// `DAY 2 / 5 · 10.26 일 · 14:00`. 날짜가 없는 여행이면 그 조각을 빼고, 시각은 여행 중일 때만 말한다.
    static func metaLine(_ today: TodayResponse?, dayCount: Int, preview: Bool) -> String {
        guard let today else { return "불러오는 중" }
        var parts = ["Day \(today.day.index + 1) / \(dayCount)"]
        if let date = TimeFormat.dayChipDate(today.day.date) { parts.append(date) }
        if preview { parts.append("미리보기") }
        else if today.currentState.live { parts.append(TimeFormat.clock(today.currentState.nowMinutes)) }
        return parts.joined(separator: " · ")
    }
}

/// 섹션 머리 — 본문과 같은 잉크의 굵은 글자. 2026-09-27 전에는 흐린 작은 글자라 섹션이 어디서 갈리는지 안 보였다.
struct SectionHeader: View {
    let title: String
    var actionTitle: String? = nil
    var action: () -> Void = {}

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.headline)
                .foregroundStyle(Ink.ink)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            if let actionTitle {
                Button(actionTitle, action: action)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Ink.accent)
                    .buttonStyle(.plain)
                    .frame(minHeight: 44)
            }
        }
        .padding(.top, Space.m)
        .padding(.horizontal, Space.xs)
    }
}

struct ToastView: View {
    let text: String
    /// 방금 한 일을 되돌리는 것처럼 **그 자리에서** 할 수 있는 한 가지. 없으면 글자만 뜬다.
    var actionTitle: String? = nil
    var action: () -> Void = {}

    var body: some View {
        HStack(spacing: Space.m) {
            Text(text)
                .font(.subheadline)
                .fixedSize(horizontal: false, vertical: true)
            if let actionTitle {
                Button(actionTitle, action: action)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Ink.accent)
                    .frame(minHeight: 44)
            }
        }
        .padding(.horizontal, Space.l)
        .padding(.vertical, actionTitle == nil ? Space.m : Space.xs)
        .background(.thinMaterial, in: Capsule())
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.updatesFrequently)
    }
}

struct DoneForTodayCard: View {
    var tone: JTone = .friendly
    var body: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            Label(JCopy.text("pulse.complete", tone: tone), systemImage: "checkmark.circle")
                .font(.headline)
            Text(JCopy.text("today.rest", tone: tone))
                .font(.subheadline)
                .foregroundStyle(Ink.soft)
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
        VStack(alignment: .leading, spacing: Space.l) {
            VStack(alignment: .leading, spacing: Space.s) {
                HStack(spacing: Space.s) {
                    Circle().fill(Ink.accent).frame(width: 7, height: 7)
                    Text("다음 일정")
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Ink.accent)

                HStack(alignment: .firstTextBaseline, spacing: Space.s) {
                    Text(next.title)
                        .font(Typeface.editorial(.title2))
                        .foregroundStyle(Ink.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Image(systemName: next.type.symbol)
                        .foregroundStyle(Ink.soft)
                        .accessibilityHidden(true)
                }

                if activity.isFixedCommitment {
                    Label(Self.fixedLine(activity), systemImage: "lock.fill")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Ink.info)
                }
            }

            if let departure = next.departure {
                // 명령하지 않는다 — 서버가 만든 문장을 그대로 쓴다(§38). 이 카드에서 **가장 크게** 읽히는 줄이다.
                Text(departure.text)
                    .font(.headline)
                    .foregroundStyle(departure.level == .late ? Ink.danger : Ink.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Space.m)
                    .background(Ink.paper, in: RoundedRectangle(cornerRadius: Radius.control))
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

            // 꽉 찬 버튼은 하나 — 지금 가장 할 법한 일. 나머지는 그 아래 한 줄에 같은 폭으로 나란히 선다.
            let completionFirst = NextActionCard.prioritizesCompletion(next.status) || next.location == nil
            VStack(spacing: Space.s) {
                if !completionFirst, let location = next.location {
                    PrimaryActionButton(title: "길찾기", systemImage: "map") {
                        MapLauncher.open(location: location, name: next.title)
                    }
                } else if canEdit {
                    PrimaryActionButton(title: "다녀왔어요", systemImage: "checkmark", isBusy: isBusy, action: onComplete)
                }
                HStack(spacing: Space.s) {
                    if canEdit && !completionFirst {
                        SecondaryActionButton(title: "다녀왔어요", systemImage: "checkmark", action: onComplete)
                            .disabled(isBusy)
                    }
                    if completionFirst, let location = next.location {
                        SecondaryActionButton(title: "길찾기", systemImage: "map") {
                            MapLauncher.open(location: location, name: next.title)
                        }
                    }
                    if canEdit {
                        SecondaryActionButton(title: "건너뛰기", systemImage: "arrow.uturn.forward", action: onSkip)
                            .disabled(isBusy)
                    }
                }
                // 예약해 둔 곳이면 그 예약을 여기서 연다 — 공항·식당 앞에서 앱을 나갔다 찾지 않게.
                // 서버가 이미 보내던 값인데(`ActivitySummary.bookUrl`) 그리는 곳이 없었다(2026-09-20).
                if let booking = SafeURL.web(activity.bookUrl) {
                    Link(destination: booking) {
                        Label("예약 열기", systemImage: "arrow.up.right.square")
                            .font(.subheadline.weight(.medium))
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Ink.accent)
                }
            }
        }
        .card()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("다음 일정 \(next.title), \(StatusPalette.label(for: next.status))")
    }
}

extension NextActionCard {
    /// 예약된 일정의 한 줄 — `15:02 · 예약된 일정`. 시각이 없으면 예약이라는 것만.
    static func fixedLine(_ activity: ActivitySummary) -> String {
        guard let at = activity.fixedAtMinutes else { return "예약된 일정" }
        return "\(TimeFormat.clock(at)) · 예약된 일정"
    }

    static func prioritizesCompletion(_ status: TravelStatus) -> Bool {
        status == .arrived || status == .inProgress || status == .completed
    }

    struct Fact: Hashable {
        let symbol: String
        let text: String
    }

    /// 카드에 보일 사실들 — 출발(서버가 정한 시각) → 도착 예정 → 이동 → 머무름. 없는 것은 말하지 않는다.
    /// 도착 예정이 없을 때만 시작 시각을 대신 말한다(둘 다 두면 같은 시각이 두 번 보인다).
    static func arrival(_ next: NextAction) -> Int? {
        guard let departure = next.departure else { return next.etaMinutes }
        if let eta = next.etaMinutes, eta >= departure.leaveMinutes { return eta }
        guard let travel = next.travelMinutes, travel >= 0 else { return nil }
        return departure.leaveMinutes + travel
    }

    static func facts(_ next: NextAction, isEstimate: Bool) -> [Fact] {
        var out: [Fact] = []
        if let departure = next.departure {
            out.append(Fact(symbol: "figure.walk.departure", text: "출발 \(TimeFormat.clock(departure.leaveMinutes))"))
        }
        // 도착은 **출발보다 앞설 수 없다.** 계획 타임라인의 도착 예상(eta)은 아침에 계산된 값이라, 약속에서
        // 거꾸로 센 출발(leaveMinutes)과 나란히 두면 '출발 18:58 · 도착 09:02'가 됐다(2026-09-27 UX 검토).
        // 그때는 '지금 안내대로 출발하면 도착하는 때'(출발 + 이동)를 말한다.
        if let arrival = Self.arrival(next) {
            out.append(Fact(symbol: "mappin.and.ellipse", text: "도착 \(TimeFormat.clock(arrival))"))
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

/// 오늘 하루를 한 장에 — 시각 · 표지 · 이름이 한 줄씩. 다녀온 곳은 흐리게, 다음 일정은 표시만 한다.
/// 할 일(다녀왔어요·건너뛰기·되돌리기)은 줄의 `⋯`·길게 누르기·옆으로 밀기에 있다.
struct TodayTimelineCard: View {
    let activities: [ActivitySummary]
    let nextId: String?
    let isBusy: Bool
    var canEdit = true
    let onComplete: (ActivitySummary) -> Void
    let onSkip: (ActivitySummary) -> Void
    let onUndo: (ActivitySummary) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(activities.enumerated()), id: \.element.id) { index, activity in
                if index > 0 {
                    Rectangle().fill(Ink.hairline).frame(height: 1).padding(.leading, 86)
                }
                if activity.status.isDone {
                    FinishedRow(activity: activity, isBusy: isBusy, canEdit: canEdit) { onUndo(activity) }
                } else {
                    ActivityRow(activity: activity, isNext: activity.id == nextId, isBusy: isBusy,
                                canEdit: canEdit && activity.id != nextId,
                                onComplete: { onComplete(activity) }, onSkip: { onSkip(activity) })
                }
            }
        }
        .background(Ink.raised)
        .clipShape(RoundedRectangle(cornerRadius: Radius.card))
        .overlay(RoundedRectangle(cornerRadius: Radius.card).strokeBorder(Ink.hairline))
    }
}

/// 타임라인의 한 줄 틀 — 시각 칸과 표지 칸의 폭을 모든 줄이 같이 쓴다(세로로 줄이 맞아야 흐름이 읽힌다).
private struct TimelineLine<Marker: View, Content: View, Trailing: View>: View {
    let time: String
    var timeColor: Color = Ink.ink
    var timeWeight: Font.Weight = .regular
    @ViewBuilder let marker: Marker
    @ViewBuilder let content: Content
    @ViewBuilder let trailing: Trailing

    var body: some View {
        HStack(spacing: 0) {
            Text(time)
                .font(.subheadline.monospacedDigit().weight(timeWeight))
                .foregroundStyle(timeColor)
                .frame(width: 52, alignment: .leading)
            marker.frame(width: 24)
            content.padding(.leading, Space.s)
            Spacer(minLength: Space.s)
            trailing
        }
        .padding(.leading, Space.l)
        .padding(.trailing, Space.xs)
        .frame(minHeight: 50)
        .background(Ink.raised)
    }
}

struct ActivityRow: View {
    let activity: ActivitySummary
    var isNext = false
    let isBusy: Bool
    var canEdit = true
    let onComplete: () -> Void
    let onSkip: () -> Void
    /// 옆으로 민 거리. ⚠️ `.swipeActions`는 `List` 행에서만 동작한다 — 이 행은 `ScrollView > VStack` 안이라
    /// 전에는 코드만 있고 밀어도 아무 일이 없었다. 그래서 제스처를 직접 둔다.
    @State private var offset: CGFloat = 0
    private static let revealWidth: CGFloat = 168

    var body: some View {
        ZStack(alignment: .trailing) {
            if canEdit && offset < 0 {
                HStack(spacing: Space.s) {
                    swipeButton("건너뛰기", symbol: "arrow.uturn.forward", tint: Ink.warning, action: onSkip)
                    swipeButton("다녀옴", symbol: "checkmark", tint: Ink.positive, action: onComplete)
                }
                .padding(.trailing, Space.s)
            }
            row
                .offset(x: offset)
                .simultaneousGesture(canEdit && !isBusy ? swipe : nil)
        }
        .animation(.snappy(duration: 0.2), value: offset)
    }

    /// 가로로 분명히 민 것만 받는다 — 세로 스크롤을 빼앗지 않는다.
    private var swipe: some Gesture {
        DragGesture(minimumDistance: 24)
            .onChanged { value in
                guard abs(value.translation.width) > abs(value.translation.height) * 1.5 else { return }
                let base: CGFloat = offset <= -Self.revealWidth / 2 ? -Self.revealWidth : 0
                offset = min(0, max(-Self.revealWidth, base + value.translation.width))
            }
            .onEnded { _ in offset = offset < -Self.revealWidth / 3 ? -Self.revealWidth : 0 }
    }

    private func swipeButton(_ title: String, symbol: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button {
            offset = 0
            action()
        } label: {
            Label(title, systemImage: symbol)
                .labelStyle(.titleAndIcon)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 76, height: 40)
                .background(tint, in: RoundedRectangle(cornerRadius: Radius.control))
        }
        .buttonStyle(.plain)
    }

    private var row: some View {
        TimelineLine(time: TimeFormat.clock(activity.startMinutes),
                     timeWeight: isNext ? .semibold : .regular) {
            if isNext {
                Circle().fill(Ink.accent).frame(width: 10, height: 10)
            } else {
                Circle().strokeBorder(Ink.faint, lineWidth: 1.5).frame(width: 10, height: 10)
            }
        } content: {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Space.s) {
                    Text(activity.name)
                        .font(.body.weight(isNext ? .semibold : .regular))
                        .foregroundStyle(Ink.ink)
                        .lineLimit(1)
                    if isNext { TagChip(text: "다음", tint: Ink.accent) }
                    if activity.isFixedCommitment { TagChip(text: "예약", tint: Ink.info) }
                    if activity.mustVisit { TagChip(text: "꼭 가기", tint: Ink.warning) }
                }
                if !activity.desc.isEmpty {
                    Text(activity.desc).font(.caption).foregroundStyle(Ink.soft).lineLimit(1)
                }
            }
        } trailing: {
            if isBusy && canEdit {
                ProgressView().controlSize(.small).frame(width: 44, height: 44)
            } else if canEdit {
                Menu {
                    Button("다녀왔어요", systemImage: "checkmark", action: onComplete)
                    Button("건너뛰기", systemImage: "arrow.uturn.forward", action: onSkip)
                } label: {
                    Image(systemName: "ellipsis").foregroundStyle(Ink.soft).frame(width: 44, height: 44)
                }
                .accessibilityLabel("\(activity.name) 작업")
            }
        }
        .contextMenu {
            if canEdit {
                Button("다녀왔어요", systemImage: "checkmark", action: onComplete)
                Button("건너뛰기", systemImage: "arrow.uturn.forward", action: onSkip)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(TimeFormat.clock(activity.startMinutes)) \(activity.name)\(isNext ? ", 다음 일정" : "")")
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

    private var completed: Bool { activity.status == .completed }

    var body: some View {
        TimelineLine(time: TimeFormat.clock(activity.startMinutes), timeColor: Ink.faint) {
            Image(systemName: completed ? "checkmark" : "arrow.uturn.forward")
                .font(.caption.weight(.bold))
                .foregroundStyle(completed ? Ink.positive : Ink.faint)
        } content: {
            Text(activity.name)
                .strikethrough(completed, color: Ink.faint)
                .foregroundStyle(Ink.soft)
                .lineLimit(1)
        } trailing: {
            if canEdit {
                Menu {
                    Button("되돌리기", systemImage: "arrow.uturn.backward", action: onUndo)
                } label: {
                    Image(systemName: "ellipsis").foregroundStyle(Ink.faint).frame(width: 44, height: 44)
                }
                .disabled(isBusy)
                .accessibilityLabel("\(activity.name) 되돌리기")
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(activity.name), \(completed ? "다녀옴" : "건너뜀")")
        .accessibilityActions {
            if canEdit { Button("되돌리기", action: onUndo) }
        }
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
                SectionHeader(title: "오늘의 위치")
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

/// "오늘 어떻게 할까요" — 자연어 한 줄과 컨디션.
///
/// ⚠️ **여기서 해석하지 않는다.** 문장은 서버로 가고(`adaptive.js`의 `parseIntent`), 돌아온
///    `IntentEcho`를 그대로 그린다 — 규칙을 Swift로 옮기면 웹과 답이 갈린다(§엔진은 하나다).
/// ⚠️ 못 알아들었으면 **그렇게 말한다.** 알아들은 척하고 아무 제안이나 내놓지 않는다.
struct IntentField: View {
    @Environment(AppEnvironment.self) private var env
    @Binding var text: String
    let echo: IntentEcho?
    let energy: EnergyLevel
    let isBusy: Bool
    let onSubmit: () -> Void
    let onClear: () -> Void
    let onEnergy: (EnergyLevel) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            SectionHeader(title: "오늘은 어떻게 할까요")

            // 문장으로 말하지 않아도 되는 길 — 웹의 컨디션 버튼과 같다. 셋 중 하나라 한 덩어리로 묶는다.
            HStack(spacing: Space.xs) {
                ForEach(EnergyPick.allCases, id: \.self) { pick in
                    let on = energy == pick.level
                    Button { onEnergy(pick.level) } label: {
                        Text(pick.label)
                            .font(.subheadline.weight(on ? .semibold : .regular))
                            .foregroundStyle(on ? Ink.ink : Ink.soft)
                            .frame(maxWidth: .infinity, minHeight: 40)
                            .background(on ? Ink.raised : Color.clear, in: Capsule())
                            .shadow(color: on ? Ink.ink.opacity(0.08) : .clear, radius: 1, y: 1)
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? [.isSelected] : [])
                }
            }
            .padding(Space.xs)
            .background(Ink.sunken, in: Capsule())
            .disabled(isBusy)

            HStack(spacing: Space.s) {
                TextField("J에게 말하기 — 예: 많이 걷기 싫어", text: $text, axis: .vertical)
                    .lineLimit(1...3)
                    .textFieldStyle(.plain)
                    .submitLabel(.done)
                    .onSubmit(onSubmit)
                if !text.isEmpty {
                    Button("적용", action: onSubmit)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Ink.accent)
                        .disabled(isBusy)
                }
            }
            .padding(.horizontal, Space.l)
            .padding(.vertical, Space.m)
            .background(Ink.raised, in: RoundedRectangle(cornerRadius: Radius.control))
            .overlay(RoundedRectangle(cornerRadius: Radius.control).strokeBorder(Ink.hairline))

            if let echo, !echo.text.isEmpty {
                HStack(alignment: .top, spacing: Space.xs) {
                    Image(systemName: echo.understood ? "text.bubble" : "questionmark.circle")
                    Text(JCopy.text(echo.understood ? "intent.echo" : "intent.unknownNative", params: ["reasons": echo.reasons.joined(separator: " · ")], tone: env.jTone.selected)).font(.caption)
                    Spacer(minLength: 0)
                    Button("지우기", action: onClear).font(.caption).disabled(isBusy)
                }
                // 못 알아들은 것은 오류가 아니라 '확인할 것'이다 — 빨강을 쓰지 않는다(§색은 뜻이다).
                .foregroundStyle(echo.understood ? Ink.accent : Ink.warning)
            }
        }
    }
}

/// 컨디션 세 갈래. 계약의 `EnergyLevel`에서 `unknown`을 뺀 것 — 고르는 칸에는 모르는 값이 없다.
enum EnergyPick: CaseIterable {
    case low, normal, high

    var level: EnergyLevel {
        switch self {
        case .low: .low
        case .normal: .normal
        case .high: .high
        }
    }

    var label: String {
        switch self {
        case .low: "지쳤어요"
        case .normal: "보통"
        case .high: "쌩쌩해요"
        }
    }
}
