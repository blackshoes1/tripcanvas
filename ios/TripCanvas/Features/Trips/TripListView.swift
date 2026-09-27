import SwiftUI
import Observation
import UIKit

@Observable
@MainActor
final class TripListViewModel {
    private(set) var trips: [TripSummary] = []
    private(set) var isLoading = false
    private(set) var errorMessage: String?
    private(set) var cachedAt: Date?

    private let service: TripDataSource

    init(service: TripDataSource) { self.service = service }

    /// 목록에서 뺀다. **역할에 따라 다른 일이다** — 주최자는 삭제(모두에게서 사라진다),
    /// 나머지는 나가기(내 목록에서만 사라진다). 판정은 `collab.js` 복사본이 한다.
    ///
    /// 낙관적으로 먼저 지우고, 실패하면 **원래 자리로 되돌린다** — 실패를 삼키면
    /// 다음 새로고침에 되살아나서 지워진 줄 알았던 여행이 돌아온다.
    func remove(_ trip: TripSummary) async {
        guard busyTripId == nil, let index = trips.firstIndex(where: { $0.id == trip.id }) else { return }
        busyTripId = trip.id
        defer { busyTripId = nil }

        removing = (trip, index)
        trips.remove(at: index)
        errorMessage = nil

        do {
            if CollabModel.canDelete(trip.role ?? .owner) {
                try await service.deleteTrip(tripId: trip.id, expectedRevision: trip.revision)
            } else {
                try await service.leaveTrip(tripId: trip.id)
            }
            removing = nil
        } catch {
            restore()
            let message = removalMessage(for: error, trip: trip)
            // 다른 기기가 먼저 바꿨으면 내가 들고 있는 revision이 낡았다 — 목록을 새로 받는다.
            // ⚠️ `load()`는 성공하면 errorMessage를 지운다 — 그래서 **다시 받은 뒤에** 문구를 세운다.
            if case .revisionConflict = (error as? APIError) { await load() }
            errorMessage = message
        }
    }

    /// 여행을 만든다. 성공하면 목록 맨 앞에 넣고 그 여행을 돌려준다(바로 열 수 있게).
    ///
    /// ⚠️ 낙관적으로 먼저 넣지 않는다 — id는 **서버가 정한다**. 가짜 id로 줄을 만들면
    /// 그 줄을 눌렀을 때 열 것이 없다(삭제와 반대 방향이라 규칙도 반대다).
    func create(_ draft: NewTripDraft) async -> TripSummary? {
        guard busyTripId == nil else { return nil }
        errorMessage = nil
        do {
            let created = try await service.createTrip(draft)
            trips.insert(created, at: 0)
            return created
        } catch {
            errorMessage = createMessage(for: error)
            return nil
        }
    }

    private func createMessage(for error: Error) -> String {
        guard let api = error as? APIError else { return error.localizedDescription }
        switch api {
        case .unauthorized: return "로그인이 필요해요 — 다시 로그인한 뒤 만들어 주세요."
        case .offline: return "서버에 닿지 못했어요 — 연결을 확인하고 다시 시도해 주세요."
        default: return "여행을 만들지 못했어요. 잠시 후 다시 시도해 주세요."
        }
    }

    private func restore() {
        guard let pending = removing else { return }
        trips.insert(pending.trip, at: min(pending.index, trips.count))
        removing = nil
    }

    private func removalMessage(for error: Error, trip: TripSummary) -> String {
        guard let api = error as? APIError else { return error.localizedDescription }
        switch api {
        case .revisionConflict:
            return "다른 기기에서 먼저 바뀌었어요 — 목록을 새로 불러왔어요. 다시 시도해 주세요."
        // ⚠️ 예전에는 삼항이 뒤집혀 있었다 — `canDelete`가 참이면 **내가 주최자**인데 "지울 권한이
        //    없어요"라고 했고, 거짓(주최자가 아님)일 때 주최자용 안내를 했다. 이제 서버가 말한
        //    이유를 그대로 쓴다(공통 규칙 — `collab.js`의 forbiddenText).
        case .forbidden(let text):
            return CollabModel.forbiddenText(text, role: trip.role)
        default:
            return api.errorDescription ?? "처리하지 못했어요."
        }
    }

    /// 방금 지운(또는 나간) 여행. 되돌릴 수 있게 원래 자리를 함께 들고 있는다.
    private var removing: (trip: TripSummary, index: Int)?

    /// 지우는 중인 여행 id — 같은 행을 두 번 밀어도 두 번 부르지 않는다.
    private(set) var busyTripId: String?

    /// 캐시가 있으면 먼저 그린다 — 긴 스피너만 보여주지 않는다(§32).
    func load() async {
        if trips.isEmpty { isLoading = true }
        defer { isLoading = false }
        do {
            let fetched = try await service.trips()
            trips = fetched.value
            cachedAt = fetched.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// 여행 중 → 가까운 예정 여행 → 최근 지난 여행 → 날짜 미정.
    var ordered: [TripSummary] {
        func group(_ trip: TripSummary) -> Int {
            if trip.isLive { return 0 }
            if trip.isUpcoming { return 1 }
            return trip.start.isEmpty ? 3 : 2
        }
        return trips.sorted { lhs, rhs in
            let left = group(lhs), right = group(rhs)
            if left != right { return left < right }
            if left == 1, lhs.daysUntilStart != rhs.daysUntilStart {
                return (lhs.daysUntilStart ?? 0) < (rhs.daysUntilStart ?? 0)
            }
            if lhs.start != rhs.start { return lhs.start > rhs.start }
            return false
        }
    }

    /// 목록의 묶음 — 여행 중은 크게(표지), 나머지는 촘촘한 줄로. 순서는 `ordered`를 그대로 따른다.
    /// 날짜 미정은 지난 여행보다 **위**다 — 아직 짜고 있는 여행이 끝난 여행보다 지금 더 쓸모 있다.
    struct Sections: Equatable {
        var live: [TripSummary] = []
        var upcoming: [TripSummary] = []
        var undated: [TripSummary] = []
        var finished: [TripSummary] = []
    }

    var sections: Sections {
        ordered.reduce(into: Sections()) { out, trip in
            if trip.isLive { out.live.append(trip) }
            else if trip.isUpcoming { out.upcoming.append(trip) }
            else if trip.start.isEmpty { out.undated.append(trip) }
            else { out.finished.append(trip) }
        }
    }
}

struct TripListView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var model: TripListViewModel?
    /// 초대 링크로 참여 — 딥링크(`tripcanvas://join/…`)로 오거나 링크를 붙여넣어 연다.
    @State private var joinToken: String?
    @State private var pasteText = ""
    @State private var showsPastePrompt = false
    @State private var joinError: String?
    /// 지우기·나가기를 확인받는 중인 여행. 무엇이 사라지는지 말한 뒤에만 실행한다.
    @State private var coverRefresh = UUID()
    @State private var pendingRemoval: TripSummary?
    /// 밀어 넣은 여행. 딥링크가 목록을 거치지 않고 바로 열 수 있게 경로를 들고 있는다.
    @State private var path: [TripSummary] = []
    /// 알림·딥링크가 정한 목적 화면. 규칙(`TripHomeTab.initial`)을 이긴다.
    @State private var requestedTab: TripHomeTab?
    @State private var requestedPanel: TripPanel?
    @State private var routeNotice: String?
    /// 목록이 아직 안 왔을 때 들어온 딥링크 — 목록을 받은 뒤 다시 시도한다(콜드 스타트).
    @State private var pendingDestination: ActionRouter.Destination?
    /// 공유로 받은 자료는 여행 선택 전에 확인한다.
    @State private var showsInbox = false
    @State private var inboxKey: String?
    /// 여행 만들기 시트. 앱만 설치한 사람도 여기서 시작할 수 있어야 한다.
    @State private var showsCreateTrip = false
    /// 어느 길로 열 것인가. 빈 목록 화면의 두 버튼이 각자 자기 길로 연다.
    @State private var createStartMode: CreateTripMode = .scratch
    /// 가진 일정 붙여넣기 시트.

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if let model {
                    content(model)
                } else {
                    ProgressView()
                }
            }
            // 목록이 없을 때(불러오는 중·빈 목록·오류)도 종이 위다 — 전에는 그때만 흰 바탕이었다.
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Ink.paper)
            .navigationDestination(for: TripSummary.self) { trip in
                TripHomeView(trip: trip, requested: requestedTab, panel: $requestedPanel, env: env)
            }
            .navigationTitle("With J")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("받은 자료", systemImage: "tray") { inboxKey = nil; showsInbox = true }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    // 메뉴가 아니라 버튼 하나다 — 두 길은 시트를 열면 나란히 보인다.
                    Button {
                        createStartMode = .scratch
                        showsCreateTrip = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("여행 만들기")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if let email = env.auth.email { Text(email) }
                        Button {
                            pasteText = UIPasteboard.general.string ?? ""
                            showsPastePrompt = true
                        } label: {
                            Label("초대 링크로 참여", systemImage: "link")
                        }
                        Button("로그아웃", role: .destructive) { env.auth.signOut() }
                    } label: {
                        Image(systemName: "person.crop.circle")
                    }
                    .accessibilityLabel("계정")
                }
            }
        }
        .task {
            if model == nil { model = TripListViewModel(service: env.service) }
            if let destination = env.router.destination {
                pendingDestination = destination
                env.router.clear()
            }
            await model?.load()
            // 목록보다 딥링크가 먼저 왔을 수 있다(알림으로 앱이 켜진 경우).
            if let pending = pendingDestination, handle(pending) { pendingDestination = nil }
        }
        // 목록으로 돌아오면 딥링크가 정했던 목적지를 지운다 — 다음에 목록에서 고른 여행은 규칙이 정한다.
        // 목록을 새로 받는 것도 여기서다 — 여행 안에서 이름·날짜를 바꾸고 돌아왔는데 옛 이름이 남아 있으면 안 된다.
        .onChange(of: path) { _, current in
            if current.isEmpty {
                requestedTab = nil; requestedPanel = nil
                Task { await model?.load() }
            }
        }
        // 딥링크는 라우터 하나를 지난다 — 앱을 열어 둔 채로 링크를 눌러도 같은 화면이 뜬다.
        .onChange(of: env.router.destination) { _, destination in
            guard let destination else { return }
            if handle(destination) { env.router.clear() }
            else { pendingDestination = destination; env.router.clear() }
        }
        .onChange(of: model?.trips) { _, _ in
            if let pending = pendingDestination, handle(pending) { pendingDestination = nil }
        }
        .alert("화면 안내", isPresented: Binding(get: { routeNotice != nil }, set: { if !$0 { routeNotice = nil } })) {
            Button("확인") { routeNotice = nil }
        } message: { Text(routeNotice ?? "") }
        .sheet(isPresented: $showsInbox) {
            SharedInboxView(service: env.service, trips: model?.trips ?? [], focusKey: inboxKey) { id in
                Task {
                    await model?.load()
                    if let trip = find(id) { open(trip, tab: nil) }
                    else { routeNotice = "저장했어요. 여행 목록을 다시 불러와 주세요." }
                }
            }
        }
        .sheet(isPresented: $showsCreateTrip) {
            CreateTripView(service: env.service, places: env.places, startMode: createStartMode) { created in
                Task { await model?.load() }
                path = [created]
            } onCreateFromScratch: { draft in
                guard let model else { return "잠시 후 다시 시도해 주세요." }
                let created = await model.create(draft)
                // 만들자마자 그 여행으로 들어간다 — 목록으로 돌려보내면 무엇을 할지 다시 찾아야 한다.
                if let created { path = [created] }
                return created == nil ? model.errorMessage ?? "여행을 만들지 못했어요." : nil
            }
        }
        .sheet(item: Binding(get: { joinToken.map(JoinToken.init) }, set: { joinToken = $0?.value })) { item in
            JoinInviteView(token: item.value) { result in
                guard let id = result.clientId else { return }
                pendingDestination = .trip(tripId: id)
                Task {
                    await model?.load()
                    if let trip = find(id) { pendingDestination = nil; open(trip, tab: nil) }
                    else { routeNotice = "참여했어요. 연결되면 이 여행을 다시 열어요. 목록을 새로고침해 주세요." }
                }
            }
        }
        .alert("초대 링크로 참여", isPresented: $showsPastePrompt) {
            TextField("https://…#join=…", text: $pasteText)
            Button("참여") {
                if let token = CollabModel.joinToken(from: pasteText) { joinToken = token; pasteText = "" }
                else { joinError = CollabModel.joinReasonText("INVALID") }
            }
            Button("취소", role: .cancel) { pasteText = "" }
        } message: {
            Text("받은 초대 링크를 붙여 넣으세요. 여행 이름과 권한을 먼저 확인한 뒤 참여해요.")
        }
        // 삭제와 나가기는 문구가 다르다 — 무엇이 사라지는지가 다르기 때문이다.
        .confirmationDialog(
            pendingRemoval.map { TripListView.removalTitle(for: $0) + " — “\($0.name)”" } ?? "",
            isPresented: Binding(get: { pendingRemoval != nil }, set: { if !$0 { pendingRemoval = nil } }),
            titleVisibility: .visible
        ) {
            if let trip = pendingRemoval {
                Button(TripListView.removalTitle(for: trip), role: .destructive) {
                    pendingRemoval = nil
                    Task { await model?.remove(trip) }
                }
            }
            Button("취소", role: .cancel) { pendingRemoval = nil }
        } message: {
            if let trip = pendingRemoval { Text(TripListView.removalMessage(for: trip)) }
        }
        .alert("참여할 수 없어요", isPresented: Binding(get: { joinError != nil }, set: { if !$0 { joinError = nil } })) {
            Button("확인") { joinError = nil }
        } message: {
            Text(joinError ?? "")
        }
    }

    /// 주최자는 삭제, 함께 보는 사람은 나가기. 판정은 `collab.js` 복사본이 한다.
    static func removalTitle(for trip: TripSummary) -> String {
        CollabModel.canDelete(trip.role ?? .owner) ? "삭제" : "나가기"
    }

    /// **무엇이 사라지는지**를 말한다. 둘은 결과가 다르다.
    static func removalMessage(for trip: TripSummary) -> String {
        CollabModel.canDelete(trip.role ?? .owner)
            ? "함께 보는 사람들에게서도 사라져요. 되돌릴 수 없어요."
            : "내 목록에서만 사라져요. 여행 자체는 남아요."
    }

    private func removalSymbol(for trip: TripSummary) -> String {
        CollabModel.canDelete(trip.role ?? .owner) ? "trash" : "rectangle.portrait.and.arrow.right"
    }

    /// 딥링크 목적지를 화면 이동으로 옮긴다. 여행을 아직 못 찾으면 `false` — 목록을 받은 뒤 다시 부른다.
    ///
    /// ⚠️ 여기서 정한 `requestedTab`이 `TripHomeTab.initial`의 규칙을 이긴다.
    /// 출발 알림을 눌렀는데 일정 편집 화면이 뜨면 안 된다.
    private func handle(_ destination: ActionRouter.Destination) -> Bool {
        switch destination {
        case .join(let token):
            joinToken = token
            return true
        case .today(let tripId, _):
            // 여행을 특정하지 않는 짧은 형태(위젯·Siri)는 지금 진행 중인 여행을 연다.
            guard let trip = tripId.flatMap(find) ?? model?.ordered.first(where: { $0.isLive }) else { return false }
            open(trip, tab: .today)
            return true
        case .bookings(let tripId):
            guard let trip = find(tripId) else { return false }
            requestedPanel = .bookings
            requestedTab = nil
            path = [trip]
            return true
        case .replan(let tripId), .suggestion(let tripId, _):
            guard let trip = find(tripId) else { return false }
            open(trip, tab: .today)
            return true
        case .trip(let tripId):
            guard let trip = find(tripId) else { return false }
            open(trip, tab: nil)
            return true
        case .inbox(let key):
            inboxKey = key; showsInbox = true
            return true
        case .memory:
            routeNotice = "이 링크의 기록·공유 확인 화면은 아직 지원하지 않아요. 여행 목록에서 일정을 열어 주세요."
            return true
        }
    }

    private func find(_ tripId: String) -> TripSummary? { model?.trips.first { $0.id == tripId } }

    private func open(_ trip: TripSummary, tab: TripHomeTab?) {
        requestedPanel = nil
        requestedTab = tab
        path = [trip]
    }

    @ViewBuilder
    private func content(_ model: TripListViewModel) -> some View {
        if model.isLoading && model.trips.isEmpty {
            ProgressView("여행을 불러오는 중")
        } else if model.trips.isEmpty, let error = model.errorMessage {
            VStack(spacing: Space.m) {
                EmptyStateView(symbol: "exclamationmark.icloud", title: "여행을 불러오지 못했어요", message: error)
                SecondaryActionButton(title: "다시 시도", systemImage: "arrow.clockwise", expands: false) {
                    Task { await model.load() }
                }
            }
            .padding(Space.l)
        } else if model.trips.isEmpty {
            VStack(spacing: Space.m) {
                EmptyStateView(
                    symbol: "suitcase",
                    title: "아직 여행이 없어요",
                    message: "첫 여행을 만들어 보세요. 웹에서 만든 여행도 여기에 나타나요.")
                VStack(spacing: Space.s) {
                    PrimaryActionButton(title: "여행 만들기", systemImage: "plus") {
                        createStartMode = .scratch; showsCreateTrip = true
                    }
                    SecondaryActionButton(title: "가진 일정 붙여넣기", systemImage: "doc.on.clipboard") {
                        createStartMode = .paste; showsCreateTrip = true
                    }
                    joinInviteButton
                }
                .padding(.horizontal, Space.xl)
            }
        } else {
            let sections = model.sections
            List {
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text("Trips · \(model.trips.count)").metaLabel()
                    Text("나의 여행").font(Typeface.editorial(.largeTitle)).foregroundStyle(Ink.ink)
                }
                .padding(.top, Space.s)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 0, leading: Space.xs, bottom: 0, trailing: Space.xs))
                if let cachedAt = model.cachedAt {
                    OfflineNotice(savedAt: cachedAt)
                        .listRowBackground(Color.clear)
                }
                if let error = model.errorMessage, model.cachedAt == nil {
                    InlineErrorBanner(message: "목록을 새로 불러오지 못했어요", detail: error) {
                        Task { await model.load() }
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
                // 여행 중인 여행만 표지를 크게 — 지금 들어갈 곳이 한눈에 보여야 한다.
                // 나머지는 표지 없이 촘촘한 줄이다: 표지 사진은 출처를 함께 적어야 해서 작은 칸에 넣을 수 없고,
                // 여행마다 표지를 받던 요청도 그만큼 줄어든다(표지는 여행 안의 첫 화면에서 본다).
                ForEach(sections.live) { trip in
                    Section {
                        LiveTripCard(trip: trip, cover: TripCoverView(trip: trip, api: env.service.api, cache: env.service.cache,
                                                                      cacheScope: env.service.cacheScope, refresh: coverRefresh,
                                                                      isHero: true, opensOnTap: true) { path.append(trip) }) {
                            path.append(trip)
                        }
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets())
                        .swipeActions(edge: .trailing) { removeAction(trip, model: model) }
                    }
                }
                tripSection("다가오는 여행", sections.upcoming, model: model)
                tripSection("날짜를 정하지 않은 여행", sections.undated, model: model)
                tripSection("지난 여행", sections.finished, model: model)
                Section {
                    joinInviteButton
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                }
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(Space.l)
            .paperGround()
            .refreshable { await model.load(); coverRefresh = UUID() }
        }
    }

    @ViewBuilder
    private func tripSection(_ title: String, _ trips: [TripSummary], model: TripListViewModel) -> some View {
        if !trips.isEmpty {
            Section {
                ForEach(trips) { trip in
                    NavigationLink(value: trip) { TripListRow(trip: trip) }
                        .listRowBackground(Ink.raised)
                        .swipeActions(edge: .trailing) { removeAction(trip, model: model) }
                }
            } header: {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(Ink.ink)
                    .textCase(nil)
            }
        }
    }

    private func removeAction(_ trip: TripSummary, model: TripListViewModel) -> some View {
        Button(role: .destructive) { pendingRemoval = trip } label: {
            Label(TripListView.removalTitle(for: trip), systemImage: removalSymbol(for: trip))
        }
        .disabled(model.busyTripId != nil)
    }
}

extension TripListView {
    fileprivate var joinInviteButton: some View {
        Button {
            pasteText = UIPasteboard.general.string ?? ""
            showsPastePrompt = true
        } label: {
            Label("초대 링크로 참여", systemImage: "link").font(.subheadline).frame(minHeight: 44)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Ink.accent)
    }
}

/// 여행 중인 여행 — 표지 · 명조 이름 · 한 줄 요약 · '오늘 일정 보기'. 목록에서 가장 크게 읽힌다.
struct LiveTripCard<Cover: View>: View {
    let trip: TripSummary
    let cover: Cover
    let onOpen: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            cover
            Button(action: onOpen) {
                VStack(alignment: .leading, spacing: Space.s) {
                    StatusChip(text: "여행 중 · Day \(trip.todayIndex + 1) / \(trip.dayCount)", symbol: "location.fill", tint: Ink.accent)
                    Text(trip.name)
                        .font(Typeface.editorial(.title))
                        .foregroundStyle(Ink.ink)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(TripListRow.subtitle(trip))
                        .font(.subheadline)
                        .foregroundStyle(Ink.soft)
                    HStack(spacing: Space.xs) {
                        Text("오늘 일정 보기")
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Ink.accent)
                    .frame(minHeight: 44)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Space.xs)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityHint("오늘 일정을 열어요")
        }
        .padding(.bottom, Space.s)
    }
}

/// 여행 한 줄 — 날짜 칸 · 명조 이름 · 요약 · D-day. 표지 대신 날짜가 앞에 선다(목록은 '언제'로 훑는다).
struct TripListRow: View {
    let trip: TripSummary

    var body: some View {
        HStack(spacing: Space.m) {
            dateTile
            VStack(alignment: .leading, spacing: 3) {
                Text(trip.name)
                    .font(Typeface.editorial(.title3))
                    .foregroundStyle(trip.isFinished ? Ink.soft : Ink.ink)
                    .lineLimit(2)
                // D-day는 이름 옆이 아니라 요약 줄 앞이다 — 이름 옆에 두면 이름이 일찍 줄바꿈된다.
                HStack(spacing: Space.s) {
                    if trip.isUpcoming, let days = trip.daysUntilStart {
                        TagChip(text: "D-\(days)", tint: Ink.accent)
                    }
                    Text(Self.subtitle(trip))
                        .font(.subheadline)
                        .foregroundStyle(Ink.soft)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, Space.xs)
        .accessibilityElement(children: .combine)
    }

    /// 날짜 칸 — `12월` 위 `20`. 날짜가 없는 여행은 달력 기호만.
    private var dateTile: some View {
        VStack(spacing: 0) {
            if let parts = Self.monthDay(trip.start) {
                Text(parts.month).font(.caption2.weight(.semibold)).foregroundStyle(Ink.soft)
                Text(parts.day).font(Typeface.editorial(.title3)).foregroundStyle(trip.isFinished ? Ink.soft : Ink.ink)
            } else {
                Image(systemName: "calendar.badge.plus").foregroundStyle(Ink.faint)
            }
        }
        .frame(width: 52, height: 52)
        .background(Ink.sunken, in: RoundedRectangle(cornerRadius: Radius.control))
        .accessibilityHidden(true)
    }

    /// `2026-12-20` → (`12월`, `20`). 못 읽으면 nil — 날짜를 지어내지 않는다.
    static func monthDay(_ iso: String) -> (month: String, day: String)? {
        let parts = iso.split(separator: "-")
        guard parts.count == 3, Int(parts[0]) != nil, let month = Int(parts[1]), let day = Int(parts[2]) else { return nil }
        return ("\(month)월", "\(day)")
    }

    static func subtitle(_ trip: TripSummary) -> String {
        var parts: [String] = []
        if !trip.start.isEmpty { parts.append(ReadableDate.day(trip.start)) }
        parts.append("\(trip.dayCount)일")
        if !trip.cities.isEmpty { parts.append(trip.cities.prefix(3).joined(separator: " · ")) }
        if trip.isShared { parts.append("\(trip.memberCount ?? 1)명") }
        return parts.joined(separator: " · ")
    }
}

struct OfflineNotice: View {
    let savedAt: Date

    var body: some View {
        Label("오프라인 상태예요 · 마지막 동기화 \(TimeFormat.shortTime(savedAt))", systemImage: "wifi.slash")
            .font(.caption)
            .foregroundStyle(Ink.soft)
            .listRowSeparator(.hidden)
    }
}
