import SwiftUI

/// 검색·선택·저장 완료를 같은 맥락에서 확인한다. 실패하면 선택한 장소와 검색어가 남는다.
struct PlaceSearchView: View {
    let near: GeoPoint?
    var timeZone: String? = nil
    var addTitle: String? = nil
    var onManual: ((String) -> Void)? = nil
    var searcher: PlaceSearching? = nil
    let onPick: (PlaceHit) async -> String?

    @Environment(\.dismiss) private var dismiss
    @Environment(AppEnvironment.self) private var env
    @State private var query = ""
    @State private var scope = PlaceSearchScope.automatic
    @State private var model: PlaceSearchViewModel?
    @State private var task: Task<Void, Never>?
    @State private var detail: PlaceHit?
    @State private var saving = EditorSaveState()

    var body: some View {
        NavigationStack {
            PaperList {
                Section {
                    Picker("찾는 지역", selection: $scope) {
                        ForEach(PlaceSearchScope.allCases) { Text($0.label).tag($0) }
                    }.pickerStyle(.segmented).accessibilityIdentifier("placeSearchRegion")
                }
                if let error = model?.errorMessage ?? saving.error {
                    Section {
                        Label(error, systemImage: "exclamationmark.circle")
                            .font(.subheadline).foregroundStyle(Ink.warning)
                        Button("같은 검색어로 다시 찾기", action: startSearch)
                        if model?.errorMessage != nil, let onManual {
                            Button("검색어 그대로 직접 입력") {
                                let text = model?.searchedQuery ?? query
                                dismiss(); onManual(text)
                            }
                        }
                    }
                }
                if model?.searched == true, model?.hits.isEmpty == true, model?.errorMessage == nil {
                    Section {
                        Text("검색 결과가 없어요. 다른 말이나 지역으로 찾아보세요.")
                            .font(.subheadline).foregroundStyle(Ink.soft)
                        if let onManual {
                            Button("‘\(model?.searchedQuery ?? query)’ 직접 입력") {
                                let text = model?.searchedQuery ?? query
                                dismiss(); onManual(text)
                            }
                        }
                    }
                }
                Section {
                    ForEach(Array((model?.hits ?? []).enumerated()), id: \.element.id) { index, hit in
                        Button {
                            if addTitle != nil { detail = hit }
                            else { Task { await pick(hit) } }
                        } label: { PlaceResultRow(hit: hit, highlighted: index == 0) }
                        .buttonStyle(.plain).disabled(saving.isWorking)
                        .listRowBackground(index == 0 ? Ink.accent.opacity(0.08) : Ink.raised)
                    }
                } footer: {
                    if let hits = model?.hits, !hits.isEmpty {
                        Text(hits.first?.provider == "kakao" ? "국내 · 카카오 검색 결과" : "해외 · 구글 검색 결과")
                    }
                }
            }
            .overlay { if model?.isSearching == true { ProgressView("찾는 중") } }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "장소 이름·주소")
            .onSubmit(of: .search, startSearch)
            .onChange(of: query) { _, _ in task?.cancel(); model?.clear() }
            .onChange(of: scope) { _, _ in startSearch() }
            .navigationTitle("장소 검색").navigationBarTitleDisplayMode(.inline)
            .navigationDestination(item: $detail) { hit in
                PlaceDetailView(hit: hit, addTitle: addTitle ?? "이 장소 선택", saving: saving) {
                    let error = await onPick(hit)
                    if error == nil { dismiss() }
                    return error
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("닫기") { dismiss() }.disabled(saving.isWorking) }
            }
        }
        .interactiveDismissDisabled(saving.isWorking)
        .task {
            if model == nil {
                model = PlaceSearchViewModel(source: searcher ?? env.places)
                scope = .initial(near: near, timeZone: timeZone)
            }
        }
        .onDisappear { task?.cancel(); model?.invalidate() }
    }

    private func startSearch() {
        guard let model else { return }
        saving.clearError()
        task?.cancel()
        let text = query, scope = scope
        task = Task { await model.search(text, near: near, scope: scope) }
    }

    private func pick(_ hit: PlaceHit) async {
        if await saving.perform({ await onPick(hit) }) { dismiss() }
    }
}
