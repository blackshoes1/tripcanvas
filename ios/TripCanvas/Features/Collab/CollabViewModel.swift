import Foundation
import Observation

/// 함께하기 화면의 상태 — 멤버 · 초대 · 여행 취향 · 최근 활동.
///
/// source of truth는 서버(DB)다. 여기서 하는 것은 읽고, 바꾸고, **다시 읽는 것**뿐이다 — 응답을 믿고 화면을 짜맞추지 않는다.
/// 권한 거절(`APIError.forbidden`)은 재시도하지 않는다: 재시도해도 같은 답이다.
@Observable
@MainActor
final class CollabViewModel {
    private(set) var members: [MemberView] = []
    private(set) var invites: [InviteView] = []
    private(set) var preferences: [PreferenceView] = []
    private(set) var activity: [CollabModel.CondensedActivity] = []
    private(set) var isLoading = false
    private(set) var isWorking = false
    private(set) var errorMessage: String?
    private(set) var toast: String?
    /// 방금 만든 초대 링크. 토큰은 서버가 다시 주지 않으므로 여기서만 보인다.
    private(set) var createdInviteLink: String?
    /// 취향을 저장할 때마다 오른다. 화면은 이 값이 바뀌면 **서버가 돌려준 것으로** 입력칸을 맞춘다 —
    /// 서버가 모르는 값을 떨어뜨렸으면 화면에도 그렇게 보여야 한다.
    private(set) var prefsSaveStamp = 0
    /// 나갔다 — 화면은 이걸 보고 목록으로 돌아간다.
    private(set) var hasLeft = false
    /// 전부를 서버에서 마지막으로 받은 시각 — 시트를 다시 열 때 또 받을지의 기준.
    private(set) var loadedAt: Date?

    let trip: TripSummary
    private let service: CollabSource
    private let webBaseURL: URL

    init(trip: TripSummary, service: CollabSource, webBaseURL: URL) {
        self.trip = trip
        self.service = service
        self.webBaseURL = webBaseURL
    }

    /// 내 역할. 멤버 목록의 `me` 행이 먼저고, 없으면 여행 요약이 말한 것.
    var role: MemberRole {
        members.first { $0.me }?.role ?? trip.role ?? .owner
    }

    var me: MemberView? { members.first { $0.me } }
    var canManage: Bool { CollabModel.canManage(role) }
    var canLeave: Bool { CollabModel.canLeave(role) }
    var memberCount: Int { max(members.count, trip.memberCount ?? 1) }
    var myPrefs: TripPrefs { TripPrefs(raw: preferences.first { $0.mine }?.prefs ?? [:]) }
    var groupContext: [String] { CollabModel.groupContextText(preferences, memberCount: memberCount) }

    /// 시트를 열 때 부른다 — 방금 받은 것이면 그대로다(Today·Plan과 같은 60초 규칙, 2026-09-18). 변경·당겨서 새로고침은 `load()`다.
    func loadIfStale(maxAge: TimeInterval = 60, now: Date = Date()) async {
        if !members.isEmpty, let loadedAt, now.timeIntervalSince(loadedAt) < maxAge { return }
        await load()
    }

    func load() async {
        if members.isEmpty { isLoading = true }
        defer { isLoading = false }
        await reload(.all)
    }

    /// 바뀐 것만 다시 읽는다(2026-09-18, 전에는 이름 하나 바꿔도 4건이었다). 멤버를 못 읽으면 나머지는 건드리지 않는다.
    private func reload(_ parts: CollabRefresh) async {
        if parts.contains(.members) {
            do {
                members = try await service.members(tripId: trip.id)
                errorMessage = nil
            } catch {
                errorMessage = message(for: error)
                return
            }
        }
        // 나머지는 각자 실패해도 멤버 목록은 남는다 — 화면 전체를 못 쓰게 만들지 않는다.
        if parts.contains(.invites) { invites = canManage ? ((try? await service.invites(tripId: trip.id)) ?? []).filter(\.active) : [] }
        if parts.contains(.preferences) { preferences = (try? await service.preferences(tripId: trip.id)) ?? [] }
        if parts.contains(.activity) { activity = CollabModel.condensed((try? await service.activity(tripId: trip.id, limit: 40)) ?? []) }
        if parts == .all { loadedAt = Date() }
    }

    func clearToast() { toast = nil }
    func dismissError() { errorMessage = nil }

    // MARK: 멤버

    func setRole(memberId: Int, role: MemberRole) async {
        await perform("권한을 바꿨어요", refresh: [.members, .activity]) { try await self.service.manageMember(tripId: self.trip.id, memberId: memberId, action: "SET_ROLE", value: role.rawValue) }
    }

    func remove(memberId: Int) async {
        await perform("멤버를 내보냈어요", refresh: [.members, .activity]) { try await self.service.manageMember(tripId: self.trip.id, memberId: memberId, action: "REMOVE", value: nil) }
    }

    /// 이 여행에서 보일 내 이름. 계정 이메일은 여행에 나오지 않는다(§69).
    func rename(_ name: String) async {
        guard let me else { return }
        let trimmed = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(CollabModel.nameMax))
        await perform("이름을 저장했어요", refresh: [.members, .activity]) { try await self.service.manageMember(tripId: self.trip.id, memberId: me.id, action: "RENAME", value: trimmed) }
    }

    /// 나가기 — 소유자는 못 나간다(§71). 성공하면 `hasLeft`.
    func leave() async {
        guard canLeave else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            try await service.leave(tripId: trip.id)
            hasLeft = true
        } catch {
            errorMessage = message(for: error)
        }
    }

    // MARK: 초대 — 소유자만. 링크는 웹 주소다(받는 사람에게 앱이 없을 수 있다)

    func createInvite(role: MemberRole) async {
        guard canManage else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            let created = try await service.createInvite(tripId: trip.id, role: role, hours: CollabModel.inviteHours)
            createdInviteLink = CollabModel.inviteLink(webBase: webBaseURL, token: created.token)
            toast = "초대 링크를 만들었어요 — 일행에게 보내 주세요"
            invites = ((try? await service.invites(tripId: trip.id)) ?? []).filter(\.active)
        } catch {
            // 서버가 "초대 링크는 주최자만 만들 수 있습니다"라고 더 정확히 말한다 — 덮어쓰지 않는다.
            errorMessage = message(for: error)
        }
    }

    func revokeInvite(id: Int) async {
        // 초대 취소는 활동 기록에 남지 않는다 — 초대 목록만 다시 읽는다.
        await perform("초대 링크를 취소했어요", refresh: [.invites]) { try await self.service.revokeInvite(tripId: self.trip.id, inviteId: id) }
    }

    func clearCreatedInvite() { createdInviteLink = nil }

    // MARK: 취향 — 의견이라 보기 권한도 남긴다. 본인 것만

    func savePrefs(_ prefs: TripPrefs) async {
        isWorking = true
        defer { isWorking = false }
        do {
            _ = try await service.savePreferences(tripId: trip.id, prefs: prefs.raw)
            toast = "취향을 저장했어요"
            preferences = (try? await service.preferences(tripId: trip.id)) ?? preferences   // 서버가 돌려준 것이 이긴다
            prefsSaveStamp += 1
        } catch {
            errorMessage = message(for: error)
        }
    }

    // MARK: 공통

    private func perform(_ successToast: String, refresh: CollabRefresh = .all, _ work: () async throws -> Void) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await work()
            toast = successToast
            await reload(refresh)
        } catch {
            errorMessage = message(for: error)
        }
    }

    private func message(for error: Error) -> String {
        if let apiError = error as? APIError {
            if case .forbidden(let text) = apiError { return CollabModel.forbiddenText(text, role: role) }
            return apiError.errorDescription ?? "요청을 처리하지 못했어요."
        }
        return error.localizedDescription
    }
}

/// 함께하기 화면에서 다시 읽을 것 — 변경마다 전부(4건)를 읽지 않기 위해 고른다.
struct CollabRefresh: OptionSet, Sendable {
    let rawValue: Int
    static let members = CollabRefresh(rawValue: 1)
    static let invites = CollabRefresh(rawValue: 2)
    static let preferences = CollabRefresh(rawValue: 4)
    static let activity = CollabRefresh(rawValue: 8)
    static let all: CollabRefresh = [.members, .invites, .preferences, .activity]
}
