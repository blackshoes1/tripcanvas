import SwiftUI

struct TripCoverResponse: Decodable {
    let revision: Int
    let imageBase64: String?
    var image: UIImage? {
        imageBase64.flatMap { Data(base64Encoded: $0) }.flatMap { UIImage(data: $0) }
    }
}

struct TripCoverView: View {
    let trip: TripSummary
    let api: APIClient
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
                }
            }
        }
    }

    @MainActor
    private func load() async {
        guard !showsEditor else { return }
        let attempt = UUID()
        loadID = attempt
        do {
            let result: TripCoverResponse = try await api.get(endpoint)
            guard !Task.isCancelled, !showsEditor, loadID == attempt else { return }
            saved = result; loadFailed = false
        } catch {
            guard !Task.isCancelled, !showsEditor, loadID == attempt else { return }
            saved = nil; loadFailed = true
        }
        if saved?.imageBase64 == nil {
            let result = await TripCoverService.shared.representative(city: city)
            guard !Task.isCancelled, loadID == attempt else { return }
            cover = result
        }
    }
}
