import Foundation
import Observation

/// Today 화면의 상태. 판단은 하지 않는다 — 서버가 준 `TodayResponse`를 들고 있다가
/// 사용자의 결정을 서버로 넘기고, 돌아온 최신 Today로 갈아끼운다.
@Observable
@MainActor
final class TodayViewModel {
    let trip: TripSummary

    private(set) var today: TodayResponse?
    private(set) var isLoading = false
    private(set) var cachedAt: Date?
    /// 서버에서 **직접** 받은 마지막 시각. 캐시로 그린 것은 세지 않는다 — 신선도 판단의 기준이다.
    private(set) var loadedAt: Date?
    /// 시작 전 여행에서 '여행 보기'를 눌렀는가. 탭을 오가도 유지된다 — 화면이 아니라 모델이 들고 있어서다.
    var showsPlanPreview = false
    /// 여행 모드 권유를 "나중에"로 미뤘는가. 같은 이유로 여기 있다.
    var deferredTravelInvite = false
    private(set) var loadErrorMessage: String?
    private(set) var actionErrorMessage: String?
    private(set) var actionErrorTitle: String?
    private(set) var isRetrying = false
    private var failedAction: FailedAction?
    private var contentGeneration = 0

    private struct FailedAction {
        let id: String
        let revision: Int
        let title: String
        let operation: () async throws -> MutationResponse
        let describe: (MutationResponse) -> String
    }

    var canEdit: Bool { (today?.trip ?? trip).canEdit }
    var canRetryAction: Bool { failedAction != nil && canEdit }
    var errorMessage: String? { actionErrorMessage ?? loadErrorMessage }
    /// 지금 서버 응답을 기다리는 대상(활동 id 또는 제안 id) — 버튼만 비활성화하고 화면은 살려 둔다.
    private(set) var pending: Set<String> = []
    /// 수락/완료 직후의 짧은 확인 문구. 명령형이 아니라 결과를 알려주는 톤으로.
    private(set) var toast: String?

    private let service: TripDataSource

    init(trip: TripSummary, service: TripDataSource) {
        self.trip = trip
        self.service = service
    }

    var dayIndex: Int? { today?.day.index }

    /// 출발까지 남은 날 — **아직 시작하지 않은 여행에만** 값이 있다.
    /// 서버가 센다(`adaptive.js`의 `daysUntilStart`). 앱이 `start`를 오늘과 비교하면
    /// 여행지의 오늘과 어긋나 "D-1인데 이미 시작됨" 같은 일이 생긴다.
    var daysUntilStart: Int? {
        guard let summary = today?.trip, !summary.isLive else { return nil }
        return summary.daysUntilStart
    }
    var revision: Int { today?.trip.revision ?? trip.revision }
    var status: TravelStatus { today?.nextAction?.status ?? (today?.activities.isEmpty == false ? .upcoming : .noPlan) }
    var isOffline: Bool { cachedAt != nil }

    /// 이동시간이 추정치면 화면이 그렇게 말해야 한다 — 실제 경로 시간인 척하지 않는다.
    var travelTimeIsEstimate: Bool { today?.travelTimeSource != .routed }

    /// 탭에 들어올 때 부른다. **탭 전환은 앱 복귀가 아니다** — 이미 보여 준 내용이 있고 방금
    /// 받은 것이면 서버를 다시 묻지 않는다(그때마다 로딩이 떴다, 2026-09-17). 오래됐으면 뒤에서
    /// 조용히 새로 받는다: 내용이 있으므로 화면은 로딩으로 바뀌지 않는다.
    /// - Returns: 실제로 서버에 물었는가. 물었을 때만 여행 모드도 함께 갱신할 가치가 있다.
    @discardableResult
    func loadIfStale(maxAge: TimeInterval = 60, now: Date = Date()) async -> Bool {
        if today != nil, cachedAt == nil, let loadedAt, now.timeIntervalSince(loadedAt) < maxAge { return false }
        await load()
        return true
    }

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        let generation = contentGeneration
        defer { isLoading = false }
        // 지난번 화면을 **먼저** 그린다 — 서버를 기다리는 동안 빈 스피너 대신 마지막으로 본 오늘이 보인다.
        // ⚠️ 문서가 그때 그대로일 때만(목록이 아는 revision과 같을 때) — 편집한 뒤의 옛 일정을 잠깐이라도
        //    보여 주면 틀린 것을 말하는 것이다. 시각은 서버 답이 오면 갈아끼워진다.
        if today == nil, let cached = await service.cachedToday(tripId: trip.id), cached.trip.revision == trip.revision {
            guard generation == contentGeneration else { return }
            today = cached
        }
        do {
            let fetched = try await service.today(tripId: trip.id, dayIndex: nil)
            guard generation == contentGeneration, today == nil || fetched.value.trip.revision >= revision else { return }
            today = fetched.value
            cachedAt = fetched.cachedAt
            if fetched.cachedAt == nil { loadedAt = Date() }
            loadErrorMessage = nil
        } catch {
            // 앱 복귀 조회가 실패해도 마지막 내용과 저장 실패 안내를 유지한다.
            guard generation == contentGeneration else { return }
            loadErrorMessage = error.localizedDescription
        }
    }

    // MARK: 일정 실행 상태 — 한 번의 터치로 끝난다(§17)

    func complete(_ activity: ActivitySummary) async {
        guard !isRetrying else { return }
        let expectedRevision = revision
        await mutate(id: activity.id, revision: expectedRevision, title: "완료 표시를 저장하지 못했어요") { [service, tripId = trip.id] in
            try await service.setActivity(
                tripId: tripId, activityId: activity.id, action: .complete,
                expectedRevision: expectedRevision, expectedName: activity.name)
        } describe: { _ in "\(activity.name) 다녀온 것으로 표시했어요." }
    }

    func skip(_ activity: ActivitySummary) async {
        guard !isRetrying else { return }
        let expectedRevision = revision
        await mutate(id: activity.id, revision: expectedRevision, title: "건너뛰기를 저장하지 못했어요") { [service, tripId = trip.id] in
            try await service.setActivity(
                tripId: tripId, activityId: activity.id, action: .skip,
                expectedRevision: expectedRevision, expectedName: activity.name)
        } describe: { _ in "\(activity.name)을(를) 건너뛰었어요. 남은 일정을 다시 확인했어요." }
    }

    func undo(_ activity: ActivitySummary) async {
        guard !isRetrying else { return }
        let expectedRevision = revision
        await mutate(id: activity.id, revision: expectedRevision, title: "되돌리기를 저장하지 못했어요") { [service, tripId = trip.id] in
            try await service.setActivity(
                tripId: tripId, activityId: activity.id, action: .reset,
                expectedRevision: expectedRevision, expectedName: activity.name)
        } describe: { _ in "\(activity.name)을(를) 되돌렸어요." }
    }

    // MARK: 제안

    func accept(_ suggestion: TripSuggestion) async {
        guard !isRetrying else { return }
        let expectedRevision = revision
        await mutate(id: suggestion.id, revision: expectedRevision, title: "제안을 반영하지 못했어요") { [service, tripId = trip.id] in
            try await service.decideSuggestion(
                tripId: tripId, suggestionId: suggestion.id, decision: .accept, expectedRevision: expectedRevision)
        } describe: { response in
            response.applied ? "\(suggestion.title) 반영했어요." : "알겠어요 — 일정은 그대로 둘게요."
        }
    }

    func dismiss(_ suggestion: TripSuggestion) async {
        guard !isRetrying else { return }
        let expectedRevision = revision
        await mutate(id: suggestion.id, revision: expectedRevision, title: "제안 건너뛰기를 저장하지 못했어요") { [service, tripId = trip.id] in
            try await service.decideSuggestion(
                tripId: tripId, suggestionId: suggestion.id, decision: .skip, expectedRevision: expectedRevision)
        } describe: { _ in "이번엔 건너뛸게요." }
    }

    /// 재구성은 제안 목록의 REPLAN 카드를 수락하는 것과 같다 — 별도 경로를 만들지 않는다.
    var replanSuggestion: TripSuggestion? {
        today?.suggestions.first { $0.type == .replan }
    }

    var otherSuggestions: [TripSuggestion] {
        (today?.suggestions ?? []).filter { $0.type != .replan }
    }

    var remaining: [ActivitySummary] {
        today?.remainingActivities ?? []
    }

    /// 다음 일정을 뺀 나머지 — 위에 큰 카드로 이미 보여준 것을 목록에서 또 강조하지 않는다.
    var upcomingAfterNext: [ActivitySummary] {
        guard let nextId = today?.nextAction?.activityId else { return remaining }
        return remaining.filter { $0.id != nextId }
    }

    func activity(id: String?) -> ActivitySummary? {
        guard let id else { return nil }
        return today?.activities.first { $0.id == id }
    }

    func clearToast() { toast = nil }

    /// 응답이 끊겼을 때 이미 저장됐을 수 있다. 원래 revision을 확인한 뒤 같은 요청만 재시도한다.
    func retryAction() async {
        guard let failedAction, !isRetrying, pending.isEmpty, canEdit else { return }
        isRetrying = true
        defer { isRetrying = false }
        do {
            let fetched = try await service.today(tripId: trip.id, dayIndex: nil)
            guard fetched.cachedAt == nil else { throw APIError.offline }
            guard fetched.value.trip.revision >= revision else { throw APIError.stale("최신 일정을 확인하지 못했어요. 다시 확인해 주세요.") }
            contentGeneration += 1
            today = fetched.value
            cachedAt = nil
            loadErrorMessage = nil
            guard canEdit else {
                self.failedAction = nil
                actionErrorMessage = "이 여행은 볼 수만 있어요. 주최자에게 편집 권한을 요청해 주세요."
                return
            }
            guard revision == failedAction.revision else {
                self.failedAction = nil
                actionErrorMessage = "일정이 바뀌어 최신 내용을 불러왔어요. 이미 반영됐을 수 있으니 확인한 뒤 다시 선택해 주세요."
                return
            }
            await mutate(id: failedAction.id, revision: failedAction.revision, title: failedAction.title,
                         failedAction.operation, describe: failedAction.describe)
        } catch {
            actionErrorMessage = "저장 여부를 확인하지 못해 다시 보내지 않았어요. " + error.localizedDescription
        }
    }

    func dismissActionError() {
        failedAction = nil
        actionErrorMessage = nil
        actionErrorTitle = nil
    }

    // MARK: 공통 변경 처리

    private func mutate(
        id: String,
        revision: Int,
        title: String,
        _ operation: @escaping () async throws -> MutationResponse,
        describe: @escaping (MutationResponse) -> String
    ) async {
        guard canEdit, pending.isEmpty else { return }
        pending.insert(id)
        contentGeneration += 1
        defer { pending.remove(id) }
        do {
            let response = try await operation()
            contentGeneration += 1
            today = response.today
            cachedAt = nil
            loadErrorMessage = nil
            dismissActionError()
            toast = response.alreadyApplied ? "이미 반영돼 있었어요." : describe(response)
        } catch let error as APIError {
            switch error {
            case .revisionConflict, .stale:
                dismissActionError()
                await load()
                actionErrorTitle = title
                actionErrorMessage = "일정이 먼저 바뀌어 방금 선택은 반영되지 않았어요. 최신 내용을 확인한 뒤 다시 선택해 주세요."
            case .forbidden, .unauthorized, .badRequest, .notFound:
                failedAction = nil
                actionErrorTitle = title
                actionErrorMessage = error.localizedDescription
            default:
                recordFailure(id: id, revision: revision, title: title, operation: operation, describe: describe, error: error)
            }
        } catch {
            recordFailure(id: id, revision: revision, title: title, operation: operation, describe: describe, error: error)
        }
    }

    private func recordFailure(id: String, revision: Int, title: String,
                               operation: @escaping () async throws -> MutationResponse,
                               describe: @escaping (MutationResponse) -> String, error: Error) {
        failedAction = FailedAction(id: id, revision: revision, title: title, operation: operation, describe: describe)
        actionErrorTitle = title
        actionErrorMessage = "저장 완료를 확인하지 못했어요. 다시 시도하면 저장 여부부터 확인해요. " + error.localizedDescription
    }
}
