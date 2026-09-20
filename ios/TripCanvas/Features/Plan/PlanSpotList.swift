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
                    if day.spots.isEmpty { emptyDay }
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
                                split: splitInfo(at: index))
                        }
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
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
                    ForEach(model.planDay?.carReturns ?? [], id: \.bookingId) { carEventRow($0) }
                    if let back = model.planDay?.back { backRow(back) }
                    if model.canEdit && !day.spots.isEmpty && !isEditing {
                        // 왼쪽 정렬 텍스트 동작(시안). 검색이 먼저다 — 좌표가 있어야 동선·ETA·지도에 들어간다.
                        Menu {
                            Button { actions.addAfter(nil) } label: { Label("검색해서 담기", systemImage: "magnifyingglass") }
                            Button { actions.createSpot() } label: { Label("직접 입력", systemImage: "square.and.pencil") }
                        } label: {
                            Label("장소 추가", systemImage: "plus")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(Ink.accent)
                                .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                } header: {
                    // 기본 화면은 제목·이동·비용·종료 시각까지다. 나머지(거리·미정·예산·안내)는 '오늘 요약 보기' 안에 —
                    // 일정이 요약보다 중요하고, 첫 화면에 첫 장소가 보여야 한다(2026-09-18).
                    VStack(alignment: .leading, spacing: Space.xs) {
                        dayHeader(day)
                        if model.plan == nil && !model.planAttempted(for: model.selectedDay) {
                            ProgressView("이동·도착 시각을 계산하는 중").font(.caption)
                        }
                        if let totals = model.planDay?.totals { daySummary(totals) }
                        costRow(day)
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
                        if summaryExpanded { dayDetails(day) }
                        Divider().padding(.top, Space.xs)
                        spotsSectionHeader(day)
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
            .listStyle(.plain)
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

    /// 하루 제목 — `마드리드 도착 · 1박`. 승인 시안의 첫 줄이다.
    /// ⚠️ 이동수단 바꾸기는 **접힌 요약 안으로** 옮겼다(시안 헤더에는 제목만 있다). 기능은 그대로다.
    private func dayHeader(_ day: TripDay) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Space.s) {
            Text(dayTitleText(day))
                .font(.title2.weight(.bold))
                .foregroundStyle(Ink.ink)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: Space.s)
            if model.isSaving { ProgressView().controlSize(.mini) }
        }
        .textCase(nil)
    }

    /// `마드리드 도착 · 1박`. **숙박은 문서에 있을 때만** 붙인다 — 없는 밤을 지어내지 않는다.
    private func dayTitleText(_ day: TripDay) -> String {
        let base = day.title.isEmpty ? "\(model.selectedDay + 1)일차" : day.title
        let nights = day.spots.compactMap { $0.isStay ? $0.nights : nil }.max() ?? 0
        return nights > 0 ? "\(base) · \(nights)박" : base
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
                .foregroundStyle(.secondary)
            if model.canEdit {
                // 방금 만든 여행이면 **누를 것을 화면에 둔다.** 처음 온 사람에게
                // "오른쪽 위 ＋를 누르세요"는 한 번 더 찾게 만드는 말이다.
                if model.tripIsEmpty {
                    Text("어디부터 가볼까요?").font(.subheadline.weight(.semibold))
                    Button { actions.addAfter(nil) } label: {
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
        HStack(spacing: Space.xs) {
            if let line = Self.summaryLine(totals) {
                Text(line)
                    .font(.subheadline)
                    // 늦게 끝나는 것 자체는 문제가 아니다 — 자정을 넘길 때(과밀)만 주의색이다.
                    .foregroundStyle(totals.overloaded ? Ink.warning : Ink.soft)
                    .fixedSize(horizontal: false, vertical: true)
            }
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
