import Foundation
import Observation

/// 후보 보드의 상태. **판단은 하지 않는다** — 서버가 준 묶음·문장·선택지를 들고 있다가
/// 사용자의 결정을 서버로 넘기고, 돌아온 보드로 통째로 갈아끼운다.
///
/// 반응 하나에 달라지는 것이 그 카드만이 아니라서 응답이 보드 전체다: 묶음이 옮겨 가고,
/// 배지 문장이 바뀌고, 그룹 제안이 다시 계산된다. 그걸 클라이언트가 흉내내면 웹과 갈린다(§8).
@Observable
@MainActor
final class CandidateBoardViewModel {
    let trip: TripSummary

    private(set) var board: CandidateBoardResponse?
    private(set) var isLoading = false
    private(set) var errorMessage: String?
    /// 지금 서버 응답을 기다리는 후보 id — 그 카드의 버튼만 잠그고 화면은 살려 둔다.
    private(set) var pending: Set<String> = []
    private(set) var toast: String?
    /// 닫은 제안은 다시 올라오지 않는다. 조합이 바뀌면 새 제안이므로 키로 기억한다.
    private var dismissedProposals: Set<String> = []

    private let service: CollabDataSource

    init(trip: TripSummary, service: CollabDataSource) {
        self.trip = trip
        self.service = service
    }

    var groups: [CandidateGroup] { board?.groups ?? [] }
    var canPropose: Bool { board?.canPropose ?? false }
    var canReact: Bool { board?.canReact ?? false }
    var groupContext: [String] { board?.groupContext ?? [] }

    /// 닫지 않은 제안만. 같은 조합이면 같은 키라 다시 뜨지 않는다.
    var proposal: GroupProposal? {
        guard let proposal = board?.proposal, !dismissedProposals.contains(key(of: proposal)) else { return nil }
        return proposal
    }

    private func key(of proposal: GroupProposal) -> String {
        proposal.picks.map { "\($0.candidateId):\($0.dayIndex)" }.joined(separator: "|")
    }

    func dismissProposal() {
        guard let proposal = board?.proposal else { return }
        dismissedProposals.insert(key(of: proposal))
    }

    func load() async {
        if board == nil { isLoading = true }
        defer { isLoading = false }
        do {
            board = try await service.board(tripId: trip.id)
            errorMessage = nil
        } catch {
            // 이미 보고 있던 보드는 지우지 않는다 — 배너만 띄운다(§33).
            errorMessage = error.localizedDescription
        }
    }

    func addCandidate(title: String, note: String?) async {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        await mutate(id: "new") {
            try await self.service.addCandidate(tripId: self.trip.id, title: name, location: nil, note: note, url: nil)
        } describe: { _ in "\(name)을(를) 후보에 담았어요." }
    }

    /// 같은 반응을 다시 누르면 거둔다 — 마음이 바뀌는 것을 되돌릴 수 없게 만들지 않는다.
    func react(_ candidate: TripCandidate, _ reaction: ReactionKind) async {
        let next: ReactionKind? = candidate.myReaction == reaction ? nil : reaction
        await mutate(id: candidate.id) {
            try await self.service.react(tripId: self.trip.id, candidateId: candidate.id, reaction: next)
        } describe: { _ in nil }
    }

    func manage(_ candidate: TripCandidate, _ action: CollabService.CandidateAction, value: String? = nil) async {
        await mutate(id: candidate.id) {
            try await self.service.manage(tripId: self.trip.id, candidateId: candidate.id, action: action, value: value)
        } describe: { _ in
            switch action {
            case .reject: "이번 일정에서는 뺐어요 — 언제든 되돌릴 수 있어요."
            case .reopen: "다시 후보로 올렸어요."
            case .schedule: "\(candidate.title)을(를) 일정에 넣었어요."
            case .unschedule: "일정에서 빼고 후보로 되돌렸어요."
            case .remove: "후보에서 지웠어요."
            }
        }
    }

    /// 제안을 받아들이면 고른 날 **맨 뒤**에 붙는다 — 최적 위치를 추측하지 않는다(§12).
    func acceptProposal(_ proposal: GroupProposal) async {
        for pick in proposal.picks {
            do {
                board = try await service.manage(
                    tripId: trip.id, candidateId: pick.candidateId, action: .schedule, value: String(pick.dayIndex + 1))
            } catch {
                errorMessage = error.localizedDescription
                return
            }
        }
        dismissProposal()
        toast = "\(proposal.picks.count)곳을 일정에 넣었어요."
    }

    func clearToast() { toast = nil }

    private func mutate(
        id: String,
        _ work: @escaping () async throws -> CandidateBoardResponse,
        describe: @escaping (CandidateBoardResponse) -> String?
    ) async {
        pending.insert(id)
        defer { pending.remove(id) }
        do {
            let next = try await work()
            board = next
            errorMessage = nil
            toast = describe(next)
        } catch APIError.forbidden(let message) {
            // 권한 문제는 재시도해도 같다 — 그렇게 말하고 멈춘다.
            errorMessage = message
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// 후보 하나의 코멘트. 의견이라 보기 권한도 남길 수 있다(§14).
@Observable
@MainActor
final class CandidateCommentsViewModel {
    let tripId: String
    let candidate: TripCandidate

    private(set) var comments: [CandidateComment] = []
    private(set) var canComment = false
    private(set) var isLoading = false
    private(set) var isSending = false
    private(set) var errorMessage: String?
    var draft: String = ""

    private let service: CollabDataSource

    init(tripId: String, candidate: TripCandidate, service: CollabDataSource) {
        self.tripId = tripId
        self.candidate = candidate
        self.service = service
    }

    func load() async {
        isLoading = comments.isEmpty
        defer { isLoading = false }
        await apply { try await self.service.comments(tripId: self.tripId, candidateId: self.candidate.id) }
    }

    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending else { return }
        isSending = true
        defer { isSending = false }
        await apply { try await self.service.addComment(tripId: self.tripId, candidateId: self.candidate.id, body: text) }
        if errorMessage == nil { draft = "" }
    }

    func delete(_ comment: CandidateComment) async {
        await apply {
            try await self.service.deleteComment(tripId: self.tripId, candidateId: self.candidate.id, commentId: comment.id)
        }
    }

    private func apply(_ work: @escaping () async throws -> CommentListResponse) async {
        do {
            let response = try await work()
            comments = response.comments
            canComment = response.canComment
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// 여행 취향. 미리보기는 화면이 만들지만 **저장 뒤에는 서버가 돌려준 것이 이긴다**(§16).
@Observable
@MainActor
final class PreferenceViewModel {
    let trip: TripSummary

    private(set) var response: PreferenceResponse?
    private(set) var isLoading = false
    private(set) var isSaving = false
    private(set) var errorMessage: String?
    private(set) var toast: String?

    var draft: MemberPreference = .empty

    private let service: CollabDataSource

    init(trip: TripSummary, service: CollabDataSource) {
        self.trip = trip
        self.service = service
    }

    var members: [MemberPreferenceRow] { response?.members.filter { !$0.mine && !$0.summary.isEmpty } ?? [] }
    var groupContext: [String] { response?.groupContext ?? [] }

    func load() async {
        isLoading = response == nil
        defer { isLoading = false }
        do {
            let fetched = try await service.preferences(tripId: trip.id)
            response = fetched
            draft = fetched.mine
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let saved = try await service.savePreferences(tripId: trip.id, prefs: draft)
            response = saved
            draft = saved.mine        // 서버가 정규화한 값으로 되돌린다
            errorMessage = nil
            toast = "취향을 남겼어요. 일행이 참고할 수 있어요."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// 다시 누르면 꺼진다 — 고른 것을 되돌릴 수 없게 만들지 않는다.
    func toggle(pace: PacePreference) {
        let next: PacePreference? = draft.pace == pace ? nil : pace
        draft = MemberPreference(
            pace: next, walking: draft.walking, morning: draft.morning, night: draft.night,
            interests: draft.interests, dislikes: draft.dislikes, note: draft.note)
    }

    func toggle(walking: WalkingPreference) {
        let next: WalkingPreference? = draft.walking == walking ? nil : walking
        draft = MemberPreference(
            pace: draft.pace, walking: next, morning: draft.morning, night: draft.night,
            interests: draft.interests, dislikes: draft.dislikes, note: draft.note)
    }

    /// 세 번 누르면 제자리 — 괜찮아요 · 어려워요 · 답하지 않음.
    /// 답하지 않은 것을 '아니오'로 저장하지 않는다: 말하지 않은 것과 싫다고 한 것은 다르다.
    func cycleMorning() {
        draft = MemberPreference(
            pace: draft.pace, walking: draft.walking, morning: cycled(draft.morning), night: draft.night,
            interests: draft.interests, dislikes: draft.dislikes, note: draft.note)
    }

    func cycleNight() {
        draft = MemberPreference(
            pace: draft.pace, walking: draft.walking, morning: draft.morning, night: cycled(draft.night),
            interests: draft.interests, dislikes: draft.dislikes, note: draft.note)
    }

    private func cycled(_ value: Bool?) -> Bool? {
        switch value {
        case .none: true
        case .some(true): false
        case .some(false): nil
        }
    }

    func clearToast() { toast = nil }
}
