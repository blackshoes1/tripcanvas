import SwiftUI

struct TripCoverResponse: Codable, Equatable {
    let revision: Int
    let imageBase64: String?
    var image: UIImage? {
        imageBase64.flatMap { Data(base64Encoded: $0) }.flatMap { UIImage(data: $0) }
    }
}

struct TripCoverView: View {
    let trip: TripSummary
    let api: APIClient
    /// 마지막으로 본 표지를 파일로 남겨 둔다 — 서버가 답하기 전과 **답하지 못할 때** 자리가 비지 않게.
    let cache: TripCache
    let refresh: UUID
    var onOpen: () -> Void
    @State private var cover: TripCoverService.Cover?
    @State private var saved: TripCoverResponse?
    @State private var showsEditor = false
    @State private var loadFailed = false
    @State private var loadID = UUID()
    @Environment(\.scenePhase) private var scenePhase

    private var city: String { trip.cities.first { !$0.isEmpty && $0 != "기타" } ?? "" }
    private var endpoint: String { "api/v1/trips/\(trip.id)/cover" }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Button(action: onOpen) {
                Color.clear
                    .aspectRatio(TripCoverImage.aspectRatio, contentMode: .fit)
                    .overlay {
                        if let image = saved?.image ?? cover?.image {
                            Image(uiImage: image).resizable().scaledToFill()
                        } else {
                            Rectangle().fill(Ink.sunken)
                                .overlay {
                                    VStack(spacing: Space.s) {
                                        Image(systemName: "globe.asia.australia").font(.largeTitle)
                                        Text(city.isEmpty ? "새로운 여행" : city).font(Typeface.editorial(.title3))
                                    }.foregroundStyle(Ink.soft)
                                }
                        }
                    }
                    .clipped()
                    .clipShape(RoundedRectangle(cornerRadius: 3))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(trip.name) 여행 열기")
            if saved?.imageBase64 == nil, let cover {
                Link(destination: cover.source) {
                    Text("사진: \(cover.author) · \(cover.license) · 일부 잘림")
                        .font(.caption2).foregroundStyle(Ink.soft)
                }.buttonStyle(.plain)
            }
            if trip.canEdit {
                HStack {
                    Spacer()
                    if loadFailed {
                        Button("표지 다시 불러오기") { Task { await load() } }
                            .accessibilityHint("표지를 불러온 뒤 사진을 바꿀 수 있습니다")
                    } else {
                        Button { showsEditor = true } label: { Label("표지 바꾸기", systemImage: "photo") }
                            .disabled(saved == nil)
                    }
                }
                .font(.caption)
                .buttonStyle(.plain)
                .foregroundStyle(Ink.accent)
                .frame(minHeight: 44)
            }
        }
        .task(id: refresh) { await load() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await load() } }
        }
        .sheet(isPresented: $showsEditor, onDismiss: { Task { await load() } }) {
            // 편집 중에는 최초에 읽은 revision을 유지한다. 충돌 시 자동 덮어쓰지 않는다.
            if let saved {
                TripCoverEditor(title: trip.name, storageDescription: "이 여행을 함께 보는 일행과 다른 기기에도 같은 표지가 보여요.", initialImage: saved.image) { data in
                    let updated: TripCoverResponse = try await api.put(endpoint, body: [
                        "expectedRevision": saved.revision,
                        "imageBase64": data.map { $0.base64EncodedString() as Any } ?? NSNull()
                    ])
                    self.saved = updated
                    await cache.save(updated, key: TripCache.coverKey(tripId: trip.id))
                }
            }
        }
    }

    /// 표지를 못 받았을 때 **무엇을 보여줄지**.
    ///
    /// ⚠️ 못 받았다고 보여 주던 표지를 지우지 않는다 — NAS가 잠깐 꺼져도 여행 목록이 비어 보이지 않게.
    /// 표지는 계산이 아니라 사진이라 한 판 낡아도 틀린 말을 하지 않는다(도착 시각과 다른 점이다).
    /// ⚠️ 그래도 `failed`는 세운다: 들고 있는 `revision`이 낡아 그대로 편집하면 충돌한다.
    /// 그래서 화면은 '표지 바꾸기' 대신 '다시 불러오기'를 보인다.
    static func resolve(fetched: TripCoverResponse?, shown: TripCoverResponse?) -> (cover: TripCoverResponse?, failed: Bool) {
        if let fetched { return (fetched, false) }
        return (shown, true)
    }

    @MainActor
    private func load() async {
        guard !showsEditor else { return }
        let attempt = UUID()
        loadID = attempt
        let key = TripCache.coverKey(tripId: trip.id)
        // 지난번 표지를 **먼저** 그린다. 이미 보여 주고 있는 것이 있으면 건드리지 않는다(깜빡임).
        if saved == nil, let cached = await cache.load(TripCoverResponse.self, key: key) {
            guard !Task.isCancelled, !showsEditor, loadID == attempt else { return }
            saved = cached.value
        }
        let fetched: TripCoverResponse? = try? await api.get(endpoint)
        guard !Task.isCancelled, !showsEditor, loadID == attempt else { return }
        let outcome = Self.resolve(fetched: fetched, shown: saved)
        saved = outcome.cover
        loadFailed = outcome.failed
        if let fetched { await cache.save(fetched, key: key) }
        if saved?.imageBase64 == nil {
            let result = await TripCoverService.shared.representative(city: city)
            guard !Task.isCancelled, loadID == attempt else { return }
            cover = result
        }
    }
}
