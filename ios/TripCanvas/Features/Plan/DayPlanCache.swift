import Foundation
import Observation

/// 계산 캐시가 "지금"을 묻는 곳. **문서 revision과 보고 있는 날은 캐시의 것이 아니다** —
/// 캐시가 자기 사본을 들면 어느 쪽이 참인지 갈린다(§상태 소유자는 하나).
@MainActor
protocol DayPlanContext: AnyObject {
    var currentRevision: Int { get }
    var currentDay: Int { get }
    var currentDayCount: Int { get }
}

/// 서버가 계산한 **날짜별 일정**(예상 도착·구간·합계·일자 스트립)의 조회·캐시·선조회·재시도.
///
/// 문서는 원문이고 이건 계산이다 — 따로 온다. 없어도 일정 편집은 그대로 된다.
///
/// ## 무효화 규칙
/// 무효화의 조건은 하나다 — **문서 revision이 바뀌면 전부 버린다**(`invalidate()`).
/// 옛 시각을 잠깐이라도 보여 주는 것은 비어 있는 것보다 나쁘다. 버리는 대상은
/// 날짜별 계산·디스크 사본 시각·시도 여부·재시도 표시·이 세션에서 받은 날, 그리고 전체 동선이다.
///
/// ## 늦게 온 응답 규칙
/// 모든 조회는 **요청할 때의 revision을 들고 갔다가 돌아와서 다시 본다**. 판정은
/// `isCurrent(_:day:asked:mustBeVisible:)` 하나뿐이고, 세 가지를 함께 본다 —
/// ① 문서가 그대로인가 ② 서버가 계산한 문서가 그 문서인가 ③ (보이는 날만) 아직 그 날을 보고 있는가.
///
/// ## Task 규칙
/// 여기서 만드는 Task는 **기다리지 않는 것**뿐이다(구간 채우기 재시도·선조회·전체 동선 재시도).
/// 취소하지 않고 **깨어나서 판정한다** — 취소를 쓰면 어느 요청이 살아 있는지가 두 곳(취소 토큰과
/// revision)에 생긴다. 깨어난 뒤 위 판정에 걸리면 조용히 버린다.
@Observable
@MainActor
final class DayPlanCache {
    /// 날짜별 계산. **한 번 받은 날은 기억한다** — 날을 옮길 때마다 다시 받으면
    /// 그때마다 목록이 새로 지어지고 화면이 튄다(2026-09-07 보고).
    private var plansByDay: [Int: DayPlanResponse] = [:]
    /// 계산이 마지막으로 받아진 시점(오프라인일 때만 값이 있다). **날마다 따로** —
    /// 하나로 두면 앞 날의 '오프라인' 표시가 다음 날에 그대로 남는다.
    private var cachedAtByDay: [Int: Date] = [:]

    /// 계산을 한 번이라도 **시도한** 날들.
    ///
    /// 계산이 오기 전의 목록에는 🏠 이월 숙소·렌터카·구간 줄·숙소 복귀·하루 합계가 없다.
    /// 그 상태를 먼저 그렸다가 계산이 들어오면 줄이 통째로 밀린다 — 그래서 **첫 시도가 끝날 때까지**
    /// 목록을 짓지 않는다(2026-09-07 '화면이 튄다' 보고). 캐시가 있으면 기다림은 0이다.
    private var attemptedDays: Set<Int> = []
    /// 미리 받는 중인 날. **같은 날을 두 번 받지 않기 위해서다** — 빠르게 밀면 요청이 쌓인다.
    private var prefetching: Set<Int> = []
    /// 경로가 채워지기를 기다렸다 한 번 더 받은 날들. **날마다 한 번뿐이다.**
    private var retriedLegs: Set<Int> = []
    /// 이 세션에서 **서버로부터** 받은 날들(디스크 캐시·오프라인 사본은 빼고). 같은 문서의 채운 하루치는 날을 오가도
    /// 다시 묻지 않는다(2026-09-18) — 문서가 바뀌면 `invalidate()`가 전부 버리므로 옛것을 볼 일은 없다.
    private var fetchedDays: Set<Int> = []

    /// 여행 전체 동선. **전체 지도를 볼 때만** 받는다 — 열지도 않을 날까지 미리 받지 않는다.
    private(set) var tripRoutes: TripRoutesResponse?
    private(set) var isLoadingTripRoutes = false
    private var tripRoutesGeneration = 0
    /// 전체 동선도 한 번만 다시 받는다(하루치와 같은 규칙).
    private var retriedTripRoutes = false

    private let tripId: String
    private let service: TripDocumentSource
    /// 채우기에 주는 시간. 구간 몇 개면 대개 이 안에 끝난다.
    private let legRetryDelay: TimeInterval
    /// 하루치 계산을 받는가. 예약 편집처럼 **문서만** 필요한 곳은 끈다(2026-09-18) — 편집기 하나 여는 데 하루치 2건이 나갔다.
    private let loadsPlans: Bool

    weak var context: DayPlanContext?
    /// 하루치를 받은 직후 한 번. 참여자 이름표처럼 **계산이 온 뒤에야 필요한 것**을 밖에서 채운다.
    var onDayPlanLoaded: (() async -> Void)?

    init(tripId: String, service: TripDocumentSource, legRetryDelay: TimeInterval = 3, loadsPlans: Bool = true) {
        self.tripId = tripId
        self.service = service
        self.legRetryDelay = legRetryDelay
        self.loadsPlans = loadsPlans
    }

    // MARK: 지금 — 캐시는 들지 않고 물어본다

    private var revision: Int { context?.currentRevision ?? -1 }
    private var visibleDay: Int { context?.currentDay ?? -1 }
    private var dayCount: Int { context?.currentDayCount ?? 0 }

    /// 늦게 온 응답을 받아들일지 정하는 **단 하나의 판정**.
    private func isCurrent(_ response: DayPlanResponse, day: Int, asked: Int, mustBeVisible: Bool) -> Bool {
        guard revision == asked, response.trip.revision == asked else { return false }
        guard !mustBeVisible || day == visibleDay else { return false }
        return true
    }

    /// 받은 계산을 그 날의 자리에 넣는다. 디스크에서 온 것은 '이 세션에서 받은 날'로 세지 않는다 —
    /// 그래야 날을 옮길 때 서버에 한 번은 물어본다.
    private func store(_ fetched: TripService.Fetched<DayPlanResponse>, for day: Int) {
        plansByDay[day] = fetched.value
        cachedAtByDay[day] = fetched.cachedAt
        if fetched.cachedAt == nil { fetchedDays.insert(day) }
    }

    // MARK: 읽기

    func plan(for day: Int) -> DayPlanResponse? { plansByDay[day] }
    func cachedAt(for day: Int) -> Date? { cachedAtByDay[day] }
    func attempted(_ day: Int) -> Bool { attemptedDays.contains(day) }

    // MARK: 무효화

    /// 문서가 바뀌었다 — 이 문서로 계산된 것이 하나도 없다.
    /// 전체 동선의 세대를 올려 **이전 요청이 새 조회의 로딩 상태를 끄지 못하게** 한다.
    func invalidate() {
        plansByDay = [:]
        cachedAtByDay = [:]
        attemptedDays = []
        retriedLegs = []
        fetchedDays = []
        tripRoutes = nil
        retriedTripRoutes = false
        tripRoutesGeneration += 1
        isLoadingTripRoutes = false
    }

    /// 여행에 날이 하나도 없다 — 들고 있을 계산도 없다.
    private func clearAll() {
        plansByDay = [:]
        cachedAtByDay = [:]
    }

    // MARK: 하루치

    /// 서버 계산을 받아온다. **실패해도 조용하다** — 일정 편집은 문서만으로 되고,
    /// 계산이 없으면 화면이 시각·구간을 감출 뿐이다. 여기서 오류 배너를 띄우면
    /// 편집이 멀쩡한데 무언가 고장 난 것처럼 보인다.
    /// - Parameter reuseFetched: **날을 옮길 때**만 참이다 — 이번 문서의 계산을 이 세션에서 이미 서버로부터 받았고 채울 구간도
    ///   없으면 다시 묻지 않는다(2026-09-18). 문서 읽기·당겨서 새로고침·저장 뒤의 호출은 언제나 다시 받는다.
    func loadDay(reuseFetched: Bool = false) async {
        guard loadsPlans else { return }
        guard dayCount > 0 else { clearAll(); return }
        let day = visibleDay
        let askedRevision = revision
        defer {
            if revision == askedRevision { attemptedDays.insert(day) }
        }
        await showCachedPlan(for: day)
        guard revision == askedRevision else { return }
        // 날을 옮길 때 — 이번 문서의 계산을 이 세션에서 이미 서버로부터 받았고 채울 구간도 없으면 같은 답을 다시 받지 않는다(2026-09-18).
        if reuseFetched, let known = plansByDay[day], fetchedDays.contains(day), known.trip.revision == askedRevision, known.legsPending == 0 {
            attemptedDays.insert(day)
            prefetchNeighbours(of: day)
            return
        }
        do {
            let fetched = try await service.dayPlan(tripId: tripId, dayIndex: day)
            guard isCurrent(fetched.value, day: day, asked: askedRevision, mustBeVisible: true) else { return }
            store(fetched, for: day)
            attemptedDays.insert(day)
            await onDayPlanLoaded?()
            guard revision == askedRevision else { return }
            // ⚠️ **기다리지 않는다.** 여기서 await 하면 문서 읽기가 3초 동안 안 끝나고,
            // 그동안 화면은 로딩 상태로 멈춘다 — 채우기를 기다리는 것과 화면을 세우는 것은 다른 일이다.
            scheduleLegRetry(day: day, pending: fetched.value.legsPending)
            prefetchNeighbours(of: day)
        } catch {
            guard revision == askedRevision else { return }
            // 못 받았다고 **이미 보여 준 계산을 지우지 않는다** — 화면이 비면서 또 튄다.
            // 다만 그 계산이 지금 보는 날의 것이고 문서가 그대로일 때만 남긴다:
            // 편집한 뒤의 옛 시각을 계속 보여 주면 틀린 숫자를 말하는 것이다.
            if plansByDay[day]?.trip.revision != revision {
                plansByDay[day] = nil
                cachedAtByDay[day] = nil
            }
        }
    }

    /// 지난번 계산을 **먼저** 보여 준다 — 서버를 기다리는 동안 시각 칸이 비어 있다가
    /// 값이 들어오면서 줄이 움직이는 것을 없앤다(2026-09-07 '화면이 튄다' 보고).
    ///
    /// ⚠️ **문서가 그때 그대로일 때만** 쓴다. 편집한 뒤의 옛 시각을 보여 주면
    /// 잠깐이라도 **틀린 숫자**를 말하게 된다 — 비어 있는 것보다 나쁘다.
    private func showCachedPlan(for day: Int) async {
        // ⚠️ **그 날의 계산이 없을 때** 읽는다. 예전에는 `plan == nil`을 봤는데,
        //    날을 옮기면 앞 날의 계산이 남아 있어 조건이 거짓이 됐다 — 그래서 옮길 때마다
        //    디스크에 있는데도 서버를 기다리며 다시 로딩했다.
        guard plansByDay[day] == nil, revision > 0 else { return }
        guard let cached = await service.cachedDayPlan(tripId: tripId, dayIndex: day) else { return }
        guard cached.trip.revision == revision, cached.day.index == day else { return }
        plansByDay[day] = cached
        attemptedDays.insert(day)      // 지난 계산이 있으면 기다릴 것이 없다
    }

    // MARK: 선조회

    /// 앞뒤 하루를 미리 받아 둔다. **스와이프가 부드러워도 넘어간 뒤 목록이 늦게 지어지면
    /// 튀는 것으로 보인다** — 날을 옮기는 순간 이미 계산이 있으면 기다릴 것이 없다.
    ///
    /// ⚠️ 지금 보는 날은 건드리지 않는다. ⚠️ 이미 이번 문서(revision)의 계산이 있으면 안 받는다.
    /// ⚠️ **`scheduleLegRetry`를 걸지 않는다** — 보지도 않는 날 때문에 3초 뒤 재조회가 도는 것은
    ///    배터리와 서버 낭비다. 그 날로 실제로 옮기면 `loadDay`가 건다.
    private func prefetchNeighbours(of day: Int) {
        for next in [day + 1, day - 1] where next >= 0 && next < dayCount {
            guard plansByDay[next] == nil, !prefetching.contains(next) else { continue }
            prefetching.insert(next)
            Task(priority: .utility) { [weak self] in await self?.prefetch(day: next) }
        }
    }

    private func prefetch(day: Int) async {
        defer { prefetching.remove(day) }
        let asked = revision
        guard let fetched = try? await service.dayPlan(tripId: tripId, dayIndex: day) else { return }
        // 그 사이 문서가 바뀌었으면 버린다 — 옛 시각을 미리 넣어 두면 틀린 숫자를 보여 준다.
        guard isCurrent(fetched.value, day: day, asked: asked, mustBeVisible: false) else { return }
        guard plansByDay[day] == nil else { return }      // 그 사이 그 날을 열었으면 그쪽이 이긴다
        store(fetched, for: day)
        attemptedDays.insert(day)      // 넘어가는 순간 목록이 기다리지 않고 지어진다
    }

    // MARK: 구간 채우기 재시도

    /// 서버가 "아직 못 채운 구간이 있다"고 하면 **한 번만** 다시 받는다.
    ///
    /// 서버는 하루치를 먼저 보내고 경로를 그 뒤에 채운다(응답을 조회에 묶으면 화면이 멈춘다).
    /// 그래서 처음 연 날은 직선이고, 잠시 뒤 한 번 더 받으면 도로가 되어 있다.
    ///
    /// ⚠️ **두 번째에도 남아 있으면 멈춘다.** 조회는 실패할 수도 있고, 그때 계속 다시 받으면
    /// 아무것도 나아지지 않는 요청만 반복된다.
    /// ⚠️ 화면을 비우지 않는다 — 선이 바뀌는 것으로 충분하다.
    private func scheduleLegRetry(day: Int, pending: Int) {
        guard pending > 0, !retriedLegs.contains(day) else { return }
        retriedLegs.insert(day)
        let askedRevision = revision
        Task { [weak self] in await self?.refetchWhenLegsArrive(day: day, revision: askedRevision) }
    }

    private func refetchWhenLegsArrive(day: Int, revision askedRevision: Int) async {
        try? await Task.sleep(for: .seconds(legRetryDelay))
        guard day == visibleDay, revision == askedRevision else { return }
        guard let fetched = try? await service.dayPlan(tripId: tripId, dayIndex: day) else { return }
        guard isCurrent(fetched.value, day: day, asked: askedRevision, mustBeVisible: true) else { return }
        store(fetched, for: day)
    }

    // MARK: 여행 전체

    /// 일자 개요. 아직 없는 날만 채운다 — 문서가 바뀌면 중간에 멈춘다.
    func loadOverview() async {
        let requestedRevision = revision
        for index in 0..<dayCount {
            guard !Task.isCancelled, revision == requestedRevision else { return }
            if plansByDay[index] != nil { continue }
            do {
                let result = try await service.dayPlan(tripId: tripId, dayIndex: index)
                guard isCurrent(result.value, day: index, asked: requestedRevision, mustBeVisible: false) else { continue }
                plansByDay[index] = result.value
                cachedAtByDay[index] = result.cachedAt
            } catch { /* 개요에 계산 미확인으로 남기고 나머지 날은 계속 읽는다. */ }
        }
    }

    /// 여행 전체 동선을 받는다. **한 번만** 받고, 못 채운 구간이 있으면 한 번만 다시 받는다.
    /// ⚠️ 실패해도 조용하다 — 전체 지도가 안 뜰 뿐 일자 지도와 편집은 그대로다.
    func loadTripRoutes() async {
        guard tripRoutes == nil, !isLoadingTripRoutes else { return }
        tripRoutesGeneration += 1
        let request = tripRoutesGeneration
        let requestedRevision = revision
        isLoadingTripRoutes = true
        defer { if request == tripRoutesGeneration { isLoadingTripRoutes = false } }
        guard let received = try? await service.tripRoutes(tripId: tripId) else { return }
        guard request == tripRoutesGeneration, revision == requestedRevision,
              received.trip.revision == requestedRevision else { return }
        tripRoutes = received
        guard received.legsPending > 0, !retriedTripRoutes else { return }
        retriedTripRoutes = true
        Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(for: .seconds(self.legRetryDelay))
            guard !Task.isCancelled, self.tripRoutesGeneration == request, self.revision == requestedRevision else { return }
            guard let again = try? await self.service.tripRoutes(tripId: self.tripId),
                  self.tripRoutesGeneration == request, self.revision == requestedRevision,
                  again.trip.revision == requestedRevision else { return }
            self.tripRoutes = again
        }
    }
}
