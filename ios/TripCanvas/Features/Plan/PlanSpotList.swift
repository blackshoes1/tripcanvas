import SwiftUI

/// 하루치 일정 목록 — 장소 줄·머리글·요약·이월/복귀/렌터카 표시·날짜 스와이프.
///
/// ⚠️ **목록에서만 쓰는 상태는 여기가 소유한다**(요약 펼침·스와이프 방향 판정).
/// 밖으로 나가는 일(시트 열기·문서 고치기·날 바꾸기)은 전부 `actions`를 지난다 —
/// 조각이 시트 상태를 들면 같은 시트가 두 곳에서 열린다.
///
/// ⚠️ 계산이 오기 전에 목록을 **반쯤 지어 보이지 않는다**(`planAttempted`). 계산에 딸린 것이 많아
/// 문서만으로 먼저 그렸다가 계산이 들어오면 줄이 통째로 밀린다(2026-09-07 '화면이 튄다' 보고).
struct PlanSpotList: View {
    let trip: TripSummary
    let model: TripPlanViewModel
    let motion: Animation
    /// 다음 날로 가는 중인가 — 들어오고 나가는 방향을 정한다. **쓰는 것은 부모다**(칩과 스와이프 둘 다 바꾼다).
    let goingForward: Bool
    let actions: PlanActions
    /// 여러 장소 고르기. 툴바가 켜고 끄므로 소유자는 부모다.
    @Binding var choosingPlaces: Bool
    @Binding var chosenPlaces: Set<Int>

    /// 상단 요약을 펼쳤는가. 기본은 접힘 — 기본 화면에서는 일정이 요약보다 중요하다.
    @State private var summaryExpanded = false
    /// 종료 콜백까지 방향을 보존한다. GestureState만 쓰면 onEnded 전에 초기화될 수 있다.
    @State private var daySwipeIntent = PlanDaySwipeIntent()
    @GestureState private var isSwipingDay = false
    /// 전환 방향을 쓸지 말지. **상태가 아니라 환경 읽기다** — 부모와 값이 갈릴 일이 없다.
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.editMode) private var editMode
    private var isEditing: Bool { editMode?.wrappedValue.isEditing == true }

    var body: some View { list }

    @ViewBuilder
    private var list: some View {
        if let day = model.day {
            // 저장된 문서는 계속 보인다. 계산 응답을 기다리며 목록 전체를 교체하지 않는다.
            List {
                Section {
                    // 하루 머리는 카드가 아니라 **종이 위의 제목**이다 — 카드 안의 카드가 되지 않게(2026-09-27 시안).
                    summaryCard(day)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 0, leading: Space.xs, bottom: 0, trailing: Space.xs))
                }
                Section {
                    // 헤더도 일반 행이다. 스크롤 중 장소 위로 고정되어 겹치지 않는다.
                    spotsSectionHeader(day)
                        .listRowSeparator(.visible, edges: .bottom)
                        .deleteDisabled(true)
                        .moveDisabled(true)
                    if day.spots.isEmpty { emptyDay }
                    let rail = railEdges(day)
                    // 🏠 전날 숙소 이월 · 렌터카 픽업은 장소 목록 **앞**에 온다.
                    // ⚠️ ForEach 밖에 둔다 — 드래그 인덱스는 ForEach의 컬렉션 기준이라
                    //    이 줄들이 그 안에 섞이면 순서가 어긋난다.
                    if let flight = model.planDay?.flight, !flight.line.isEmpty {
                        flightRow(flight, top: false, bottom: !isEditing && rail.afterFlight)
                    }
                    if let carry = model.planDay?.carriedStay {
                        carryRow(carry, top: !isEditing && rail.beforeCarry, bottom: !isEditing && rail.afterCarry)
                    }
                    ForEach(model.planDay?.carPickups ?? [], id: \.bookingId) {
                        carEventRow($0, top: !isEditing && rail.beforePickups, bottom: !isEditing)
                    }
                    ForEach(Array(day.spots.enumerated()), id: \.offset) { index, spot in
                        HStack {
                            if choosingPlaces {
                                Image(systemName: chosenPlaces.contains(index) ? "checkmark.circle.fill" : "circle")
                            }
                            SpotRow(spot: spot, dayMode: day.mode, plan: model.planSpot(at: index),
                                    split: splitInfo(at: index),
                                    railTop: !isEditing && (index > 0 || rail.beforeSpots),
                                    railBottom: !isEditing && (index < day.spots.count - 1 || rail.afterSpots))
                        }
                            .listRowBackground(Ink.raised)
                            .listRowSeparator(.hidden)
                            .listRowInsets(PlanRail.railRowInsets)
                            // 12pt 이상 움직인 터치는 탭을 취소한다. 짧게 끌다 놓아도 편집을 열지 않는다.
                            .overlay(PlanSpotTapSurface { actions.editSpot(index, spot) })
                            .accessibilityElement(children: .combine)
                            .accessibilityAddTraits(.isButton)
                            .accessibilityAction { actions.editSpot(index, spot) }
                            .contextMenu {
                                if model.canEdit {
                                    Button("여기에 추가 · 이 장소 뒤") { actions.addAfter(index) }
                                    Button("날짜·위치 옮기기") { actions.moveSpots([index]) }
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
                    ForEach(model.planDay?.carReturns ?? [], id: \.bookingId) {
                        carEventRow($0, top: !isEditing, bottom: !isEditing && model.planDay?.back != nil)
                    }
                    // 숙소 복귀는 같은 줄기의 끝이다 — 따로 떨어진 카드가 아니라 선이 닿는 마지막 자리.
                    if let back = model.planDay?.back { backRow(back) }
                } footer: {
                    if model.documentCachedAt != nil {
                        Text("연결되면 최신 일정을 불러와 편집할 수 있어요.")
                    } else if !model.canEdit {
                        Text("보기 권한이라 일정을 바꿀 수 없어요. 주최자에게 요청하세요.")
                    }
                    // 나란한 가지를 열로 쪼개지 않는다(드래그 인덱스가 어긋난다) —
                    // 대신 줄마다 표시를 붙이고, 하루 단위로 한 번 설명한다.
                    if model.hasSplits {
                        Text("이 날은 일부 시간을 따로 보내요 — 표시된 구간은 함께 다니지 않아요.")
                    }
                    // 계산이 없는 상태와 정상인 상태가 화면에서 구분되지 않으면,
                    // 서버가 아직 준비 안 된 것을 아무도 모른다(2026-09-06에 그랬다).
                    // 시도해 보고 못 받았을 때만 말한다 — 기다리는 중에 실패했다고 하지 않는다.
                    if model.plan == nil, model.planAttempted(for: model.selectedDay), !day.spots.isEmpty {
                        Label(model.documentCachedAt != nil ? "저장된 장소와 메모를 보고 있어요. 이동·도착 시각은 연결되면 확인할 수 있어요." : "예상 도착 시각을 불러오지 못했어요 — 일정 편집은 그대로 돼요.",
                              systemImage: "clock.badge.exclamationmark")
                    }
                }
                .listRowBackground(Ink.raised)
                // ① 장소 추가는 **목록 맨 아래 한 곳**이다 — 빈 날에도 같은 자리에 있다(2026-09-27 시안).
                //    누르면 방법(검색·직접 입력)을 고른다. 검색이 먼저다 — 좌표가 있어야 동선·ETA·지도에 들어간다.
                if model.canEdit && !isEditing && !choosingPlaces {
                    Section {
                        Button { actions.addAfter(nil) } label: {
                            Label("장소 추가", systemImage: "plus")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(Ink.accent)
                                .frame(maxWidth: .infinity, minHeight: 54)
                                .background(Ink.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: Radius.card))
                                .overlay(RoundedRectangle(cornerRadius: Radius.card)
                                    .strokeBorder(Ink.accent.opacity(0.4), style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(Space.l)
            .contentMargins(.horizontal, Space.l, for: .scrollContent)
            .contentMargins(.top, Space.s, for: .scrollContent)
            .paperGround()
            .refreshable { await model.load() }
            // 날이 바뀌면 **새 화면**이다 — 그래야 밀려 나가고 들어오는 것이 보인다.
            .id(model.selectedDay)
            .transition(daySlide)
            // 가로 의도로 확정한 동안만 세로 이동을 멈춘다. 편집 모드의 재정렬은 그대로다.
            .scrollDisabled(!isEditing && daySwipeIntent.axis == .horizontal)
            .simultaneousGesture(daySwipe, including: isEditing ? .subviews : .all)
            .onChange(of: isSwipingDay) { _, active in
                // 시스템이 취소한 드래그도 방향 잠금을 남기지 않는다.
                if !active { daySwipeIntent = PlanDaySwipeIntent() }
            }
        } else {
            EmptyStateView(symbol: "calendar", title: "일자가 없어요", message: "웹에서 일자를 먼저 만들어 주세요.")
        }
    }

    /// 요약은 스크롤되는 독립 카드다. 방문 일정과 같은 고정 헤더에 넣지 않는다.
    private func summaryCard(_ day: TripDay) -> some View {
        VStack(alignment: .leading, spacing: Space.s) {
            dayHeader(day)
            if model.plan == nil && !model.planAttempted(for: model.selectedDay) {
                ProgressView("이동·도착 시각을 계산하는 중").font(.caption)
            }
            if let totals = model.planDay?.totals { Self.daySummary(totals) }
            costRow(day)
            Button {
                withAnimation(motion) { summaryExpanded.toggle() }
            } label: {
                HStack(spacing: Space.xs) {
                    Text(summaryExpanded ? "요약 접기" : "요약 보기")
                    Image(systemName: "chevron.right")
                        .rotationEffect(.degrees(summaryExpanded ? 90 : 0))
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(Ink.accent)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(summaryExpanded ? [.isSelected] : [])
            if summaryExpanded {
                // 숙박 상태도 여기 — 기본 화면은 제목·이동·비용 세 줄이다(첫 장소가 요약보다 위에 보여야 한다).
                lodgingSummary
                dayDetails(day)
            }
        }
        .padding(.vertical, Space.xs)
    }

    /// 세로로 읽기 시작한 손은 나중에 비스듬해져도 날짜를 바꾸지 않는다.
    private var daySwipe: some Gesture {
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
                actions.selectDay(target, target > model.selectedDay)
            }
    }

    /// 넘어가는 느낌. ⚠️ '동작 줄이기'를 켠 사람에게는 밀지 않는다 — 그 설정은 취향이 아니라 필요다.
    private var daySlide: AnyTransition {
        guard !reduceMotion else { return .opacity }
        return .asymmetric(
            insertion: .move(edge: goingForward ? .trailing : .leading).combined(with: .opacity),
            removal: .move(edge: goingForward ? .leading : .trailing).combined(with: .opacity))
    }

    /// 하루 제목. 숙박 상태는 별도 줄에서 표시한다.
    /// ⚠️ 이동수단 바꾸기는 **접힌 요약 안으로** 옮겼다(시안 헤더에는 제목만 있다). 기능은 그대로다.
    private func dayHeader(_ day: TripDay) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Space.s) {
            Text(dayTitleText(day))
                .font(Typeface.editorial(.title))
                .foregroundStyle(Ink.ink)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: Space.s)
            if model.isSaving { ProgressView().controlSize(.mini) }
        }
        .textCase(nil)
    }

    private func dayTitleText(_ day: TripDay) -> String {
        day.title.isEmpty ? "Day \(model.selectedDay + 1)" : day.title
    }

    @ViewBuilder
    private var lodgingSummary: some View {
        if let lodging = model.planDay?.lodging {
            if lodging.isEmpty {
                Label("숙박 정보 없음", systemImage: "bed.double")
                    .font(.subheadline).foregroundStyle(Ink.soft)
            } else {
                ForEach(lodging) { item in
                    Label {
                        Text("\(item.name) · \(item.detail)")
                            .fixedSize(horizontal: false, vertical: true)
                    } icon: {
                        Image(systemName: item.state == "CONFLICT" ? "exclamationmark.circle" : "bed.double")
                    }
                    .font(.subheadline)
                    .foregroundStyle(item.state == "CONFLICT" ? Ink.warning : Ink.soft)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    /// 그 장소가 분리 구간에 속하는지와, 거기에 누가 있는지.
    /// ⚠️ 가르는 것은 서버다 — 여기서는 받은 구조를 읽어 넘기기만 한다.
    private func splitInfo(at index: Int) -> SpotRow.SplitInfo? {
        guard let branch = model.splitBranch(at: index) else { return nil }
        return SpotRow.SplitInfo(
            whoText: model.participantsText(branch.participants),
            includesMe: model.includesMe(branch.participants),
            isBranchStart: model.isBranchStart(at: index))
    }

    /// 빈 날. "장소가 없어요"로 끝내지 않는다 — 이미 담아 둔 후보에서 가져올 수 있다.
    @ViewBuilder
    private var emptyDay: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            Text(model.canEdit ? "아직 장소가 없어요." : "이 날에는 장소가 없어요.")
                .font(.subheadline)
                .foregroundStyle(Ink.soft)
            if model.canEdit {
                // **누를 것을 화면에 둔다** — 빈 날이면 여행이 비었든 아니든 같다.
                // (예전 문구 "오른쪽 위 ＋"는 실제로는 ⋯ 메뉴라 없는 버튼을 가리켰다 — 2026-09-27 UX 검토)
                if model.tripIsEmpty {
                    Text("어디부터 가볼까요?").font(.subheadline.weight(.semibold))
                }
                // 처음 만든 여행이면 이게 이 화면의 주 동작이다. 아니면 아래 '장소 추가'가 있으니 가볍게 둔다.
                if model.tripIsEmpty {
                    Button { actions.searchSpot() } label: {
                        Label("장소 검색해서 담기", systemImage: "magnifyingglass")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .prominentButton()
                } else {
                    Button { actions.searchSpot() } label: {
                        Label("장소 검색해서 담기", systemImage: "magnifyingglass")
                            .font(.subheadline.weight(.semibold))
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Ink.accent)
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
    static func daySummary(_ totals: DayPlanTotals) -> some View {
        if let line = summaryLine(totals) {
            // 요약의 핵심은 시간 문구다. 자동 Label 스타일·배치 후보에 맡기지 않고
            // 좁은 카드와 큰 글씨에서도 텍스트 높이를 확보한다.
            Text(line)
                .font(.subheadline)
                .foregroundStyle(totals.overloaded ? Ink.warning : Ink.soft)
                .lineLimit(nil)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// `이동 2시간 27분 · 종료 15:56`. 둘 다 없으면 nil — 빈 줄을 만들지 않는다.
    ///
    /// ⚠️ **비용은 여기 없다.** 승인 시안에서 비용은 오른쪽에 금액이 서는 제 줄로 빠졌다(`costRow`).
    /// ⚠️ 거리는 접힌 요약에만 있다 — 첫 화면에 첫 장소가 보여야 한다.
    static func summaryLine(_ totals: DayPlanTotals) -> String? {
        var parts: [String] = []
        if totals.travelMinutes > 0 { parts.append("이동 \(TimeFormat.duration(totals.travelMinutes))") }
        if let end = totals.endMinutes { parts.append("종료 \(TimeFormat.clockAcrossMidnight(end))") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// `오늘 예상 비용        ₩458,380 ›` — 눌러서 그 날의 비용 화면으로.
    ///
    /// ⚠️ **계산 전·실패·금액 미정을 확정값처럼 말하지 않는다.** 금액이 없으면 `₩0`으로 꾸미지 않고
    /// '아직 없음'이라고 말한다 — 0원인 하루와 모르는 하루는 다른 상태다.
    @ViewBuilder
    private func costRow(_ day: TripDay) -> some View {
        let cost = model.planDay?.totals.cost
        Button {
            actions.openCosts(model.selectedDay, model.revision)
        } label: {
            HStack(spacing: Space.s) {
                Text("오늘 예상 비용").font(.subheadline).foregroundStyle(Ink.ink)
                Spacer(minLength: Space.s)
                if let cost, cost.total > 0 {
                    Text(TimeFormat.money(cost.total, currency: "KRW"))
                        .font(.subheadline.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(Ink.ink)
                } else if model.plan == nil && !model.planAttempted(for: model.selectedDay) {
                    Text("계산 중").font(.subheadline).foregroundStyle(Ink.soft)
                } else {
                    Text("아직 없음").font(.subheadline).foregroundStyle(Ink.soft)
                }
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Ink.faint)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("하루 예산과 비용 내역 열기")
    }

    /// `방문 일정` · `순서 편집`. **편집 상태는 화면의 것 하나뿐이다** — 여기서 새로 만들지 않고
    /// 툴바와 같은 `editMode`를 토글한다.
    private func spotsSectionHeader(_ day: TripDay) -> some View {
        HStack(spacing: Space.s) {
            Text("방문 일정").font(.headline).foregroundStyle(Ink.ink)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: Space.s)
            if model.canEdit, !day.spots.isEmpty {
                Button {
                    withAnimation { editMode?.wrappedValue = isEditing ? .inactive : .active }
                } label: {
                    Text(isEditing ? "완료" : "순서 편집")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Ink.accent)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .textCase(nil)
    }

    /// 접어 둔 요약 — 총 이동거리 · 머무는 시간 미정 · 예약할 곳 · 하루 예산과 비용 안내. 펼쳤을 때만 보인다.
    @ViewBuilder
    private func dayDetails(_ day: TripDay) -> some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            // 하루 기본 이동수단 — 시안 헤더에서 뺐으므로 **여기가 그 진입점이다.**
            if model.canEdit {
                Picker(selection: Binding(get: { day.mode }, set: { mode in Task { await model.setDayMode(mode) } })) {
                    ForEach(TravelMode.allCases, id: \.self) { mode in
                        Label(mode.label, systemImage: mode.symbol).tag(mode)
                    }
                } label: {
                    Label("하루 기본 이동수단", systemImage: day.mode.symbol)
                }
                .pickerStyle(.menu)
                .font(.caption)
            } else {
                Label(day.mode.label, systemImage: day.mode.symbol).font(.caption).foregroundStyle(Ink.soft)
            }
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
                        Button(spot.name) { actions.editSpot(index, spot) }
                    }
                }
                .font(.caption.weight(.semibold))
            }
            Button {
                actions.openCosts(model.selectedDay, model.revision)
            } label: { DayCostSummaryView(day: day, cost: model.planDay?.totals.cost) }
            .buttonStyle(.plain)
            .accessibilityHint("하루 예산과 비용 내역 열기")
        }
        .padding(.top, Space.xs)
    }

    /// 그날의 항공편. 공항 이동일에 편명·공항·시각을 말한다.
    ///
    /// ⚠️ 렌터카 픽업·반납과 같은 자리에 있는 이유가 같다 — **좌표가 없어 동선·ETA에 들어가지 않는다.**
    ///    시각도 ETA 칸이 아니라 이 줄 안에 있다: 그날 계산된 도착 순서에 속하지 않는다.
    /// ⚠️ `ForEach` 밖에 둔다 — 드래그 인덱스가 어긋난다(위 주석과 같은 이유).
    private func flightRow(_ flight: DayPlanFlight, top: Bool, bottom: Bool) -> some View {
        PlanRailEventRow(symbol: "airplane", title: flight.line, subtitle: "항공편", railTop: top, railBottom: bottom)
            .listRowBackground(Ink.raised)
            .listRowSeparator(.hidden)
            .listRowInsets(PlanRail.railRowInsets)
            .accessibilityLabel("항공편 \(flight.line)")
    }

    /// 🏠 전날 숙소에서 이어지는 날. **표시일 뿐**이고 이 항목은 그날 일정이 아니다.
    private func carryRow(_ carry: DayPlanCarriedStay, top: Bool, bottom: Bool) -> some View {
        PlanRailEventRow(symbol: "house.fill", style: .home, title: carry.name, subtitle: "전날 숙소에서 출발",
                         railTop: top, railBottom: bottom)
            .listRowBackground(Ink.raised)
            .listRowSeparator(.hidden)
            .listRowInsets(PlanRail.railRowInsets)
    }

    /// 자동으로 이어 붙인 숙소 복귀. 일정에 저장된 장소가 아니라는 것을 밝힌다('자동으로 이어 붙였어요').
    /// 시각 칸에는 하루가 끝나는 시각이 선다. 복귀 수단은 줄 끝의 ⋯에서 고른다.
    /// ⚠️ 일정의 마지막 날에는 서버가 이걸 주지 않는다 — 떠나는 날이다.
    /// ⚠️ 장소 `ForEach` **밖**이다 — 드래그 인덱스에 섞이지 않는다.
    private func backRow(_ back: DayPlanBack) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            PlanRailLeg(mode: TravelMode(rawValue: back.leg.mode) ?? model.day?.mode ?? .walk,
                        minutes: back.leg.minutes, distanceKm: back.leg.distanceKm, rail: !isEditing,
                        walkInstead: back.leg.walkInstead == true)
            PlanRailEventRow(symbol: "house.fill", style: .home, title: "숙소로 돌아가기",
                             subtitle: "\(back.name) · 자동으로 이어 붙였어요",
                             time: model.planDay?.totals.endMinutes.map(TimeFormat.clockAcrossMidnight),
                             railTop: !isEditing, railBottom: false) {
                if model.canEdit {
                    Menu {
                        Picker("복귀 이동수단", selection: Binding<TravelMode?>(
                            get: { model.day?.returnMode },
                            set: { mode in
                                let dayIndex = model.selectedDay
                                Task { await model.setReturnMode(mode, dayIndex: dayIndex) }
                            })) {
                            Text("그날 기본 수단 따르기").tag(TravelMode?.none)
                            ForEach(TravelMode.allCases, id: \.self) { mode in
                                Label(mode.label, systemImage: mode.symbol).tag(TravelMode?.some(mode))
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis").foregroundStyle(Ink.soft).frame(width: 44, height: 44)
                    }
                    .disabled(model.isSaving)
                    .accessibilityLabel("복귀 이동수단")
                }
            }
        }
        .listRowBackground(Ink.raised)
        .listRowSeparator(.hidden)
        .listRowInsets(PlanRail.railRowInsets)
        .deleteDisabled(true)
        .moveDisabled(true)
    }

    /// 렌터카 픽업·반납. ⚠️ **좌표가 없어 동선·ETA·지도에 들어가지 않는다** — 표시만 한다.
    /// 그래서 시각을 ETA 칸이 아니라 부제목에 둔다(그날 계산된 도착 순서에 속하지 않는다).
    private func carEventRow(_ event: DayPlanCarEvent, top: Bool, bottom: Bool) -> some View {
        let kind = event.kind == .pickup ? "렌터카 픽업" : "렌터카 반납"
        return PlanRailEventRow(symbol: "car.fill", title: event.place.isEmpty ? kind : event.place,
                                subtitle: [kind, event.atMinutes.map(TimeFormat.clock)].compactMap { $0 }.joined(separator: " · "),
                                railTop: top, railBottom: bottom)
            .listRowBackground(Ink.raised)
            .listRowSeparator(.hidden)
            .listRowInsets(PlanRail.railRowInsets)
    }

    /// 선이 어디서 시작하고 끝나는지 — 하루의 첫 줄 위와 끝 줄 아래는 비운다.
    /// ⚠️ 순서 편집 중에는 선을 그리지 않는다 — 장소 줄만 삭제 버튼만큼 오른쪽으로 밀려 선이 옆으로 꺾였다
    ///    (2026-09-27 시뮬레이터에서 확인). 편집 중에는 순서만 보이면 된다.
    /// 순서는 목록과 같다: 항공편 → 전날 숙소 → 렌터카 픽업 → 장소들 → 렌터카 반납 → 숙소 복귀.
    private func railEdges(_ day: TripDay) -> (afterFlight: Bool, beforeCarry: Bool, afterCarry: Bool,
                                              beforePickups: Bool, beforeSpots: Bool, afterSpots: Bool) {
        let flight = (model.planDay?.flight.map { !$0.line.isEmpty }) ?? false
        let carry = model.planDay?.carriedStay != nil
        let pickups = !(model.planDay?.carPickups ?? []).isEmpty
        let spots = !day.spots.isEmpty
        let returns = !(model.planDay?.carReturns ?? []).isEmpty
        let back = model.planDay?.back != nil
        return (afterFlight: carry || pickups || spots || returns || back,
                beforeCarry: flight,
                afterCarry: pickups || spots || returns || back,
                beforePickups: flight || carry,
                beforeSpots: flight || carry || pickups,
                afterSpots: returns || back)
    }
}

/// 항공편 한 줄 표기. **계약(`Contract.swift`)이 아니라 여기 있다** — 그 파일은 위젯·공유·워치 확장도
/// 함께 컴파일하는데 그쪽에는 `TimeFormat`이 없다. 값은 계약이, 표기는 화면이 안다.
extension DayPlanFlight {
    /// 웹 `flightHtml`과 같은 짜임(`편명 · 출발 시각 → 도착 시각`). 없는 조각은 빼고 잇는다.
    /// 아무 조각도 없으면 빈 문자열이고, 그때 화면은 줄을 그리지 않는다.
    var line: String {
        let from = [dep, depMinutes.map(TimeFormat.clock)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        let to = [arr, arrMinutes.map(TimeFormat.clock)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        let route = [from, to].filter { !$0.isEmpty }.joined(separator: " → ")
        return [code, route].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}
