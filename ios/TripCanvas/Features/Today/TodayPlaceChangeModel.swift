import Foundation
import Observation

/// 검토한 한 일정 칸만 바꾼다. 원래 장소는 선택지에 남기고 저장은 기존 문서 CAS를 쓴다.
@Observable @MainActor
final class TodayPlaceChangeModel: Identifiable {
    let id = UUID()
    let tripID: String
    let day: Int
    let activity: ActivitySummary
    private(set) var revision: Int
    private let source: TripDocumentSource & TripDataSource
    private let currentToday: (() async throws -> TripService.Fetched<TodayResponse>)?
    private let isCurrent: () -> Bool
    private var original: TripDocumentSnapshot?
    private var saved: TripDocumentSnapshot?
    private var generation = 0
    private var isLoading = false
    private var isSaving = false
    private(set) var spot: TripSpot?
    private(set) var replacement: TripSpot?
    private(set) var reviewedDocument: TripDocument?
    private(set) var preview: PlanChangePreview?
    private(set) var error: String?
    private(set) var blockedReason: String?
    private(set) var requiresRefresh = false

    init(tripID: String, day: Int, activity: ActivitySummary, revision: Int,
         source: TripDocumentSource & TripDataSource,
         currentToday: (() async throws -> TripService.Fetched<TodayResponse>)? = nil,
         isCurrent: @escaping () -> Bool = { true }) {
        self.tripID = tripID; self.day = day; self.activity = activity; self.revision = revision
        self.source = source; self.isCurrent = isCurrent
        self.currentToday = currentToday
    }

    var alternative: TripSpot? { spot?.choice?.alternative }
    var isWorking: Bool { isLoading || isSaving }
    var isSaved: Bool { saved != nil && !requiresRefresh }
    var viewingRevision: Int { saved?.revision ?? revision }
    var requiresQuickChoice: Bool { spot?.choice?.state == .pending }
    var canChooseNewPlace: Bool { available && spot?.choice?.state != .pending }
    var canRestore: Bool { available && spot?.choice?.state == .selected }
    var canSave: Bool { available && !isWorking && reviewedDocument != nil && preview != nil }
    var canUndo: Bool { saved != nil && !requiresRefresh && !isWorking && isCurrent() }
    var slotTime: String? {
        guard (0..<1440).contains(activity.startMinutes) else { return nil }
        return spot?.arriveAt ?? TimeFormat.clock(activity.startMinutes)
    }
    var newPlaceDraft: TripSpot {
        var value = TripSpot(name: "", city: spot?.city ?? activity.city)
        value.stayMinutes = spot?.stayMinutes
        value.arriveAt = slotTime
        return value
    }
    private var available: Bool {
        original != nil && spot != nil && saved == nil && !isSaving && !requiresRefresh && blockedReason == nil && isCurrent()
    }
    private var index: Int? {
        guard let document = original?.document, document.hasDay(day) else { return nil }
        return document.days[day].spots.indices.first { "d\(day)s\($0)" == activity.id }
    }

    func load() async {
        guard original == nil, !isWorking, !requiresRefresh else { return }
        generation += 1
        let request = generation
        isLoading = true; error = nil
        defer { if generation == request { isLoading = false } }
        do {
            try checkScope()
            let snapshot = try await source.document(tripId: tripID)
            try checkScope()
            guard snapshot.canEdit, snapshot.revision == revision, snapshot.document.hasDay(day),
                  let at = snapshot.document.days[day].spots.indices.first(where: { "d\(day)s\($0)" == activity.id }),
                  snapshot.document.days[day].spots[at].name == activity.name else { throw stale() }
            try await checkCurrentTarget()
            guard generation == request, !Task.isCancelled else { return }
            original = snapshot; spot = snapshot.document.days[day].spots[at]
            if [.flight, .train, .car, .hotel].contains(activity.type) {
                blockedReason = "항공·열차·렌터카·숙소는 연결된 예약과 이동 기준을 일정에서 먼저 확인해 주세요."
            } else if let spot {
                blockedReason = SpotChoice.unavailableReason(spot)
            }
            if slotTime == nil { blockedReason = "자정을 넘는 일정은 날짜와 시각을 일정에서 확인한 뒤 바꿔 주세요." }
        } catch { recordReadError(error, request: request) }
    }

    func review(_ newPlace: TripSpot) async {
        await review(newPlace, restoring: false)
    }
    /// 보관한 장소를 다시 선택하는 초안이다. 저장은 별도 확인 후에만 한다.
    func restore() async {
        guard let alternative else { return }
        await review(alternative, restoring: true)
    }
    private func review(_ newPlace: TripSpot, restoring: Bool) async {
        guard !isSaving, !requiresRefresh, saved == nil else { return }
        generation += 1
        let request = generation
        reviewedDocument = nil; preview = nil; replacement = nil; error = nil
        guard (restoring ? canRestore : canChooseNewPlace), let original, let index, var selected = spot else {
            isLoading = false
            if !isCurrent() { requiresRefresh = true; error = stale().localizedDescription }
            else { error = blockedReason ?? "이미 보관한 선택지가 있어요. 일정에서 두 장소를 확인해 주세요." }
            return
        }
        isLoading = true
        defer { if generation == request { isLoading = false } }
        do {
            try checkScope()
            let retainedAlternative = !restoring ? selected.choice?.alternative : nil
            var proposed = newPlace
            proposed.name = proposed.name.trimmingCharacters(in: .whitespacesAndNewlines)
            if !restoring {
                if let at = proposed.arriveAt, at != slotTime {
                    throw APIError.badRequest("같은 일정 시각을 유지해요. 시각도 바꾸려면 일정에서 확인해 주세요.")
                }
                if proposed.stayMinutes == nil { proposed.stayMinutes = selected.stayMinutes }
                selected.choice = .init(alternative: proposed, state: .pending)
            }
            guard let choice = selected.choice else { throw stale() }
            if let reason = choice.validationError(current: selected) { throw APIError.badRequest(reason) }
            selected.selectChoice(alternative: true)
            if let retainedAlternative, var choice = selected.choice {
                choice.alternative = retainedAlternative
                selected.choice = choice
                if let reason = choice.validationError(current: selected) {
                    throw APIError.badRequest("보관한 장소로 돌아가려면 되돌리기를 선택해 주세요. " + reason)
                }
            }
            selected.arriveAt = slotTime
            var document = original.document
            document.updateSpot(dayIndex: day, at: index, with: selected)
            try await checkCurrentTarget()
            guard generation == request, !Task.isCancelled else { return }
            let result = try await source.planPreview(tripId: tripID, document: document, dayIndex: day, revision: revision, sortByTime: false)
            try checkScope()
            guard generation == request, !Task.isCancelled else { return }
            guard [result.before, result.after].allSatisfy({ $0.trip.id == tripID && $0.trip.revision == revision && $0.day.index == day }),
                  result.after.day.spots.indices.contains(index), result.after.day.spots[index].name == selected.name else { throw stale() }
            // 구서버 응답도 읽되, 저장 때 서버가 다른 원문을 돌려주면 성공으로 단정하지 않는다.
            let reviewed = result.canonicalDocument ?? document
            guard reviewed.hasDay(day), reviewed.days[day].spots.indices.contains(index),
                  reviewed.days[day].spots[index].name == selected.name,
                  reviewed.days[day].spots[index].arriveAt == slotTime else { throw stale() }
            replacement = reviewed.days[day].spots[index]; reviewedDocument = reviewed; preview = result
        } catch { recordReadError(error, request: request) }
    }

    func save() async -> TripDocumentSnapshot? {
        guard canSave, let document = reviewedDocument, let index else { return nil }
        isSaving = true; error = nil; generation += 1
        defer { isSaving = false }
        do {
            // 같은 revision이어도 시간이 지나 현재 일정이 달라질 수 있다. 서버 상태를 다시 읽는다.
            try await checkCurrentTarget()
            let result = try await source.saveDocument(tripId: tripID, document: document, expectedRevision: revision)
            try checkScope()
            guard result.revision > revision, result.document == document else { throw stale() }
            saved = result; replacement = result.document.days[day].spots[index]
            return result
        } catch {
            // 응답을 잃어도 이미 저장됐을 수 있다. 같은 변경을 임의로 반복하지 않는다.
            requiresRefresh = true; preview = nil; reviewedDocument = nil
            self.error = "저장 여부를 확인하지 못했어요. 최신 일정을 확인한 뒤 다시 선택해 주세요. " + error.localizedDescription
            return nil
        }
    }

    func undo() async -> TripDocumentSnapshot? {
        guard canUndo, let saved, let original else { return nil }
        isSaving = true; error = nil
        defer { isSaving = false }
        do {
            try checkScope()
            let result = try await source.saveDocument(tripId: tripID, document: original.document, expectedRevision: saved.revision)
            try checkScope()
            guard result.revision > saved.revision, result.document == original.document else { throw stale() }
            revision = result.revision; self.original = result; self.saved = nil
            replacement = nil; reviewedDocument = nil; preview = nil
            return result
        } catch {
            requiresRefresh = true
            self.error = "다른 변경을 덮지 않도록 되돌리기를 멈췄어요. 최신 일정을 확인해 주세요."
            return nil
        }
    }

    private func checkScope() throws {
        guard isCurrent() else { throw stale() }
    }
    private func checkCurrentTarget() async throws {
        try checkScope()
        let fetched: TripService.Fetched<TodayResponse>
        if let currentToday { fetched = try await currentToday() }
        else { fetched = try await source.today(tripId: tripID, dayIndex: nil, intent: nil, energy: nil) }
        try checkScope()
        let today = fetched.value
        guard fetched.cachedAt == nil, today.trip.id == tripID, today.trip.revision == revision, today.trip.canEdit,
              today.trip.isLive, today.currentState.live, today.day.index == day,
              today.displayedNextAction?.activityId == activity.id,
              let current = today.activities.first(where: { $0.id == activity.id }),
              current.name == activity.name, !current.status.isDone, current.status != .unknown else { throw stale() }
    }
    private func stale() -> APIError {
        .stale("일정이나 현재 장소가 바뀌었어요. 최신 일정에서 다시 선택해 주세요.")
    }
    private func recordReadError(_ error: Error, request: Int) {
        guard request == generation, !ReadCancellation.shouldIgnore(error) else { return }
        if let api = error as? APIError {
            switch api {
            case .stale, .revisionConflict, .forbidden, .unauthorized, .notFound: requiresRefresh = true
            default: break
            }
        }
        self.error = error.localizedDescription
    }
}
