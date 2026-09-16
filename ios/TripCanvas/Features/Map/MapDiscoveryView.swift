import SwiftUI

/// 지도는 계속 같은 자리에 두고, 아래 목록만 펼친다. 지도 제스처에는 날짜 스와이프를 붙이지 않는다.
struct MapDiscoveryView: View {
    let trip: TripSummary
    let document: TripDocument
    let onReturnFromBoard: () async -> Void
    let onSelectItinerary: (Int, Int) -> Void
    @Environment(AppEnvironment.self) private var env
    @State private var model: MapDiscoveryModel?
    @State private var focus: GeoPoint?
    @State private var showsRegion = false
    @State private var expanded = false
    @State private var tab = 0
    @State private var manualName = ""
    @State private var withoutLocation = false
    @State private var scheduling: CandidateView?

    var body: some View {
        Group {
            if let model { content(model) } else { ProgressView() }
        }
        .task {
            if model == nil {
                model = MapDiscoveryModel(trip: trip, searcher: env.places, source: env.service)
                focus = document.days.lazy.flatMap(\.spots).compactMap(\.point).first
            }
            await model?.loadCandidates()
            if focus == nil {
                focus = model?.undatedCandidates.compactMap(candidatePoint).first
            }
        }
        .sheet(isPresented: $showsRegion) {
            DiscoveryRegionSheet(searcher: env.places) { hit in
                model?.invalidateSearch()
                model?.area = nil
                focus = hit.point
            }
        }
        .sheet(item: $scheduling) { candidate in
            CandidatePlacementSheet(trip: trip, candidate: candidate, source: env.service) { day, position, revision in
                let board = CandidateBoardViewModel(trip: trip, service: env.service, documents: env.service)
                await board.load()
                let saved = await board.schedule(candidateId: candidate.id, dayIndex: day, position: position, expectedRevision: revision)
                await model?.loadCandidates()
                // 일정 저장만 성공하고 후보 표시가 실패해도 부모 일정은 새로 읽는다.
                await onReturnFromBoard()
                return saved ? nil : board.errorMessage ?? "일정에 넣지 못했어요."
            }
        }
    }

    private func content(_ model: MapDiscoveryModel) -> some View {
        VStack(spacing: 0) {
            searchControls(model)
            GeometryReader { geometry in
                VStack(spacing: 0) {
                    MapEngineView(pins: pins(model), focus: focus, onPick: { pick in
                        withoutLocation = false
                        manualName = ""
                        model.selected = PlaceHit(id: pick.placeId ?? UUID().uuidString,
                            name: pick.name ?? "", city: "", address: "", point: pick.point,
                            category: nil, placeId: pick.placeId,
                            provider: pick.placeId == nil ? nil : "google", providerId: pick.placeId)
                    }, preservesCamera: true, selectedPinID: selectedPinID(model), onPinSelected: { id in
                        withoutLocation = false
                        manualName = ""
                        if let hit = model.hits.first(where: { "search-\($0.id)" == id }) {
                            model.selected = hit
                        } else if let candidate = model.undatedCandidates.first(where: { "candidate-\($0.id)" == id }) {
                            model.selected = candidateHit(candidate)
                        } else {
                            for (day, value) in document.days.enumerated() {
                                if let pin = value.pins.first(where: { "day-\(day)-\($0.id)" == id }) {
                                    onSelectItinerary(day, pin.order - 1)
                                }
                            }
                        }
                    }, onAreaChanged: { model.updateArea($0) })
                    .frame(height: geometry.size.height * (expanded ? 0.35 : 0.58))
                    .overlay(alignment: .top) {
                        if focus == nil {
                            Button("여행 지역을 먼저 골라 주세요") { showsRegion = true }
                                .buttonStyle(.borderedProminent).padding(Space.m)
                        }
                    }
                    bottomPanel(model)
                        .frame(maxHeight: .infinity)
                }
            }
        }
        .background(Ink.paper)
        .tint(Ink.accent)
    }

    private func searchControls(_ model: MapDiscoveryModel) -> some View {
        VStack(spacing: Space.xs) {
            HStack(spacing: Space.s) {
                Button { showsRegion = true } label: { Label("지역", systemImage: "globe.asia.australia") }
                    .frame(minHeight: 44)
                TextField("장소 이름 또는 검색어", text: Binding(get: { model.query }, set: {
                    model.query = $0; model.invalidateSearch()
                }))
                .textFieldStyle(.roundedBorder)
                .submitLabel(.search)
                .onSubmit { Task { await model.search() } }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Space.s) {
                    categoryButton("전체", category: nil, model: model)
                    ForEach(PlaceSearchCategory.allCases) { category in
                        categoryButton(category.label, category: category, model: model)
                    }
                }
            }
            HStack {
                Text("☆ 가고 싶은 곳 · 숫자 일정 · 📍 검색")
                    .font(.caption2).foregroundStyle(.secondary)
                Spacer(minLength: Space.xs)
                Button {
                    Task { await model.search() }
                } label: {
                    HStack(spacing: Space.xs) {
                        if model.isSearching { ProgressView().controlSize(.mini) }
                        Text(model.isSearching ? "찾는 중" : "이 지역에서 찾기")
                    }
                    .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                }
                .disabled(focus == nil || model.isSearching || (model.query.isEmpty && model.category == nil))
            }
        }
        .padding(.horizontal, Space.m)
    }

    private func categoryButton(_ title: String, category: PlaceSearchCategory?, model: MapDiscoveryModel) -> some View {
        Button {
            model.category = category
            model.invalidateSearch()
        } label: {
            Text(title).font(.subheadline)
                .padding(.horizontal, Space.m).frame(minHeight: 44)
                .background(model.category == category ? Color.accentColor.opacity(0.15) : Ink.sunken, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(model.category == category ? .isSelected : [])
    }

    private func bottomPanel(_ model: MapDiscoveryModel) -> some View {
        VStack(spacing: 0) {
            HStack {
                Picker("장소 목록", selection: $tab) {
                    Text("검색 \(model.hits.count)").tag(0)
                    Text("담은 장소 \(model.undatedCandidates.count)").tag(1)
                }.pickerStyle(.segmented)
                Button { expanded.toggle() } label: {
                    Image(systemName: expanded ? "chevron.down" : "chevron.up").frame(width: 44, height: 44)
                }
                .accessibilityLabel(expanded ? "목록 접기" : "목록 펼치기")
            }
            .padding(.horizontal, Space.m)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: Space.s) {
                        if let hit = model.selected { placeCard(hit, model: model).id("selected") }
                        if let message = model.errorMessage {
                            Text(message).font(.caption).foregroundStyle(.orange)
                            HStack {
                                Button("다시 검색") { Task { await model.search() } }
                                Button("담은 장소 다시 확인") { Task { await model.loadCandidates() } }
                            }.font(.subheadline).buttonStyle(.bordered)
                        }
                        if tab == 0 {
                            if model.hits.isEmpty && !model.isSearching {
                                Text(model.didSearch ? "이 범위에서 찾은 장소가 없어요. 지도를 옮기거나 검색어를 바꿔 보세요." : "지도를 옮긴 뒤 이 지역에서 찾아보세요.")
                                    .font(.subheadline).foregroundStyle(.secondary)
                            }
                            if !model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                Button("‘\(model.query)’ 직접 담기 · 위치 미정") {
                                    withoutLocation = true
                                    model.selected = PlaceHit(id: "manual-\(UUID().uuidString)", name: model.query,
                                        city: "", address: "위치 미정", point: focus ?? GeoPoint(lat: 0, lng: 0), category: nil, placeId: nil)
                                }.frame(minHeight: 44)
                            }
                            ForEach(model.hits) { hit in
                                hitRow(hit, saved: model.isSaved(hit)) {
                                    withoutLocation = false; model.selected = hit; focus = hit.point
                                }
                            }
                            if !model.hits.isEmpty {
                                Text(MapRegion.isKorea(model.hits.first?.point) ? "장소 정보: 카카오" : "장소 정보: Google Maps")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                        } else {
                            NavigationLink {
                                CandidateBoardView(trip: trip).onDisappear {
                                    Task { await model.loadCandidates(); await onReturnFromBoard() }
                                }
                            } label: {
                                Label("날짜에 배치하고 함께 고르기", systemImage: "calendar.badge.plus")
                                    .frame(minHeight: 44)
                            }
                            if model.undatedCandidates.isEmpty {
                                Text("날짜를 정하지 않고 마음에 드는 곳부터 담아 보세요.")
                                    .font(.subheadline).foregroundStyle(.secondary)
                            }
                            ForEach(model.undatedCandidates) { candidate in
                                if let hit = candidateHit(candidate) {
                                    hitRow(hit, saved: true) { withoutLocation = false; model.selected = hit; focus = hit.point }
                                } else {
                                    Label("\(candidate.title) · 위치 미정", systemImage: "star")
                                        .font(.subheadline).frame(minHeight: 44)
                                }
                            }
                        }
                    }.padding(.horizontal, Space.m).padding(.bottom, Space.m)
                }
                .onChange(of: model.selected?.id) { _, _ in proxy.scrollTo("selected", anchor: .top) }
            }
        }
    }

    private func hitRow(_ hit: PlaceHit, saved: Bool, onSelect: @escaping () -> Void) -> some View {
        Button(action: onSelect) {
            HStack(spacing: Space.s) {
                Image(systemName: saved ? "star.fill" : "mappin.circle")
                VStack(alignment: .leading, spacing: 3) {
                    Text(hit.name).font(.subheadline.weight(.medium))
                    Text(hit.address.isEmpty ? hit.city : hit.address).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if saved { Text("담았어요").font(.caption).foregroundStyle(.secondary) }
            }.frame(minHeight: 44)
        }.buttonStyle(.plain)
    }

    private func placeCard(_ hit: PlaceHit, model: MapDiscoveryModel) -> some View {
        VStack(alignment: .leading, spacing: Space.s) {
            PlacePhotoView(placeId: hit.placeId, kakaoId: hit.provider == "kakao" ? hit.providerId : nil,
                           name: hit.name, allowsGooglePhoto: !MapRegion.isKorea(focus ?? pins(model).first?.point))
                .id(hit.id)
            HStack {
                if hit.name.isEmpty {
                    Text("지도에서 고른 위치").font(.headline)
                } else { Text(hit.name).font(.headline) }
                Spacer()
                Button { model.selected = nil } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }
                    .accessibilityLabel("장소 카드 닫기")
            }
            if hit.name.isEmpty {
                Text("상호는 아직 확인되지 않았어요. 이름을 입력하거나 검색해서 골라 주세요.")
                    .font(.caption).foregroundStyle(.secondary)
                TextField("장소 이름", text: $manualName).textFieldStyle(.roundedBorder)
            } else {
                Text([hit.address, hit.category?.label ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary)
            }
            if model.canSave {
                if model.candidate(for: hit)?.status == "REJECTED" {
                    Text("이전에 후보에서 뺀 장소예요.").font(.caption)
                    Button("가고 싶은 곳으로 되돌리기") { Task { await model.reopen(hit) } }
                        .buttonStyle(.bordered).disabled(model.isSaving)
                }
                Button {
                    var place = hit
                    if hit.name.isEmpty {
                        place = PlaceHit(id: hit.id, name: manualName.trimmingCharacters(in: .whitespacesAndNewlines),
                            city: "", address: "", point: hit.point, category: nil, placeId: nil)
                    }
                    Task { await model.save(place, withoutLocation: withoutLocation) }
                } label: {
                    HStack {
                        if model.isSaving { ProgressView().controlSize(.small) }
                        Label(model.isSaved(hit) ? "담았어요" : "가고 싶은 곳에 담기", systemImage: model.isSaved(hit) ? "checkmark" : "star")
                    }.frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.isSaving || !model.candidatesLoaded || model.isSaved(hit)
                          || model.candidate(for: hit)?.status == "REJECTED"
                          || (hit.name.isEmpty && manualName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                if let candidate = model.candidate(for: hit), candidate.status != "SCHEDULED" && candidate.status != "REJECTED" {
                    Button("날짜와 위치 골라 일정에 넣기") { scheduling = candidate }.frame(minHeight: 44)
                }
            }
            Text("예약 요건 확인 필요").font(.caption).foregroundStyle(.secondary)
            if let url = hit.placeURL, url.scheme == "https" { Link("장소 페이지 확인", destination: url).frame(minHeight: 44) }
            PlaceAdmissionLookup(provider: hit.provider, providerID: hit.providerId).id(hit.id)
        }
        .padding(Space.m)
        .background(Ink.sunken, in: RoundedRectangle(cornerRadius: Radius.card))
    }

    private func candidatePoint(_ candidate: CandidateView) -> GeoPoint? {
        guard let lat = candidate.lat, let lng = candidate.lng else { return nil }
        return GeoPoint(lat: lat, lng: lng)
    }

    private func candidateHit(_ candidate: CandidateView) -> PlaceHit? {
        guard let point = candidatePoint(candidate) else { return nil }
        return PlaceHit(id: "candidate-\(candidate.id)", name: candidate.title, city: "", address: candidate.addr ?? "",
                        point: point, category: nil, placeId: candidate.placeId,
                        provider: candidate.provider, providerId: candidate.providerId)
    }

    private func selectedPinID(_ model: MapDiscoveryModel) -> String? {
        guard let hit = model.selected else { return nil }
        return hit.id.hasPrefix("candidate-") ? hit.id : "search-\(hit.id)"
    }

    private func pins(_ model: MapDiscoveryModel) -> [MapPin] {
        var result = document.days.enumerated().flatMap { day, value in
            value.pins.map { pin in
                MapPin(id: "day-\(day)-\(pin.id)", title: "Day \(day + 1) · \(pin.title)", point: pin.point, order: pin.order)
            }
        }
        result += model.undatedCandidates.compactMap { candidate in
            candidatePoint(candidate).map { MapPin(id: "candidate-\(candidate.id)", title: candidate.title, point: $0, order: 0, kind: .candidate) }
        }
        result += model.hits.map { MapPin(id: "search-\($0.id)", title: $0.name, point: $0.point, order: 0, kind: .searchResult) }
        return result
    }
}

private struct DiscoveryRegionSheet: View {
    let searcher: PlaceSearching
    let onPick: (PlaceHit) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var region: PlaceSearchRegion = .korea
    @State private var hits: [PlaceHit] = []
    @State private var working = false
    @State private var error: String?
    @State private var generation = 0

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("여행 지역", selection: $region) {
                        Text("국내").tag(PlaceSearchRegion.korea)
                        Text("해외").tag(PlaceSearchRegion.international)
                    }.pickerStyle(.segmented)
                    TextField("도시·지역·기준 장소", text: $query).submitLabel(.search).onSubmit { search() }
                    Button { search() } label: {
                        HStack { Text("지역 찾기"); if working { ProgressView() } }
                    }.disabled(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || working)
                } footer: { Text("해외를 선택하면 한국어로 검색해도 해외 장소를 찾아요.") }
                if let error { Text(error).foregroundStyle(.orange) }
                ForEach(hits) { hit in
                    Button { onPick(hit); dismiss() } label: {
                        VStack(alignment: .leading) {
                            Text(hit.name)
                            Text(hit.address).font(.caption).foregroundStyle(.secondary)
                        }.frame(minHeight: 44)
                    }
                }
            }
            .paperGround()
            .tint(Ink.accent)
            .navigationTitle("여행 지역 선택")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } } }
            .onChange(of: region) { _, _ in generation += 1; hits = []; working = false }
            .onChange(of: query) { _, _ in generation += 1; working = false }
        }
    }

    private func search() {
        generation += 1
        let request = generation
        working = true; error = nil
        Task {
            do {
                let found = try await searcher.search(query, area: nil, category: nil, region: region)
                guard generation == request else { return }
                hits = found
                if found.isEmpty { error = "찾은 지역이 없어요. 다른 이름으로 검색해 주세요." }
            } catch {
                guard generation == request else { return }
                self.error = error.localizedDescription
            }
            if generation == request { working = false }
        }
    }
}
