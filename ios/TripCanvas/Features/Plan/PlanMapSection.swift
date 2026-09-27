import SwiftUI

/// '이 날' 지도가 보이는 장면. 기본은 주 장면이고 칩으로 바꾼다. 날을 옮기면 되돌아간다.
enum SceneChoice: Equatable {
    case main
    case all
    case scene(Int)
}

/// 일정 화면의 지도 구획 — 범위(이 날 | 전체) · 장소 검색 · 장면 칩 · 그날 장소 목록.
///
/// ⚠️ **지도에서만 쓰는 상태는 여기가 소유한다**(고른 장소·그 선택이 어느 날의 것인지·장면·범위).
/// 예전에는 `TripPlanView`가 함께 들고 있었는데, 목록·시트 상태와 섞여 있어 "이 값을 누가 언제
/// 바꾸는가"가 한눈에 보이지 않았다. 밖으로 나가는 일(시트 열기·문서 고치기)만 `actions`로 넘긴다.
///
/// ⚠️ 지도는 한 번 만들면 **숨기기만 한다** — 부모가 `showsMap`으로 알려 주고 엔진은 쉰다.
struct PlanMapSection: View {
    let trip: TripSummary
    let model: TripPlanViewModel
    let discovery: MapDiscoveryModel
    /// 지금 지도를 보고 있는가. 탭 바가 정한다 — 숨긴 동안 엔진을 멈추고 전체 동선도 받지 않는다.
    let showsMap: Bool
    /// 장소 검색을 열어 두었는가. **부모도 읽는다**(검색 중에는 날짜 칩을 감춘다)서 바인딩이다.
    @Binding var mapSearching: Bool
    let motion: Animation
    let actions: PlanActions

    /// 지도를 하루만 볼지 여행 전체로 볼지.
    @State private var mapScope: MapScope = .day
    @State private var selectedMapSpot: Int?
    /// 그 선택이 **어느 날**의 것인가. 날을 옮기면 옛 번호가 새 날의 장소를 가리키지 않게 — 같은 날일 때만 선택이다.
    @State private var selectedMapSpotDay: Int?
    @State private var sceneChoice: SceneChoice = .main
    @State private var reorderMode: EditMode = .inactive
    @State private var isReordering = false

    /// 그날의 동선. 좌표 없는 장소는 여기 안 나온다 — 목록의 '위치 없음'이 그 사실을 말한다.
    var body: some View {
        VStack(spacing: 0) {
            // 범위(이 날 | 전체)와 검색은 다른 일이다 — 같은 세그먼트에 넣지 않는다.
            // 전체는 **누른 순간에만** 받는다(열지도 않을 날을 미리 받지 않는다).
            HStack(spacing: Space.s) {
                Picker("보기 범위", selection: $mapScope) {
                    Text("이 날").tag(MapScope.day)
                    Text("전체").tag(MapScope.trip)
                }
                .pickerStyle(.segmented)
                .disabled(mapSearching)
                TonalActionButton(title: mapSearching ? "닫기" : "검색",
                                  systemImage: mapSearching ? "xmark" : "magnifyingglass") {
                    withAnimation(motion) { mapSearching.toggle() }
                }
                .accessibilityLabel(mapSearching ? "장소 검색 닫기" : "장소 검색 열기")
            }
            .padding(.horizontal, Space.l)
            .padding(.vertical, Space.xs)

            if mapSearching, let document = model.document {
                MapDiscoveryView(trip: trip, document: document, model: discovery, isVisible: showsMap,
                                 onReturnFromBoard: { await model.load() }, onSelectItinerary: { day, spot in
                    actions.selectDay(day, day > model.selectedDay)
                    selectMapSpot(spot, day: day)
                    mapSearching = false
                    mapScope = .day
                })
            } else if mapScope == .trip { tripMap } else { singleDayMap }
        }
        // 숨겨진 동안은 전체 동선을 받지 않는다 — 보고 있지 않은 지도를 위해 서버를 부르지 않는다.
        .task(id: "\(mapScope)-\(model.revision)-\(showsMap)-\(mapSearching)") {
            if mapScope == .trip, showsMap, !mapSearching { await model.loadTripRoutes() }
        }
    }

    /// 여행 전체 — 날마다 색이 다르다(웹의 일자 색 순서와 같다).
    @ViewBuilder
    private var tripMap: some View {
        if let routes = model.tripRoutes {
            let days = routes.days.filter { !$0.spots.isEmpty }
            if days.isEmpty {
                EmptyStateView(symbol: "map", title: "지도에 놓을 장소가 없어요",
                               message: "장소를 담으면 여행 전체 동선이 여기에 보여요.")
            } else {
                MapEngineView(
                    pins: days.flatMap(\.pins),
                    routes: days.flatMap { $0.mapRoutes(colorIndex: $0.index) },
                    isVisible: showsMap)
                    .ignoresSafeArea(edges: .bottom)
                    .overlay(alignment: .topLeading) {
                        VStack(alignment: .leading, spacing: Space.xs) {
                            if let note = Self.routeNote(days.flatMap { $0.mapRoutes(colorIndex: $0.index) }) {
                                mapNote(note)
                            }
                            dayLegend(days.map(\.index))
                        }
                        .padding(Space.m)
                    }
            }
        } else if model.isLoadingTripRoutes {
            // 스피너만 두지 않는다 — 무엇을 기다리는지 말한다. 실패는 아래 빈 화면이 따로 말한다.
            MapLoadingPlaceholder(message: "전체 동선을 불러오는 중이에요")
        } else {
            EmptyStateView(symbol: "map", title: "전체 동선을 불러오지 못했어요",
                           message: "잠시 후 다시 시도해 주세요. 이 날 보기는 그대로 쓸 수 있어요.")
        }
    }

    /// 일자 색 범례 — 색만으로 말하지 않는다(§47). 지도를 덜 가리게 한 줄로 흘린다.
    private func dayLegend(_ indexes: [Int]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Space.s) {
                ForEach(indexes, id: \.self) { index in
                    HStack(spacing: 4) {
                        Circle().fill(Color(MapPalette.color(index))).frame(width: 10, height: 10)
                        Text("Day \(index + 1)").font(.caption2.weight(.semibold))
                    }
                }
            }
            .padding(.horizontal, Space.m).padding(.vertical, Space.xs + 2)
        }
        .background(.thinMaterial, in: Capsule())
        .frame(maxWidth: 320, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("일자별 색: " + indexes.map { "Day \($0 + 1)" }.joined(separator: ", "))
    }

    @ViewBuilder
    private var singleDayMap: some View {
        if let day = model.day {
            let selection = mapSelection(on: model.selectedDay)
            // 도시를 건너는 날은 장면으로 나눈다 — 기본 카메라는 주 장면, 전체는 칩으로. 도시 안 하루는 장면이 하나다.
            let scenes = MapScenes.split(day.sceneSpots)
            let routes = model.isSaving ? [] : (model.planDay?.mapRoutes ?? [])
            VStack(spacing: 0) {
                if !day.pins.isEmpty {
                    if scenes.count >= 2 {
                        sceneChips(scenes, transfers: sceneTransfers(scenes, plan: model.planDay), main: MapScenes.mainScene(in: scenes))
                    }
                    // 고른 장소가 있을 때만 거기로 간다. 없으면 `focus`를 비워 엔진이 `frame`(고른 장면) 또는
                    // **그날 동선 전체**(핀+선)를 맞춘다 — 첫 장소를 넣으면 거기에 줌인해 나머지 동선이 화면 밖이다(2026-09-19 전 모습).
                    MapEngineView(pins: day.pins, routes: routes,
                                  focus: selection.flatMap { day.spots.indices.contains($0) ? day.spots[$0].point : nil },
                                  frame: sceneFrame(scenes, routes: routes),
                                  preservesCamera: false,
                                  selectedPinID: day.pins.first(where: { $0.order - 1 == selection })?.id,
                                  onPinSelected: { id in chooseMapSpot(day.pins.first(where: { $0.id == id }).map { $0.order - 1 }, day: model.selectedDay, scenes: scenes) },
                                  isVisible: showsMap)
                        .frame(minHeight: 180, maxHeight: .infinity)
                        // 선이 도로인지 직선인지는 지도 **위**에서 말한다 — 전체 지도와 같은 자리·같은 모양.
                        // ⚠️ 위쪽이다: 왼쪽 아래는 Google 로고 자리라 가리면 안 된다(약관).
                        .overlay(alignment: .topLeading) {
                            if let note = Self.routeNote(routes) { mapNote(note).padding(Space.m) }
                        }
                } else {
                    VStack(spacing: Space.m) {
                        EmptyStateView(symbol: "map", title: "지도에 놓을 장소가 없어요",
                                       message: "장소를 찾아 담으면 이 날의 동선이 지도에 그려져요.")
                        TonalActionButton(title: "지도에서 장소 찾기", systemImage: "magnifyingglass") {
                            withAnimation(motion) { mapSearching = true }
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                // 방문 순서 — 지도 아래 둥근 판. 줄의 번호 배지는 지도 핀과 **같은 색·같은 번호**다.
                VStack(spacing: 0) {
                    HStack(spacing: Space.s) {
                        Text("방문 순서").font(.headline).foregroundStyle(Ink.ink)
                            .accessibilityAddTraits(.isHeader)
                        Text("\(day.spots.count)곳").font(.subheadline).foregroundStyle(Ink.soft)
                        Spacer()
                        if isReordering { ProgressView().controlSize(.small) }
                        if model.canEdit, day.spots.count > 1 {
                            Button(reorderMode.isEditing ? "완료" : "순서 편집") {
                                withAnimation(motion) {
                                    reorderMode = reorderMode.isEditing ? .inactive : .active
                                }
                            }
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Ink.accent)
                            .disabled(model.isSaving || isReordering)
                        }
                    }
                    .padding(.horizontal, Space.l)
                    .padding(.top, Space.m)
                    .frame(minHeight: 44)
                    ScrollViewReader { proxy in
                        List {
                            ForEach(Array(day.spots.enumerated()), id: \.offset) { index, spot in
                                HStack(spacing: Space.m) {
                                    Button {
                                        // 고른 줄을 다시 누르면 고름을 푼다 — 지도가 다시 그 장면(또는 그날 전체)을 보인다.
                                        chooseMapSpot(selection == index ? nil : index, day: model.selectedDay, scenes: scenes)
                                    } label: {
                                        HStack(spacing: Space.m) {
                                            orderBadge(index + 1, selected: selection == index, located: spot.point != nil)
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(spot.name.isEmpty ? "이름 없는 장소" : spot.name)
                                                    .font(.body.weight(.semibold))
                                                    .foregroundStyle(Ink.ink)
                                                    .lineLimit(1)
                                                let meta = rowMeta(index, spot: spot)
                                                if !meta.isEmpty {
                                                    Text(meta).font(.caption)
                                                        .foregroundStyle(spot.point == nil ? Ink.warning : Ink.soft)
                                                        .lineLimit(1)
                                                }
                                            }
                                            // 줄 사이 구분선은 이름에서 시작한다 — 번호 배지 밑까지 긋지 않는다.
                                            .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
                                        }
                                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                        .contentShape(Rectangle())
                                    }.buttonStyle(.plain)
                                    Button { actions.viewSpot(index, spot) } label: {
                                        Image(systemName: "info.circle").foregroundStyle(Ink.soft).frame(width: 36, height: 44)
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel("\(spot.name) 장소·예약 정보")
                                    if model.canEdit {
                                        Menu {
                                            Button("편집") { actions.editSpot(index, spot) }
                                            Button("이 장소 뒤에 추가") { actions.addAfter(index) }
                                            Button("날짜·위치 옮기기") { actions.moveSpots([index]) }
                                        } label: {
                                            Image(systemName: "ellipsis").foregroundStyle(Ink.soft).frame(width: 36, height: 44)
                                        }
                                        .accessibilityLabel("\(spot.name) 일정 작업")
                                    }
                                }
                                .listRowBackground(selection == index ? Ink.accent.opacity(0.10) : Ink.raised)
                                .listRowSeparatorTint(Ink.hairline)
                                .id(index)
                            }
                            .onMove { source, destination in
                                guard model.canEdit, !model.isSaving, !isReordering else { return }
                                let dayIndex = model.selectedDay
                                isReordering = true
                                selectMapSpot(nil, day: nil)
                                sceneChoice = .main
                                Task {
                                    defer { isReordering = false }
                                    guard model.selectedDay == dayIndex else { return }
                                    await model.moveSpots(from: source, to: destination)
                                }
                            }
                            .moveDisabled(!model.canEdit || model.isSaving || isReordering)
                        }
                        .listStyle(.plain)
                        .scrollContentBackground(.hidden)
                        .frame(maxHeight: 240)
                        .environment(\.editMode, $reorderMode)
                        .disabled(model.isSaving || isReordering)
                        .onChange(of: selectedMapSpot) { _, index in if let index { proxy.scrollTo(index, anchor: .center) } }
                    }
                }
                .background(Ink.raised)
                .clipShape(UnevenRoundedRectangle(topLeadingRadius: Radius.panel, topTrailingRadius: Radius.panel))
                .shadow(color: Ink.ink.opacity(0.08), radius: 8, y: -2)
                // ⚠️ 판을 지도 위로 겹치지 않는다 — 지도 왼쪽 아래의 Google 로고를 가리면 안 된다(약관).
            }
            .onChange(of: model.selectedDay) { _, _ in
                selectMapSpot(nil, day: nil)
                sceneChoice = .main
                reorderMode = .inactive
            }
            .onChange(of: day.spots) { _, _ in
                selectMapSpot(nil, day: nil)
                sceneChoice = .main
            }
        }
    }

    /// 지도 핀과 같은 번호 배지 — 같은 색(`MapPalette`)·같은 번호라 목록의 줄이 지도의 어느 점인지 바로 보인다.
    /// 위치가 없는 장소는 지도에 없으니 속이 빈 원이다.
    private func orderBadge(_ number: Int, selected: Bool, located: Bool) -> some View {
        let fill = Color(uiColor: selected ? MapPalette.selected : MapPalette.itinerary)
        return Text("\(number)")
            .font(.footnote.weight(.bold).monospacedDigit())
            .foregroundStyle(located ? .white : Ink.soft)
            .frame(width: 26, height: 26)
            .background(located ? fill : Color.clear, in: Circle())
            .overlay(Circle().strokeBorder(located ? Color.clear : Ink.faint, style: StrokeStyle(lineWidth: 1.5, dash: [3, 2])))
            .accessibilityHidden(true)
    }

    /// `10:00 · 명소` — 서버가 계산한 도착 예상과 유형. 위치가 없으면 그 사실이 먼저다(지도에 없다).
    private func rowMeta(_ index: Int, spot: TripSpot) -> String {
        if spot.point == nil { return "위치 미정 · 지도에 없어요" }
        var parts: [String] = []
        if let eta = model.planSpot(at: index)?.etaMinutes { parts.append(TimeFormat.clockAcrossMidnight(eta)) }
        if let category = spot.category { parts.append(category.label) }
        return parts.joined(separator: " · ")
    }

    /// 지도 위의 짧은 안내 한 알 — 타일 위에서 읽히게 옅은 유리 바탕.
    private func mapNote(_ text: String) -> some View {
        Label(text, systemImage: "line.diagonal")
            .font(.caption)
            .foregroundStyle(Ink.ink)
            .padding(.horizontal, Space.m).padding(.vertical, Space.xs + 2)
            .background(.thinMaterial, in: Capsule())
    }

    /// 이 선이 도로인지 직선인지 한 줄로. **전부 도로면 nil** — 맞는 말은 굳이 하지 않는다.
    static func routeNote(_ routes: [MapRoute]) -> String? {
        guard !routes.isEmpty else { return nil }
        if routes.allSatisfy(\.routed) { return nil }
        return routes.contains(where: \.routed)
            ? "일부 구간은 장소를 곧게 이은 직선이에요"
            : "장소를 순서대로 이은 직선이에요"
    }

    /// 지도에서 고른 장소 — `day`의 것일 때만. 날을 옮긴 직후 옛 번호가 새 날의 장소를 가리키지 않게 한다.
    private func mapSelection(on day: Int) -> Int? {
        selectedMapSpotDay == day ? selectedMapSpot : nil
    }

    private func selectMapSpot(_ index: Int?, day: Int?) {
        selectedMapSpot = index
        selectedMapSpotDay = index == nil ? nil : day
    }

    /// 장소를 고르면 그 장소의 장면도 고른 것으로 둔다 — 고름을 풀었을 때 전체가 아니라 그 장면으로 돌아가게.
    private func chooseMapSpot(_ index: Int?, day: Int, scenes: [MapScene]) {
        selectMapSpot(index, day: day)
        if let index, let scene = scenes.first(where: { $0.spotIndexes.contains(index) }) { sceneChoice = .scene(scene.id) }
    }

    /// 고른 장면의 사각형. 장면이 하나뿐이거나 '전체'면 nil — 엔진이 그린 것 전부를 맞춘다.
    /// 마지막 장면에는 숙소 복귀 선(핀이 아니라 선으로만 있다)도 넣는다.
    private func sceneFrame(_ scenes: [MapScene], routes: [MapRoute]) -> MapBounds? {
        guard scenes.count >= 2, let index = chosenScene(in: scenes) else { return nil }
        var points = scenes[index].points
        if index == scenes.count - 1 { points += routes.filter(\.synthetic).flatMap(\.points) }
        return MapBounds.covering(points: points)
    }

    private func chosenScene(in scenes: [MapScene]) -> Int? {
        switch sceneChoice {
        case .all: return nil
        case .main: return MapScenes.mainScene(in: scenes)
        case .scene(let id): return scenes.indices.contains(id) ? id : MapScenes.mainScene(in: scenes)
        }
    }

    /// 장면 사이 이동 — 서버가 도착 장소의 구간을 계산해 뒀으면 그 수단·시간·거리, 없으면 직선 거리("약").
    private func sceneTransfers(_ scenes: [MapScene], plan: DayPlanDay?) -> [MapTransfer] {
        MapScenes.transfers(between: scenes) { arriving in
            guard let leg = plan?.spots.first(where: { $0.index == arriving })?.incomingLeg else { return nil }
            return (mode: TravelMode(rawValue: leg.mode), minutes: leg.minutes, distanceKm: leg.distanceKm)
        }
    }

    /// `마드리드 1` · `기차 2시간 30분 · 390km` · `세비야 5` · `전체`. 장면 칩을 누르면 카메라가 거기로, 전체는 그날 다.
    private func sceneChips(_ scenes: [MapScene], transfers: [MapTransfer], main: Int?) -> some View {
        let chosen = chosenScene(in: scenes)
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Space.xs) {
                ForEach(scenes) { scene in
                    sceneChip("\(scene.label) \(scene.count)", on: chosen == scene.id,
                              label: "\(scene.label) 장소 \(scene.count)곳 보기") { sceneChoice = .scene(scene.id) }
                    if let transfer = transfers.first(where: { $0.id == scene.id }) {
                        LegPill(symbol: transfer.mode?.symbol ?? "arrow.right", text: MapScenes.text(for: transfer))
                    }
                }
                sceneChip("전체", on: chosen == nil, label: "그날 동선 전체 보기") { sceneChoice = .all }
            }
            .padding(.horizontal, Space.m)
            .padding(.vertical, Space.xs)
        }
    }

    private func sceneChip(_ text: String, on: Bool, label: String, action: @escaping () -> Void) -> some View {
        Button { withAnimation(motion) { action() } } label: {
            Text(text)
                .font(.caption.weight(on ? .semibold : .regular))
                .padding(.horizontal, Space.s)
                .padding(.vertical, 5)
                .background(on ? Ink.accent : Ink.sunken, in: Capsule())
                .foregroundStyle(on ? Ink.onAccent : Ink.soft)
                .frame(minHeight: 32)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
