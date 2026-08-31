import SwiftUI
import Observation

/// 예약은 읽기 중심으로 시작한다(§45). 여행 당일 필요한 것만 빠르게: 시간·장소·상태·번호·링크.
/// 자동 재예약은 하지 않는다(§44) — 더 싼 조건이 보이면 알려주고 판단은 사용자에게 맡긴다.
@Observable
@MainActor
final class BookingListViewModel {
    private(set) var bookings: [BookingSummary] = []
    private(set) var isLoading = false
    private(set) var errorMessage: String?
    private(set) var cachedAt: Date?

    private let service: TripDataSource
    private let tripId: String

    init(tripId: String, service: TripDataSource) {
        self.tripId = tripId
        self.service = service
    }

    func load() async {
        if bookings.isEmpty { isLoading = true }
        defer { isLoading = false }
        do {
            let fetched = try await service.bookings(tripId: tripId)
            bookings = fetched.value
            cachedAt = fetched.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct BookingListView: View {
    let trip: TripSummary
    @Environment(AppEnvironment.self) private var env
    @State private var model: BookingListViewModel?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.m) {
                if let model {
                    if let cachedAt = model.cachedAt {
                        Label("오프라인 · 마지막 동기화 \(TimeFormat.shortTime(cachedAt))", systemImage: "wifi.slash")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if let error = model.errorMessage, model.bookings.isEmpty {
                        InlineErrorBanner(message: "예약을 불러오지 못했어요", detail: error) {
                            Task { await model.load() }
                        }
                    }
                    if model.bookings.isEmpty && !model.isLoading {
                        EmptyStateView(
                            symbol: "ticket",
                            title: "등록된 예약이 없어요",
                            message: "웹 TripCanvas에서 예약을 추가하면 여기에 나타납니다.")
                    }
                    ForEach(model.bookings) { booking in
                        BookingCard(booking: booking)
                    }
                    if model.isLoading && model.bookings.isEmpty {
                        ProgressView().frame(maxWidth: .infinity, minHeight: 160)
                    }
                }
            }
            .padding(Space.l)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("예약")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model?.load() }
        .task {
            if model == nil { model = BookingListViewModel(tripId: trip.id, service: env.service) }
            await model?.load()
        }
    }
}

struct BookingCard: View {
    let booking: BookingSummary

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            HStack(spacing: Space.s) {
                Image(systemName: symbol).foregroundStyle(.secondary)
                Text(booking.title).font(.headline)
                Spacer()
                if let status = booking.priceStatus {
                    PriceChip(status: status)
                }
            }

            if let period {
                Label(period, systemImage: "calendar").font(.subheadline).foregroundStyle(.secondary)
            }
            if let place = booking.place, !place.isEmpty {
                Label(place, systemImage: "mappin.and.ellipse").font(.subheadline).foregroundStyle(.secondary)
            }
            HStack(spacing: Space.m) {
                Text(TimeFormat.money(booking.price, currency: booking.currency)).font(.subheadline.weight(.semibold))
                if let refundable = booking.refundable {
                    Text(refundable ? "환불 가능" : "환불 불가").font(.caption).foregroundStyle(.secondary)
                }
            }

            if let confirmation = booking.confirmation {
                // 길게 눌러 복사 — 현장에서 번호를 불러야 할 때 가장 빠른 동작이다.
                Text("예약번호 \(confirmation)")
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
            }

            if let status = booking.priceStatus {
                VStack(alignment: .leading, spacing: 2) {
                    Text(status.note).font(.caption).foregroundStyle(.secondary)
                    if let observed = status.observedAt {
                        // 언제 확인한 값인지 반드시 함께 — 오래된 값을 최신처럼 보여주지 않는다.
                        Text("확인 시각 \(observed)").font(.caption2).foregroundStyle(.tertiary)
                    }
                }
            }

            if let raw = booking.url, let url = URL(string: raw), url.scheme?.hasPrefix("http") == true {
                Link(destination: url) {
                    Label("예약 페이지 열기", systemImage: "safari").font(.subheadline)
                }
                .frame(minHeight: 44)
            }
        }
        .card()
        .accessibilityElement(children: .contain)
    }

    private var symbol: String {
        switch booking.type {
        case .hotel: "bed.double.fill"
        case .car: "car.fill"
        case .flight: "airplane"
        case .unknown: "ticket"
        }
    }

    private var period: String? {
        switch (booking.start, booking.end) {
        case let (start?, end?): "\(start) → \(end)"
        case let (start?, nil): start
        case let (nil, end?): end
        default: nil
        }
    }
}

struct PriceChip: View {
    let status: PriceStatus

    var body: some View {
        StatusChip(text: text, symbol: symbol, tint: tint)
    }

    private var text: String {
        switch status.state {
        case .savingAvailable:
            if let saving = status.savingAmount {
                return "\(TimeFormat.money(saving, currency: status.currency)) 절약 가능"
            }
            return "더 싼 조건 발견"
        case .cheaperUnverified: return "조건 확인 필요"
        case .goodPrice: return "좋은 가격"
        case .watching: return "추적 중"
        case .error: return "확인 실패"
        case .untracked: return "추적 꺼짐"
        case .unknown: return "상태 확인 필요"
        }
    }

    private var symbol: String {
        switch status.state {
        case .savingAvailable: "arrow.down.circle.fill"
        case .cheaperUnverified: "questionmark.circle"
        case .goodPrice: "checkmark.seal"
        case .watching: "eye"
        case .error: "exclamationmark.triangle"
        case .untracked, .unknown: "minus.circle"
        }
    }

    private var tint: Color {
        switch status.state {
        case .savingAvailable: .green
        case .cheaperUnverified: .orange
        case .goodPrice: .blue
        case .error: .red
        case .watching, .untracked, .unknown: .secondary
        }
    }
}
