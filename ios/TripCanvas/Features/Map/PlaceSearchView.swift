import SwiftUI

/// 검색해서 담기. 결과를 고르면 좌표·도시·카테고리가 채워진 장소가 만들어진다.
///
/// 결과가 없을 때와 검색이 안 될 때를 구분해서 말한다 — 둘을 섞으면 "그런 장소가 없다"고 거짓말하게 된다.
struct PlaceSearchView: View {
    /// 근처 우선 검색의 기준. 보통 그날 마지막 장소의 좌표
    let near: GeoPoint?
    /// 고른 검색 결과를 **그대로** 넘긴다 — 일정에 넣을지 후보로 담을지는 부르는 쪽이 정한다.
    /// (`TripSpot`으로 미리 바꾸면 후보에 필요한 주소가 사라진다)
    let onPick: (PlaceHit) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(AppEnvironment.self) private var env
    @State private var query = ""
    @State private var hits: [PlaceHit] = []
    @State private var isSearching = false
    @State private var errorMessage: String?
    @State private var searched = false
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            List {
                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.circle")
                            .font(.subheadline)
                            .foregroundStyle(.orange)
                    }
                }
                if searched && hits.isEmpty && errorMessage == nil && !isSearching {
                    Section {
                        Text("검색 결과가 없어요. 다른 말로 찾아보거나 직접 입력할 수 있어요.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                Section {
                    ForEach(hits) { hit in
                        Button {
                            onPick(hit)
                            dismiss()
                        } label: {
                            HStack(alignment: .top, spacing: Space.m) {
                                Text(hit.category?.icon ?? "📍").font(.title3)
                                VStack(alignment: .leading, spacing: Space.xs) {
                                    Text(hit.name).font(.body.weight(.semibold))
                                    if !hit.address.isEmpty {
                                        Text(hit.address).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                    }
                                    if !hit.city.isEmpty {
                                        Text(hit.city).font(.caption2).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                } footer: {
                    if !hits.isEmpty {
                        Text(MapRegion.isKoreanSearch(query, near: near) ? "카카오 검색 결과" : "구글 검색 결과")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .overlay {
                if isSearching { ProgressView("찾는 중") }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "장소 이름·주소")
            .onSubmit(of: .search) { Task { await search() } }
            .navigationTitle("장소 검색")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("닫기") { dismiss() } }
            }
        }
    }

    private func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isSearching = true
        defer { isSearching = false }
        do {
            hits = try await env.places.search(trimmed, near: near)
            errorMessage = nil
        } catch {
            hits = []
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        searched = true
    }
}

/// 지도에서 자리 고르기. 탭한 좌표(해외는 POI 신원까지)를 돌려준다.
///
/// 좌표 역추적(이름 추측)은 하지 않는다 — 추측이라 엉뚱한 상호가 들어갈 수 있다. 이름은 사용자가 쓴다.
struct MapPickerView: View {
    let initial: GeoPoint?
    let regionHint: Bool
    let onPick: (MapPick) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var picked: MapPick?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                MapEngineView(
                    pins: initial.map { [MapPin(id: "current", title: "지금 위치", point: $0, order: 1)] } ?? [],
                    focus: initial,
                    regionHint: regionHint,
                    onPick: { picked = $0 })
                    .ignoresSafeArea(edges: .bottom)
                VStack(spacing: Space.s) {
                    if let picked {
                        Text(picked.name ?? String(format: "%.5f, %.5f", picked.point.lat, picked.point.lng))
                            .font(.subheadline.weight(.semibold))
                        if picked.placeId == nil {
                            Text("탭한 자리의 좌표만 담깁니다. 이름은 직접 적어 주세요.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    } else {
                        Text("지도를 탭해 자리를 고르세요. 해외 지도에서는 장소 아이콘을 탭하면 이름까지 담깁니다.")
                            .font(.caption).foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    PrimaryActionButton(title: "이 자리로") {
                        if let picked { onPick(picked) }
                        dismiss()
                    }
                    .disabled(picked == nil)
                }
                .padding(Space.l)
                .background(Color(.systemBackground))
            }
            .navigationTitle("지도에서 고르기")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("취소") { dismiss() } }
            }
        }
    }
}
