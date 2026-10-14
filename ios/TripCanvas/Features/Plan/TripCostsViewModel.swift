import Foundation
import Observation

/// 비용도 일정과 같은 문서 저장·충돌 규칙을 쓴다. 저장 완료는 합계 조회를 기다리지 않는다.
@Observable @MainActor
final class TripCostsViewModel {
    let store: TripDocumentStore
    private(set) var response: TripCostsResponse?
    private(set) var isLoading = false
    private(set) var isCalculating = false
    private(set) var needsReload = false
    private var calculationError: String?
    private var generation = 0
    private var costGeneration = 0
    private let fetchCosts: () async throws -> TripCostsResponse
    private let memory: TripCostsMemory?

    init(tripId: String, documents: TripDocumentSource, memory: TripCostsMemory? = nil,
         costs: @escaping () async throws -> TripCostsResponse) {
        store = TripDocumentStore(tripId: tripId, service: documents)
        self.memory = memory; fetchCosts = costs
        if let memory, memory.isFresh(), let snapshot = memory.snapshot {
            store.acceptSaved(snapshot); response = memory.response
        }
        store.onSaved = { [weak self] in
            guard let self else { return }
            self.calculationError = nil
            Task { [weak self] in await self?.refreshCosts() }
        }
    }

    var snapshot: TripDocumentSnapshot? {
        guard let document = store.document else { return nil }
        return TripDocumentSnapshot(document: document, revision: store.revision, role: store.role, cachedAt: store.cachedAt)
    }
    var isSaving: Bool { store.isSaving }
    var canEdit: Bool { store.document != nil && store.canEdit && !needsReload }
    var error: String? {
        if needsReload { return "일행이 여행 내용을 바꿨어요. 입력을 보존하고 닫은 뒤 최신 내용을 확인해 주세요." }
        if store.conflict != nil { return store.saveFailureMessage }
        return store.errorMessage ?? calculationError
    }
    var saveFailureMessage: String { error ?? store.saveFailureMessage }

    func loadIfStale() async {
        if snapshot != nil, response != nil, !needsReload, memory?.isFresh() == true { return }
        await load()
    }

    func invalidate(editing: Bool) async {
        if memory?.invalidationRevision == store.revision, store.document != nil { return }
        guard !store.isSaving else { return }
        needsReload = true; costGeneration += 1; isCalculating = false
        if !editing { await load() }
    }

    func load() async {
        guard !store.isSaving else { return }
        generation += 1
        let request = generation, memoryGeneration = memory?.generation
        isLoading = true
        defer { if request == generation { isLoading = false } }
        let loaded: Bool
        if store.conflict == nil { loaded = await store.load() }
        else { loaded = await store.reloadFromServer() }
        guard loaded, request == generation, memoryGeneration == memory?.generation, !Task.isCancelled,
              store.loadErrorMessage == nil else { return }
        needsReload = false
        await refreshCosts()
    }

    func refreshCosts() async {
        costGeneration += 1
        let request = costGeneration, revision = store.revision, memoryGeneration = memory?.generation
        isCalculating = true
        defer { if request == costGeneration { isCalculating = false } }
        do {
            let result = try await fetchCosts()
            guard request == costGeneration, revision == store.revision, memoryGeneration == memory?.generation,
                  !needsReload, !Task.isCancelled else { return }
            guard result.revision == revision else {
                response = nil; calculationError = "여행 내용이 변경됐어요. 다시 불러와 주세요."; return
            }
            response = result; calculationError = nil
            memory?.remember(snapshot: snapshot, response: result)
        } catch {
            guard request == costGeneration, revision == store.revision, !Task.isCancelled else { return }
            response = nil
            calculationError = "합계를 계산하지 못했어요. 저장된 내용은 유지돼요. 다시 불러와 주세요."
        }
    }

    @discardableResult
    func save(expected: Int?, _ change: @escaping (inout TripDocument) -> Void) async -> Bool {
        guard !needsReload, !isLoading else { return false }
        costGeneration += 1; isCalculating = false
        return await store.edit(nil, expectedRevision: expected, change)
    }
}
