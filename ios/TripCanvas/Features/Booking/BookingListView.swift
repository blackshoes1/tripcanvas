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

/// 예약 목록. 읽기는 서버 요약(`/bookings` — 가격 상태가 붙어 온다)이고, **편집은 여행 문서**다.
///
/// 예약은 장소와 같은 문서(`trip.bookings`)에 살아서 저장 경로도 같다 — `TripPlanViewModel`이 revision CAS로
/// 올리고, 실패하면 되돌리고, 충돌이면 묻는다. 저장한 뒤에는 요약을 다시 읽어 가격 상태를 그대로 보여준다.
struct BookingListView: View {
    let trip: TripSummary
    @Environment(AppEnvironment.self) private var env
    @State private var model: BookingListViewModel?
    /// 편집할 때만 문서를 연다 — 보기만 하는 사람은 요약 하나로 끝난다.
    @State private var plan: TripPlanViewModel?
    @State private var editor: BookingEditorTarget?
    @State private var isPreparing = false

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
                    if let plan, let error = plan.errorMessage {
                        InlineErrorBanner(message: "예약을 바꾸지 못했어요", detail: error) {
                            Task { await plan.load() }
                        }
                    }
                    if model.bookings.isEmpty && !model.isLoading {
                        EmptyStateView(
                            symbol: "ticket",
                            title: "등록된 예약이 없어요",
                            message: trip.canEdit
                                ? "오른쪽 위 ＋로 숙박·렌터카·항공 예약을 추가합니다. 가격 추적을 켜 두면 절약 기회를 알려줘요."
                                : "주최자나 편집자가 예약을 추가하면 여기에 나타납니다.")
                    }
                    ForEach(model.bookings) { booking in
                        BookingCard(booking: booking, editable: trip.canEdit)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                guard trip.canEdit else { return }
                                Task { await openEditor(bookingId: booking.id) }
                            }
                            .accessibilityAddTraits(trip.canEdit ? [.isButton] : [])
                            .accessibilityHint(trip.canEdit ? "예약을 고칩니다" : "")
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
        .toolbar {
            if trip.canEdit {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await openEditor(bookingId: nil) }
                    } label: {
                        if isPreparing { ProgressView() } else { Image(systemName: "plus") }
                    }
                    .disabled(isPreparing)
                    .accessibilityLabel("예약 추가")
                }
            }
        }
        .refreshable { await model?.load() }
        .task {
            if model == nil { model = BookingListViewModel(tripId: trip.id, service: env.service) }
            await model?.load()
        }
        .sheet(item: $editor) { target in
            if let plan, let document = plan.document {
                BookingEditorView(
                    target: target,
                    document: document,
                    onSave: { booking, links in
                        Task {
                            if await plan.saveBooking(booking, links: links) { await model?.load() }
                        }
                    },
                    onDelete: { id in
                        Task {
                            await plan.removeBooking(id: id)
                            await model?.load()
                        }
                    })
            }
        }
        .overlay(alignment: .bottom) {
            if let plan, let toast = plan.toast {
                ToastView(text: toast)
                    .padding(Space.l)
                    .task {
                        try? await Task.sleep(for: .seconds(2))
                        plan.clearToast()
                    }
            }
        }
        // 충돌은 자동으로 어느 쪽도 고르지 않는다 — 무엇이 사라지는지 말하고 사용자가 고른다(§91).
        .alert("다른 기기에서 먼저 바뀌었어요", isPresented: conflictBinding) {
            Button("최신 불러오기") { Task { await plan?.reloadFromServer(); await model?.load() } }
            Button("그대로 두기", role: .cancel) { plan?.dismissConflict() }
        } message: {
            Text("최신 여행을 불러오면 방금 바꾼 예약은 사라집니다. 방금 바꾼 것은 아직 저장되지 않았어요.")
        }
    }

    private var conflictBinding: Binding<Bool> {
        Binding(get: { plan?.conflict != nil }, set: { if !$0 { plan?.dismissConflict() } })
    }

    /// 편집기는 **최신 문서** 위에서 연다 — 오래된 문서 위에서 고치면 저장이 전부 충돌로 돌아온다.
    private func openEditor(bookingId: String?) async {
        isPreparing = true
        defer { isPreparing = false }
        let plan = self.plan ?? TripPlanViewModel(tripId: trip.id, service: env.service)
        self.plan = plan
        await plan.load()
        guard let document = plan.document else { return }   // 오류는 배너가 말한다
        guard plan.canEdit else { return }
        if let bookingId {
            guard let booking = document.booking(id: bookingId) else {
                // 목록이 옛것이다 — 다른 기기가 이미 뺐다. 요약을 다시 읽어 그 사실을 보여준다.
                await model?.load()
                return
            }
            editor = .edit(booking)
        } else {
            editor = .create
        }
    }
}

struct BookingCard: View {
    let booking: BookingSummary
    var editable = false

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            HStack(spacing: Space.s) {
                Image(systemName: symbol).foregroundStyle(.secondary)
                Text(booking.title).font(.headline)
                Spacer()
                if let status = booking.priceStatus {
                    PriceChip(status: status)
                }
                if editable {
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
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
