import SwiftUI

/// 장소 추가의 흐름(2026-09-27 시안) — 일정 화면의 '장소 추가' 한 곳에서 시작한다.
///
/// ```
/// ① 일정의 ＋ 장소 추가 → ② 방법 고르기 ─ 장소 검색 → ③ 결과 → ④ 장소 상세 → 이 장소 일정에 추가
///                                   └ 직접 입력 → ⑤ 이름·종류·위치·시간 → ⑥ 위치 고르기(지도·주소 검색)
/// ```
/// 검색이 먼저다 — 좌표가 있어야 동선·도착 예상·지도에 들어간다. 직접 입력은 검색에 없는 곳을 위한 길이고,
/// 거기서도 위치를 붙일 수 있다(붙이지 않아도 이름만으로 일정에 남는다).

/// ② 어떻게 담을지 고른다.
struct AddSpotOptionsSheet: View {
    /// 그날 장소 이름(순서대로). 둘 이상이면 넣을 자리를 여기서 고른다 —
    /// 전에는 장소 사이에 넣는 길이 길게 누르기 메뉴뿐이라 아무도 몰랐다.
    var spotNames: [String] = []
    /// 이 번호의 장소 뒤에 넣는다. nil이면 맨 뒤.
    @Binding var after: Int?
    let onSearch: () -> Void
    let onManual: () -> Void
    @Environment(\.dismiss) private var dismiss

    init(spotNames: [String] = [], after: Binding<Int?> = .constant(nil),
         onSearch: @escaping () -> Void, onManual: @escaping () -> Void) {
        self.spotNames = spotNames
        self._after = after
        self.onSearch = onSearch
        self.onManual = onManual
    }

    private var positionLabel: String {
        guard let after, spotNames.indices.contains(after) else { return "맨 뒤" }
        return "\(after + 1). \(spotNames[after]) 뒤"
    }

    var body: some View {
        VStack(spacing: Space.m) {
            Text("장소 추가")
                .font(.headline)
                .padding(.top, Space.l)
                .accessibilityAddTraits(.isHeader)
            if spotNames.count > 1 {
                Menu {
                    Button("맨 뒤") { after = nil }
                    ForEach(Array(spotNames.enumerated()), id: \.offset) { index, name in
                        Button("\(index + 1). \(name) 뒤") { after = index }
                    }
                } label: {
                    HStack {
                        Text("넣을 자리").foregroundStyle(Ink.soft)
                        Spacer()
                        Text(positionLabel).foregroundStyle(Ink.accent).lineLimit(1)
                        Image(systemName: "chevron.up.chevron.down").font(.caption).foregroundStyle(Ink.accent)
                    }
                    .font(.subheadline)
                    .frame(minHeight: 44)
                }
            }
            option(symbol: "magnifyingglass", title: "장소 검색", detail: "장소를 찾아 일정에 추가해요.", action: onSearch)
            option(symbol: "pencil", title: "직접 입력", detail: "검색되지 않는 장소를 직접 추가해요.", action: onManual)
            Button { dismiss() } label: {
                Text("취소")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Ink.ink)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(Ink.sunken, in: RoundedRectangle(cornerRadius: Radius.card))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, Space.l)
        .padding(.bottom, Space.l)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Ink.paper)
        .presentationDetents([.height(spotNames.count > 1 ? 360 : 310)])
        .presentationDragIndicator(.visible)
    }

    private func option(symbol: String, title: String, detail: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: Space.m) {
                Image(systemName: symbol)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Ink.accent)
                    .frame(width: 44, height: 44)
                    .background(Ink.accent.opacity(0.1), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.body.weight(.semibold)).foregroundStyle(Ink.ink)
                    Text(detail).font(.footnote).foregroundStyle(Ink.soft)
                }
                Spacer(minLength: Space.s)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Ink.faint)
            }
            .padding(Space.m)
            .background(Ink.raised, in: RoundedRectangle(cornerRadius: Radius.card))
            .overlay(RoundedRectangle(cornerRadius: Radius.card).strokeBorder(Ink.hairline))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// ④ 고른 검색 결과를 확인하고 일정에 넣는다. 사진은 **이 화면에서만** 부른다 —
/// 목록의 결과마다 부르면 결과 수만큼 과금되는 요청이 나가고 출처 표기도 붙일 자리가 없다.
struct PlaceDetailView: View {
    let hit: PlaceHit
    let addTitle: String
    let onAdd: () -> Void
    @State private var showsMap = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.l) {
                // 사진은 구글 장소만 있다(출처 표기와 함께). 국내(카카오) 결과는 사진 자리에 분류 기호를 둔다 —
                // "사진 정보가 없어요"로 화면을 시작하지 않는다.
                if let placeId = hit.placeId, GooglePlaces.validPlaceId(placeId) {
                    PlacePhotoView(placeId: placeId, kakaoId: nil, name: hit.name)
                } else {
                    Image(systemName: hit.category?.symbol ?? "mappin.and.ellipse")
                        .font(.system(size: 44, weight: .regular))
                        .foregroundStyle(Ink.accent)
                        .frame(maxWidth: .infinity, minHeight: 180)
                        .background(Ink.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: Radius.control))
                        .accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text(hit.name)
                        .font(.title2.weight(.bold))
                        .foregroundStyle(Ink.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    if let subtitle = Self.subtitle(hit) {
                        Text(subtitle).font(.body).foregroundStyle(Ink.ink)
                    }
                    if !hit.address.isEmpty {
                        Text(hit.address).font(.subheadline).foregroundStyle(Ink.soft)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Button { showsMap = true } label: {
                    HStack(spacing: Space.s) {
                        Image(systemName: "mappin.circle.fill").foregroundStyle(Ink.accent)
                        Text("지도에서 보기").foregroundStyle(Ink.ink)
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Ink.faint)
                        Spacer()
                    }
                    .font(.subheadline)
                    .padding(Space.m)
                    .frame(minHeight: 48)
                    .background(Ink.sunken.opacity(0.6), in: RoundedRectangle(cornerRadius: Radius.control))
                }
                .buttonStyle(.plain)
                if hit.provider == "kakao", let id = hit.providerId, !id.isEmpty, id.allSatisfy(\.isNumber),
                   let url = URL(string: "https://place.map.kakao.com/\(id)") {
                    Link("카카오맵에서 자세히 보기", destination: url)
                        .font(.footnote).frame(minHeight: 44)
                }
            }
            .padding(Space.l)
        }
        .safeAreaInset(edge: .bottom) {
            PrimaryActionButton(title: addTitle, action: onAdd)
                .padding(Space.l)
                .background(Ink.paper)
        }
        .background(Ink.paper)
        .navigationTitle("장소 정보")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showsMap) {
            NavigationStack {
                MapEngineView(pins: [MapPin(id: hit.id, title: hit.name, point: hit.point, order: 1)],
                              focus: hit.point, regionHint: MapRegion.isKorea(hit.point))
                    .ignoresSafeArea(edges: .bottom)
                    .navigationTitle(hit.name)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .topBarLeading) { Button("닫기") { showsMap = false } } }
            }
        }
    }

    /// 이름 아래 한 줄 — 도시. 이름과 같으면 되풀이하지 않는다.
    static func subtitle(_ hit: PlaceHit) -> String? {
        let city = hit.city.trimmingCharacters(in: .whitespaces)
        guard !city.isEmpty, city != hit.name, city != "기타" else { return nil }
        return city
    }
}

/// ⑤ 검색에 없는 장소를 직접 만든다 — 이름·종류·위치·시간만 묻는다.
/// 이동수단·비용·메모 같은 나머지는 추가한 뒤 그 장소를 눌러 정한다(편집기가 전부 갖고 있다).
struct SpotQuickCreateView: View {
    let contextLabel: String?
    let draftKey: EditorDraftKey?
    let onSave: (TripSpot) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var draft: TripSpot
    @State private var saving = EditorSaveState()
    @State private var showsLocation = false
    @State private var showsDiscardConfirm = false
    @FocusState private var nameFocused: Bool
    private let initial: TripSpot

    init(prefilledName: String = "", contextLabel: String? = nil, draftKey: EditorDraftKey? = nil,
         onSave: @escaping (TripSpot) async -> String?) {
        let spot = TripSpot(name: prefilledName)
        self.initial = spot
        self.contextLabel = contextLabel
        self.draftKey = draftKey
        self.onSave = onSave
        _draft = State(initialValue: spot)
    }

    private var isDirty: Bool { draft != initial }
    private var canSave: Bool { !draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !saving.isWorking }

    var body: some View {
        NavigationStack {
            PaperForm {
                if let contextLabel, !contextLabel.isEmpty {
                    Section { Text(contextLabel).font(.subheadline.weight(.semibold)) }
                }
                if let error = saving.error {
                    Section { Text(error).foregroundStyle(Ink.danger) }
                }
                Section {
                    LabeledContent("이름") {
                        TextField("장소 이름을 입력해주세요.", text: $draft.name)
                            .multilineTextAlignment(.leading)
                            .focused($nameFocused)
                            .submitLabel(.done)
                    }
                    Picker("종류", selection: $draft.category) {
                        Text("미지정").tag(SpotCategory?.none)
                        ForEach(SpotCategory.allCases, id: \.self) { category in
                            Label(category.label, systemImage: category.symbol).tag(SpotCategory?.some(category))
                        }
                    }
                }
                Section("위치") {
                    Button { showsLocation = true } label: {
                        HStack(spacing: Space.m) {
                            Image(systemName: draft.point == nil ? "mappin.and.ellipse" : "mappin.circle.fill")
                                .font(.title3)
                                .foregroundStyle(draft.point == nil ? Ink.soft : Ink.accent)
                                .frame(width: 28)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(draft.point == nil ? "위치 추가" : locationTitle)
                                    .font(.body.weight(.semibold)).foregroundStyle(Ink.ink)
                                Text(draft.point == nil ? "위치를 추가하면 이동 동선과 도착 시간을 계산할 수 있어요." : "눌러서 위치를 바꿀 수 있어요.")
                                    .font(.footnote).foregroundStyle(Ink.soft)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: Space.s)
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Ink.faint)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if draft.point != nil {
                        Button("위치 지우기", role: .destructive) {
                            draft.point = nil; draft.placeId = nil; draft.kakaoId = nil; draft.setField("addr", nil)
                        }
                    }
                }
                Section {
                    ClockField(title: "예약·입장 시간", text: $draft.bookedAt)
                    ClockField(title: "도착 시간", text: $draft.arriveAt)
                    StayMinutesPicker(minutes: $draft.stayMinutes)
                } header: {
                    Text("시간 (선택)")
                } footer: {
                    Text("예약·입장 시간은 상대가 정한 약속, 도착 시간은 내가 정한 계획이에요. 비워 두면 앞 장소에서 계산해요. 이동수단·비용·메모는 추가한 뒤 장소를 눌러 정할 수 있어요.")
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .disabled(saving.isWorking)
            .interactiveDismissDisabled(isDirty || saving.isWorking)
            .tint(Ink.accent)
            .navigationTitle("장소 추가 (직접 입력)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { if isDirty { showsDiscardConfirm = true } else { dismiss() } } label: {
                        Image(systemName: "chevron.left")
                    }
                    .accessibilityLabel("취소")
                    .disabled(saving.isWorking)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(saving.isWorking ? "저장 중…" : "완료") { Task { await save() } }
                        .disabled(!canSave)
                }
            }
            .confirmationDialog("입력한 내용을 버릴까요?", isPresented: $showsDiscardConfirm, titleVisibility: .visible) {
                Button("내용 버리기", role: .destructive) { dismiss() }
                Button("계속 편집", role: .cancel) { }
            }
            .sheet(isPresented: $showsLocation) {
                LocationPickerView(initial: draft.point, query: draft.name) { choice in
                    draft = choice.applied(to: draft)
                }
            }
            .onAppear { if draft.name.isEmpty { nameFocused = true } }
        }
    }

    private var locationTitle: String {
        if let address = draft.raw["addr"]?.stringValue, !address.isEmpty { return address }
        guard let point = draft.point else { return "위치 추가" }
        return String(format: "%.5f, %.5f", point.lat, point.lng)
    }

    private func save() async {
        var spot = draft
        spot.name = spot.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if spot.city.trimmingCharacters(in: .whitespaces).isEmpty { spot.city = "기타" }
        if await saving.perform({ await onSave(spot) }) { EditorDraftStore.shared.remove(draftKey); dismiss() }
    }
}

/// ⑥에서 고른 위치. 검색 결과는 이름·주소·도시·식별자까지, 지도 탭은 좌표(해외 POI면 이름·id)만 온다.
enum LocationChoice: Equatable {
    case place(PlaceHit)
    case point(MapPick)

    var point: GeoPoint {
        switch self {
        case .place(let hit): hit.point
        case .point(let pick): pick.point
        }
    }

    var title: String {
        switch self {
        case .place(let hit): hit.name
        case .point(let pick): pick.name ?? "지도에서 고른 위치"
        }
    }

    var detail: String {
        switch self {
        case .place(let hit): hit.address.isEmpty ? hit.city : hit.address
        case .point(let pick): String(format: "%.5f, %.5f", pick.point.lat, pick.point.lng)
        }
    }

    /// 위치를 장소에 붙인다. **사용자가 쓴 이름은 덮지 않는다** — 비어 있을 때만 채운다.
    func applied(to spot: TripSpot) -> TripSpot {
        var next = spot
        let typedName = spot.name.trimmingCharacters(in: .whitespacesAndNewlines)
        switch self {
        case .place(let hit):
            next.point = hit.point
            if !hit.city.isEmpty { next.city = hit.city }
            if next.category == nil { next.category = hit.category }
            next.setField("addr", hit.address.isEmpty ? nil : .string(hit.address))
            next.placeId = hit.placeId
            next.kakaoId = hit.provider == "kakao" ? hit.providerId : nil
            if typedName.isEmpty { next.name = hit.name }
        case .point(let pick):
            next.point = pick.point
            next.placeId = pick.placeId
            next.kakaoId = nil
            next.setField("addr", nil)
            if typedName.isEmpty, let name = pick.name { next.name = name }
        }
        return next
    }
}

/// ⑥ 위치 고르기 — 이름·주소로 찾거나 지도를 탭한다. 고른 곳을 아래 카드로 확인하고 '이 위치로 선택'.
///
/// 좌표 역추적(이름 추측)은 하지 않는다 — 추측이라 엉뚱한 상호가 들어갈 수 있다(웹 `reverseSpot`과 같은 이유).
struct LocationPickerView: View {
    let initial: GeoPoint?
    let query: String
    let onPick: (LocationChoice) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(AppEnvironment.self) private var env
    @State private var text: String
    @State private var hits: [PlaceHit] = []
    @State private var searching = false
    @State private var searchError: String?
    @State private var searched = false
    @State private var choice: LocationChoice?
    @FocusState private var focused: Bool

    init(initial: GeoPoint?, query: String = "", onPick: @escaping (LocationChoice) -> Void) {
        self.initial = initial
        self.query = query
        self.onPick = onPick
        _text = State(initialValue: query)
    }

    private var focus: GeoPoint? { choice?.point ?? initial }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                searchField
                ZStack(alignment: .top) {
                    MapEngineView(
                        pins: focus.map { [MapPin(id: "choice", title: choice?.title ?? "고른 위치", point: $0, order: 1)] } ?? [],
                        focus: focus,
                        regionHint: MapRegion.isKoreanSearch(text, near: initial),
                        onPick: { pick in focused = false; hits = []; choice = .point(pick) })
                    if focused || !hits.isEmpty || searchError != nil || (searched && hits.isEmpty) {
                        resultsList
                    }
                }
                card
            }
            .background(Ink.paper)
            .navigationTitle("위치 추가")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: { Image(systemName: "chevron.left") }
                        .accessibilityLabel("취소")
                }
            }
        }
    }

    private var searchField: some View {
        HStack(spacing: Space.s) {
            Image(systemName: "magnifyingglass").foregroundStyle(Ink.soft)
            TextField("장소 이름·주소로 검색", text: $text)
                .focused($focused)
                .submitLabel(.search)
                .onSubmit { Task { await search() } }
            if !text.isEmpty {
                Button { text = ""; hits = []; searched = false; searchError = nil } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Ink.faint)
                }
                .accessibilityLabel("검색어 지우기")
            }
        }
        .padding(.horizontal, Space.m)
        .frame(minHeight: 44)
        .background(Ink.raised, in: RoundedRectangle(cornerRadius: Radius.control))
        .overlay(RoundedRectangle(cornerRadius: Radius.control).strokeBorder(Ink.hairline))
        .padding(.horizontal, Space.l)
        .padding(.vertical, Space.s)
    }

    private var resultsList: some View {
        List {
            if searching {
                HStack { ProgressView(); Text("찾는 중").foregroundStyle(Ink.soft) }
            } else if let searchError {
                VStack(alignment: .leading, spacing: Space.s) {
                    Label(searchError, systemImage: "exclamationmark.circle").foregroundStyle(Ink.warning)
                    Button("다시 검색") { Task { await search() } }
                }
            } else if searched && hits.isEmpty {
                Text("검색 결과가 없어요. 지도를 탭해 위치를 고를 수 있어요.").foregroundStyle(Ink.soft)
            }
            ForEach(hits) { hit in
                Button {
                    focused = false; choice = .place(hit); hits = []; searched = false
                } label: {
                    PlaceResultRow(hit: hit)
                }
                .buttonStyle(.plain)
            }
        }
        .listStyle(.plain)
        .frame(maxHeight: 320)
        .scrollContentBackground(.hidden)
        .background(Ink.paper)
    }

    @ViewBuilder
    private var card: some View {
        VStack(spacing: Space.m) {
            if let choice {
                HStack(spacing: Space.m) {
                    PlaceThumbnail(symbol: choiceSymbol)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(choice.title).font(.body.weight(.semibold)).foregroundStyle(Ink.ink)
                        Text(choice.detail).font(.footnote).foregroundStyle(Ink.soft).lineLimit(2)
                    }
                    Spacer(minLength: 0)
                }
                if case .point(let pick) = choice, pick.placeId == nil {
                    Text("탭한 자리의 좌표만 담겨요. 이름은 직접 적어 주세요.")
                        .font(.caption).foregroundStyle(Ink.soft)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                Text("장소 이름이나 주소로 찾거나, 지도를 탭해 위치를 고르세요.")
                    .font(.footnote).foregroundStyle(Ink.soft)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            PrimaryActionButton(title: "이 위치로 선택") {
                if let choice { onPick(choice) }
                dismiss()
            }
            .disabled(choice == nil)
        }
        .padding(Space.l)
        .background(Ink.raised)
    }

    private var choiceSymbol: String {
        if case .place(let hit) = choice { return hit.category?.symbol ?? "mappin" }
        return "mappin"
    }

    private func search() async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        searching = true
        defer { searching = false }
        do {
            hits = try await env.places.search(trimmed, near: initial)
            searchError = nil
        } catch {
            hits = []
            searchError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        searched = true
    }
}

/// 검색 결과 한 줄 — 기호·이름·보조 이름·주소. 오른쪽 썸네일 자리에는 사진 대신 분류 기호를 둔다(사진은 상세에서).
struct PlaceResultRow: View {
    let hit: PlaceHit
    var highlighted = false

    var body: some View {
        HStack(alignment: .center, spacing: Space.m) {
            Image(systemName: "mappin.circle.fill")
                .font(.title3)
                .foregroundStyle(highlighted ? Ink.accent : Ink.soft)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(hit.name).font(.body.weight(.semibold)).foregroundStyle(Ink.ink)
                if let subtitle = PlaceDetailView.subtitle(hit) {
                    Text(subtitle).font(.footnote).foregroundStyle(Ink.soft)
                }
                if !hit.address.isEmpty {
                    Text(hit.address).font(.caption).foregroundStyle(Ink.soft).lineLimit(1)
                }
            }
            Spacer(minLength: Space.s)
            PlaceThumbnail(symbol: hit.category?.symbol ?? "mappin")
        }
        .padding(.vertical, Space.xs)
        .contentShape(Rectangle())
    }
}

/// 사진 자리 — 목록에서는 사진을 부르지 않으므로 분류 기호를 같은 크기의 칸에 둔다.
struct PlaceThumbnail: View {
    let symbol: String

    var body: some View {
        Image(systemName: symbol)
            .font(.title3)
            .foregroundStyle(Ink.accent)
            .frame(width: 56, height: 56)
            .background(Ink.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: Radius.control))
            .accessibilityHidden(true)
    }
}

/// 머무는 시간. 자주 쓰는 값을 두되, **문서에 이미 있는 값은 목록에 없어도 그대로 보인다** —
/// 웹·붙여넣기로 정한 150분이 빈칸이 되거나, 고칠 때 가까운 값으로 바뀌면 안 된다.
struct StayMinutesPicker: View {
    @Binding var minutes: Int?
    static let presets = [0, 15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480, 600]

    static func options(including current: Int?) -> [Int] {
        guard let current, current >= 0, !presets.contains(current) else { return presets }
        return (presets + [current]).sorted()
    }

    var body: some View {
        Picker("머무는 시간", selection: $minutes) {
            // '정하지 않음'과 '0분'은 계산에서 같다(둘 다 머무르지 않는다).
            // 그래도 둘을 남긴다 — "아직 안 정했다"와 "들렀다 바로 간다"는 다른 말이다.
            Text("정하지 않음").tag(Int?.none)
            ForEach(Self.options(including: minutes), id: \.self) { value in
                Text(value == 0 ? "0분 (바로 이동)" : TimeFormat.duration(value)).tag(Int?.some(value))
            }
        }
    }
}
