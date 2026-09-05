import Foundation
import Observation

/// 가고 싶은 곳(후보 보드)의 상태. 판정(집계·묶음·권한)은 전부 `CollabModel`에 있고 여기는 배선만 한다.
///
/// 후보와 반응은 여행 문서가 아니라 제 테이블에 산다 — 넷이 동시에 하트를 눌러도 리비전 CAS가 서로를 걷어차지 않는다.
/// 반응은 **낙관적**이다: 탭 즉시 화면이 바뀌고, 서버가 거절하면 되돌린다. 저장되지 않은 것이 저장된 척하지 않는다.
/// ⚠️ 인기순 자동 반영은 없다(§12·§79) — 일정에 넣는 것은 언제나 사람이 누른다.
@Observable
@MainActor
final class CandidateBoardViewModel {
    private(set) var candidates: [CandidateView] = []
    private(set) var isLoading = false
    private(set) var isWorking = false
    private(set) var errorMessage: String?
    private(set) var toast: String?
    /// 펼친 카드의 한마디 목록. nil이면 아직 안 읽었다.
    private(set) var comments: [Int: [CommentView]] = [:]
    private(set) var memberCount: Int
    var sortByInterest = false

    let trip: TripSummary
    private let service: CollabSource
    private let documents: TripDocumentSource

    init(trip: TripSummary, service: CollabSource, documents: TripDocumentSource) {
        self.trip = trip
        self.service = service
        self.documents = documents
        self.memberCount = max(1, trip.memberCount ?? 1)
    }

    var role: MemberRole { trip.role ?? .owner }
    var canPropose: Bool { CollabModel.canPropose(role) }
    var canReact: Bool { CollabModel.canReact(role) }
    var canSchedule: Bool { CollabModel.canScheduleCandidate(role) }

    /// 묶음이 정렬보다 먼저다 — "관심 순"은 묶음 안에서만 점수 순.
    var groups: CandidateGroups {
        CollabModel.grouped(CollabModel.sorted(candidates, byInterest: sortByInterest, memberCount: memberCount), memberCount: memberCount)
    }

    func load() async {
        if candidates.isEmpty { isLoading = true }
        defer { isLoading = false }
        do {
            candidates = try await service.candidates(tripId: trip.id)
            // 몇 명이 아직 말하지 않았는지 알려면 인원이 필요하다. 못 읽으면 요약이 말한 값으로 간다.
            if let members = try? await service.members(tripId: trip.id), !members.isEmpty { memberCount = members.count }
            errorMessage = nil
        } catch {
            errorMessage = message(for: error)
        }
    }

    func clearToast() { toast = nil }
    func dismissError() { errorMessage = nil }

    // MARK: 후보

    func add(title: String, note: String, lat: Double? = nil, lng: Double? = nil, placeId: String? = nil, addr: String? = nil) async -> Bool {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, canPropose else { return false }
        let cleanNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        return await perform("후보로 담았어요") {
            _ = try await self.service.addCandidate(tripId: self.trip.id, title: String(trimmed.prefix(120)), note: cleanNote.isEmpty ? nil : String(cleanNote.prefix(300)),
                                                    lat: lat, lng: lng, placeId: placeId, addr: addr)
        }
    }

    /// 한 번의 탭. 이미 고른 것을 다시 누르면 거둔다. 실패하면 되돌린다.
    func react(candidateId: Int, reaction: Reaction) async {
        guard let index = candidates.firstIndex(where: { $0.id == candidateId }) else { return }
        let before = candidates[index]
        let next: Reaction? = Reaction(loose: before.myReaction) == reaction ? nil : reaction
        candidates[index] = CollabModel.applyingReaction(next, to: before)
        do {
            try await service.react(tripId: trip.id, candidateId: candidateId, reaction: next)
        } catch {
            if let again = candidates.firstIndex(where: { $0.id == candidateId }) { candidates[again] = before }
            errorMessage = message(for: error)
        }
    }

    func remove(candidateId: Int) async {
        await perform("후보에서 뺐어요") { try await self.service.manageCandidate(tripId: self.trip.id, candidateId: candidateId, action: "REMOVE", value: nil) }
    }

    /// 제외는 **상태**다 — 의견·한마디가 남고 되돌릴 수 있다.
    func reject(candidateId: Int) async {
        await perform("이번 일정에서는 뺐어요 — 언제든 되돌릴 수 있어요") { try await self.service.manageCandidate(tripId: self.trip.id, candidateId: candidateId, action: "REJECT", value: nil) }
    }

    func reopen(candidateId: Int) async {
        await perform("후보로 되돌렸어요") { try await self.service.manageCandidate(tripId: self.trip.id, candidateId: candidateId, action: "REOPEN", value: nil) }
    }

    /// 후보 표시만 되돌린다 — 일정에 넣은 장소는 그대로 남는다(장소에 안정적인 id가 없다).
    func unschedule(candidateId: Int) async {
        await perform("후보로 되돌렸어요") { try await self.service.manageCandidate(tripId: self.trip.id, candidateId: candidateId, action: "UNSCHEDULE", value: nil) }
    }

    /// 일정에 넣기 — 고른 날 **맨 뒤**에 붙인다(최적 위치를 추측하지 않는다). 문서는 최신본을 읽어 CAS로 저장하고,
    /// 들어간 뒤에 후보를 SCHEDULED로 표시한다. 표시가 실패해도 일정에는 들어가 있다고 정직하게 말한다.
    func schedule(candidateId: Int, dayIndex: Int) async {
        guard canSchedule, let candidate = candidates.first(where: { $0.id == candidateId }) else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            let snapshot = try await documents.document(tripId: trip.id)
            var document = snapshot.document
            guard document.hasDay(dayIndex) else { errorMessage = "그 날짜는 일정에 없어요"; return }
            document.insertSpot(CandidateBoardViewModel.spot(from: candidate), dayIndex: dayIndex)
            _ = try await documents.saveDocument(tripId: trip.id, document: document, expectedRevision: snapshot.revision)
        } catch {
            errorMessage = message(for: error)
            return
        }
        do {
            try await service.manageCandidate(tripId: trip.id, candidateId: candidateId, action: "SCHEDULE", value: String(dayIndex + 1))
            toast = "Day \(dayIndex + 1)에 넣었어요"
        } catch {
            errorMessage = "일정에는 넣었지만 후보 표시를 바꾸지 못했어요 — \(message(for: error))"
        }
        await load()
    }

    /// 웹 `appendCandidateSpot`과 같은 모양 — 좌표가 없으면 위치 없는 장소다.
    /// 순수 매핑이라 화면 상태를 건드리지 않는다 — `nonisolated`로 두어 어디서든(테스트 포함) 부를 수 있게 한다.
    nonisolated static func spot(from candidate: CandidateView) -> TripSpot {
        var spot = TripSpot(name: candidate.title, city: "기타")
        spot.desc = candidate.note ?? ""
        if let lat = candidate.lat, let lng = candidate.lng { spot.point = GeoPoint(lat: lat, lng: lng) } else { spot.point = nil }
        if let placeId = candidate.placeId { spot.placeId = placeId }
        return spot
    }

    // MARK: 한마디 — 후보에만 붙는다. 의견이라 보기 권한도 남긴다

    func loadComments(candidateId: Int) async {
        do {
            comments[candidateId] = try await service.comments(tripId: trip.id, candidateId: candidateId)
        } catch {
            comments[candidateId] = []
            errorMessage = message(for: error)
        }
    }

    func addComment(candidateId: Int, body: String) async -> Bool {
        let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return false }
        do {
            try await service.addComment(tripId: trip.id, candidateId: candidateId, body: String(text.prefix(500)))
            await loadComments(candidateId: candidateId)
            await load()   // comment_count
            return true
        } catch {
            errorMessage = message(for: error)
            return false
        }
    }

    func deleteComment(candidateId: Int, commentId: Int) async {
        do {
            try await service.deleteComment(tripId: trip.id, commentId: commentId)
            await loadComments(candidateId: candidateId)
            await load()
        } catch {
            errorMessage = message(for: error)
        }
    }

    // MARK: 공통

    @discardableResult
    private func perform(_ successToast: String, _ work: () async throws -> Void) async -> Bool {
        isWorking = true
        defer { isWorking = false }
        do {
            try await work()
            toast = successToast
            await load()
            return true
        } catch {
            errorMessage = message(for: error)
            return false
        }
    }

    private func message(for error: Error) -> String {
        if let apiError = error as? APIError {
            if case .forbidden(let text) = apiError {
                if role == .viewer { return "보기 권한이라 할 수 없어요 — 주최자에게 편집 권한을 요청하세요" }
                return text.isEmpty ? "이 여행을 바꿀 권한이 없어요" : text
            }
            return apiError.errorDescription ?? "요청을 처리하지 못했어요."
        }
        return error.localizedDescription
    }
}
