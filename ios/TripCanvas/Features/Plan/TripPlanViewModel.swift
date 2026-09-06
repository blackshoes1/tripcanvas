import Foundation
import Observation

/// 일정 편집 화면의 상태. 문서를 읽고, 고치고, **곧바로** 저장한다.
///
/// 왜 곧바로 저장하는가 — 저장 버튼을 두면 앱을 끄거나 다른 기기가 먼저 바꿨을 때 어느 쪽이
/// 맞는지 사람이 판단해야 한다. 한 번에 한 가지 변경만 올리면 충돌은 그 변경 하나로 좁아진다.
///
/// 충돌(다른 기기가 먼저 저장)은 **조용히 덮어쓰지 않는다**(§91). 방금 바꾼 것이 서버에 없다는
/// 사실을 그대로 말하고, 최신을 불러올지 사용자가 고른다.
@Observable
@MainActor
final class TripPlanViewModel {
    /// 지금 보고 있는 문서. 저장에 성공하면 서버가 돌려준 문서로 바뀐다.
    private(set) var document: TripDocument?
    private(set) var revision = 0
    private(set) var role: MemberRole = .owner
    private(set) var isLoading = false
    private(set) var isSaving = false
    private(set) var errorMessage: String?
    /// 다른 기기가 먼저 바꿨다. 화면은 이걸 보고 물어본다 — 자동으로 어느 쪽도 고르지 않는다.
    private(set) var conflict: String?
    private(set) var toast: String?

    /// 서버가 계산한 그 날의 흐름과 일자 스트립. 문서와 따로 온다 — 문서는 원문, 이건 계산이다.
    /// nil이면 아직 못 받았거나 실패한 것이다. **없어도 일정 편집은 그대로 된다.**
    private(set) var plan: DayPlanResponse?
    /// 계산이 마지막으로 받아진 시점(오프라인일 때만 값이 있다).
    private(set) var planCachedAt: Date?

    /// 보고 있는 일자. 문서가 줄어들면 마지막 날로 당긴다.
    var selectedDay = 0 {
        didSet {
            if let document, selectedDay >= document.days.count { selectedDay = max(0, document.days.count - 1) }
            if selectedDay != oldValue { Task { await loadPlan() } }
        }
    }

    let tripId: String
    private let service: TripDocumentSource
    /// 여행 중일 때 '오늘'로 한 번만 옮긴다.
    private var didJumpToToday = false

    init(tripId: String, service: TripDocumentSource) {
        self.tripId = tripId
        self.service = service
    }

    var canEdit: Bool { role.canEdit }

    var day: TripDay? {
        guard let document, document.hasDay(selectedDay) else { return nil }
        return document.days[selectedDay]
    }

    var dayCount: Int { document?.days.count ?? 0 }

    func load() async {
        if document == nil { isLoading = true }
        defer { isLoading = false }
        do {
            apply(try await service.document(tripId: tripId))
            errorMessage = nil
        } catch {
            errorMessage = message(for: error)
        }
        await loadPlan()
    }

    /// 서버 계산을 받아온다. **실패해도 조용하다** — 일정 편집은 문서만으로 되고,
    /// 계산이 없으면 화면이 시각·구간을 감출 뿐이다. 여기서 오류 배너를 띄우면
    /// 편집이 멀쩡한데 무언가 고장 난 것처럼 보인다.
    func loadPlan() async {
        guard dayCount > 0 else { plan = nil; return }
        let day = selectedDay
        do {
            let fetched = try await service.dayPlan(tripId: tripId, dayIndex: day)
            guard day == selectedDay else { return }   // 그 사이 다른 날로 옮겼으면 버린다
            plan = fetched.value
            planCachedAt = fetched.cachedAt
            jumpToTodayOnce()
        } catch {
            plan = nil
            planCachedAt = nil
        }
    }

    /// 여행 중이면 오늘부터 본다 — 14일짜리 일정에서 1일차부터 스크롤하게 두지 않는다.
    /// **한 번만** 옮긴다. 사용자가 고른 날을 나중에 되돌리면 안 된다.
    private func jumpToTodayOnce() {
        guard !didJumpToToday else { return }
        didJumpToToday = true
        guard let today = todayIndex, today != selectedDay, document?.hasDay(today) == true else { return }
        selectedDay = today
    }

    /// 일자 스트립. 계산을 못 받았으면 문서에서 최소한(번호·제목·장소 수)만 만든다 —
    /// ⚠️ 날짜는 넣지 않는다. `start + index`를 앱에서 더하면 규칙이 두 곳이 된다.
    var strip: [DayPlanStripEntry] {
        if let plan, plan.days.count == dayCount { return plan.days }
        return (0..<dayCount).map { i in
            DayPlanStripEntry(index: i, date: "", title: document?.days[i].title ?? "",
                              spotCount: document?.days[i].spots.count ?? 0)
        }
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

    /// 이동시간이 실측인지 추정인지. 서버에 구간 캐시가 없어 지금은 늘 추정이다.
    var travelTimeIsEstimate: Bool { plan?.travelTimeSource != .routed }

    /// 오늘이 몇 일차인지. 여행 기간 밖이면 nil이다(서버가 -1로 준다).
    var todayIndex: Int? {
        guard let index = plan?.trip.todayIndex, index >= 0 else { return nil }
        return index
    }

    /// 충돌 뒤 "최신 불러오기". 방금 바꾼 것은 서버에 없으므로 사라진다 — 화면이 그렇게 말한 뒤에 부른다.
    func reloadFromServer() async {
        conflict = nil
        await load()
    }

    func dismissConflict() { conflict = nil }
    func clearToast() { toast = nil }

    // MARK: 편집 — 전부 "문서를 고치고 저장한다" 한 갈래로 지나간다

    /// 편집 화면이 만든 장소를 그대로 넣는다. 이름만 있는 장소도 일정에 남는다(좌표는 나중에).
    func addSpot(_ spot: TripSpot, after index: Int? = nil) async {
        guard !spot.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        await edit("장소를 추가했어요") { $0.insertSpot(spot, dayIndex: self.selectedDay, after: index) }
    }

    func updateSpot(at index: Int, with spot: TripSpot) async {
        await edit(nil) { $0.updateSpot(dayIndex: self.selectedDay, at: index, with: spot) }
    }

    func removeSpot(at index: Int) async {
        await edit("장소를 뺐어요") { $0.removeSpot(dayIndex: self.selectedDay, at: index) }
    }

    func moveSpots(from source: IndexSet, to destination: Int) async {
        await edit(nil) { $0.moveSpots(dayIndex: self.selectedDay, from: source, to: destination) }
    }

    func moveSpot(at index: Int, toDay targetDay: Int) async {
        await edit("Day \(targetDay + 1)로 옮겼어요") { $0.moveSpot(from: (day: self.selectedDay, index: index), toDay: targetDay) }
    }

    func setDayMode(_ mode: TravelMode) async {
        await edit(nil) { document in
            guard document.hasDay(self.selectedDay) else { return }
            var day = document.days[self.selectedDay]
            day.mode = mode
            var days = document.days
            days[self.selectedDay] = day
            document.days = days
        }
    }

    func setDayTitle(_ title: String) async {
        await edit(nil) { document in
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
    /// 돌려주는 값은 저장 요청이 나갔는지다 — 화면은 이걸 보고 닫을지 정한다.
    @discardableResult
    func saveBooking(_ booking: TripBooking, links: BookingLinks = .empty) async -> Bool {
        if let problem = booking.validate() {
            errorMessage = problem.message
            return false
        }
        let isNew = document?.booking(id: booking.id) == nil
        await edit(isNew ? "예약을 추가했어요" : "예약을 저장했어요") { $0.upsertBooking(booking, links: links) }
        return true
    }

    /// 예약 추적을 뺀다. 실제 예약이 취소되지는 않는다 — 화면이 그렇게 말한 뒤에 부른다.
    func removeBooking(id: String) async {
        await edit("예약을 뺐어요") { $0.removeBooking(id: id) }
    }

    /// 고치고 → 화면에 먼저 반영하고 → 저장한다. 실패하면 **서버가 아는 상태로 되돌린다** —
    /// 저장되지 않은 것이 저장된 것처럼 남아 있으면 다음 편집이 그 위에 쌓인다.
    private func edit(_ successToast: String?, _ change: (inout TripDocument) -> Void) async {
        guard canEdit, let current = document else { return }
        var edited = current
        change(&edited)
        guard edited != current else { return }

        document = edited
        isSaving = true
        defer { isSaving = false }
        do {
            apply(try await service.saveDocument(tripId: tripId, document: edited, expectedRevision: revision))
            errorMessage = nil
            toast = successToast
        } catch let error as APIError {
            document = current
            if case .revisionConflict(let message, _) = error {
                conflict = message
            } else {
                errorMessage = message(for: error)
            }
        } catch {
            document = current
            errorMessage = message(for: error)
        }
    }

    private func apply(_ snapshot: TripDocumentSnapshot) {
        document = snapshot.document
        revision = snapshot.revision
        role = snapshot.role
        if selectedDay >= snapshot.document.days.count { selectedDay = max(0, snapshot.document.days.count - 1) }
    }

    private func message(for error: Error) -> String {
        (error as? APIError)?.errorDescription ?? error.localizedDescription
    }
}
