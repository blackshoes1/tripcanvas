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
    private(set) var errorMessage: String?
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
    var revision: Int { today?.trip.revision ?? trip.revision }
    var status: TravelStatus { today?.nextAction?.status ?? (today?.activities.isEmpty == false ? .upcoming : .noPlan) }
    var isOffline: Bool { cachedAt != nil }

    /// 이동시간이 추정치면 화면이 그렇게 말해야 한다 — 실제 경로 시간인 척하지 않는다.
    var travelTimeIsEstimate: Bool { today?.travelTimeSource != .routed }

    func load() async {
        if today == nil { isLoading = true }
        defer { isLoading = false }
        do {
            let fetched = try await service.today(tripId: trip.id, dayIndex: nil)
            today = fetched.value
            cachedAt = fetched.cachedAt
            errorMessage = nil
        } catch {
            // 캐시가 남아 있으면 화면을 비우지 않는다(§33) — 배너만 띄운다.
            errorMessage = error.localizedDescription
        }
    }

    // MARK: 일정 실행 상태 — 한 번의 터치로 끝난다(§17)

    func complete(_ activity: ActivitySummary) async {
        await mutate(id: activity.id) {
            try await self.service.setActivity(
                tripId: self.trip.id, activityId: activity.id, action: .complete,
                expectedRevision: self.revision, expectedName: activity.name)
        } describe: { _ in "\(activity.name) 다녀온 것으로 표시했어요." }
    }

    func skip(_ activity: ActivitySummary) async {
        await mutate(id: activity.id) {
            try await self.service.setActivity(
                tripId: self.trip.id, activityId: activity.id, action: .skip,
                expectedRevision: self.revision, expectedName: activity.name)
        } describe: { _ in "\(activity.name)을(를) 건너뛰었어요. 남은 일정을 다시 확인했어요." }
    }

    func undo(_ activity: ActivitySummary) async {
        await mutate(id: activity.id) {
            try await self.service.setActivity(
                tripId: self.trip.id, activityId: activity.id, action: .reset,
                expectedRevision: self.revision, expectedName: activity.name)
        } describe: { _ in "\(activity.name)을(를) 되돌렸어요." }
    }

    // MARK: 제안

    func accept(_ suggestion: TripSuggestion) async {
        await mutate(id: suggestion.id) {
            try await self.service.decideSuggestion(
                tripId: self.trip.id, suggestionId: suggestion.id, decision: .accept, expectedRevision: self.revision)
        } describe: { response in
            response.applied ? "\(suggestion.title) 반영했어요." : "알겠어요 — 일정은 그대로 둘게요."
        }
    }

    func dismiss(_ suggestion: TripSuggestion) async {
        await mutate(id: suggestion.id) {
            try await self.service.decideSuggestion(
                tripId: self.trip.id, suggestionId: suggestion.id, decision: .skip, expectedRevision: self.revision)
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

    // MARK: 공통 변경 처리
    //
    // 409(다른 기기가 먼저 바꿈 / 제안이 낡음)는 오류로 보여주지 않는다 — 조용히 최신을 받아
    // 다시 그리고, 무엇이 달라졌는지만 알린다. 여행 중에 실패 화면을 보여줄 이유가 없다.
    private func mutate(
        id: String,
        _ operation: @escaping () async throws -> MutationResponse,
        describe: @escaping (MutationResponse) -> String
    ) async {
        guard !pending.contains(id) else { return }   // 연타로 두 번 보내지 않는다
        pending.insert(id)
        defer { pending.remove(id) }
        do {
            let response = try await operation()
            today = response.today
            cachedAt = nil
            errorMessage = nil
            toast = response.alreadyApplied ? "이미 반영돼 있었어요." : describe(response)
        } catch let error as APIError {
            switch error {
            case .revisionConflict, .stale:
                await load()
                toast = "다른 곳에서 먼저 바뀌어서 최신 일정으로 새로 불러왔어요."
            case .offline:
                errorMessage = "지금은 연결이 없어 반영하지 못했어요. 연결되면 다시 눌러 주세요."
            default:
                errorMessage = error.localizedDescription
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
