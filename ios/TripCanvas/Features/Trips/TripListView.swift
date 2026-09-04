import SwiftUI
import Observation

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
    @State private var showsWeb = false

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
                // 계획·편집은 웹에만 있다 — 앱에서 나갔다 오지 않게 그 화면을 여기서 연다.
                ToolbarItem(placement: .topBarLeading) {
                    Button { showsWeb = true } label: { Image(systemName: "globe") }
                        .accessibilityLabel("웹 화면 열기")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if let email = env.auth.email { Text(email) }
                        Button("로그아웃", role: .destructive) { env.auth.signOut() }
                    } label: {
                        Image(systemName: "person.crop.circle")
                    }
                    .accessibilityLabel("계정")
                }
            }
        }
        .fullScreenCover(isPresented: $showsWeb) {
            WebAppView(url: AppConfig.webBaseURL)
        }
        .task {
            if model == nil { model = TripListViewModel(service: env.service) }
            await model?.load()
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
