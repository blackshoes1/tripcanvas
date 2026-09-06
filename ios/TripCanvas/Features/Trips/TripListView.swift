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

    /// 여행 중인 것이 맨 위 — 앱을 여는 이유는 대개 지금 하는 여행이다.
    var ordered: [TripSummary] {
        trips.sorted { lhs, rhs in
            if lhs.isLive != rhs.isLive { return lhs.isLive }
            return lhs.updatedAt > rhs.updatedAt
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
    /// 밀어 넣은 여행. 딥링크가 목록을 거치지 않고 바로 열 수 있게 경로를 들고 있는다.
    @State private var path: [TripSummary] = []
    /// 알림·딥링크가 정한 목적 화면. 규칙(`TripHomeTab.initial`)을 이긴다.
    @State private var requestedTab: TripHomeTab?
    /// 목록이 아직 안 왔을 때 들어온 딥링크 — 목록을 받은 뒤 다시 시도한다(콜드 스타트).
    @State private var pendingDestination: ActionRouter.Destination?

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if let model {
                    content(model)
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("내 여행")
            .toolbar {
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
            await model?.load()
            // 목록보다 딥링크가 먼저 왔을 수 있다(알림으로 앱이 켜진 경우).
            if let pending = pendingDestination, handle(pending) { pendingDestination = nil }
        }
        // 목록으로 돌아오면 딥링크가 정했던 목적지를 지운다 — 다음에 목록에서 고른 여행은 규칙이 정한다.
        .onChange(of: path) { _, current in if current.isEmpty { requestedTab = nil } }
        // 딥링크는 라우터 하나를 지난다 — 앱을 열어 둔 채로 링크를 눌러도 같은 화면이 뜬다.
        .onOpenURL { url in env.router.open(url: url) }
        .onChange(of: env.router.destination) { _, destination in
            guard let destination else { return }
            if handle(destination) { env.router.clear() }
            else { pendingDestination = destination; env.router.clear() }
        }
        .sheet(item: Binding(get: { joinToken.map(JoinToken.init) }, set: { joinToken = $0?.value })) { item in
            JoinInviteView(token: item.value) { _ in
                Task { await model?.load() }
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
            Text("받은 초대 링크를 붙여 넣으세요. 여행 이름과 권한을 먼저 확인한 뒤 참여합니다.")
        }
        .alert("참여할 수 없어요", isPresented: Binding(get: { joinError != nil }, set: { if !$0 { joinError = nil } })) {
            Button("확인") { joinError = nil }
        } message: {
            Text(joinError ?? "")
        }
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
        case .trip(let tripId), .replan(let tripId), .bookings(let tripId), .memory(let tripId),
             .suggestion(let tripId, _):
            // 세부 화면까지는 아직 안 간다 — 여행은 연다. 규칙이 어느 탭인지 정한다.
            guard let trip = find(tripId) else { return false }
            open(trip, tab: nil)
            return true
        case .inbox:
            return false   // 확인 화면은 아직 없다
        }
    }

    private func find(_ tripId: String) -> TripSummary? { model?.trips.first { $0.id == tripId } }

    private func open(_ trip: TripSummary, tab: TripHomeTab?) {
        requestedTab = tab
        path = [trip]
    }

    @ViewBuilder
    private func content(_ model: TripListViewModel) -> some View {
        if model.isLoading && model.trips.isEmpty {
            ProgressView("여행을 불러오는 중")
        } else if model.trips.isEmpty {
            EmptyStateView(
                symbol: "suitcase",
                title: "아직 여행이 없어요",
                message: "웹 With J에서 만든 여행이 여기에 나타납니다.")
        } else {
            List {
                if let cachedAt = model.cachedAt {
                    OfflineNotice(savedAt: cachedAt)
                }
                if let error = model.errorMessage, model.cachedAt == nil {
                    InlineErrorBanner(message: "목록을 새로 불러오지 못했어요", detail: error) {
                        Task { await model.load() }
                    }
                    .listRowSeparator(.hidden)
                }
                ForEach(model.ordered) { trip in
                    NavigationLink(value: trip) {
                        TripRow(trip: trip)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { await model.load() }
            .navigationDestination(for: TripSummary.self) { trip in
                TripHomeView(trip: trip, requested: requestedTab)
            }
        }
    }
}

struct TripRow: View {
    let trip: TripSummary

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            HStack(spacing: Space.s) {
                Text(trip.name).font(.headline)
                if trip.isLive {
                    StatusChip(text: "Day \(trip.todayIndex + 1)", symbol: "location.fill", tint: .blue)
                }
                if trip.isShared {
                    // 함께 보는 여행인지 목록에서 바로 안다 — 편집 권한은 여행 안에서 말한다.
                    StatusChip(text: "\(trip.memberCount ?? 1)명", symbol: "person.2.fill")
                }
            }
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, Space.xs)
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        var parts: [String] = []
        if !trip.start.isEmpty { parts.append(trip.start) }
        parts.append("\(trip.dayCount)일")
        if !trip.cities.isEmpty { parts.append(trip.cities.prefix(3).joined(separator: " · ")) }
        return parts.joined(separator: "  ·  ")
    }
}

/// 오프라인이어도 읽기는 된다 — 대신 언제 받아온 것인지 반드시 말한다(§29).
struct OfflineNotice: View {
    let savedAt: Date

    var body: some View {
        Label("오프라인 상태예요 · 마지막 동기화 \(TimeFormat.shortTime(savedAt))", systemImage: "wifi.slash")
            .font(.caption)
            .foregroundStyle(.secondary)
            .listRowSeparator(.hidden)
    }
}
