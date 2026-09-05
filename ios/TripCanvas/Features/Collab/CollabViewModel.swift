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

    func load() async {
        if members.isEmpty { isLoading = true }
        defer { isLoading = false }
        do {
            members = try await service.members(tripId: trip.id)
            errorMessage = nil
        } catch {
            errorMessage = message(for: error)
            return
        }
        // 나머지는 각자 실패해도 멤버 목록은 남는다 — 화면 전체를 못 쓰게 만들지 않는다.
        invites = canManage ? ((try? await service.invites(tripId: trip.id)) ?? []).filter(\.active) : []
        preferences = (try? await service.preferences(tripId: trip.id)) ?? []
        activity = CollabModel.condensed((try? await service.activity(tripId: trip.id, limit: 40)) ?? [])
    }

    func clearToast() { toast = nil }
    func dismissError() { errorMessage = nil }

    // MARK: 멤버

    func setRole(memberId: Int, role: MemberRole) async {
        await perform("권한을 바꿨어요") { try await self.service.manageMember(tripId: self.trip.id, memberId: memberId, action: "SET_ROLE", value: role.rawValue) }
    }

    func remove(memberId: Int) async {
        await perform("멤버를 내보냈어요") { try await self.service.manageMember(tripId: self.trip.id, memberId: memberId, action: "REMOVE", value: nil) }
    }

    /// 이 여행에서 보일 내 이름. 계정 이메일은 여행에 나오지 않는다(§69).
    func rename(_ name: String) async {
        guard let me else { return }
        let trimmed = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(CollabModel.nameMax))
        await perform("이름을 저장했어요") { try await self.service.manageMember(tripId: self.trip.id, memberId: me.id, action: "RENAME", value: trimmed) }
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
            errorMessage = isForbidden(error) ? "초대 링크는 주최자만 만들 수 있어요" : message(for: error)
        }
    }

    func revokeInvite(id: Int) async {
        await perform("초대 링크를 취소했어요") { try await self.service.revokeInvite(tripId: self.trip.id, inviteId: id) }
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

    private func perform(_ successToast: String, _ work: () async throws -> Void) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await work()
            toast = successToast
            await load()
        } catch {
            errorMessage = message(for: error)
        }
    }

    private func isForbidden(_ error: Error) -> Bool {
        guard let apiError = error as? APIError, case .forbidden = apiError else { return false }
        return true
    }

    private func message(for error: Error) -> String {
        if let apiError = error as? APIError {
            if case .forbidden(let text) = apiError {
                // 서버 hint를 우선하고, 없으면 역할에 맞는 문장 — 웹 forbiddenText와 같다.
                if text.contains("OWNER_CANNOT_LEAVE") { return "주최자는 여행을 나갈 수 없어요 — 여행을 삭제하거나 다른 사람에게 넘겨 주세요" }
                return text.isEmpty ? "이 여행을 바꿀 권한이 없어요" : text
            }
            return apiError.errorDescription ?? "요청을 처리하지 못했어요."
        }
        return error.localizedDescription
    }
}
