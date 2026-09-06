import SwiftUI

/// 일정 편집 — 하루씩 본다.
///
/// 웹의 일자 카드를 그대로 옮기지 않았다. 아이폰에서는 하루를 골라 그 날의 장소만 목록으로 보고,
/// 순서는 끌어서, 빼는 것은 스와이프로 한다. 바꾸는 즉시 저장된다(저장 버튼이 없다).
struct TripPlanView: View {
    let trip: TripSummary

    @Environment(AppEnvironment.self) private var env
    @State private var model: TripPlanViewModel?
    @State private var editor: SpotEditorTarget?
    @State private var showsSearch = false
    @State private var showsMap = false

    var body: some View {
        Group {
            if let model {
                content(model)
            } else {
                ProgressView()
            }
        }
        // 제목(여행 이름)은 `TripHomeView`가 정한다.
        .toolbar {
            if let model, model.canEdit, model.day != nil {
                ToolbarItem(placement: .topBarTrailing) { EditButton() }
                ToolbarItem(placement: .topBarTrailing) {
                    // 검색이 먼저다 — 좌표가 있어야 동선·ETA·지도에 들어간다. 직접 입력은 그다음.
                    Menu {
                        Button { showsSearch = true } label: { Label("검색해서 담기", systemImage: "magnifyingglass") }
                        Button { editor = .create } label: { Label("직접 입력", systemImage: "square.and.pencil") }
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("장소 추가")
                }
            }
        }
        .task {
            if model == nil { model = TripPlanViewModel(tripId: trip.id, service: env.service) }
            await model?.load()
        }
        .sheet(isPresented: $showsSearch) {
            if let model {
                // 근처 우선의 기준은 그날 마지막 좌표 — 웹이 앵커로 검색하는 것과 같다.
                PlaceSearchView(near: model.day?.pins.last?.point) { hit in
                    let spot = hit.makeSpot()
                    Task { await model.addSpot(spot) }
                }
            }
        }
        .sheet(item: $editor) { target in
            if let model {
                SpotEditorView(
                    target: target,
                    dayCount: model.dayCount,
                    currentDay: model.selectedDay,
                    onSave: { spot in
                        Task {
                            switch target {
                            case .create: await model.addSpot(spot)
                            case .edit(let index, _): await model.updateSpot(at: index, with: spot)
                            }
                        }
                    },
                    onDelete: { index in Task { await model.removeSpot(at: index) } },
                    onMoveToDay: { index, day in Task { await model.moveSpot(at: index, toDay: day) } })
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
                dayPicker(model)
                Picker("보기", selection: $showsMap) {
                    Text("목록").tag(false)
                    Text("지도").tag(true)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, Space.l)
                .padding(.bottom, Space.s)
                Divider()
                if showsMap {
                    dayMap(model)
                } else {
                    spotList(model)
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
                Button("그대로 두기", role: .cancel) { model.dismissConflict() }
            } message: {
                Text("최신 일정을 불러오면 방금 바꾼 것은 사라집니다. 방금 바꾼 것은 아직 저장되지 않았어요.")
            }
        }
    }

    private func conflictBinding(_ model: TripPlanViewModel) -> Binding<Bool> {
        Binding(get: { model.conflict != nil }, set: { if !$0 { model.dismissConflict() } })
    }

    /// 며칠짜리든 한 줄에 담기지 않는다 — 가로 스크롤 칩으로 고른다.
    ///
    /// "며칠째"만 보여 주면 3일차가 무슨 요일인지, 오늘인지, 뭐가 들어 있는지 모른다.
    /// 날짜·요일은 **서버가 준 것**을 쓴다(`start + index`를 앱에서 더하면 규칙이 두 곳이 된다).
    private func dayPicker(_ model: TripPlanViewModel) -> some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Space.s) {
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
            model.selectedDay = entry.index
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
                            .background(Color.accentColor, in: Capsule())
                            .foregroundStyle(.white)
                    }
                }
                if let date = TimeFormat.dayChipLabel(entry.date) {
                    Text(date).font(.caption2).foregroundStyle(selected ? Color.accentColor : .secondary)
                }
                Text(entry.title.isEmpty ? subtitle(for: entry) : entry.title)
                    .font(.caption2)
                    .lineLimit(1)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, Space.m)
            .padding(.vertical, Space.s)
            .frame(minWidth: 72)
            .background(selected ? Color.accentColor.opacity(0.16) : Color(.secondarySystemBackground),
                        in: RoundedRectangle(cornerRadius: Radius.card))
            .overlay(RoundedRectangle(cornerRadius: Radius.card)
                .stroke(isToday ? Color.accentColor : .clear, lineWidth: selected ? 0 : 1))
            .foregroundStyle(selected ? Color.accentColor : .primary)
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
            List {
                Section {
                    if day.spots.isEmpty { emptyDay(model) }
                    // 🏠 전날 숙소 이월 · 렌터카 픽업은 장소 목록 **앞**에 온다.
                    // ⚠️ ForEach 밖에 둔다 — 드래그 인덱스는 ForEach의 컬렉션 기준이라
                    //    이 줄들이 그 안에 섞이면 순서가 어긋난다.
                    if let carry = model.planDay?.carriedStay { carryRow(carry) }
                    ForEach(model.planDay?.carPickups ?? [], id: \.bookingId) { carEventRow($0) }
                    ForEach(Array(day.spots.enumerated()), id: \.offset) { index, spot in
                        Button {
                            guard model.canEdit else { return }
                            editor = .edit(index: index, spot: spot)
                        } label: {
                            SpotRow(spot: spot, dayMode: day.mode, plan: model.planSpot(at: index))
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing) {
                            if model.canEdit {
                                Button("빼기", role: .destructive) { Task { await model.removeSpot(at: index) } }
                            }
                        }
                    }
                    .onMove { source, destination in
                        Task { await model.moveSpots(from: source, to: destination) }
                    }
                    .deleteDisabled(!model.canEdit)
                    .moveDisabled(!model.canEdit)
                    // 반납은 장소 뒤, 숙소 복귀 앞 — 웹 일자 카드와 같은 순서다.
                    ForEach(model.planDay?.carReturns ?? [], id: \.bookingId) { carEventRow($0) }
                    if let back = model.planDay?.back { backRow(back) }
                } header: {
                    VStack(alignment: .leading, spacing: Space.xs) {
                        dayHeader(model, day: day)
                        if let totals = model.planDay?.totals { daySummary(totals) }
                    }
                } footer: {
                    VStack(alignment: .leading, spacing: Space.xs) {
                        if !model.canEdit {
                            Text("보기 권한이라 일정을 바꿀 수 없어요. 주최자에게 요청하세요.")
                        }
                        // 추정을 실측처럼 말하지 않는다. 구간마다 붙이면 잔소리가 되므로 하루에 한 번만.
                        if model.plan != nil, model.travelTimeIsEstimate, !day.spots.isEmpty {
                            Text("이동 시간은 직선거리 기준 예상이에요.")
                        }
                        // 계산이 없는 상태와 정상인 상태가 화면에서 구분되지 않으면,
                        // 서버가 아직 준비 안 된 것을 아무도 모른다(2026-09-06에 그랬다).
                        if model.plan == nil, !day.spots.isEmpty {
                            Label("예상 도착 시각을 불러오지 못했어요 — 일정 편집은 그대로 됩니다.",
                                  systemImage: "clock.badge.exclamationmark")
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { await model.load() }
        } else {
            EmptyStateView(symbol: "calendar", title: "일자가 없어요", message: "웹에서 일자를 먼저 만들어 주세요.")
        }
    }

    /// 그날의 동선. 좌표 없는 장소는 여기 안 나온다 — 목록의 '위치 없음'이 그 사실을 말한다.
    @ViewBuilder
    private func dayMap(_ model: TripPlanViewModel) -> some View {
        if let day = model.day {
            let pins = day.pins
            if pins.isEmpty {
                EmptyStateView(
                    symbol: "map",
                    title: "지도에 놓을 장소가 없어요",
                    message: "검색해서 담으면 좌표가 함께 들어와 여기에 보입니다.")
            } else {
                MapEngineView(pins: pins)
                    .ignoresSafeArea(edges: .bottom)
                    .overlay(alignment: .topTrailing) {
                        let missing = day.spots.count - pins.count
                        if missing > 0 {
                            Text("위치 없는 장소 \(missing)곳은 지도에 없어요")
                                .font(.caption)
                                .padding(.horizontal, Space.m)
                                .padding(.vertical, Space.xs + 2)
                                .background(.thinMaterial, in: Capsule())
                                .padding(Space.m)
                        }
                    }
            }
        }
    }

    private func dayHeader(_ model: TripPlanViewModel, day: TripDay) -> some View {
        HStack(spacing: Space.s) {
            Text(day.title.isEmpty ? "Day \(model.selectedDay + 1)" : day.title)
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

    /// 빈 날. "장소가 없어요"로 끝내지 않는다 — 이미 담아 둔 후보에서 가져올 수 있다.
    @ViewBuilder
    private func emptyDay(_ model: TripPlanViewModel) -> some View {
        VStack(alignment: .leading, spacing: Space.s) {
            Text(model.canEdit ? "아직 장소가 없어요." : "이 날에는 장소가 없어요.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if model.canEdit {
                Text("오른쪽 위 ＋로 검색해서 담거나, 일행과 골라 둔 곳에서 가져옵니다.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                NavigationLink { CandidateBoardView(trip: trip) } label: {
                    Label("가고 싶은 곳에서 가져오기", systemImage: "mappin.and.ellipse")
                        .font(.subheadline.weight(.semibold))
                }
            }
        }
        .padding(.vertical, Space.xs)
    }

    /// 하루의 무게 — 얼마나 움직이고 얼마나 쓰는가. 값은 전부 서버가 계산한 것이다.
    @ViewBuilder
    private func daySummary(_ totals: DayPlanTotals) -> some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            HStack(spacing: Space.m) {
                if totals.distanceKm > 0 {
                    Label(String(format: "%.1fkm", totals.distanceKm), systemImage: "ruler")
                }
                if totals.travelMinutes > 0 {
                    Label(TimeFormat.duration(totals.travelMinutes), systemImage: "arrow.triangle.turn.up.right.diamond")
                }
                if totals.cost.total > 0 {
                    Label(TimeFormat.money(Double(totals.cost.total), currency: "KRW"), systemImage: "wonsign.circle")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            // 자정을 넘긴다 — 넘긴다고 막지는 않는다. 그렇게 되어 있다고 말할 뿐이다.
            if totals.overloaded, let end = totals.endMinutes {
                Label("이대로면 \(TimeFormat.clock(end))에 끝나요", systemImage: "moon.zzz")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
        .textCase(nil)
    }

    /// 🏠 전날 숙소에서 이어지는 날. **표시일 뿐**이고 이 항목은 그날 일정이 아니다.
    private func carryRow(_ carry: DayPlanCarriedStay) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 1) {
                Text(carry.name).font(.subheadline)
                Text("전날 숙소에서 출발").font(.caption2).foregroundStyle(.secondary)
            }
        } icon: {
            Text("🏠")
        }
        .listRowBackground(Color(.secondarySystemGroupedBackground).opacity(0.6))
    }

    /// 자동으로 이어 붙인 숙소 복귀. 일정에 저장된 장소가 아니라는 것을 밝힌다.
    /// ⚠️ 일정의 마지막 날에는 서버가 이걸 주지 않는다 — 떠나는 날이다.
    private func backRow(_ back: DayPlanBack) -> some View {
        HStack(alignment: .top, spacing: Space.m) {
            Text("🏠").font(.title3)
            VStack(alignment: .leading, spacing: 1) {
                Text(back.name).font(.subheadline)
                let mode = TravelMode(rawValue: back.leg.mode)
                Text("숙소 복귀 · 자동 · \(mode?.label ?? "") \(TimeFormat.duration(back.leg.minutes))")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .listRowBackground(Color(.secondarySystemGroupedBackground).opacity(0.6))
    }

    /// 렌터카 픽업·반납. ⚠️ **좌표가 없어 동선·ETA·지도에 들어가지 않는다** — 표시만 한다.
    /// 그래서 시각을 ETA 칸이 아니라 메타 줄에 둔다(그날 계산된 도착 순서에 속하지 않는다).
    private func carEventRow(_ event: DayPlanCarEvent) -> some View {
        HStack(alignment: .top, spacing: Space.m) {
            Image(systemName: "car.fill").font(.subheadline).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(event.place.isEmpty ? (event.kind == .pickup ? "렌터카 픽업" : "렌터카 반납") : event.place)
                    .font(.subheadline)
                Text([event.kind == .pickup ? "렌터카 픽업" : "렌터카 반납",
                      event.atMinutes.map(TimeFormat.clock)].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .listRowBackground(Color(.secondarySystemGroupedBackground).opacity(0.6))
    }
}

/// 목록의 한 줄. 시각·상태·이동수단처럼 "그 장소가 언제 어떤 상태인지"만 보인다.
struct SpotRow: View {
    let spot: TripSpot
    let dayMode: TravelMode
    /// 서버가 계산한 그 장소의 시각과 구간. nil이면 계산을 못 받은 것이다 —
    /// 그때는 **문서에 적힌 것만** 보인다(없는 시각을 앱이 지어내지 않는다).
    var plan: DayPlanSpot?

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            // 이 장소로 '들어오는' 구간. 장소 사이가 비어 있으면 "여기서 저기까지 얼마나"를 알 수 없다.
            if let leg = plan?.incomingLeg { legLine(leg) }

            HStack(alignment: .top, spacing: Space.m) {
                timeColumn
                Text(spot.category?.icon ?? "📍").font(.title3)
                VStack(alignment: .leading, spacing: Space.xs) {
                    HStack(spacing: Space.s) {
                        Text(spot.name.isEmpty ? "이름 없는 장소" : spot.name)
                            .font(.body.weight(.semibold))
                            .strikethrough(spot.status == .skipped || spot.status == .cancelled)
                        if spot.isMust { Image(systemName: "star.fill").font(.caption2).foregroundStyle(.orange) }
                    }
                    // 상대가 정한 약속은 가장 세게 말한다 — 내가 옮길 수 없는 시각이다.
                    if let booked = bookedText { bookedChip(booked) }
                    if !meta.isEmpty {
                        Text(meta).font(.caption).foregroundStyle(.secondary)
                    }
                    if spot.point == nil {
                        Label("위치 없음 · 동선에서 빠져요", systemImage: "mappin.slash")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
                if spot.status != .planned {
                    StatusChip(text: spot.status.label, symbol: statusSymbol, tint: statusTint)
                }
            }
        }
        .padding(.vertical, Space.xs)
        .contentShape(Rectangle())
    }

    /// 시각 3종 중 둘 — 📌 도착 고정(내가 정한 계획)과 예상 도착(계산).
    /// 세기를 달리해서 "내가 정한 것"과 "계산된 것"이 눈으로 갈린다.
    @ViewBuilder
    private var timeColumn: some View {
        if let plan {
            VStack(spacing: 1) {
                HStack(spacing: 2) {
                    if plan.fixed { Text("📌").font(.caption2) }
                    Text(TimeFormat.clock(plan.etaMinutes))
                        .font(.caption.weight(plan.fixed ? .bold : .regular))
                        .monospacedDigit()
                }
                if plan.conflict {
                    // 고정 시각이 이동상 불가능하다 — 조용히 넘기지 않는다.
                    Image(systemName: "exclamationmark.triangle.fill").font(.caption2)
                }
            }
            .foregroundStyle(plan.conflict ? Color.orange : (plan.fixed ? .primary : .secondary))
            .frame(width: 48, alignment: .leading)
            .accessibilityLabel(timeAccessibility(plan))
        } else {
            // 계산을 못 받았으면 자리만 비운다 — 문서의 `at`을 도착 예정처럼 보이게 하지 않는다.
            Color.clear.frame(width: 0, height: 0)
        }
    }

    private func timeAccessibility(_ plan: DayPlanSpot) -> String {
        var text = plan.fixed ? "도착 고정 " : "예상 도착 "
        text += TimeFormat.clock(plan.etaMinutes)
        if plan.conflict { text += ", 이동 시간상 맞추기 어려워요" }
        return text
    }

    private func legLine(_ leg: DayPlanLeg) -> some View {
        let mode = TravelMode(rawValue: leg.mode) ?? dayMode
        return HStack(spacing: 4) {
            Image(systemName: "arrow.turn.down.right").font(.caption2)
            Image(systemName: mode.symbol).font(.caption2)
            Text(TimeFormat.duration(leg.minutes)).font(.caption2)
            Text("· \(distanceText(leg.distanceKm))").font(.caption2)
        }
        .foregroundStyle(.secondary)
        .padding(.leading, 48)
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
        .foregroundStyle(late ? Color.orange : Color.accentColor)
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
        case .completed: .green
        case .skipped, .cancelled: .secondary
        case .planned: .secondary
        }
    }
}
