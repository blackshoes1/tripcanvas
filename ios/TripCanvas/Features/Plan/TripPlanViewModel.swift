import Foundation
import Observation

/// 일정 편집 화면이 쓰는 하나의 창구.
///
/// 스스로 상태를 들지 않고 **둘에 나눠 맡긴다** — 문서 편집·저장·충돌·실행 취소는
/// `TripDocumentStore`, 날짜별 계산의 조회·캐시·선조회·재시도는 `DayPlanCache`다.
/// 여기가 직접 가진 것은 **화면이 고른 것**(보고 있는 날)과 이름표용 멤버뿐이다.
///
/// ⚠️ **`revision`은 문서가 소유한다.** 캐시는 사본을 들지 않고 `DayPlanContext`로 물어본다 —
/// 두 곳이 각자 들고 비교하기 시작하면 "어느 쪽이 지금인가"의 답이 갈린다.
@Observable
@MainActor
final class TripPlanViewModel: DayPlanContext {
    private let store: TripDocumentStore
    private let cache: DayPlanCache

    let tripId: String
    private let memberSource: MemberListing?
    private let candidateSource: CollabSource?

    /// 보고 있는 일자. 문서가 줄어들면 마지막 날로 당긴다.
    var selectedDay = 0 {
        didSet {
            if let document, selectedDay >= document.days.count { selectedDay = max(0, document.days.count - 1) }
            if selectedDay != oldValue { Task { await loadPlan(reuseFetched: true) } }
        }
    }

    /// 참여자 이름표를 만드는 데만 쓴다. 없으면 이름 대신 인원만 말한다.
    private(set) var members: [MemberView] = []

    /// - Parameters:
    ///   - initialDay: 처음 볼 날. **여행 목록이 이미 아는 값**(`TripSummary.todayIndex`)을 받는다 —
    ///     계산이 온 뒤에 옮기면 1일차를 보여 줬다가 오늘로 튄다.
    ///   - legRetryDelay: 경로가 채워지기를 기다리는 시간. 테스트는 짧게 준다.
    init(tripId: String, service: TripDocumentSource, memberSource: MemberListing? = nil, candidateSource: CollabSource? = nil,
         initialDay: Int = 0, legRetryDelay: TimeInterval = 3, loadsPlans: Bool = true) {
        self.tripId = tripId
        self.memberSource = memberSource
        self.candidateSource = candidateSource ?? (service as? CollabSource)
        self.store = TripDocumentStore(tripId: tripId, service: service)
        self.cache = DayPlanCache(tripId: tripId, service: service, legRetryDelay: legRetryDelay, loadsPlans: loadsPlans)
        self.selectedDay = max(0, initialDay)
        cache.context = self
        // 문서가 바뀌면 이 문서로 계산된 것은 하나도 없다 — 캐시를 버리는 판단은 여기 한 곳에서만 한다.
        store.onApplied = { [weak self] revisionChanged in
            guard let self else { return }
            if revisionChanged { self.cache.invalidate() }
            if self.selectedDay >= self.store.dayCount { self.selectedDay = max(0, self.store.dayCount - 1) }
        }
        // 저장 완료를 계산 대기에 묶지 않고, 현재 일자의 로딩도 다시 끝나게 한다.
        store.onSaved = { [weak self] in
            Task { [weak self] in await self?.loadPlan() }
        }
        // 이름표는 계산이 온 뒤에야 필요하다(분리 구간이 있는 날에만).
        cache.onDayPlanLoaded = { [weak self] in await self?.loadMembers() }
    }

    // MARK: DayPlanContext — 캐시가 "지금"을 묻는 창구

    var currentRevision: Int { store.revision }
    var currentDay: Int { selectedDay }
    var currentDayCount: Int { store.dayCount }

    // MARK: 문서 — 소유자는 store다

    var document: TripDocument? { store.document }
    var revision: Int { store.revision }
    var role: MemberRole { store.role }
    var isLoading: Bool { store.isLoading }
    var loadedAt: Date? { store.loadedAt }
    var isSaving: Bool { store.isSaving }
    var errorMessage: String? { store.errorMessage }
    var conflict: String? { store.conflict }
    var toast: String? { store.toast }
    var canEdit: Bool { store.canEdit }
    var canUndo: Bool { store.canUndo }
    var saveFailureMessage: String { store.saveFailureMessage }

    var day: TripDay? {
        guard let document, document.hasDay(selectedDay) else { return nil }
        return document.days[selectedDay]
    }

    var dayCount: Int { store.dayCount }

    // MARK: 계산 — 소유자는 cache다

    /// 보고 있는 날의 계산.
    var plan: DayPlanResponse? { cache.plan(for: selectedDay) }
    var planCachedAt: Date? { cache.cachedAt(for: selectedDay) }
    func planAttempted(for day: Int) -> Bool { cache.attempted(day) }
    func overviewPlan(_ day: Int) -> DayPlanResponse? { cache.plan(for: day) }
    var tripRoutes: TripRoutesResponse? { cache.tripRoutes }
    var isLoadingTripRoutes: Bool { cache.isLoadingTripRoutes }

    func loadOverview() async { await cache.loadOverview() }
    func loadTripRoutes() async { await cache.loadTripRoutes() }
    func loadPlan(reuseFetched: Bool = false) async { await cache.loadDay(reuseFetched: reuseFetched) }

    // MARK: 읽기 — 문서를 받고 그 다음에 계산을 받는다

    /// 탭에 들어올 때 부른다. 문서가 있고 방금 받은 것이면 아무것도 하지 않는다 — 탭을 오갈 때마다
    /// 문서·하루치를 다시 받으면 그때마다 로딩이 뜨고 고른 날이 튄다(2026-09-17).
    func loadIfStale(maxAge: TimeInterval = 60, now: Date = Date()) async {
        if document != nil, let loadedAt, now.timeIntervalSince(loadedAt) < maxAge { return }
        await load()
    }

    /// ⚠️ 문서 읽기가 **늦게 온 것으로 판정되면 계산을 받으러 가지 않는다** — 그 요청은
    /// 이미 지나간 화면의 것이라 지금 보는 날의 계산을 건드릴 자격이 없다.
    func load() async {
        guard await store.load() else { return }
        await loadPlan()
    }

    /// 충돌 뒤 "최신 불러오기". 방금 바꾼 것은 서버에 없으므로 사라진다 — 화면이 그렇게 말한 뒤에 부른다.
    func reloadFromServer() async {
        store.dismissConflict()
        await load()
    }

    func dismissConflict() { store.dismissConflict() }
    func clearToast() { store.clearToast() }

    /// 이름표와 '누가 가나요'에 쓸 멤버. **일행이 있는 여행에서만, 한 번만** 부른다 —
    /// 혼자 쓰는 여행에는 고를 사람도 이름표를 붙일 분리도 없다.
    /// **실패해도 조용하다**: 이름 대신 인원만 말할 뿐 일정은 그대로 보인다.
    ///
    /// ⚠️ 예전에는 `hasSplits`만 봤다. 그러면 이름표는 맞지만 **첫 분리를 만들 수가 없다** —
    ///    분리가 없는 날에는 멤버가 비어 있어 장소 편집기의 '누가 가나요'가 뜨지 않고,
    ///    그게 안 뜨니 분리도 영영 생기지 않는다. 그래서 `isShared`(인원 2명 이상)도 함께 본다.
    ///    혼자 쓰는 여행의 요청 수는 그대로 0이다.
    private func loadMembers() async {
        guard members.isEmpty, let memberSource else { return }
        guard hasSplits || (plan?.trip.isShared ?? false) else { return }
        members = (try? await memberSource.members(tripId: tripId)) ?? []
    }

    // MARK: 날 이동

    /// 앞/뒤 날로 옮긴다. 끝에서는 **아무 일도 하지 않는다** — 되감기지 않는다.
    /// 판정을 화면 밖에 두는 이유: 경계(첫 날·마지막 날)는 눈으로 확인하기 어렵다.
    @discardableResult
    func step(_ direction: DayStep) -> Bool {
        let next = selectedDay + direction.offset
        guard next >= 0, next < dayCount else { return false }
        selectedDay = next
        return true
    }

    enum DayStep {
        case previous, next
        var offset: Int { self == .next ? 1 : -1 }
    }

    // MARK: 계산에서 읽어 오는 표시값

    /// 일자 스트립. 계산을 못 받았으면 문서에서 최소한(번호·제목·장소 수)만 만든다 —
    /// ⚠️ 날짜는 넣지 않는다. `start + index`를 앱에서 더하면 규칙이 두 곳이 된다.
    var strip: [DayPlanStripEntry] {
        if let plan, plan.days.count == dayCount { return plan.days }
        return (0..<dayCount).map { i in
            DayPlanStripEntry(index: i, date: "", title: document?.days[i].title ?? "",
                              spotCount: document?.days[i].spots.count ?? 0)
        }
    }

    /// 보고 있는 날의 계산. **날이 다르면 nil이다** — 다른 날의 숙소 복귀·렌터카를 그리면
    /// 있지도 않은 일정이 화면에 생긴다.
    var planDay: DayPlanDay? {
        guard let plan, plan.day.index == selectedDay else { return nil }
        return plan.day
    }

    /// 그 장소의 서버 계산(예상 도착·구간). 보고 있는 날의 것이 아니면 nil이다.
    /// 문서와 계산이 어긋난 순간(막 추가·삭제한 직후)에는 조용히 nil로 떨어진다 —
    /// 그 상태에서 옛 시각을 그리면 없는 장소의 시각을 보여 주게 된다.
    func planSpot(at index: Int) -> DayPlanSpot? {
        guard let plan, plan.day.index == selectedDay, plan.day.spots.count == (day?.spots.count ?? -1) else {
            return nil
        }
        return plan.day.spots.indices.contains(index) ? plan.day.spots[index] : nil
    }

    // ── 함께 움직이지 않는 시간 (§25~§27) ─────────────────────────────────────
    //
    // ⚠️ 가르는 것은 서버(`splitSegments`)다. 여기서는 **받은 구조를 읽기만** 한다 —
    // 앱이 따로 가르면 타임라인과 그림이 어긋난다.

    /// 이 날에 함께 다니지 않는 구간이 있는가.
    var hasSplits: Bool { !(planDay?.splits.isEmpty ?? true) }

    /// 여행 전체에 장소가 하나도 없는가 — **방금 만든 여행**이라는 뜻이다.
    /// 그때는 "오른쪽 위 ＋를 누르세요"가 아니라 누를 것을 화면에 둔다.
    var tripIsEmpty: Bool {
        guard let days = plan?.days, !days.isEmpty else { return false }
        return days.allSatisfy { $0.spotCount == 0 }
    }

    /// 그 장소가 속한 가지. 분리 구간이 아니면 nil이다.
    func splitBranch(at index: Int) -> DayPlanSplitBranch? {
        guard let splits = planDay?.splits else { return nil }
        for split in splits where index >= split.from && index < split.to {
            return split.branches.first { $0.spotIndexes.contains(index) }
        }
        return nil
    }

    /// 가지에서 **처음** 나오는 장소인가. 참여자 이름표를 여기에만 붙여 줄이 반복되지 않게.
    func isBranchStart(at index: Int) -> Bool {
        splitBranch(at: index)?.spotIndexes.first == index
    }

    /// '모두' 또는 '나 · 지민'. 규칙은 `collab.js` 복사본(`CollabModel`)이 들고 있다.
    func participantsText(_ ids: [String]) -> String {
        guard !members.isEmpty else { return ids.isEmpty ? "모두" : "\(ids.count)명" }
        return CollabModel.whoText(ids, members: members)
    }

    /// 이 일정에 내가 들어 있는가. 지정이 없으면 모두이므로 참이다.
    func includesMe(_ ids: [String]) -> Bool {
        CollabModel.includesMe(ids, myId: members.first(where: { $0.me })?.userId)
    }

    /// 이동시간이 실측인지 추정인지. **그날 구간이 전부 조회됐을 때만** 실측이라고 말한다.
    var travelTimeIsEstimate: Bool { plan?.travelTimeSource != .routed }

    /// 오늘이 몇 일차인지. 여행 기간 밖이면 nil이다(서버가 -1로 준다).
    var todayIndex: Int? {
        guard let index = plan?.trip.todayIndex, index >= 0 else { return nil }
        return index
    }

    // MARK: 편집 — 전부 "문서를 고치고 저장한다" 한 갈래로 지나간다

    @discardableResult
    func savePreparedDocument(_ draft: TripDocument, expectedRevision: Int, message: String) async -> Bool {
        await store.savePreparedDocument(draft, expectedRevision: expectedRevision, message: message)
    }

    /// 직전 문서로 되돌리고, 그 과정에서 일정에서 빠진 후보의 날짜 표시도 되돌린다.
    /// ⚠️ **문서가 먼저다** — 문서를 되돌리지 못했으면 후보 표시는 건드리지 않는다.
    /// 표시만 실패한 경우에는 되돌린 문서를 그대로 두고 그 사실만 말한다.
    func undoLastChange() async {
        guard let undone = await store.undoLastChange() else { return }
        guard let candidateSource else { return }
        for (dayIndex, day) in undone.restored.days.enumerated() {
            for spot in day.spots {
                guard let id = spot.raw["candidateId"]?.intValue, !undone.replacedIDs.contains(id) else { continue }
                do { try await candidateSource.manageCandidate(tripId: tripId, candidateId: id, action: "SCHEDULE", value: String(dayIndex + 1)) }
                catch { store.report("일정은 되돌렸지만 가고 싶은 곳의 날짜 표시를 복구하지 못했어요. 후보 보드에서 해당 장소를 다시 확인해 주세요.") }
            }
        }
    }

    /// 편집 화면이 만든 장소를 그대로 넣는다. 이름만 있는 장소도 일정에 남는다(좌표는 나중에).
    @discardableResult
    func addSpot(_ spot: TripSpot, after index: Int? = nil) async -> Bool {
        guard !spot.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        return await store.edit("장소를 추가했어요") { $0.insertSpot(spot, dayIndex: self.selectedDay, after: index) }
    }

    @discardableResult
    func updateSpot(at index: Int, with spot: TripSpot) async -> Bool {
        return await store.edit(nil) { $0.updateSpot(dayIndex: self.selectedDay, at: index, with: spot) }
    }

    @discardableResult
    func removeSpot(at index: Int) async -> Bool {
        return await store.edit("장소를 뺐어요") { $0.removeSpot(dayIndex: self.selectedDay, at: index) }
    }

    func moveSpots(from source: IndexSet, to destination: Int) async {
        await store.edit(nil) { $0.moveSpots(dayIndex: self.selectedDay, from: source, to: destination) }
    }

    @discardableResult
    func moveSpot(at index: Int, toDay targetDay: Int, with spot: TripSpot? = nil) async -> Bool {
        if let spot, spot.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            store.report("장소 이름을 입력해 주세요.")
            return false
        }
        return await store.edit("Day \(targetDay + 1)로 옮겼어요") { document in
            if let spot { document.updateSpot(dayIndex: self.selectedDay, at: index, with: spot) }
            document.moveSpot(from: (day: self.selectedDay, index: index), toDay: targetDay)
        }
    }

    func setDayMode(_ mode: TravelMode) async {
        await store.edit(nil) { document in
            guard document.hasDay(self.selectedDay) else { return }
            var day = document.days[self.selectedDay]
            day.mode = mode
            var days = document.days
            days[self.selectedDay] = day
            document.days = days
        }
    }

    func setReturnMode(_ mode: TravelMode?, dayIndex: Int) async {
        await store.edit("숙소 복귀 이동수단을 저장했어요") { document in
            guard document.hasDay(dayIndex) else { return }
            var days = document.days
            days[dayIndex].returnMode = mode
            document.days = days
        }
    }

    func setDayTitle(_ title: String) async {
        await store.edit(nil) { document in
            guard document.hasDay(self.selectedDay) else { return }
            var day = document.days[self.selectedDay]
            day.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
            var days = document.days
            days[self.selectedDay] = day
            document.days = days
        }
    }

    // MARK: 예약 — 장소와 같은 문서라 같은 길로 저장된다

    var bookings: [TripBooking] { document?.bookings ?? [] }

    /// 예약을 넣거나 고친다. 검증(웹 `bkSave`와 같은 규칙)을 지나지 못하면 저장하지 않고 이유를 말한다.
    /// 돌려주는 값은 저장에 성공했는지다 — 화면은 이걸 보고 닫을지 정한다.
    @discardableResult
    func saveBooking(_ booking: TripBooking, links: BookingLinks = .empty) async -> Bool {
        if let problem = booking.validate() {
            store.report(problem.message)
            return false
        }
        let isNew = document?.booking(id: booking.id) == nil
        return await store.edit(isNew ? "예약을 추가했어요" : "예약을 저장했어요") { $0.upsertBooking(booking, links: links) }
    }

    /// 예약 추적을 뺀다. 실제 예약이 취소되지는 않는다 — 화면이 그렇게 말한 뒤에 부른다.
    @discardableResult
    func removeBooking(id: String) async -> Bool {
        return await store.edit("예약을 뺐어요") { $0.removeBooking(id: id) }
    }

    /// 예약이 아닌 결제 항목(보험·유심·입장권…) — 여행 단위 비용(`trip.costItems`). 고친 항목은 제자리에, 새 항목은 뒤에.
    @discardableResult
    func saveCostItem(_ entry: CostEntry) async -> Bool {
        let isNew = document?.costItems.contains { $0.id == entry.id } != true
        return await store.edit(isNew ? "결제 항목을 저장했어요 — 비용 화면의 예약 결제 금액에 있어요" : "결제 항목을 고쳤어요") { draft in
            var items = draft.costItems
            if let index = items.firstIndex(where: { $0.id == entry.id }) { items[index] = entry } else { items.append(entry) }
            draft.costItems = items
        }
    }

    @discardableResult
    func removeCostItem(id: String) async -> Bool {
        return await store.edit("결제 항목을 지웠어요") { draft in draft.costItems = draft.costItems.filter { $0.id != id } }
    }
}
