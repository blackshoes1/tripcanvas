import SwiftUI

/// 검색해서 담기. 결과를 고르면 좌표·도시·카테고리가 채워진 장소가 만들어진다.
///
/// 결과가 없을 때와 검색이 안 될 때를 구분해서 말한다 — 둘을 섞으면 "그런 장소가 없다"고 거짓말하게 된다.
struct PlaceSearchView: View {
    /// 근처 우선 검색의 기준. 보통 그날 마지막 장소의 좌표
    let near: GeoPoint?
    /// 상세를 거쳐 담을 때의 버튼 이름(예: '이 장소 일정에 추가'). 없으면 결과를 누르는 즉시 넘긴다.
    var addTitle: String? = nil
    /// 결과가 없을 때 '검색어 그대로 직접 입력'으로 넘긴다. 없으면 그 버튼을 두지 않는다 — 없는 버튼을 말하지 않는다.
    var onManual: ((String) -> Void)? = nil
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
    @State private var detail: PlaceHit?

    var body: some View {
        NavigationStack {
            List {
                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.circle")
                            .font(.subheadline)
                            .foregroundStyle(Ink.warning)
                        Button("같은 검색어로 다시 찾기") { Task { await search() } }
                    }
                }
                if searched && hits.isEmpty && errorMessage == nil && !isSearching {
                    Section {
                        Text("검색 결과가 없어요. 다른 말로 찾아보세요.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        if let onManual {
                            Button {
                                let name = trimmedQuery
                                dismiss()
                                onManual(name)
                            } label: {
                                Label("‘\(trimmedQuery)’ 직접 입력", systemImage: "pencil")
                            }
                        }
                    }
                }
                Section {
                    ForEach(Array(hits.enumerated()), id: \.element.id) { index, hit in
                        Button {
                            if addTitle != nil { detail = hit } else { onPick(hit); dismiss() }
                        } label: {
                            PlaceResultRow(hit: hit, highlighted: index == 0)
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(index == 0 ? Ink.accent.opacity(0.08) : Ink.raised)
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
            .navigationDestination(item: $detail) { hit in
                PlaceDetailView(hit: hit, addTitle: addTitle ?? "이 장소 선택") {
                    onPick(hit)
                    dismiss()
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("닫기") { dismiss() } }
            }
        }
    }

    private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func search() async {
        let trimmed = trimmedQuery
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
