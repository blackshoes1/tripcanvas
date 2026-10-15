import SwiftUI

/// 다른 화면에서도 같은 진입·개인정보 공개 규칙을 사용한다.
struct StaffShowButton: View {
    let card: StaffShowCard
    @Environment(AppEnvironment.self) private var env: AppEnvironment?
    @State private var presented = false
    var body: some View {
        Button { presented = true } label: {
            Label("직원에게 이 화면 보여주기", systemImage: "person.crop.rectangle")
                .frame(minHeight: 44)
        }
        .accessibilityIdentifier("staffShowOpen")
        .fullScreenCover(isPresented: $presented) { StaffShowView(card: card) }
        .onChange(of: env?.auth.session?.userId) { _, _ in presented = false }
        .onChange(of: env?.service.cacheScope) { _, _ in presented = false }
    }
}

/// 큰 글씨·스크롤·Dynamic Type을 사용한다. 자동 번역·주소 추측·지도 타일 캐시는 하지 않는다.
struct StaffShowView: View {
    let card: StaffShowCard
    @Environment(AppEnvironment.self) private var env: AppEnvironment?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var revealsConfirmation = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.xl) {
                    Text(card.isReservation ? "Reservation / 예약 정보" : "Destination / 목적지")
                        .font(.headline).foregroundStyle(Ink.soft)
                    VStack(alignment: .leading, spacing: Space.m) {
                        Text(card.title)
                            .font(.largeTitle.weight(.semibold))
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                            .accessibilityIdentifier("staffShowName")
                        Text(card.hasLocalName ? "직접 확인해 적어 둔 현지어 이름" : "일정에 적은 이름 · 현지어 이름 미확인")
                            .font(.subheadline).foregroundStyle(Ink.soft)
                        if let address = card.address {
                            Text("Address / 주소").font(.headline).foregroundStyle(Ink.soft)
                            Text(address).font(.title2).fixedSize(horizontal: false, vertical: true)
                                .accessibilityIdentifier("staffShowAddress")
                        } else {
                            Text("주소가 저장되지 않았어요. 주소를 추측해 표시하지 않아요.")
                                .font(.subheadline).foregroundStyle(Ink.soft)
                        }
                    }
                    ForEach(card.facts) { fact in
                        VStack(alignment: .leading, spacing: Space.xs) {
                            Text(fact.label).font(.subheadline).foregroundStyle(Ink.soft)
                            Text(fact.value).font(.title2.weight(.medium)).fixedSize(horizontal: false, vertical: true)
                        }
                        .accessibilityElement(children: .combine)
                    }
                    if let confirmation = card.confirmation {
                        VStack(alignment: .leading, spacing: Space.s) {
                            if revealsConfirmation {
                                Text("Confirmation / 예약번호").font(.subheadline).foregroundStyle(Ink.soft)
                                Text(confirmation).font(.title2.monospaced()).textSelection(.enabled)
                                    .accessibilityIdentifier("staffShowConfirmation")
                            }
                            Button(revealsConfirmation ? "예약번호 다시 숨기기" : "예약번호 보여주기") {
                                revealsConfirmation.toggle()
                            }
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("staffShowReveal")
                            Text("예약번호는 직접 선택할 때만 보여요. 앱을 벗어나면 다시 숨겨요.")
                                .font(.caption).foregroundStyle(Ink.soft)
                        }
                    }
                    if let point = card.point, let url = coordinateURL(point) {
                        VStack(alignment: .leading, spacing: Space.s) {
                            Link(destination: url) {
                                Label("저장된 위치를 지도 앱에서 열기", systemImage: "map")
                                    .frame(minHeight: 44)
                            }
                            Text("지도에는 인터넷 연결이 필요해요. 이름·주소·예약 정보는 저장된 여행에서 보여드려요.")
                                .font(.caption).foregroundStyle(Ink.soft)
                        }
                    }
                    Text("Saved travel details / 저장된 여행 정보\n예약 확인서의 원문과 다른 내용이 없는지 확인해 주세요.")
                        .font(.caption).foregroundStyle(Ink.soft)
                }
                .padding(Space.xl)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Ink.paper).foregroundStyle(Ink.ink)
            .navigationTitle("보여주기")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("닫기") { dismiss() }.frame(minHeight: 44).accessibilityIdentifier("staffShowClose")
                }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { revealsConfirmation = false }
        }
        .onChange(of: env?.auth.session?.userId) { _, _ in revealsConfirmation = false; dismiss() }
        .onChange(of: env?.service.cacheScope) { _, _ in revealsConfirmation = false; dismiss() }
        .onChange(of: card.confirmation) { _, _ in revealsConfirmation = false }
        .onDisappear { revealsConfirmation = false }
    }

    private func coordinateURL(_ point: GeoPoint) -> URL? {
        var components = URLComponents(string: "https://maps.apple.com/")
        components?.queryItems = [URLQueryItem(name: "ll", value: "\(point.lat),\(point.lng)")]
        return components?.url
    }
}

/// 확인한 원문만 사용자가 적는다. 이 바인딩은 편집기의 초안이라 '저장' 전에는 문서를 바꾸지 않는다.
struct StaffShowEditorSection: View {
    @Binding var details: StaffShowDetails
    var body: some View {
        Section {
            DisclosureGroup("직원에게 보여줄 원문") {
                TextField("현지어 이름 (직접 확인한 원문)", text: $details.localName, axis: .vertical)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .accessibilityIdentifier("staffLocalName")
                TextField("현지 주소 (직접 확인한 원문)", text: $details.address, axis: .vertical)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .accessibilityIdentifier("staffAddress")
                TextField("예약자명 (예약 확인서와 같게)", text: $details.bookingName)
                    .textInputAutocapitalization(.words).autocorrectionDisabled()
                    .accessibilityIdentifier("staffBookingName")
                Text("예약 확인서나 현지 표지에서 확인한 글자를 적어 주세요. 번역하거나 자동으로 채우지 않아요. 저장하면 일행과 공유되는 여행 정보에 들어가요.")
                    .font(.caption).foregroundStyle(Ink.soft)
            }
        }
    }
}

/// 예약 요약만 열었던 경우 문서 정보를 선택할 때 한 번 읽는다. 계정 변경 뒤 늦은 응답은 폐기한다.
struct BookingStaffShowButton: View {
    let tripId: String
    let booking: BookingSummary
    @Environment(AppEnvironment.self) private var env
    @Environment(TripScreenModels.self) private var screenModels: TripScreenModels?
    @State private var card: StaffShowCard?
    @State private var preparing = false
    @State private var preparationGeneration = 0
    @State private var errorMessage: String?
    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Button { Task { await open() } } label: {
                Label(preparing ? "저장된 정보 준비 중…" : "직원에게 이 화면 보여주기", systemImage: "person.crop.rectangle")
                    .frame(minHeight: 44)
            }
            .disabled(preparing)
            if let errorMessage { Text(errorMessage).font(.caption).foregroundStyle(Ink.warning) }
        }
        .fullScreenCover(item: $card) { StaffShowView(card: $0) }
        .onChange(of: env.auth.session?.userId) { _, _ in
            preparationGeneration += 1; card = nil; preparing = false; errorMessage = nil
        }
        .onChange(of: env.service.cacheScope) { _, _ in
            preparationGeneration += 1; card = nil; preparing = false; errorMessage = nil
        }
    }

    @MainActor private func open() async {
        preparationGeneration += 1
        let generation = preparationGeneration, account = env.auth.session?.userId, scope = env.service.cacheScope
        preparing = true; errorMessage = nil
        defer { if generation == preparationGeneration { preparing = false } }
        if let document = screenModels?.plan.document, let saved = document.booking(id: booking.id) {
            card = StaffShowCard(booking: saved, linkedSpot: StaffShowSelection.linkedSpot(document: document, booking: saved))
            return
        }
        do {
            let snapshot = try await env.service.document(tripId: tripId)
            guard generation == preparationGeneration, env.auth.session?.userId == account, env.service.cacheScope == scope else { return }
            if let saved = snapshot.document.booking(id: booking.id) {
                card = StaffShowCard(booking: saved, linkedSpot: StaffShowSelection.linkedSpot(document: snapshot.document, booking: saved))
            } else if booking.source == "SPOT", let day = booking.dayIndex,
                      snapshot.document.hasDay(day), let index = Self.spotIndex(booking.id),
                      snapshot.document.days[day].spots.indices.contains(index) {
                let spot = snapshot.document.days[day].spots[index]
                // 요약 id는 위치 인덱스다. 원문이 갱신되어 다른 장소가 되었으면 추측해 연결하지 않는다.
                if spot.name == booking.title, spot.raw["choice"]?.objectValue?["state"]?.stringValue != "PENDING" {
                    card = StaffShowCard(spot: spot)
                } else { errorMessage = "예약한 장소가 바뀌었어요. 예약 목록을 새로고침한 뒤 다시 확인해 주세요." }
            } else if StaffShowSelection.summaryExists(document: snapshot.document, summary: booking) {
                card = StaffShowCard(summary: booking)
            } else { errorMessage = "이 예약이 바뀌거나 삭제됐어요. 예약 목록을 새로고침해 주세요." }
        } catch APIError.offline {
            guard generation == preparationGeneration, env.auth.session?.userId == account, env.service.cacheScope == scope else { return }
            card = StaffShowCard(summary: booking)
        } catch {
            guard generation == preparationGeneration, env.auth.session?.userId == account, env.service.cacheScope == scope else { return }
            errorMessage = "이 예약 정보를 열지 못했어요. 예약 목록을 새로고침한 뒤 다시 확인해 주세요."
        }
    }

    private static func spotIndex(_ id: String) -> Int? {
        let parts = id.split(separator: ":")
        guard parts.count == 4, parts[0] == "reservation", parts[1] == "SPOT" else { return nil }
        return Int(parts[3])
    }
}

/// '지금'의 다음 일정에서 연다. 계산과 원문이 같은 revision일 때만 위치 인덱스를 신뢰한다.
struct TodayStaffShowButton: View {
    let tripID: String
    let activityID: String
    let expectedName: String
    let revision: Int
    @Environment(AppEnvironment.self) private var env
    @Environment(TripScreenModels.self) private var screenModels: TripScreenModels?
    @State private var card: StaffShowCard?
    @State private var errorMessage: String?
    @State private var loading = false
    @State private var generation = 0
    private var identity: String { "\(tripID)|\(activityID)|\(expectedName)|\(revision)" }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Button { Task { await open() } } label: {
                Label(loading ? "저장된 정보 준비 중…" : "직원에게 이 화면 보여주기", systemImage: "person.crop.rectangle")
                    .frame(minHeight: 44)
            }
            .disabled(loading)
            .accessibilityIdentifier("todayStaffShowOpen")
            if let errorMessage { Text(errorMessage).font(.caption).foregroundStyle(Ink.warning) }
        }
        .fullScreenCover(item: $card) { StaffShowView(card: $0) }
        .onChange(of: env.auth.session?.userId) { _, _ in reset() }
        .onChange(of: env.service.cacheScope) { _, _ in reset() }
        .onChange(of: identity) { _, _ in reset() }
    }

    @MainActor private func reset() {
        generation += 1; card = nil; loading = false; errorMessage = nil
    }

    @MainActor private func open() async {
        generation += 1
        let request = generation, account = env.auth.session?.userId, scope = env.service.cacheScope
        loading = true; errorMessage = nil
        defer { if request == generation { loading = false } }
        do {
            if let plan = screenModels?.plan, let document = plan.document, plan.revision == revision {
                card = try StaffShowSelection.card(document: document, documentRevision: plan.revision,
                    activityID: activityID, expectedName: expectedName, expectedRevision: revision)
                return
            }
            let snapshot = try await env.service.document(tripId: tripID)
            guard request == generation, account == env.auth.session?.userId, scope == env.service.cacheScope else { return }
            card = try StaffShowSelection.card(document: snapshot.document, documentRevision: snapshot.revision,
                activityID: activityID, expectedName: expectedName, expectedRevision: revision)
        } catch let error as StaffShowSelection.Failure {
            guard request == generation, account == env.auth.session?.userId, scope == env.service.cacheScope else { return }
            errorMessage = error.localizedDescription
        } catch {
            guard request == generation, account == env.auth.session?.userId, scope == env.service.cacheScope else { return }
            errorMessage = "저장된 정보를 열지 못했어요. 연결 상태를 확인한 뒤 다시 눌러 주세요."
        }
    }
}
