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
    /// 서버가 만든 그룹 제안(§35). 앱은 판정하지 않고 이걸 그린다. 없으면 카드도 없다.
    private(set) var proposal: GroupProposalView?
    /// 이 세션에서 "나중에"를 누른 제안은 다시 올리지 않는다 — 거절한 제안을 반복하지 않는다(§79).
    private var proposalDismissed = false
    private(set) var memberCount: Int
    /// 멤버 행. 인원과 **같은 응답**이라 새 요청이 아니다 — 분리(§25)의 이름표와 내 id가 여기서 나온다.
    private(set) var members: [MemberView] = []
    /// 인원을 서버에서 읽었는가 — 처음 한 번과 멤버 이벤트 때만 읽는다(2026-09-18, 전에는 목록을 읽을 때마다 3건이었다).
    private var membersLoaded = false
    /// 목록을 서버에서 마지막으로 받은 시각 — 시트를 다시 열 때 또 받을지의 기준.
    private(set) var loadedAt: Date?
    var sortByInterest = false
    /// 분류로 거르기 — 표시일 뿐이다. nil이면 전부, `.none`은 '아직 고르지 않음'만.
    var categoryFilter: CandidateCategoryFilter = .all

    let trip: TripSummary
    private let service: CollabSource
    private let documents: TripDocumentSource

    /// - Parameter seed: 이미 아는 후보 목록(지도가 들고 있던 것). 넣으려는 후보 하나 때문에 목록을 다시 받지 않는다.
    init(trip: TripSummary, service: CollabSource, documents: TripDocumentSource, seed: [CandidateView] = []) {
        self.trip = trip
        self.service = service
        self.documents = documents
        self.memberCount = max(1, trip.memberCount ?? 1)
        self.candidates = seed
    }

    var role: MemberRole { trip.role ?? .owner }
    var canPropose: Bool { CollabModel.canPropose(role) }
    var canReact: Bool { CollabModel.canReact(role) }
    var canSchedule: Bool { CollabModel.canScheduleCandidate(role) }

    /// 묶음이 정렬보다 먼저다 — "관심 순"은 묶음 안에서만 점수 순.
    var groups: CandidateGroups {
        CollabModel.grouped(CollabModel.sorted(visibleCandidates, byInterest: sortByInterest, memberCount: memberCount), memberCount: memberCount)
    }

    /// 거른 뒤의 후보 — 묶음·정렬은 그 다음이다(분류는 순위를 바꾸지 않는다).
    var visibleCandidates: [CandidateView] {
        candidates.filter { categoryFilter.matches(CandidateCategory.of($0.category)) }
    }

    /// 시트를 열 때 부른다 — 방금 받은 목록이 있으면 그대로다(Today·Plan과 같은 60초 규칙, 2026-09-18).
    /// 변경·실시간·당겨서 새로고침은 여전히 `load()`다.
    func loadIfStale(maxAge: TimeInterval = 60, now: Date = Date()) async {
        if errorMessage == nil, let loadedAt, now.timeIntervalSince(loadedAt) < maxAge { return }
        await load()
    }

    func load() async {
        if candidates.isEmpty { isLoading = true }
        defer { isLoading = false }
        let before = candidates
        do {
            candidates = try await service.candidates(tripId: trip.id)
            loadedAt = Date()
            // 몇 명이 아직 말하지 않았는지 알려면 인원이 필요하다 — 처음 한 번만. 멤버가 바뀌면 그 이벤트(`handle`)가 다시 읽는다.
            if !membersLoaded { await loadMembers() }
            errorMessage = nil
        } catch {
            errorMessage = message(for: error)
        }
        // 제안은 곁들이다 — 못 읽어도 보드는 그대로 뜬다(오류로 만들지 않는다). 목록이 그대로면 제안도 그대로다 — 다시 묻지 않는다.
        if !proposalDismissed, proposal == nil || before != candidates {
            proposal = try? await service.groupProposal(tripId: trip.id)
        }
    }

    /// 못 읽으면 요약이 말한 값으로 간다 — 조용하다.
    private func loadMembers() async {
        guard let rows = try? await service.members(tripId: trip.id), !rows.isEmpty else { return }
        members = rows
        memberCount = rows.count
        membersLoaded = true
    }

    /// 내 user_id — 서버가 `me`로 표시해 준 멤버 행에서 가져온다(인증 id를 따로 추측하지 않는다).
    var myUserId: String? { members.first(where: { $0.me })?.userId }

    /// "나중에" — 이 세션에서는 다시 올리지 않는다. 서버에 남기지 않는다(제안은 저장되지 않는다).
    func dismissProposal() {
        proposalDismissed = true
        proposal = nil
    }

    /// 제안을 그대로 받아들인다. **문서 저장이 먼저**고 후보 표시가 그다음이다 — `schedule`과 같은 순서다.
    /// 여러 곳을 한 번에 넣으므로 문서는 **한 번만** 저장한다(CAS 충돌을 스스로 만들지 않기 위해).
    func acceptProposal() async {
        guard canSchedule, !isWorking, let plan = proposal, !plan.picks.isEmpty else { return }
        isWorking = true
        defer { isWorking = false }

        var placed: [(candidateId: Int, dayIndex: Int)] = []
        var addedCount = 0
        do {
            let snapshot = try await documents.document(tripId: trip.id)
            guard snapshot.canEdit else { errorMessage = "이 일정을 바꿀 권한이 없어요."; return }
            var document = snapshot.document
            for pick in plan.picks {
                guard !placed.contains(where: { $0.candidateId == pick.candidateId }),
                      let candidate = candidates.first(where: { $0.id == pick.candidateId }) else { continue }
                // 문서 저장 뒤 응답이나 후보 표시만 실패했을 수 있다. 실제 위치의 표시만 복구한다.
                if let location = candidateLocation(pick.candidateId, in: document) {
                    placed.append((pick.candidateId, location.day))
                    continue
                }
                guard candidate.status != "SCHEDULED" else {
                    errorMessage = "이미 일정에 넣은 후보지만 연결된 장소를 찾지 못했어요. 일정에서 위치를 먼저 확인해 주세요."
                    return
                }
                guard document.hasDay(pick.dayIndex), candidate.status == "PROPOSED" else { continue }
                document.insertSpot(CandidateBoardViewModel.spot(from: candidate), dayIndex: pick.dayIndex)
                placed.append((pick.candidateId, pick.dayIndex))
                addedCount += 1
            }
            guard !placed.isEmpty else { errorMessage = "넣을 수 있는 곳이 없어요 — 목록을 새로 읽어볼게요"; await load(); return }
            if document != snapshot.document {
                _ = try await documents.saveDocument(tripId: trip.id, document: document, expectedRevision: snapshot.revision)
            }
        } catch {
            errorMessage = message(for: error)
            return
        }

        // 표시가 실패해도 일정에는 들어가 있다 — 정직하게 말한다.
        var failed = 0
        for pick in placed {
            do {
                try await service.manageCandidate(tripId: trip.id, candidateId: pick.candidateId,
                                                  action: "SCHEDULE", value: String(pick.dayIndex + 1))
            } catch { failed += 1 }
        }
        let notice = failed > 0
            ? "일정에는 \(placed.count)곳이 있지만 후보 표시 \(failed)건을 바꾸지 못했어요"
            : nil
        if notice == nil {
            toast = addedCount == placed.count ? "\(placed.count)곳을 일정에 넣었어요" : "일정에 있는 \(placed.count)곳의 후보 표시를 맞췄어요"
        }
        proposal = nil
        await load()
        if let notice { errorMessage = notice }
    }

    /// 실시간 이벤트 하나. **payload를 화면 상태로 쓰지 않는다**(§41) —
    /// 무엇을 다시 읽을지만 판정하고(`CollabModel.liveEffects`, `collab.js`와 같은 규칙) 내용은 API로 다시 읽는다.
    ///
    /// 이 화면이 다시 읽는 것은 후보 보드뿐이다. 멤버·문서는 각자의 화면이 본다.
    func handle(_ event: RealtimeActivity) async {
        guard event.tripId == trip.id else { return }
        let effects = CollabModel.liveEffects(kind: event.kind, mine: event.mine)
        // 알림은 적게(§51) — 남이 후보를 담았을 때와 새 멤버뿐이다.
        if effects.notify, event.kind == "CANDIDATE_PROPOSED" { toast = "일행이 가고 싶은 곳을 담았어요" }
        // 인원이 바뀌면 "몇 명이 아직 말하지 않았는지"가 바뀐다 — 그때만 멤버를 다시 읽는다.
        if effects.members { await loadMembers() }
        // 내 반응·담기·한마디의 에코는 `liveEffects`가 이미 거른다(내 화면은 이미 그렇다).
        guard effects.candidates else { return }
        await load()
    }

    func clearToast() { toast = nil }
    func dismissError() { errorMessage = nil }

    // MARK: 후보

    func add(title: String, note: String, lat: Double? = nil, lng: Double? = nil, placeId: String? = nil, addr: String? = nil, provider: String? = nil, providerId: String? = nil, category: CandidateCategory? = nil) async -> Bool {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, canPropose else { return false }
        let cleanNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        return await perform("후보로 담았어요") {
            _ = try await self.service.addCandidate(tripId: self.trip.id, title: String(trimmed.prefix(120)), note: cleanNote.isEmpty ? nil : String(cleanNote.prefix(300)),
                                                    lat: lat, lng: lng, placeId: placeId, addr: addr, provider: provider, providerId: providerId,
                                                    category: category?.rawValue)
        }
    }

    /// 분류만 바꾼다(빈 값이면 '고르지 않음'으로). 순위·묶음은 그대로다.
    func setCategory(candidateId: Int, category: CandidateCategory?) async {
        await perform(category.map { "\($0.label)(으)로 표시했어요" } ?? "분류를 지웠어요") {
            try await self.service.manageCandidate(tripId: self.trip.id, candidateId: candidateId, action: "CATEGORY", value: category?.rawValue)
        }
    }

    /// 한 번의 탭. 이미 고른 것을 다시 누르면 거둔다. 실패하면 되돌린다.
    func react(candidateId: Int, reaction: Reaction) async {
        guard let index = candidates.firstIndex(where: { $0.id == candidateId }) else { return }
        let before = candidates[index]
        let next: Reaction? = Reaction(loose: before.myReaction) == reaction ? nil : reaction
        candidates[index] = CollabModel.applyingReaction(next, to: before, myId: myUserId)
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

    /// 후보 표시만 되돌린다 — 일정에 넣은 장소는 그대로 남고, 다시 배치할 때 연결된 장소를 옮긴다.
    func unschedule(candidateId: Int) async {
        await perform("후보로 되돌렸어요") { try await self.service.manageCandidate(tripId: self.trip.id, candidateId: candidateId, action: "UNSCHEDULE", value: nil) }
    }

    /// 일정에 넣기 — 고른 위치에 넣거나 이미 연결된 장소를 옮긴다. 문서는 최신본을 읽어 CAS로 저장하고,
    /// 들어간 뒤에 후보를 SCHEDULED로 표시한다. 표시가 실패해도 일정에는 들어가 있다고 정직하게 말한다.
    /// - Parameter reloadAfter: 끝에 목록을 다시 읽는가. 지도의 배치 흐름은 제 목록을 따로 읽으므로 끈다(2026-09-18).
    @discardableResult
    func schedule(candidateId: Int, dayIndex: Int, position: Int? = nil, expectedRevision: Int? = nil, reloadAfter: Bool = true) async -> Bool {
        guard canSchedule, !isWorking, let candidate = candidates.first(where: { $0.id == candidateId }) else { return false }
        isWorking = true
        defer { isWorking = false }
        do {
            let snapshot = try await documents.document(tripId: trip.id)
            guard snapshot.canEdit else { errorMessage = "이 일정을 바꿀 권한이 없어요."; return false }
            var document = snapshot.document
            guard document.hasDay(dayIndex) else { errorMessage = "그 날짜는 일정에 없어요"; return false }
            if let expectedRevision, expectedRevision != snapshot.revision {
                errorMessage = "미리보기를 연 뒤 일정이 바뀌었어요. 닫고 다시 위치를 골라 주세요."
                return false
            }
            if let location = candidateLocation(candidateId, in: document) {
                document.moveSpots(fromDay: location.day, indexes: IndexSet(integer: location.index),
                                   toDay: dayIndex, position: position ?? document.days[dayIndex].spots.count)
            } else if candidate.status == "SCHEDULED" {
                errorMessage = "이미 일정에 넣은 후보지만 연결된 장소를 찾지 못했어요. 일정에서 위치를 먼저 확인해 주세요."
                return false
            } else {
                document.insertSpot(CandidateBoardViewModel.spot(from: candidate), dayIndex: dayIndex, after: position.map { $0 - 1 })
            }
            if document != snapshot.document {
                _ = try await documents.saveDocument(tripId: trip.id, document: document, expectedRevision: snapshot.revision)
            }
        } catch {
            errorMessage = message(for: error)
            return false
        }
        var marking: String?
        do {
            try await service.manageCandidate(tripId: trip.id, candidateId: candidateId, action: "SCHEDULE", value: String(dayIndex + 1))
            toast = "Day \(dayIndex + 1)에 넣었어요"
        } catch {
            marking = "일정에는 넣었지만 후보 표시를 바꾸지 못했어요 — \(message(for: error))"
        }
        // 목록을 다시 읽으면 errorMessage가 지워진다 — 반쪽 성공은 그 뒤에 다시 말한다.
        if reloadAfter { await load() }
        if let marking { errorMessage = marking }
        return marking == nil
    }

    /// §24의 "자유시간으로 분리" → §25~§27. 가고 싶은 사람은 그 후보로, 나머지는 자유시간으로 가고 끝나면 합류한다.
    /// 세 줄을 고른 날 **맨 뒤**에 붙인다 — 후보를 넣을 때와 같은 규칙이라 위치를 추측하지 않는다(§12).
    /// 만들어 주는 것은 자리와 참여자까지고, 자유시간에 무엇을 할지는 그 사람들이 정한다(§23).
    ///
    /// `schedule`과 같은 순서다: **문서 저장이 먼저**고 후보 표시가 그다음이며, 표시가 실패해도
    /// 일정에는 들어갔다고 정직하게 말한다.
    @discardableResult
    func split(candidateId: Int, dayIndex: Int, splitId: String = CandidateBoardViewModel.newSplitId()) async -> Bool {
        guard canSchedule, !isWorking, let candidate = candidates.first(where: { $0.id == candidateId }) else { return false }
        guard let plan = CollabModel.buildSplitPlan(candidate, members: members, splitId: splitId) else {
            errorMessage = "갈릴 사람이 없어요 — 다 같이 가거나, 이번엔 빼는 쪽이에요"
            return false
        }
        isWorking = true
        defer { isWorking = false }
        do {
            let snapshot = try await documents.document(tripId: trip.id)
            guard snapshot.canEdit else { errorMessage = "이 일정을 바꿀 권한이 없어요."; return false }
            var document = snapshot.document
            guard document.hasDay(dayIndex) else { errorMessage = "그 날짜는 일정에 없어요"; return false }
            for spot in plan.spots { document.insertSpot(spot, dayIndex: dayIndex) }
            _ = try await documents.saveDocument(tripId: trip.id, document: document, expectedRevision: snapshot.revision)
        } catch {
            errorMessage = message(for: error)
            return false
        }
        var marking: String?
        do {
            try await service.manageCandidate(tripId: trip.id, candidateId: candidateId, action: "SCHEDULE", value: String(dayIndex + 1))
            toast = "같은 시간에 나란히 넣었어요 — 끝나면 합류합니다"
        } catch {
            marking = "일정에는 넣었지만 후보 표시를 바꾸지 못했어요 — \(message(for: error))"
        }
        await load()
        if let marking { errorMessage = marking }
        return marking == nil
    }

    /// 분리 묶음 키. 웹 `uid()`와 같은 형식(`_ID_RE` = `[A-Za-z0-9_-]{1,40}`)이라 정규화를 지난다.
    nonisolated static func newSplitId(now: Date = Date()) -> String {
        let stamp = String(Int(now.timeIntervalSince1970 * 1000), radix: 36)
        let alphabet = Array("0123456789abcdefghijklmnopqrstuvwxyz")
        let random = String((0..<6).map { _ in alphabet[Int.random(in: 0..<alphabet.count)] })
        return "sp\(stamp)\(random)"
    }

    private func candidateLocation(_ candidateId: Int, in document: TripDocument) -> (day: Int, index: Int)? {
        for (day, value) in document.days.enumerated() {
            if let index = value.spots.firstIndex(where: { $0.raw["candidateId"]?.doubleValue == Double(candidateId) }) {
                return (day, index)
            }
        }
        return nil
    }

    /// 웹 `appendCandidateSpot`과 같은 모양 — 좌표가 없으면 위치 없는 장소다.
    /// 순수 매핑이라 화면 상태를 건드리지 않는다 — `nonisolated`로 두어 어디서든(테스트 포함) 부를 수 있게 한다.
    nonisolated static func spot(from candidate: CandidateView) -> TripSpot {
        var spot = TripSpot(name: candidate.title, city: "기타")
        spot.desc = candidate.note ?? ""
        if let address = candidate.addr { spot.setField("addr", .string(address)) }
        if let lat = candidate.lat, let lng = candidate.lng { spot.point = GeoPoint(lat: lat, lng: lng) } else { spot.point = nil }
        if let placeId = candidate.placeId { spot.placeId = placeId }
        if candidate.provider == "kakao", let providerId = candidate.providerId { spot.kakaoId = providerId }
        spot.setField("candidateId", .number(Double(candidate.id)))
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
            // 목록(comment_count)을 먼저 읽는다 — load()가 errorMessage를 지우므로,
            // 한마디를 다시 읽다 실패한 안내는 그 뒤에 남아야 한다(§일정 넣기와 같은 이유).
            await load()
            await loadComments(candidateId: candidateId)
            return true
        } catch {
            errorMessage = message(for: error)
            return false
        }
    }

    func deleteComment(candidateId: Int, commentId: Int) async {
        do {
            try await service.deleteComment(tripId: trip.id, commentId: commentId)
            await load()
            await loadComments(candidateId: candidateId)
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

/// 보드의 분류 거르기 — 전부 / 고르지 않음만 / 특정 분류.
enum CandidateCategoryFilter: Hashable, Sendable {
    case all
    case none
    case only(CandidateCategory)

    var label: String {
        switch self {
        case .all: "전체 분류"
        case .none: "분류 없음"
        case .only(let category): category.label
        }
    }

    func matches(_ category: CandidateCategory?) -> Bool {
        switch self {
        case .all: true
        case .none: category == nil
        case .only(let wanted): category == wanted
        }
    }
}
