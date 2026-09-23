import SwiftUI

/// 여행 하나를 여는 화면. `지금`·`일정`·`지도`·`더보기`는 **형제다** — 하나가 다른 하나의 하위 화면이 아니다.
///
/// 예전에는 여행을 열면 언제나 `지금`이 뜨고 `일정`은 그 안의 툴바 버튼이었다. 그런데 출발 전에
/// 여는 여행은 대부분 "계획을 마저 짜려고" 여는 것이고, 그때 `지금`은 할 말이 없다(여행 기간 밖이다).
/// 그래서 무엇을 먼저 보일지는 **여행이 지금 진행 중인지**로 정한다.
///
/// ⚠️ **화면 아래 탭 바로 옮겼다**(2026-09-17). 예전에는 "계층 중간의 탭바는 뒤로가기를 흐린다"는
/// 이유로 위쪽에 세그먼트를 깔았는데, 그렇게 쌓인 것이 다섯 층이었다 — 지금/일정 · 일자 칩 ·
/// 바로가기 네 칸 · 하루 요약 · 목록/지도. 첫 일정이 화면 아래 3분의 1에서야 시작했다.
/// 세그먼트 둘을 탭으로 내리고 바로가기 넷을 `더보기` 안으로 넣으니 위쪽이 두 층으로 줄었다.
/// 뒤로가기는 여전히 내비게이션 바에 있고, 탭 바는 그 아래 별개 층이라 섞이지 않는다.
///
/// ⚠️ **화면 모델은 탭이 아니라 여행이 들고 있다**(2026-09-17). 탭을 바꾸면 SwiftUI는 이전 탭 화면을
/// 통째로 버리고 새로 만든다 — 화면이 `@State`로 모델을 들고 있으면 모델도 함께 죽어, 돌아올 때마다
/// 서버를 다시 묻고 답이 올 때까지 로딩을 보였다. 그래서 `지금`·`일정`·`지도`의 모델은 `TripScreenModels`
/// 하나에 모아 이 뷰가 소유하고, 탭 화면은 **받기만** 한다. 탭 진입은 앱 복귀가 아니다 — 이미 있는
/// 내용은 그대로 두고 오래됐을 때만 뒤에서 조용히 새로 받는다(`loadIfStale`). 여행을 나가면 함께 사라진다:
/// 다시 들어오면 규칙이 다시 정하고 새로 받는다(어느 화면이 왜 떴는지 예측할 수 있어야 한다).
///
/// ⚠️ `일정`과 `지도`는 **같은 화면의 두 모드다** — `TripPlanView` 하나가 고른 날짜·편집기를
/// 들고 있으므로 탭마다 새로 만들면 고른 날이 갈린다. 그래서 `TabView`가 아니라
/// 직접 그린 탭 바를 쓰고, 두 탭이 `switch`의 **같은 갈래**에 있어 뷰 정체성이 유지된다.
///
/// ⚠️ **탭 바는 언제나 화면 맨 아래다.** 내용이 짧거나(로딩·오류 화면) 키보드가 올라와도 제자리다 —
/// 내용 위에 겹쳐 두고(`ZStack`) 키보드 안전 영역을 무시한다. 내용은 바 높이만큼 위에서 끝난다.
@MainActor
struct TripHomeView: View {
    let trip: TripSummary
    /// 알림·딥링크가 목적지를 정해서 들어온 경우. nil이면 아래 규칙이 정한다.
    var requested: TripHomeTab?
    @Binding var panel: TripPanel?

    /// 세 화면의 모델. **여행을 보는 동안** 살아 있고, 탭을 오가도 죽지 않는다.
    @State private var models: TripScreenModels
    @State private var tab: TripHomeTab?
    @Environment(AppEnvironment.self) private var env
    @Environment(\.scenePhase) private var scenePhase
    /// 이 화면의 실시간 구독 이름. 보드(`"candidates"`)와 달라야 서로를 덮어쓰지 않는다.
    private static let liveKey = "trip"

    /// 탭 바의 높이. 내용이 이만큼 위에서 끝나야 마지막 줄이 바에 가리지 않는다 — 재지 않고 정한다.
    static let tabBarHeight: CGFloat = 50

    init(trip: TripSummary, requested: TripHomeTab? = nil, panel: Binding<TripPanel?>, env: AppEnvironment) {
        self.trip = trip
        self.requested = requested
        _panel = panel
        // `@State`의 초기값은 처음 만들 때 한 번만 쓰인다 — 부모가 다시 그려도 이 객체는 유지된다.
        _models = State(initialValue: TripScreenModels(trip: trip, env: env))
    }

    var body: some View {
        // 사용자가 탭을 바꾸면 이 여행을 보는 동안 유지된다. 다시 들어오면 규칙이 다시 정한다 —
        // 어느 화면이 왜 떴는지 예측할 수 있어야 한다(기억을 디스크에 남기지 않는 이유).
        let selection = Binding(
            get: { tab ?? TripHomeTab.initial(isLive: trip.isLive, requested: requested) },
            set: { tab = $0 })

        ZStack(alignment: .bottom) {
            // 제목 자리는 쓰지 않는다: 거기엔 여행 이름이 있어야 한다(여행이 여러 개다).
            Group {
                switch selection.wrappedValue {
                case .today:
                    TodayView(trip: trip, model: models.today, onOpenPlan: { selection.wrappedValue = .plan })
                case .plan, .map:
                    // 한 갈래다 — 뷰 정체성이 유지돼 탭을 오가도 고른 날·편집기가 그대로다.
                    TripPlanView(trip: trip, model: models.plan, discovery: models.discovery, showsMap: Binding(
                        get: { selection.wrappedValue == .map },
                        set: { selection.wrappedValue = $0 ? .map : .plan }))
                case .more:
                    moreList
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            // 내용은 탭 바 높이만큼 위에서 끝난다 — 바가 겹쳐 있어도 마지막 줄을 가리지 않는다.
            .safeAreaInset(edge: .bottom, spacing: 0) { Color.clear.frame(height: Self.tabBarHeight) }

            tabBar(selection)
                // 키보드가 올라와도 바는 제자리다 — 시스템 탭 바처럼 키보드 아래에 있다.
                .ignoresSafeArea(.keyboard, edges: .bottom)
        }
        // 여행 하나가 드는 모델을 아래 전체에 내려보낸다(2026-09-21). 시트·push로 들어간 화면이
        // `shared`를 못 받아 **자체 모델을 새로 만들던** 자리가 넷 있었다 — 같은 목록을 최대 3벌 받았다.
        // §탭 전환은 앱 복귀가 아니다 — 그 규칙이 탭에만 걸려 있고 시트·push에는 안 걸려 있었다.
        .environment(models)
        .sheet(item: $panel) { item in
            NavigationStack {
                Group {
                    // 시트를 닫았다 열어도 방금 받은 것은 다시 받지 않는다 — 모델이 여행 화면에 산다(2026-09-18).
                    switch item {
                    case .costs: TripCostsView(trip: trip, memory: models.costs)
                    case .bookings: BookingListView(trip: trip, shared: models.bookings)
                    case .collab: CollabView(trip: trip, shared: models.collab)
                    case .candidates: CandidateBoardView(trip: trip, shared: models.candidateBoard)
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) { Button("닫기") { panel = nil } }
                }
            }
        }
        .onChange(of: requested) { _, value in tab = value }
        // 여행을 보는 동안 실시간에 붙어 있는다 — 일행이 일정을 고치면 `지금`·`일정`이 그 자리에서 바뀐다.
        // 전에는 '가고 싶은 곳' 보드가 열렸을 때만 붙어서, 다른 탭에서는 아무 일도 일어나지 않았다(2026-09-20).
        .task(id: trip.id) { startLive() }
        // 앱이 뒤로 가면 소켓을 붙들지 않는다(§34) — 돌아올 때 다시 붙고 그때 최신을 읽는다.
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: startLive()
            case .background, .inactive: env.realtime.disconnect()
            @unknown default: break
            }
        }
        .onDisappear { env.realtime.disconnect(key: Self.liveKey) }
        .navigationTitle(trip.name)
        .navigationBarTitleDisplayMode(.inline)
    }

    /// 실시간을 붙인다. **못 붙어도 앱은 그대로** — 상태만 바뀌고 폴백(당겨서 새로고침)으로 간다.
    private func startLive() {
        env.realtime.connect(tripId: trip.id, key: Self.liveKey) { event in
            Task { await models.handle(event) }
        }
    }

    /// 여행 안에서만 쓰는 탭 바. 시스템 `TabView`를 쓰지 않는 이유는 위 주석에 있다.
    /// 상태를 색으로만 구분하지 않는다 — 고른 탭은 색과 굵기가 함께 바뀐다(§47).
    private func tabBar(_ selection: Binding<TripHomeTab>) -> some View {
        HStack(spacing: 0) {
            ForEach(TripHomeTab.allCases, id: \.self) { item in
                tabButton(item, selection: selection)
            }
        }
        .padding(.top, Space.xs)
        .frame(height: Self.tabBarHeight)
        .frame(maxWidth: .infinity)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
    }

    private func tabButton(_ item: TripHomeTab, selection: Binding<TripHomeTab>) -> some View {
        let on = selection.wrappedValue == item
        return Button {
            selection.wrappedValue = item
        } label: {
            VStack(spacing: 2) {
                Image(systemName: item.symbol)
                    .font(.system(size: 20, weight: on ? .semibold : .regular))
                Text(item.label)
                    .font(.caption2)
                    .fontWeight(on ? .semibold : .regular)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .foregroundStyle(on ? Ink.accent : Ink.soft)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(item.label)
        .accessibilityAddTraits(on ? [.isSelected] : [])
    }

    /// 매일 쓰는 것이 아니라 가끔 들어가는 곳들. 예전에는 늘 한 줄 반을 차지했다.
    /// 목록이라 이름 아래 한 줄을 더 쓸 수 있어, 눌러 보기 전에 무엇이 들었는지 말할 수 있다.
    private var moreList: some View {
        List {
            Section("이 여행") {
                ForEach(TripPanel.allCases) { item in
                    // 설정 앱의 한 줄처럼 — 아이콘·이름·한 줄 설명·꺾쇠. 행 전체가 눌린다.
                    Button { panel = item } label: {
                        HStack(spacing: Space.m) {
                            Image(systemName: item.symbol)
                                .foregroundStyle(Ink.accent)
                                .frame(width: 24)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(item.label).foregroundStyle(Ink.ink)
                                Text(item.hint).font(.caption).foregroundStyle(Ink.soft)
                            }
                            Spacer(minLength: Space.s)
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Ink.faint)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isButton)
                }
            }
        }
        .listStyle(.insetGrouped)
        .paperGround()
        .frame(maxHeight: .infinity)
    }
}

/// 여행 하나를 여는 동안 살아 있는 화면 모델들. `TripHomeView`가 `@State`로 들고 있어 탭을 오가도 죽지 않는다.
///
/// 만드는 것은 값싸다 — 여기서는 아무것도 받지 않는다. 각 화면이 나타날 때 `loadIfStale`로
/// "없으면 받고, 오래됐으면 뒤에서 새로 받고, 방금 받았으면 그대로" 판단한다.
@MainActor
@Observable
final class TripScreenModels {
    let today: TodayViewModel
    let plan: TripPlanViewModel
    /// 지도 탭의 '장소 찾기' — 담은 후보 목록을 들고 있다. 지도를 열 때마다 다시 받지 않는다.
    let discovery: MapDiscoveryModel
    /// 더보기의 시트 넷(비용·예약·함께하기·가고 싶은 곳)도 여행이 든다(2026-09-18) — 닫았다 열 때마다
    /// 처음부터 다시 받지 않고 `loadIfStale`(60초)로 간다. 만드는 것은 공짜다 — 열기 전에는 서버를 묻지 않는다.
    let costs = TripCostsMemory()
    let bookings: BookingListViewModel
    let collab: CollabViewModel
    let candidateBoard: CandidateBoardViewModel
    private let tripId: String

    init(trip: TripSummary, env: AppEnvironment) {
        today = TodayViewModel(trip: trip, service: env.service)
        plan = TripPlanViewModel(tripId: trip.id, service: env.service, memberSource: env.service,
                                 initialDay: max(0, trip.todayIndex))
        discovery = MapDiscoveryModel(trip: trip, searcher: env.places, source: env.service)
        bookings = BookingListViewModel(tripId: trip.id, service: env.service)
        collab = CollabViewModel(trip: trip, service: env.service, webBaseURL: AppConfig.webBaseURL)
        candidateBoard = CandidateBoardViewModel(trip: trip, service: env.service, documents: env.service)
        self.tripId = trip.id
    }

    /// 실시간 이벤트 하나를 화면들에 나눈다. 무엇을 읽을지는 `TripLiveRefresh`가 정하고 여기서는 그대로 따른다.
    func handle(_ event: RealtimeActivity) async {
        guard event.tripId == tripId else { return }
        let refresh = TripLiveRefresh.decide(kind: event.kind, mine: event.mine,
                                             hasPlan: plan.document != nil,
                                             hasToday: today.today != nil,
                                             hasCollab: collab.loadedAt != nil)
        if refresh.plan { await plan.load() }
        if refresh.today { await today.load() }
        await collab.applyLive(members: refresh.members, activity: refresh.activity)
    }
}

/// 실시간 이벤트 하나가 **여행 화면에서** 무엇을 다시 읽게 하는가. 순수 판정 — 네트워크도 모델도 모른다.
///
/// **payload를 화면 상태로 쓰지 않는다**(§41): `liveEffects`(`collab.js`와 같은 규칙)가 무엇을 다시 읽을지만
/// 정하고 내용은 API로 다시 읽는다.
///
/// ⚠️ **이미 내용을 든 화면만 다시 읽는다.** 닫힌 시트를 미리 채워 두지 않는다 — 열 때 `loadIfStale`이
/// 챙기므로, 안 보는 화면 때문에 소켓이 올 때마다 네트워크를 쓰면 "방금 받은 것은 다시 받지 않는다"가
/// 무너진다(`docs/network-audit.md`).
///
/// ⚠️ **후보 보드는 여기 없다** — 보드 화면이 제 구독(`key: "candidates"`)으로 직접 받는다.
/// 여기서도 읽으면 보드가 열려 있을 때 같은 목록을 두 번 받는다.
struct TripLiveRefresh: Equatable, Sendable {
    var plan = false
    var today = false
    /// 함께하기의 **멤버 목록**. 인원·역할·이름이 바뀌었을 때만이다.
    var members = false
    /// 함께하기의 **활동 기록**. 아는 종류면 전부 남으므로 자주 켜지지만, 시트가 닫혀 있으면 읽지 않는다.
    var activity = false

    /// `has…`는 "그 화면이 이미 내용을 들고 있는가"다.
    static func decide(kind: String, mine: Bool, hasPlan: Bool, hasToday: Bool, hasCollab: Bool) -> TripLiveRefresh {
        let effects = CollabModel.liveEffects(kind: kind, mine: mine)
        return TripLiveRefresh(plan: effects.pull && hasPlan,
                               today: effects.pull && hasToday,
                               members: effects.members && hasCollab,
                               activity: effects.activity && hasCollab)
    }
}

/// 여행 하나 안에서 나란히 있는 두 화면.
enum TripHomeTab: String, CaseIterable, Hashable, Sendable {
    case today
    case plan
    case map
    case more

    var label: String {
        switch self {
        case .today: return "여행"
        case .plan: return "일정"
        case .map: return "지도"
        case .more: return "더보기"
        }
    }

    var symbol: String {
        switch self {
        case .today: return "clock"
        case .plan: return "calendar"
        case .map: return "map"
        case .more: return "ellipsis"
        }
    }

    /// 처음 열었을 때 어느 쪽을 보일지.
    ///
    /// - `requested`(알림·딥링크로 들어온 목적지)가 있으면 **그것이 규칙을 이긴다.**
    ///   출발 알림을 눌렀는데 일정 편집 화면이 뜨면 안 된다.
    /// - 그 외에는 **여행이 지금 진행 중인지**로 정한다. 시작 전·끝난 뒤·날짜 없는 여행은
    ///   `지금`이 할 말이 없으므로 `일정`이다.
    ///
    /// ⚠️ `isLive`는 서버가 정한 `todayIndex >= 0`이다(`adaptive.js`의 `currentDayIndex`).
    /// 여기서 `start` 문자열을 오늘과 비교하지 않는다 — 시간대 판단이 엔진 안에 있고,
    /// 앱이 따로 계산하면 웹과 다른 날을 '오늘'이라고 부르게 된다.
    static func initial(isLive: Bool, requested: TripHomeTab?) -> TripHomeTab {
        if let requested { return requested }
        return isLive ? .today : .plan
    }
}

/// 여행 전/중에 관계없이 같은 자리에서 연다.
enum TripPanel: String, CaseIterable, Identifiable {
    case bookings, collab, candidates, costs
    var id: String { rawValue }
    var label: String {
        switch self {
        case .costs: "비용"
        case .bookings: "예약"
        case .collab: "같이 짜기"
        case .candidates: "가고 싶은 곳"
        }
    }
    var symbol: String {
        switch self {
        case .costs: "wonsign.circle"
        case .bookings: "ticket"
        case .collab: "person.2"
        case .candidates: "mappin.and.ellipse"
        }
    }
    /// 눌러 보기 전에 무엇이 있는 곳인지 한 줄로. 개수는 싣지 않는다 —
    /// 여기서 세려면 네 곳을 미리 불러와야 하고, 그건 이 화면이 할 일이 아니다.
    var hint: String {
        switch self {
        case .costs: "예약 결제 금액 · 현지 결제 금액"
        case .bookings: "항공 · 숙박 · 렌터카"
        case .collab: "멤버 초대와 권한"
        case .candidates: "아직 일정이 아닌 곳"
        }
    }
}
