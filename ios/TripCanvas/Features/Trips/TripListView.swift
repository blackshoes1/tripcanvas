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

    var body: some View {
        NavigationStack {
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
        }
        // 딥링크는 라우터 하나를 지난다 — 앱을 열어 둔 채로 링크를 눌러도 같은 화면이 뜬다.
        .onOpenURL { url in env.router.open(url: url) }
        .onChange(of: env.router.destination) { _, destination in
            if case .join(let token) = destination {
                joinToken = token
                env.router.clear()
            }
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

    @ViewBuilder
    private func content(_ model: TripListViewModel) -> some View {
        if model.isLoading && model.trips.isEmpty {
            ProgressView("여행을 불러오는 중")
        } else if model.trips.isEmpty {
            EmptyStateView(
                symbol: "suitcase",
                title: "아직 여행이 없어요",
                message: "웹 From J에서 만든 여행이 여기에 나타납니다.")
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
                TodayView(trip: trip)
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
