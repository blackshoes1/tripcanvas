import SwiftUI

/// 일정 편집 — 하루씩 본다.
///
/// 웹의 일자 카드를 그대로 옮기지 않았다. 아이폰에서는 하루를 골라 그 날의 장소만 목록으로 보고,
/// 순서는 끌어서, 빼는 것은 스와이프로 한다. 바꾸는 즉시 저장된다(저장 버튼이 없다).
/// 지도 보기 범위(이 날 | 전체). 전체는 **누른 순간에만** 받는다 — 열지도 않을 날까지 미리 받지 않는다.
/// 장소 검색은 범위가 아니라 **다른 일**이라 따로 켠다(`mapSearching`) — 같은 세그먼트에 넣지 않는다(2026-09-18).
enum MapScope: Hashable { case day, trip }

/// 화면 조각이 **부모에게 부탁하는 일.** 시트를 여는 것과 문서를 고치는 것은 조각이 아니라
/// `TripPlanView`가 소유한다 — 조각이 자기 시트 상태를 들면 같은 시트가 두 곳에서 열린다.
@MainActor
struct PlanActions {
    /// 그 장소를 편집기로 연다(보기 권한이면 정보 보기로 떨어진다).
    var editSpot: (Int, TripSpot) -> Void
    /// 고치지 않고 정보만 본다.
    var viewSpot: (Int, TripSpot) -> Void
    /// 장소를 담는다. `nil`이면 맨 뒤, 값이 있으면 그 장소 **뒤**에.
    var addAfter: (Int?) -> Void
    /// 고른 장소들을 날짜·위치로 옮긴다.
    var moveSpots: (Set<Int>) -> Void
    /// 고른 날을 바꾼다 — 방향(뒤쪽 날이면 true)은 목록 전환이 쓴다.
    var selectDay: (Int, Bool) -> Void
    /// 그 날의 비용 화면을 연다. revision을 함께 넘겨 **연 뒤 문서가 바뀌면** 화면이 알 수 있게 한다.
    var openCosts: (_ day: Int, _ revision: Int) -> Void
    /// 검색을 거치지 않고 **직접 입력**으로 장소를 만든다. 이름만 있는 장소도 일정에 남는다.
    var createSpot: () -> Void
}

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
    @State private var editor: SpotEditorSession?
    @State private var viewingSpot: SpotEditorTarget?
    @State private var showsSearch = false
    @State private var searchedSpot: TripSpot?
    /// 장소 검색(지도에서 담기)을 열어 두었는가. 범위와 별개다.
    @State private var mapSearching = false
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
                        // 시안의 툴바는 ⋯ 하나다 — 빼 온 진입점을 여기 모은다(기능을 잃지 않는다).
                        Button { insertionAfter = nil; showsSearch = true } label: { Label("검색해서 담기", systemImage: "magnifyingglass") }
                        Button { insertionAfter = nil; editor = makeEditor(.create) } label: { Label("직접 입력", systemImage: "square.and.pencil") }
                        if model.day != nil {
                            Button(isEditing ? "순서 편집 마치기" : "순서 편집") {
                                withAnimation { editMode?.wrappedValue = isEditing ? .inactive : .active }
                            }
                        }
                        Button("여행·하루 설정") { showsSettings = true }
                        Button(choosingPlaces ? "장소 선택 마치기" : "여러 장소 옮기기") {
                            choosingPlaces.toggle(); chosenPlaces = []; showsMap = false
                        }
                        if model.canUndo { Button("마지막 변경 되돌리기") { Task { await model.undoLastChange() } } }
                    }
                } label: { Image(systemName: "ellipsis.circle") }
                .accessibilityLabel("일정 메뉴")
            }
        }
        .task {
            // 탭 진입 — 문서가 있고 방금 받은 것이면 아무것도 받지 않는다(탭 전환은 앱 복귀가 아니다).
            await model.loadIfStale()
        }
        // 지도를 처음 켠 순간부터 만들어 둔다. 그 뒤로는 숨기기만 한다.
        .onChange(of: showsMap, initial: true) { _, on in if on { mapMounted = true } }
        .sheet(isPresented: $showsSearch, onDismiss: {
            if let spot = searchedSpot { editor = makeEditor(.createFromMap(spot)); searchedSpot = nil }
        }) {
            // 근처 우선의 기준은 그날 마지막 좌표 — 웹이 앵커로 검색하는 것과 같다.
            PlaceSearchView(near: model.day?.pins.last?.point) { hit in
                searchedSpot = hit.makeSpot()
            }
        }
        .sheet(item: $viewingSpot) { target in
            SpotInformationView(spot: target.spot, contextLabel: "\(trip.name) · Day \(model.selectedDay + 1)")
        }
        .sheet(item: $editor) { session in
            let target = session.target
            Group {
                SpotEditorView(
                    target: target,
                    dayCount: model.dayCount,
                    currentDay: session.day,
                    contextLabel: "\(trip.name) · Day \(session.day + 1) · \(model.strip.first(where: { $0.index == session.day })?.date ?? trip.start)",
                    members: model.members,
                    role: model.role,
                    draftKey: EditorDraftKey(accountID: env.auth.session?.userId, tripID: trip.id, editor: "spot-\(session.day)-\(target.index.map(String.init) ?? "new")"),
                    onSave: { spot in
                        let saved: Bool
                        switch target {
                        case .create, .createFromMap: saved = await model.addSpot(spot, after: insertionAfter, dayIndex: session.day, expectedRevision: session.revision)
                        case .edit(let index, _): saved = await model.updateSpot(at: index, with: spot, dayIndex: session.day, expectedRevision: session.revision)
                        }
                        return saved ? nil : model.saveFailureMessage
                    },
                    onDelete: { index in
                        await model.removeSpot(at: index, dayIndex: session.day, expectedRevision: session.revision) ? nil : model.saveFailureMessage
                    },
                    onMoveToDay: { index, day, spot in
                        await model.moveSpot(at: index, toDay: day, with: spot, dayIndex: session.day, expectedRevision: session.revision) ? nil : model.saveFailureMessage
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
                            draftKey: EditorDraftKey(accountID: env.auth.session?.userId, tripID: trip.id, editor: "spend-\(costDay)"),
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

    /// 조각들에게 넘기는 동작 한 벌. **여기서만** 시트 상태를 건드린다.
    private var actions: PlanActions {
        PlanActions(
            editSpot: { index, spot in editSpot(index, spot: spot, model: model) },
            viewSpot: { index, spot in viewingSpot = .edit(index: index, spot: spot) },
            addAfter: { index in insertionAfter = index; showsSearch = true },
            moveSpots: { indexes in prepareMove(indexes, model: model) },
            // ⚠️ 애니메이션을 **여기서** 건다. 날을 바꾸는 곳이 둘(날짜 칩·좌우 스와이프)이라
            //    각자 감싸면 한쪽만 밀리고 다른 쪽은 즉시 교체된다 — 실제로 그랬다(2026-09-21).
            selectDay: { day, forward in
                goingForward = forward
                withAnimation(motion) { model.selectedDay = day }
            },
            openCosts: { day, revision in costDay = day; costRevision = revision; showsCosts = true },
            createSpot: { insertionAfter = nil; editor = makeEditor(.create) })
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
                if let savedAt = model.documentCachedAt {
                    OfflineNotice(savedAt: savedAt)
                        .padding(.horizontal, Space.l)
                    Text("저장된 일정이에요. 연결되면 다시 불러와 편집할 수 있어요.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                // 오류도 화면의 높이를 차지해야 한다. overlay로 띄우면 날짜 탭과
                // 일정 제목을 덮고, 반투명 배경 아래의 글자까지 겹쳐 보인다.
                if let error = model.errorMessage {
                    InlineErrorBanner(message: "저장하지 못했어요", detail: error, tint: Ink.danger, compact: true) {
                        Task { await model.load() }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(Space.l)
                    .background(Ink.paper)
                }
                if !showsMap || !mapSearching {
                    PlanDayPicker(strip: model.strip, selectedDay: model.selectedDay,
                                  todayIndex: model.todayIndex, onSelect: actions.selectDay)
                }
                if choosingPlaces {
                    HStack {
                        Text("\(chosenPlaces.count)곳 선택")
                        Spacer()
                        Button("날짜·위치 옮기기") { prepareMove(chosenPlaces, model: model) }.disabled(chosenPlaces.isEmpty)
                    }.padding(.horizontal, Space.l).frame(minHeight: 44)
                }
                if showsMap { Divider() }
                ZStack {
                    // 지도는 한 번 만들면 **숨기기만 한다** — 일정↔지도를 오갈 때마다 엔진을 새로 띄우고
                    // 타일을 다시 받지 않게(2026-09-17). 처음 열기 전에는 만들지 않는다: 목록만 쓰는 사람에게
                    // 지도 SDK 값을 물리지 않는다. 숨긴 동안은 엔진이 쉰다(`MapEngineView.isVisible`).
                    if mapMounted {
                        PlanMapSection(trip: trip, model: model, discovery: discovery, showsMap: showsMap,
                                       mapSearching: $mapSearching, motion: motion, actions: actions)
                            .opacity(showsMap ? 1 : 0)
                            .allowsHitTesting(showsMap)
                            .accessibilityHidden(!showsMap)
                    }
                    if !showsMap {
                        // 나가는 목록과 들어오는 목록이 높이를 나눠 갖지 않게 같은 영역에 겹친다.
                        ZStack {
                            PlanSpotList(trip: trip, model: model, motion: motion, goingForward: goingForward,
                                         actions: actions, choosingPlaces: $choosingPlaces, chosenPlaces: $chosenPlaces)
                        }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .clipped()
                    }
                }
            }
            .background(Ink.paper)
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

    private func makeEditor(_ target: SpotEditorTarget) -> SpotEditorSession {
        SpotEditorSession(target: target, day: model.selectedDay, revision: model.revision)
    }

    private func editSpot(_ index: Int, spot: TripSpot, model: TripPlanViewModel) {
        guard model.canEdit else { viewingSpot = .edit(index: index, spot: spot); return }
        if choosingPlaces {
            if chosenPlaces.contains(index) { chosenPlaces.remove(index) } else { chosenPlaces.insert(index) }
            return
        }
        editor = makeEditor(.edit(index: index, spot: spot))
    }

    private func prepareMove(_ indexes: Set<Int>, model: TripPlanViewModel) {
        guard let document = model.document else { return }
        moveTarget = PlanMoveTarget(document: document, revision: model.revision, day: model.selectedDay, indexes: IndexSet(indexes))
    }

    private var motion: Animation {
        reduceMotion ? .easeInOut(duration: 0.15) : .snappy(duration: 0.28, extraBounce: 0.02)
    }


}

private struct PlanMoveTarget: Identifiable {
    let id = UUID()
    let document: TripDocument
    let revision: Int
    let day: Int
    let indexes: IndexSet
}

private struct SpotEditorSession: Identifiable {
    let id = UUID()
    let target: SpotEditorTarget
    let day: Int
    let revision: Int
}
