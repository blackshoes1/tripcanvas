import SwiftUI

/// 일정 편집 — 하루씩 본다.
///
/// 웹의 일자 카드를 그대로 옮기지 않았다. 아이폰에서는 하루를 골라 그 날의 장소만 목록으로 보고,
/// 순서는 끌어서, 빼는 것은 스와이프로 한다. 바꾸는 즉시 저장된다(저장 버튼이 없다).
/// 지도 보기 범위(이 날 | 전체). 전체는 **누른 순간에만** 받는다 — 열지도 않을 날까지 미리 받지 않는다.
/// 장소 검색은 범위가 아니라 **다른 일**이라 따로 켠다(`mapSearching`) — 같은 세그먼트에 넣지 않는다(2026-09-18).
enum MapScope: Hashable { case day, trip }

struct TripPlanView: View {
    let trip: TripSummary
    /// **여행이 들고 있는** 모델(`TripScreenModels`). 이 화면은 `지금` 탭으로 가면 죽지만 모델은 남는다 —
    /// 돌아왔을 때 문서·고른 날·받아 둔 계산이 그대로라 로딩이 없다.
    let model: TripPlanViewModel
    /// 지도 탭의 '장소 찾기' 모델. 같은 이유로 여행이 들고 있다.
    let discovery: MapDiscoveryModel
    /// 목록이냐 지도냐. **탭 바가 정한다**(`TripHomeView`) — 이 화면 안에 세그먼트를 또 깔지 않는다.
    /// 화면 안에서 지도를 끄는 곳이 하나 있다(여러 장소 옮기기). 그때는 이 바인딩이 탭도 함께 되돌린다.
    @Binding var showsMap: Bool

    @Environment(AppEnvironment.self) private var env
    /// 지도를 한 번이라도 열었는가. 열기 전에는 만들지 않고, 연 뒤에는 숨기기만 한다(`content`).
    @State private var mapMounted = false
    @State private var editor: SpotEditorTarget?
    @State private var viewingSpot: SpotEditorTarget?
    @State private var showsSearch = false
    @State private var searchedSpot: TripSpot?
    /// 지도를 하루만 볼지 여행 전체로 볼지.
    @State private var mapScope: MapScope = .day
    /// 장소 검색(지도에서 담기)을 열어 두었는가. 범위와 별개다.
    @State private var mapSearching = false
    /// 상단 요약을 펼쳤는가. 기본은 접힘 — 기본 화면에서는 일정이 요약보다 중요하다.
    @State private var summaryExpanded = false
    /// 종료 콜백까지 방향을 보존한다. GestureState만 쓰면 onEnded 전에 초기화될 수 있다.
    @State private var daySwipeIntent = PlanDaySwipeIntent()
    @GestureState private var isSwipingDay = false
    /// 다음 날로 가는 중인가 — 들어오고 나가는 방향을 정한다.
    @State private var goingForward = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.editMode) private var editMode
    private var isEditing: Bool { editMode?.wrappedValue.isEditing == true }
    @State private var showsOverview = false
    @State private var showsSettings = false
    @State private var showsCosts = false
    @State private var costDay = 0
    @State private var costRevision = 0
    @State private var insertionAfter: Int?
    @State private var moveTarget: PlanMoveTarget?
    @State private var choosingPlaces = false
    @State private var chosenPlaces: Set<Int> = []
    @State private var selectedMapSpot: Int?
    /// 그 선택이 **어느 날**의 것인가. 날을 옮기면 옛 번호가 새 날의 장소를 가리키지 않게 — 같은 날일 때만 선택이다.
    @State private var selectedMapSpotDay: Int?

    var body: some View {
        Group {
            content(model)
        }
        // 제목(여행 이름)은 `TripHomeView`가 정한다.
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("여행 전체 개요") { showsOverview = true }
                    if model.canEdit {
                        Button("여행·하루 설정") { showsSettings = true }
                        Button(choosingPlaces ? "장소 선택 마치기" : "여러 장소 옮기기") {
                            choosingPlaces.toggle(); chosenPlaces = []; showsMap = false
                        }
                        if model.canUndo { Button("마지막 변경 되돌리기") { Task { await model.undoLastChange() } } }
                    }
                } label: { Image(systemName: "ellipsis.circle") }
                .accessibilityLabel("일정 메뉴")
            }
            if model.canEdit, model.day != nil {
                // EditButton()은 앱에 한국어 번들이 없어 'Edit'으로 나왔다 — 문구를 직접 준다.
                ToolbarItem(placement: .topBarTrailing) {
                    Button(isEditing ? "완료" : "편집") {
                        withAnimation { editMode?.wrappedValue = isEditing ? .inactive : .active }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    // 검색이 먼저다 — 좌표가 있어야 동선·ETA·지도에 들어간다. 직접 입력은 그다음.
                    Menu {
                        Button { insertionAfter = nil; showsSearch = true } label: { Label("검색해서 담기", systemImage: "magnifyingglass") }
                        Button { insertionAfter = nil; editor = .create } label: { Label("직접 입력", systemImage: "square.and.pencil") }
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("장소 추가")
                }
            }
        }
        .task {
            // 탭 진입 — 문서가 있고 방금 받은 것이면 아무것도 받지 않는다(탭 전환은 앱 복귀가 아니다).
            await model.loadIfStale()
        }
        // 지도를 처음 켠 순간부터 만들어 둔다. 그 뒤로는 숨기기만 한다.
        .onChange(of: showsMap, initial: true) { _, on in if on { mapMounted = true } }
        .sheet(isPresented: $showsSearch, onDismiss: {
            if let spot = searchedSpot { editor = .createFromMap(spot); searchedSpot = nil }
        }) {
            // 근처 우선의 기준은 그날 마지막 좌표 — 웹이 앵커로 검색하는 것과 같다.
            PlaceSearchView(near: model.day?.pins.last?.point) { hit in
                searchedSpot = hit.makeSpot()
            }
        }
        .sheet(item: $viewingSpot) { target in
            SpotInformationView(spot: target.spot, contextLabel: "\(trip.name) · Day \(model.selectedDay + 1)")
        }
        .sheet(item: $editor) { target in
            Group {
                SpotEditorView(
                    target: target,
                    dayCount: model.dayCount,
                    currentDay: model.selectedDay,
                    contextLabel: "\(trip.name) · Day \(model.selectedDay + 1) · \(model.strip.first(where: { $0.index == model.selectedDay })?.date ?? trip.start)",
                    onSave: { spot in
                        let saved: Bool
                        switch target {
                        case .create, .createFromMap: saved = await model.addSpot(spot, after: insertionAfter)
                        case .edit(let index, _): saved = await model.updateSpot(at: index, with: spot)
                        }
                        return saved ? nil : model.saveFailureMessage
                    },
                    onDelete: { index in
                        await model.removeSpot(at: index) ? nil : model.saveFailureMessage
                    },
                    onMoveToDay: { index, day, spot in
                        await model.moveSpot(at: index, toDay: day, with: spot) ? nil : model.saveFailureMessage
                    })
            }
        }
        .sheet(isPresented: $showsOverview) {
            NavigationStack { TripOverviewView(model: model) { index in
                model.selectedDay = index; showsOverview = false; showsMap = false
            } }
        }
        .sheet(isPresented: $showsSettings) {
            if let document = model.document {
                PlanSettingsView(document: document, revision: model.revision, selectedDay: model.selectedDay) { draft, revision in
                    await model.savePreparedDocument(draft, expectedRevision: revision, message: "여행 설정을 저장했어요") ? nil : model.saveFailureMessage
                }
            }
        }
        .sheet(item: $moveTarget) { target in
            Group {
                PlanMoveSheet(tripId: trip.id, document: target.document, revision: target.revision,
                              sourceDay: target.day, indexes: target.indexes, source: env.service) { draft, revision in
                    let saved = await model.savePreparedDocument(draft, expectedRevision: revision, message: "선택한 장소를 옮겼어요")
                    if saved { chosenPlaces = []; choosingPlaces = false }
                    return saved ? nil : model.saveFailureMessage
                }
            }
        }
        .sheet(isPresented: $showsCosts) {
            if let document = model.document, document.hasDay(costDay) {
                DayCostView(day: document.days[costDay], cost: model.overviewPlan(costDay)?.day.totals.cost, canEdit: model.canEdit,
                            onRefresh: { await model.load() }) { edited in
                    guard var draft = model.document, draft.hasDay(costDay), model.revision == costRevision else { return false }
                    var days = draft.days
                    // 비용 시트 밖에서 편집한 장소 필드는 건드리지 않는다.
                    days[costDay].setField("budget", edited.raw["budget"])
                    days[costDay].setField("costItems", edited.raw["costItems"])
                    var spots = days[costDay].spots
                    for index in spots.indices where edited.spots.indices.contains(index) {
                        for key in ["cost", "cur", "costBasis", "costPeople", "costPartial", "costKind"] {
                            spots[index].setField(key, edited.spots[index].raw[key])
                        }
                    }
                    days[costDay].spots = spots; draft.days = days
                    let saved = await model.savePreparedDocument(draft, expectedRevision: costRevision, message: "하루 비용을 저장했어요")
                    if saved { costRevision = model.revision }
                    return saved
                }
            }
        }
    }

    @ViewBuilder
    private func content(_ model: TripPlanViewModel) -> some View {
        if model.isLoading && model.document == nil {
            ProgressView("일정을 불러오는 중")
        } else if model.document == nil {
            VStack(spacing: Space.l) {
                EmptyStateView(
                    symbol: "exclamationmark.icloud",
                    title: "일정을 불러오지 못했어요",
                    message: model.errorMessage ?? "잠시 뒤 다시 시도해 주세요.")
                SecondaryActionButton(title: "다시 시도", systemImage: "arrow.clockwise") {
                    Task { await model.load() }
                }
            }
        } else {
            VStack(spacing: 0) {
                if !showsMap || !mapSearching { dayPicker(model) }
                if choosingPlaces {
                    HStack {
                        Text("\(chosenPlaces.count)곳 선택")
                        Spacer()
                        Button("날짜·위치 옮기기") { prepareMove(chosenPlaces, model: model) }.disabled(chosenPlaces.isEmpty)
                    }.padding(.horizontal, Space.l).frame(minHeight: 44)
                }
                Divider()
                ZStack {
                    // 지도는 한 번 만들면 **숨기기만 한다** — 일정↔지도를 오갈 때마다 엔진을 새로 띄우고
                    // 타일을 다시 받지 않게(2026-09-17). 처음 열기 전에는 만들지 않는다: 목록만 쓰는 사람에게
                    // 지도 SDK 값을 물리지 않는다. 숨긴 동안은 엔진이 쉰다(`MapEngineView.isVisible`).
                    if mapMounted {
                        dayMap(model)
                            .opacity(showsMap ? 1 : 0)
                            .allowsHitTesting(showsMap)
                            .accessibilityHidden(!showsMap)
                    }
                    if !showsMap {
                        // 나가는 목록과 들어오는 목록이 높이를 나눠 갖지 않게 같은 영역에 겹친다.
                        ZStack { spotList(model) }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .clipped()
                    }
                }
            }
            .overlay(alignment: .top) {
                if let error = model.errorMessage {
                    InlineErrorBanner(message: "저장하지 못했어요", detail: error) {
                        Task { await model.load() }
                    }
                    .padding(Space.l)
                }
            }
            .overlay(alignment: .bottom) {
                if let toast = model.toast {
                    ToastView(text: toast)
                        .padding(Space.l)
                        .task {
                            try? await Task.sleep(for: .seconds(2))
                            model.clearToast()
                        }
                }
            }
            // 충돌은 자동으로 어느 쪽도 고르지 않는다 — 무엇이 사라지는지 말하고 사용자가 고른다(§91).
            .alert("다른 기기에서 먼저 바뀌었어요", isPresented: conflictBinding(model)) {
                Button("최신 불러오기") { Task { await model.reloadFromServer() } }
                Button("이전 일정 유지", role: .cancel) { model.dismissConflict() }
            } message: {
                Text("방금 변경은 저장되지 않아 이전 일정으로 돌아왔어요. 최신 일정을 불러와 확인해 주세요.")
            }
        }
    }

    private func conflictBinding(_ model: TripPlanViewModel) -> Binding<Bool> {
        Binding(get: { model.conflict != nil && editor == nil }, set: { if !$0 { model.dismissConflict() } })
    }

    /// 며칠짜리든 한 줄에 담기지 않는다 — 가로 스크롤 칩으로 고른다.
    ///
    /// "며칠째"만 보여 주면 3일차가 무슨 요일인지, 오늘인지, 뭐가 들어 있는지 모른다.
    /// 날짜·요일은 **서버가 준 것**을 쓴다(`start + index`를 앱에서 더하면 규칙이 두 곳이 된다).
    private func dayPicker(_ model: TripPlanViewModel) -> some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: Space.s) {
                    ForEach(model.strip) { entry in
                        dayChip(entry, model: model)
                            .id(entry.index)
                    }
                }
                .padding(.horizontal, Space.l)
                .padding(.vertical, Space.s)
            }
            // 14일짜리 일정에서 고른 날이 화면 밖에 있으면 안 된다 — 여행 중이면 오늘로 옮겨진 뒤다.
            .onChange(of: model.selectedDay) { _, day in
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(day, anchor: .center) }
            }
            .onAppear { proxy.scrollTo(model.selectedDay, anchor: .center) }
        }
    }

    private func dayChip(_ entry: DayPlanStripEntry, model: TripPlanViewModel) -> some View {
        let selected = entry.index == model.selectedDay
        let isToday = entry.index == model.todayIndex
        return Button {
            goingForward = entry.index > model.selectedDay
            withAnimation(motion) { model.selectedDay = entry.index }
        } label: {
            VStack(spacing: 2) {
                HStack(spacing: 4) {
                    Text("Day \(entry.index + 1)").font(.subheadline.weight(.semibold))
                    // 오늘은 번호보다 이 표시로 찾는다.
                    if isToday {
                        Text("오늘")
                            .font(.caption2.weight(.bold))
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Ink.accent, in: Capsule())
                            .foregroundStyle(.white)
                    }
                }
                // 고른 날만 요일·제목까지 말한다. 나머지는 번호와 날짜뿐 — 칩이 카드가 되지 않게(2026-09-18).
                if let date = selected ? TimeFormat.dayChipLabel(entry.date) : TimeFormat.dayChipShort(entry.date) {
                    Text(date).font(.caption2).foregroundStyle(selected ? Ink.accent : Ink.soft)
                }
                if selected {
                    Text(entry.title.isEmpty ? subtitle(for: entry) : entry.title)
                        .font(.caption2)
                        .lineLimit(1)
                        .foregroundStyle(Ink.soft)
                }
            }
            .padding(.horizontal, Space.m)
            .padding(.vertical, Space.s)
            .frame(minWidth: 64)
            .background(selected ? Ink.accent.opacity(0.14) : Ink.sunken,
                        in: RoundedRectangle(cornerRadius: Radius.card))
            .overlay(RoundedRectangle(cornerRadius: Radius.card)
                .stroke(isToday ? Ink.accent : .clear, lineWidth: selected ? 0 : 1))
            .foregroundStyle(selected ? Ink.accent : Ink.ink)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel(entry, isToday: isToday))
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    /// 제목이 없는 날은 대신 그 날의 무게를 말한다 — 빈 날을 눈에 띄게.
    private func subtitle(for entry: DayPlanStripEntry) -> String {
        entry.spotCount == 0 ? "비어 있음" : "\(entry.spotCount)곳"
    }

    private func accessibilityLabel(_ entry: DayPlanStripEntry, isToday: Bool) -> String {
        var parts = ["Day \(entry.index + 1)"]
        if isToday { parts.append("오늘") }
        if let date = TimeFormat.dayChipLabel(entry.date) { parts.append(date) }
        if !entry.title.isEmpty { parts.append(entry.title) }
        parts.append(subtitle(for: entry))
        return parts.joined(separator: ", ")
    }

    @ViewBuilder
    private func spotList(_ model: TripPlanViewModel) -> some View {
        if let day = model.day {
            // 저장된 문서는 계속 보인다. 계산 응답을 기다리며 목록 전체를 교체하지 않는다.
            List {
                Section {
                    if day.spots.isEmpty { emptyDay(model) }
                    // 🏠 전날 숙소 이월 · 렌터카 픽업은 장소 목록 **앞**에 온다.
                    // ⚠️ ForEach 밖에 둔다 — 드래그 인덱스는 ForEach의 컬렉션 기준이라
                    //    이 줄들이 그 안에 섞이면 순서가 어긋난다.
                    if let carry = model.planDay?.carriedStay { carryRow(carry) }
                    ForEach(model.planDay?.carPickups ?? [], id: \.bookingId) { carEventRow($0) }
                    ForEach(Array(day.spots.enumerated()), id: \.offset) { index, spot in
                        HStack {
                            if choosingPlaces {
                                Image(systemName: chosenPlaces.contains(index) ? "checkmark.circle.fill" : "circle")
                            }
                            SpotRow(spot: spot, dayMode: day.mode, plan: model.planSpot(at: index),
                                split: splitInfo(model, at: index))
                        }
                            // 12pt 이상 움직인 터치는 탭을 취소한다. 짧게 끌다 놓아도 편집을 열지 않는다.
                            .overlay(PlanSpotTapSurface { editSpot(index, spot: spot, model: model) })
                            .accessibilityElement(children: .combine)
                            .accessibilityAddTraits(.isButton)
                            .accessibilityAction { editSpot(index, spot: spot, model: model) }
                            .contextMenu {
                                if model.canEdit {
                                    Button("여기에 추가 · 이 장소 뒤") { insertionAfter = index; showsSearch = true }
                                    Button("날짜·위치 옮기기") { prepareMove([index], model: model) }
                                }
                            }
                    }
                    // ⚠️ **편집 모드에서만** 지운다. `onDelete`는 편집 모드의 ⊖와 **스와이프 삭제를
                    //    둘 다** 켜는데, 가로 스와이프는 날짜 이동이 쓴다 — 행 위에서는 삭제가 먼저 먹어
                    //    날이 안 넘어간다(#208에서 `.swipeActions`를 이걸로 바꾸며 놓쳤다).
                    //    `perform`에 nil을 주면 스와이프 삭제가 아예 붙지 않는다.
                    .onDelete(perform: isEditing ? { offsets in
                        guard let index = offsets.first else { return }
                        Task { await model.removeSpot(at: index) }
                    } : nil)
                    .onMove { source, destination in
                        Task { await model.moveSpots(from: source, to: destination) }
                    }
                    .deleteDisabled(!model.canEdit)
                    .moveDisabled(!model.canEdit)
                    // 반납은 장소 뒤, 숙소 복귀 앞 — 웹 일자 카드와 같은 순서다.
                    ForEach(model.planDay?.carReturns ?? [], id: \.bookingId) { carEventRow($0) }
                    if let back = model.planDay?.back { backRow(back) }
                } header: {
                    // 기본 화면은 제목·이동·비용·종료 시각까지다. 나머지(거리·미정·예산·안내)는 '오늘 요약 보기' 안에 —
                    // 일정이 요약보다 중요하고, 첫 화면에 첫 장소가 보여야 한다(2026-09-18).
                    VStack(alignment: .leading, spacing: Space.xs) {
                        dayHeader(model, day: day)
                        if model.plan == nil && !model.planAttempted(for: model.selectedDay) {
                            ProgressView("이동·도착 시각을 계산하는 중").font(.caption)
                        }
                        if let totals = model.planDay?.totals { daySummary(totals) }
                        Button {
                            withAnimation(motion) { summaryExpanded.toggle() }
                        } label: {
                            HStack(spacing: Space.xs) {
                                Text(summaryExpanded ? "요약 접기" : "오늘 요약 보기")
                                Image(systemName: "chevron.right")
                                    .rotationEffect(.degrees(summaryExpanded ? 90 : 0))
                            }
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Ink.accent)
                            .frame(minHeight: 32)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(summaryExpanded ? [.isSelected] : [])
                        if summaryExpanded { dayDetails(model, day: day) }
                    }
                    .textCase(nil)
                } footer: {
                    VStack(alignment: .leading, spacing: Space.xs) {
                        if !model.canEdit {
                            Text("보기 권한이라 일정을 바꿀 수 없어요. 주최자에게 요청하세요.")
                        }
                        // 나란한 가지를 열로 쪼개지 않는다(드래그 인덱스가 어긋난다) —
                        // 대신 줄마다 표시를 붙이고, 하루 단위로 한 번 설명한다.
                        if model.hasSplits {
                            Text("이 날은 일부 시간을 따로 보내요 — 표시된 구간은 함께 다니지 않습니다.")
                        }
                        // 추정을 실측처럼 말하지 않는다. 구간마다 붙이면 잔소리가 되므로 하루에 한 번만.
                        if model.plan != nil, model.travelTimeIsEstimate, !day.spots.isEmpty {
                            Text("이동 시간은 직선거리 기준 예상이에요.")
                        }
                        // 계산이 없는 상태와 정상인 상태가 화면에서 구분되지 않으면,
                        // 서버가 아직 준비 안 된 것을 아무도 모른다(2026-09-06에 그랬다).
                        // 시도해 보고 못 받았을 때만 말한다 — 기다리는 중에 실패했다고 하지 않는다.
                        if model.plan == nil, model.planAttempted(for: model.selectedDay), !day.spots.isEmpty {
                            Label("예상 도착 시각을 불러오지 못했어요 — 일정 편집은 그대로 됩니다.",
                                  systemImage: "clock.badge.exclamationmark")
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .paperGround()
            .refreshable { await model.load() }
            // 날이 바뀌면 **새 화면**이다 — 그래야 밀려 나가고 들어오는 것이 보인다.
            .id(model.selectedDay)
            .transition(daySlide)
            // 가로 의도로 확정한 동안만 세로 이동을 멈춘다. 편집 모드의 재정렬은 그대로다.
            .scrollDisabled(!isEditing && daySwipeIntent.axis == .horizontal)
            .simultaneousGesture(daySwipe(model), including: isEditing ? .subviews : .all)
            .onChange(of: isSwipingDay) { _, active in
                // 시스템이 취소한 드래그도 방향 잠금을 남기지 않는다.
                if !active { daySwipeIntent = PlanDaySwipeIntent() }
            }
        } else {
            EmptyStateView(symbol: "calendar", title: "일자가 없어요", message: "웹에서 일자를 먼저 만들어 주세요.")
        }
    }

    private func editSpot(_ index: Int, spot: TripSpot, model: TripPlanViewModel) {
        guard model.canEdit else { viewingSpot = .edit(index: index, spot: spot); return }
        if choosingPlaces {
            if chosenPlaces.contains(index) { chosenPlaces.remove(index) } else { chosenPlaces.insert(index) }
            return
        }
        editor = .edit(index: index, spot: spot)
    }

    private func prepareMove(_ indexes: Set<Int>, model: TripPlanViewModel) {
        guard let document = model.document else { return }
        moveTarget = PlanMoveTarget(document: document, revision: model.revision, day: model.selectedDay, indexes: IndexSet(indexes))
    }

    /// 세로로 읽기 시작한 손은 나중에 비스듬해져도 날짜를 바꾸지 않는다.
    private func daySwipe(_ model: TripPlanViewModel) -> some Gesture {
        DragGesture(minimumDistance: 12, coordinateSpace: .global)
            .updating($isSwipingDay) { _, active, _ in active = true }
            .onChanged { value in
                guard !isEditing else { return }
                daySwipeIntent.update(value.translation)
            }
            .onEnded { value in
                defer { daySwipeIntent = PlanDaySwipeIntent() }
                guard let target = daySwipeIntent.destination(
                    translation: value.translation, selectedDay: model.selectedDay,
                    dayCount: model.dayCount, isEditing: isEditing) else { return }
                goingForward = target > model.selectedDay
                withAnimation(motion) { model.selectedDay = target }
            }
    }

    /// 넘어가는 느낌. ⚠️ '동작 줄이기'를 켠 사람에게는 밀지 않는다 — 그 설정은 취향이 아니라 필요다.
    private var motion: Animation {
        reduceMotion ? .easeInOut(duration: 0.15) : .snappy(duration: 0.28, extraBounce: 0.02)
    }

    private var daySlide: AnyTransition {
        guard !reduceMotion else { return .opacity }
        return .asymmetric(
            insertion: .move(edge: goingForward ? .trailing : .leading).combined(with: .opacity),
            removal: .move(edge: goingForward ? .leading : .trailing).combined(with: .opacity))
    }

    /// 이 선이 도로인지 직선인지 한 줄로. **전부 도로면 nil** — 맞는 말은 굳이 하지 않는다.
    private func routeNote(_ routes: [MapRoute]) -> String? {
        guard !routes.isEmpty else { return nil }
        if routes.allSatisfy(\.routed) { return nil }
        return routes.contains(where: \.routed)
            ? "일부 구간은 장소를 곧게 이은 직선이에요"
            : "장소를 순서대로 이은 직선이에요"
    }

    /// 그날의 동선. 좌표 없는 장소는 여기 안 나온다 — 목록의 '위치 없음'이 그 사실을 말한다.
    @ViewBuilder
    private func dayMap(_ model: TripPlanViewModel) -> some View {
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
                Button {
                    withAnimation(motion) { mapSearching.toggle() }
                } label: {
                    Label(mapSearching ? "검색 닫기" : "장소 검색", systemImage: mapSearching ? "xmark.circle.fill" : "magnifyingglass")
                        .font(.subheadline.weight(.semibold))
                        .frame(minHeight: 44)
                }
                .tint(Ink.accent)
                .accessibilityLabel(mapSearching ? "장소 검색 닫기" : "장소 검색 열기")
            }
            .padding(.horizontal, Space.m)
            .padding(.vertical, Space.xs)

            if mapSearching, let document = model.document {
                MapDiscoveryView(trip: trip, document: document, model: discovery, isVisible: showsMap,
                                 onReturnFromBoard: { await model.load() }, onSelectItinerary: { day, spot in
                    model.selectedDay = day; selectMapSpot(spot, day: day); mapSearching = false; mapScope = .day
                })
            } else if mapScope == .trip { tripMap(model) } else { singleDayMap(model) }
        }
        // 숨겨진 동안은 전체 동선을 받지 않는다 — 보고 있지 않은 지도를 위해 서버를 부르지 않는다.
        .task(id: "\(mapScope)-\(model.revision)-\(showsMap)-\(mapSearching)") {
            if mapScope == .trip, showsMap, !mapSearching { await model.loadTripRoutes() }
        }
    }

    /// 여행 전체 — 날마다 색이 다르다(웹의 일자 색 순서와 같다).
    @ViewBuilder
    private func tripMap(_ model: TripPlanViewModel) -> some View {
        if let routes = model.tripRoutes {
            let days = routes.days.filter { !$0.spots.isEmpty }
            if days.isEmpty {
                EmptyStateView(symbol: "map", title: "지도에 놓을 장소가 없어요",
                               message: "장소를 담으면 여행 전체 동선이 여기에 보입니다.")
            } else {
                MapEngineView(
                    pins: days.flatMap(\.pins),
                    routes: days.flatMap { $0.mapRoutes(colorIndex: $0.index) },
                    isVisible: showsMap)
                    .ignoresSafeArea(edges: .bottom)
                    .overlay(alignment: .topLeading) {
                        if let note = routeNote(days.flatMap { $0.mapRoutes(colorIndex: $0.index) }) {
                            Label(note, systemImage: "line.diagonal")
                                .font(.caption)
                                .padding(.horizontal, Space.m).padding(.vertical, Space.xs + 2)
                                .background(.thinMaterial, in: Capsule())
                                .padding(Space.m)
                        }
                    }
            }
        } else if model.isLoadingTripRoutes {
            // 스피너만 두지 않는다 — 무엇을 기다리는지 말한다. 실패는 아래 빈 화면이 따로 말한다.
            MapLoadingPlaceholder(message: "전체 동선을 불러오는 중이에요")
        } else {
            EmptyStateView(symbol: "map", title: "전체 동선을 불러오지 못했어요",
                           message: "잠시 후 다시 시도해 주세요. 이 날 보기는 그대로 됩니다.")
        }
    }

    @ViewBuilder
    private func singleDayMap(_ model: TripPlanViewModel) -> some View {
        if let day = model.day {
            let selection = mapSelection(on: model.selectedDay)
            VStack(spacing: 0) {
                if !day.pins.isEmpty {
                    // 고른 장소가 있을 때만 거기로 간다. 없으면 `focus`를 비워 엔진이 **그날 동선 전체**(핀+선)를 맞춘다 —
                    // 첫 장소를 넣으면 거기에 줌인해 나머지 동선이 화면 밖이다(2026-09-19 전 모습).
                    MapEngineView(pins: day.pins, routes: model.planDay?.mapRoutes ?? [],
                                  focus: selection.flatMap { day.spots.indices.contains($0) ? day.spots[$0].point : nil },
                                  preservesCamera: false,
                                  selectedPinID: day.pins.first(where: { $0.order - 1 == selection })?.id,
                                  onPinSelected: { id in selectMapSpot(day.pins.first(where: { $0.id == id }).map { $0.order - 1 }, day: model.selectedDay) },
                                  isVisible: showsMap)
                        .frame(minHeight: 180, maxHeight: .infinity)
                    if let note = routeNote(model.planDay?.mapRoutes ?? []) {
                        Text(note).font(.caption).foregroundStyle(.secondary)
                    }
                } else {
                    Button { withAnimation(motion) { mapSearching = true } } label: {
                        Label("지도에서 장소 찾기", systemImage: "magnifyingglass").frame(minHeight: 60)
                    }
                }
                ScrollViewReader { proxy in
                    List {
                        ForEach(Array(day.spots.enumerated()), id: \.offset) { index, spot in
                            HStack {
                                Button {
                                    // 고른 줄을 다시 누르면 고름을 푼다 — 지도가 다시 그날 전체를 보인다.
                                    selectMapSpot(selection == index ? nil : index, day: model.selectedDay)
                                } label: {
                                    VStack(alignment: .leading) {
                                        Text("\(index + 1). \(spot.name)")
                                        if spot.point == nil { Text("위치 미정").font(.caption).foregroundStyle(.secondary) }
                                    }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                }.buttonStyle(.plain)
                                Button { viewingSpot = .edit(index: index, spot: spot) } label: {
                                    Image(systemName: "info.circle").frame(width: 44, height: 44)
                                }.accessibilityLabel("\(spot.name) 장소·예약 정보")
                                if model.canEdit {
                                    Menu {
                                        Button("편집") { editor = .edit(index: index, spot: spot) }
                                        Button("이 장소 뒤에 추가") { insertionAfter = index; showsSearch = true }
                                        Button("날짜·위치 옮기기") { prepareMove([index], model: model) }
                                    } label: { Image(systemName: "ellipsis").frame(width: 44, height: 44) }
                                    .accessibilityLabel("\(spot.name) 일정 작업")
                                }
                            }
                            .listRowBackground(selection == index ? Color.accentColor.opacity(0.12) : Ink.raised)
                            .id(index)
                        }
                    }.listStyle(.plain).frame(maxHeight: 240)
                    .onChange(of: selectedMapSpot) { _, index in if let index { proxy.scrollTo(index, anchor: .center) } }
                }
            }
            .onChange(of: model.selectedDay) { _, _ in selectMapSpot(nil, day: nil) }
        }
    }

    /// 지도에서 고른 장소 — `day`의 것일 때만. 날을 옮긴 직후 옛 번호가 새 날의 장소를 가리키지 않게 한다.
    private func mapSelection(on day: Int) -> Int? {
        selectedMapSpotDay == day ? selectedMapSpot : nil
    }

    private func selectMapSpot(_ index: Int?, day: Int?) {
        selectedMapSpot = index
        selectedMapSpotDay = index == nil ? nil : day
    }

    private func dayHeader(_ model: TripPlanViewModel, day: TripDay) -> some View {
        HStack(spacing: Space.s) {
            // 위계: 하루 제목(headline) > 장소 이름(body·semibold) > 정보(caption) > 이동(caption2 알약).
            Text(day.title.isEmpty ? "Day \(model.selectedDay + 1)" : day.title)
                .font(.headline)
                .foregroundStyle(Ink.ink)
                .lineLimit(1)
            Spacer()
            if model.isSaving { ProgressView().controlSize(.mini) }
            if model.canEdit {
                Menu {
                    // 그날의 기본 이동수단. 구간마다 다르면 장소 편집에서 따로 정한다.
                    Picker("이동수단", selection: Binding(
                        get: { day.mode },
                        set: { mode in Task { await model.setDayMode(mode) } })) {
                        ForEach(TravelMode.allCases, id: \.self) { mode in
                            Label(mode.label, systemImage: mode.symbol).tag(mode)
                        }
                    }
                } label: {
                    Label(day.mode.label, systemImage: day.mode.symbol)
                        .font(.caption.weight(.semibold))
                }
            } else {
                Label(day.mode.label, systemImage: day.mode.symbol).font(.caption)
            }
        }
        .textCase(nil)
    }

    /// 그 장소가 분리 구간에 속하는지와, 거기에 누가 있는지.
    /// ⚠️ 가르는 것은 서버다 — 여기서는 받은 구조를 읽어 넘기기만 한다.
    private func splitInfo(_ model: TripPlanViewModel, at index: Int) -> SpotRow.SplitInfo? {
        guard let branch = model.splitBranch(at: index) else { return nil }
        return SpotRow.SplitInfo(
            whoText: model.participantsText(branch.participants),
            includesMe: model.includesMe(branch.participants),
            isBranchStart: model.isBranchStart(at: index))
    }

    /// 빈 날. "장소가 없어요"로 끝내지 않는다 — 이미 담아 둔 후보에서 가져올 수 있다.
    @ViewBuilder
    private func emptyDay(_ model: TripPlanViewModel) -> some View {
        VStack(alignment: .leading, spacing: Space.s) {
            Text(model.canEdit ? "아직 장소가 없어요." : "이 날에는 장소가 없어요.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if model.canEdit {
                // 방금 만든 여행이면 **누를 것을 화면에 둔다.** 처음 온 사람에게
                // "오른쪽 위 ＋를 누르세요"는 한 번 더 찾게 만드는 말이다.
                if model.tripIsEmpty {
                    Text("어디부터 가볼까요?").font(.subheadline.weight(.semibold))
                    Button { showsSearch = true } label: {
                        Label("장소 검색해서 담기", systemImage: "magnifyingglass")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                } else {
                    Text("오른쪽 위 ＋로 검색해서 담거나, 일행과 골라 둔 곳에서 가져옵니다.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                NavigationLink { CandidateBoardView(trip: trip) } label: {
                    Label("가고 싶은 곳에서 가져오기", systemImage: "mappin.and.ellipse")
                        .font(.subheadline.weight(.semibold))
                }
            }
        }
        .padding(.vertical, Space.xs)
    }

    /// 하루의 무게 — 한 줄(`이동 2시간 27분 · 예상 ₩456,665`)과 종료 시각. 값은 전부 서버가 계산한 것이다.
    /// 거리·미정·예산 같은 나머지는 `dayDetails`(접힘) 안에 있다.
    @ViewBuilder
    private func daySummary(_ totals: DayPlanTotals) -> some View {
        if let line = Self.summaryLine(totals) {
            Text(line).font(.caption).foregroundStyle(Ink.soft)
        }
        // 늦게 끝나는 것 자체는 문제가 아니다 — 그렇게 되어 있다고 말할 뿐이라 경고색을 쓰지 않는다.
        // ⚠️ 예전에는 주황이었는데, 오후 4시에 끝나는 날에도 붉게 떠서 무엇이 잘못됐는지 되묻게 했다.
        //    자정을 넘길 때(과밀)만 주의색이다 — 그건 정말 확인할 일이다.
        if let end = totals.endMinutes {
            Label("이대로면 \(TimeFormat.clockAcrossMidnight(end))에 끝나요", systemImage: "moon.zzz")
                .font(.caption)
                .foregroundStyle(totals.overloaded ? Ink.warning : Ink.soft)
        }
    }

    /// `이동 2시간 27분 · 예상 ₩456,665`. 둘 다 없으면 nil — 빈 줄을 만들지 않는다. 외화가 섞이면 '약'을 붙인다.
    static func summaryLine(_ totals: DayPlanTotals) -> String? {
        var parts: [String] = []
        if totals.travelMinutes > 0 { parts.append("이동 \(TimeFormat.duration(totals.travelMinutes))") }
        if totals.cost.total > 0 {
            let approx = totals.cost.details?.hasForeignCurrency == true ? "약 " : ""
            parts.append("예상 \(approx)\(TimeFormat.money(Double(totals.cost.total), currency: "KRW"))")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// 접어 둔 요약 — 총 이동거리 · 머무는 시간 미정 · 예약할 곳 · 하루 예산과 비용 안내. 펼쳤을 때만 보인다.
    @ViewBuilder
    private func dayDetails(_ model: TripPlanViewModel, day: TripDay) -> some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            if let totals = model.planDay?.totals, totals.distanceKm > 0 {
                Label(String(format: "총 이동거리 %.1fkm", totals.distanceKm), systemImage: "ruler")
                    .font(.caption).foregroundStyle(Ink.soft)
            }
            let unknown = day.spots.filter { $0.stayMinutes == nil }.count
            if unknown > 0 {
                Label("머무는 시간 미정 \(unknown)곳 · 현재 0분으로 계산", systemImage: "hourglass")
                    .font(.caption).foregroundStyle(Ink.warning)
            }
            let needing = day.spots.enumerated().filter { $0.element.needsReservation }
            if !needing.isEmpty {
                Menu("예약할 곳 \(needing.count)곳") {
                    ForEach(needing, id: \.offset) { index, spot in
                        Button(spot.name) { editSpot(index, spot: spot, model: model) }
                    }
                }
                .font(.caption.weight(.semibold))
            }
            Button {
                costDay = model.selectedDay; costRevision = model.revision; showsCosts = true
            } label: { DayCostSummaryView(day: day, cost: model.planDay?.totals.cost) }
            .buttonStyle(.plain)
            .accessibilityHint("하루 예산과 비용 내역 열기")
        }
        .padding(.top, Space.xs)
    }

    /// 🏠 전날 숙소에서 이어지는 날. **표시일 뿐**이고 이 항목은 그날 일정이 아니다.
    private func carryRow(_ carry: DayPlanCarriedStay) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 1) {
                Text(carry.name).font(.subheadline)
                Text("전날 숙소에서 출발").font(.caption2).foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: "house.fill").foregroundStyle(Ink.soft)
        }
        .listRowBackground(Ink.raised.opacity(0.6))
    }

    /// 자동으로 이어 붙인 숙소 복귀. 일정에 저장된 장소가 아니라는 것을 밝힌다.
    /// ⚠️ 일정의 마지막 날에는 서버가 이걸 주지 않는다 — 떠나는 날이다.
    private func backRow(_ back: DayPlanBack) -> some View {
        HStack(alignment: .top, spacing: Space.m) {
            Image(systemName: "house.fill").font(.body).foregroundStyle(Ink.soft).frame(width: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(back.name).font(.subheadline)
                let mode = TravelMode(rawValue: back.leg.mode)
                Text("숙소 복귀 · 자동 · \(mode?.label ?? "") \(TimeFormat.duration(back.leg.minutes))")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .listRowBackground(Ink.raised.opacity(0.6))
    }

    /// 렌터카 픽업·반납. ⚠️ **좌표가 없어 동선·ETA·지도에 들어가지 않는다** — 표시만 한다.
    /// 그래서 시각을 ETA 칸이 아니라 메타 줄에 둔다(그날 계산된 도착 순서에 속하지 않는다).
    private func carEventRow(_ event: DayPlanCarEvent) -> some View {
        HStack(alignment: .top, spacing: Space.m) {
            Image(systemName: "car.fill").font(.body).foregroundStyle(Ink.soft).frame(width: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(event.place.isEmpty ? (event.kind == .pickup ? "렌터카 픽업" : "렌터카 반납") : event.place)
                    .font(.subheadline)
                Text([event.kind == .pickup ? "렌터카 픽업" : "렌터카 반납",
                      event.atMinutes.map(TimeFormat.clock)].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .listRowBackground(Ink.raised.opacity(0.6))
    }
}

private struct PlanMoveTarget: Identifiable {
    let id = UUID()
    let document: TripDocument
    let revision: Int
    let day: Int
    let indexes: IndexSet
}

/// 목록의 한 줄. 시각·상태·이동수단처럼 "그 장소가 언제 어떤 상태인지"만 보인다.
struct SpotRow: View {
    let spot: TripSpot
    let dayMode: TravelMode
    /// 서버가 계산한 그 장소의 시각과 구간. nil이면 계산을 못 받은 것이다 —
    /// 그때는 **문서에 적힌 것만** 보인다(없는 시각을 앱이 지어내지 않는다).
    var plan: DayPlanSpot?
    /// 함께 다니지 않는 구간에 속할 때만. 규칙은 서버가 정하고 여기서는 그리기만 한다.
    var split: SplitInfo?

    /// 시간 칸 폭. `📌 25:10 (익일)`이 한 줄에 들어가야 하고, 글자 크기 설정을 따라 커진다.
    @ScaledMetric(relativeTo: .caption) private var timeColumnWidth: CGFloat = 92
    /// 📌 자리. 고정 폭이라 아이콘 유무와 상관없이 시간이 같은 x에서 시작한다.
    @ScaledMetric(relativeTo: .caption) private var pinSlotWidth: CGFloat = 16
    @Environment(\.dynamicTypeSize) private var typeSize

    /// 시간 칸 아래에 붙는 줄들(구간·참여자·합류)의 들여쓰기.
    /// ⚠️ 시간 칸 폭과 **같은 곳에서** 나와야 한다 — 따로 두면 폭을 바꿀 때 줄이 어긋난다.
    private var secondaryIndent: CGFloat {
        // 시간이 이름 위로 올라가면 옆으로 맞출 기준이 없다 — 들여쓰지 않는다.
        typeSize.isAccessibilitySize ? 0 : SpotRow.secondaryIndent(timeColumnWidth: timeColumnWidth)
    }

    static func secondaryIndent(timeColumnWidth: CGFloat) -> CGFloat { timeColumnWidth + Space.m }

    struct SplitInfo: Equatable {
        let whoText: String
        let includesMe: Bool
        /// 가지에서 처음 나오는 장소. 이름표를 여기에만 붙여 줄이 반복되지 않게 한다.
        let isBranchStart: Bool
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            // 이 장소로 '들어오는' 구간. 장소 사이가 비어 있으면 "여기서 저기까지 얼마나"를 알 수 없다.
            if let leg = plan?.incomingLeg { legLine(leg) }
            // 누가 가는지는 **가지가 시작될 때 한 번만** 말한다.
            if let split, split.isBranchStart { branchHeader(split) }
            if !spot.admission.raw.isEmpty || spot.category == .sight {
                Label(spot.admission.isBooked ? "예약 완료 · \(spot.admission.requirement.label)" : spot.admission.requirement.label,
                      systemImage: spot.admission.isBooked ? "checkmark.seal" : "ticket")
                    .font(.caption).foregroundStyle(spot.needsReservation ? Ink.warning : Ink.soft)
            }

            // ⚠️ 접근성 글자 크기에서는 **옆에 두지 않는다.** 시간 칸이 화면의 절반을 먹어
            //    이름이 글자 단위로 갈린다. 그때는 시간을 이름 위로 올린다.
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: Space.xs) {
                    timeColumn
                    mainContent
                }
            } else {
                HStack(alignment: .top, spacing: Space.m) {
                    timeColumn
                    mainContent
                }
            }
            // 갈라졌던 사람들이 다시 만나는 지점. 시각은 타임라인이 정하므로 여기서 말하지 않는다.
            if plan?.reunion == true {
                Label("여기서 다시 만나요", systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                    .font(.caption2)
                    .foregroundStyle(Color.accentColor)
                    .padding(.leading, secondaryIndent)
            }
        }
        // ⚠️ 나란한 가지를 열로 쪼개지 않는다 — 드래그 인덱스가 자식 순서로 계산돼서
        //    다른 요소를 끼우면 순서가 어긋난다. 줄은 1:1로 두고 왼쪽 선으로 묶어 보인다.
        .padding(.leading, split != nil ? Space.s : 0)
        .overlay(alignment: .leading) {
            if split != nil {
                Rectangle()
                    .fill(Color.accentColor.opacity(0.35))
                    .frame(width: 2)
            }
        }
        .padding(.vertical, Space.xs)
        .contentShape(Rectangle())
    }

    /// 아이콘·이름·시각·메모. 배치(옆/위)만 바깥에서 달라지고 내용은 하나다.
    private var mainContent: some View {
        HStack(alignment: .top, spacing: Space.m) {
            // 장소 유형은 앱 아이콘(SF Symbols)으로 — 이모지와 섞지 않는다. 이름이 언제나 가장 먼저 읽힌다.
            Image(systemName: spot.category?.symbol ?? "mappin")
                .font(.body)
                .foregroundStyle(Ink.soft)
                .frame(width: 22, alignment: .center)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: Space.xs) {
                HStack(spacing: Space.s) {
                    Text(spot.name.isEmpty ? "이름 없는 장소" : spot.name)
                        .font(.body.weight(.semibold))
                        .strikethrough(spot.status == .skipped || spot.status == .cancelled)
                    if spot.isMust { Image(systemName: "star.fill").font(.caption2).foregroundStyle(Ink.warning) }
                }
                // 상대가 정한 약속은 가장 세게 말한다 — 내가 옮길 수 없는 시각이다.
                if let booked = bookedText { bookedChip(booked) }
                if !meta.isEmpty {
                    Text(meta).font(.caption).foregroundStyle(Ink.soft)
                }
                if spot.point == nil {
                    Label("위치 없음 · 동선에서 빠져요", systemImage: "mappin.slash")
                        .font(.caption2)
                        .foregroundStyle(Ink.warning)
                }
            }
            Spacer(minLength: 0)
            if spot.status != .planned {
                StatusChip(text: spot.status.label, symbol: statusSymbol, tint: statusTint)
            }
        }
    }

    /// 이 가지에 누가 가는가. 내가 빠진 구간은 옅게 — 없는 일정처럼 보이지 않게 지우지는 않는다.
    private func branchHeader(_ split: SplitInfo) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "person.2.fill").font(.caption2)
            Text(split.whoText).font(.caption.weight(.semibold))
            if !split.includesMe {
                Text("· 나는 안 가요").font(.caption2)
            }
        }
        .foregroundStyle(split.includesMe ? Color.accentColor : .secondary)
        .padding(.leading, secondaryIndent)
    }

    /// 시각 3종 중 둘 — 📌 도착 고정(내가 정한 계획)과 예상 도착(계산).
    /// 세기를 달리해서 "내가 정한 것"과 "계산된 것"이 눈으로 갈린다.
    ///
    /// ⚠️ 폭을 **고정하지 않는다.** 예전에는 48pt에 `📌 09:30`을 넣어서, 📌가 붙는 줄만
    /// 시간이 줄바꿈됐다. 글자 크기 설정을 키우면 아이콘이 없어도 넘친다 —
    /// 그래서 폭이 글자 크기를 따라가고(`@ScaledMetric`), 시간은 어떤 경우에도 한 줄이다.
    @ViewBuilder
    private var timeColumn: some View {
        if let plan {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 2) {
                    // 핀 자리는 **있든 없든 같다** — 아니면 고정된 줄의 시간만 오른쪽으로 밀린다.
                    Image(systemName: "pin.fill")
                        .font(.caption2)
                        .opacity(plan.fixed ? 1 : 0)
                        .frame(width: pinSlotWidth, alignment: .leading)
                        .accessibilityHidden(true)
                    Text(TimeFormat.clockAcrossMidnight(plan.etaMinutes))
                        .font(.caption.weight(plan.fixed ? .bold : .regular))
                        .monospacedDigit()
                        .lineLimit(1)
                        // 접근성 글자 크기에서 폭이 모자라면 줄을 바꾸는 대신 조금 줄인다.
                        .minimumScaleFactor(0.7)
                }
                if plan.conflict {
                    // 고정 시각이 이동상 불가능하다 — 조용히 넘기지 않는다.
                    Image(systemName: "exclamationmark.triangle.fill").font(.caption2)
                }
            }
            .foregroundStyle(plan.conflict ? Ink.warning : (plan.fixed ? Ink.ink : Ink.soft))
            .frame(width: typeSize.isAccessibilitySize ? nil : timeColumnWidth, alignment: .leading)
            .accessibilityLabel(timeAccessibility(plan))
        } else {
            // 계산이 오기 전에도 **자리는 잡아 둔다.** 폭을 0으로 두면 시각이 도착하는 순간
            // 이름이 통째로 옆으로 밀려 화면이 튄다(2026-09-07 보고).
            // 값은 비워 둔다 — 문서의 `at`을 도착 예정처럼 보이게 하지 않는다.
            Color.clear
                .frame(width: typeSize.isAccessibilitySize ? 0 : timeColumnWidth, height: 0)
                .accessibilityHidden(true)
        }
    }

    private func timeAccessibility(_ plan: DayPlanSpot) -> String {
        var text = plan.fixed ? "도착 고정 " : "예상 도착 "
        text += TimeFormat.clockAcrossMidnight(plan.etaMinutes)
        if plan.conflict { text += ", 이동 시간상 맞추기 어려워요" }
        return text
    }

    /// 이동은 장소보다 가볍게 — 작은 알약(`LegPill`) 하나. 장소 이름이 언제나 가장 높은 우선순위다.
    private func legLine(_ leg: DayPlanLeg) -> some View {
        let mode = TravelMode(rawValue: leg.mode) ?? dayMode
        return LegPill(symbol: mode.symbol, text: "\(TimeFormat.duration(leg.minutes)) · \(distanceText(leg.distanceKm))")
        .padding(.leading, secondaryIndent)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(mode.label)로 \(TimeFormat.duration(leg.minutes)), \(distanceText(leg.distanceKm))")
    }

    private func distanceText(_ km: Double) -> String {
        km < 1 ? "\(Int((km * 1000).rounded()))m" : String(format: "%.1fkm", km)
    }

    private var bookedText: String? {
        if let minutes = plan?.bookedAtMinutes { return TimeFormat.clock(minutes) }
        return spot.bookedAt      // 계산이 없으면 문서에 적힌 그대로
    }

    /// 예약·입장은 **상대가 정한** 시각이다. 늦으면 그 사실을 그 자리에서 말한다.
    private func bookedChip(_ text: String) -> some View {
        let late = plan.map { $0.etaMinutes > ($0.bookedAtMinutes ?? Int.max) } ?? false
        return HStack(spacing: 4) {
            Image(systemName: "ticket.fill").font(.caption2)
            Text("예약 \(text)").font(.caption.weight(.semibold))
            if late { Text("· 도착이 늦어요").font(.caption2) }
        }
        .foregroundStyle(late ? Ink.warning : Ink.accent)
    }

    /// 남는 것 — 머무는 시간 · 대기 · 구간 수단 재정의 · 도시.
    /// 시각(예약·도착)은 위에서 따로 말하므로 여기 섞지 않는다.
    private var meta: String {
        var parts: [String] = []
        if let stay = stayMinutes, stay > 0 { parts.append("\(stay)분 머무름") }
        if let wait = plan?.waitMinutes, wait > 0 { parts.append("대기 \(TimeFormat.duration(wait))") }
        if plan == nil, let arrive = spot.arriveAt { parts.append("도착 \(arrive)") }
        if let mode = spot.legMode, mode != dayMode { parts.append(mode.label) }
        if !spot.city.isEmpty && spot.city != "기타" { parts.append(spot.city) }
        return parts.joined(separator: "  ·  ")
    }

    private var stayMinutes: Int? { plan?.stayMinutes ?? spot.stayMinutes }

    private var statusSymbol: String {
        switch spot.status {
        case .completed: "checkmark.circle.fill"
        case .skipped: "arrow.uturn.right"
        case .cancelled: "xmark.circle"
        case .planned: "circle"
        }
    }

    private var statusTint: Color {
        switch spot.status {
        case .completed: Ink.positive
        case .skipped, .cancelled: Ink.soft
        case .planned: Ink.soft
        }
    }
}
