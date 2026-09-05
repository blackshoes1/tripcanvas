import Foundation

/// 함께하기 화면이 의존하는 계약. 테스트에서 가짜로 갈아끼운다.
///
/// 전부 `/api/v1`이다 — 접근 제어는 서버(DB)가 하고, 여기는 경로·본문만 만든다. 권한 거절은 `APIError.forbidden`으로
/// 오고 화면은 그것을 **재시도하지 않는다**(재시도해도 같은 답이다).
@MainActor
protocol CollabSource {
    func members(tripId: String) async throws -> [MemberView]
    func manageMember(tripId: String, memberId: Int, action: String, value: String?) async throws
    func leave(tripId: String) async throws

    func invites(tripId: String) async throws -> [InviteView]
    func createInvite(tripId: String, role: MemberRole, hours: Int) async throws -> InviteCreated
    func revokeInvite(tripId: String, inviteId: Int) async throws
    func previewInvite(token: String) async throws -> InvitePreview
    func acceptInvite(token: String, displayName: String?) async throws -> InviteAccept

    func candidates(tripId: String) async throws -> [CandidateView]
    func addCandidate(tripId: String, title: String, note: String?, lat: Double?, lng: Double?, placeId: String?, addr: String?) async throws -> Int
    func react(tripId: String, candidateId: Int, reaction: Reaction?) async throws
    func manageCandidate(tripId: String, candidateId: Int, action: String, value: String?) async throws

    func comments(tripId: String, candidateId: Int) async throws -> [CommentView]
    func addComment(tripId: String, candidateId: Int, body: String) async throws
    func deleteComment(tripId: String, commentId: Int) async throws

    func activity(tripId: String, limit: Int) async throws -> [ActivityView]
    func preferences(tripId: String) async throws -> [PreferenceView]
    func savePreferences(tripId: String, prefs: [String: JSONValue]) async throws -> [String: JSONValue]
}

extension TripService: CollabSource {
    private func tripPath(_ tripId: String) -> String { "/api/v1/trips/\(tripId)" }
    /// JSON의 null. Optional을 그대로 넣으면 직렬화가 거부한다.
    private func orNull(_ value: Any?) -> Any { value ?? NSNull() }

    func members(tripId: String) async throws -> [MemberView] {
        let response: MembersResponse = try await api.get("\(tripPath(tripId))/members")
        return response.members
    }

    func manageMember(tripId: String, memberId: Int, action: String, value: String?) async throws {
        let _: OkResponse = try await api.patch("\(tripPath(tripId))/members/\(memberId)", body: ["action": action, "value": orNull(value)])
    }

    func leave(tripId: String) async throws {
        let _: OkResponse = try await api.post("\(tripPath(tripId))/members/leave", body: [:])
    }

    func invites(tripId: String) async throws -> [InviteView] {
        let response: InvitesResponse = try await api.get("\(tripPath(tripId))/invites")
        return response.invites
    }

    /// 토큰은 이 응답에만 한 번 온다.
    func createInvite(tripId: String, role: MemberRole, hours: Int) async throws -> InviteCreated {
        let response: InviteCreatedResponse = try await api.post(
            "\(tripPath(tripId))/invites", body: ["role": role.rawValue, "hours": hours, "maxUses": NSNull()])
        return response.invite
    }

    func revokeInvite(tripId: String, inviteId: Int) async throws {
        let _: OkResponse = try await api.delete("\(tripPath(tripId))/invites/\(inviteId)")
    }

    func previewInvite(token: String) async throws -> InvitePreview {
        let response: InvitePreviewResponse = try await api.get("/api/v1/invites/\(token)")
        return response.preview
    }

    /// 여기서만 멤버십이 생긴다(§67). 멱등 — 이미 멤버면 `alreadyMember`.
    func acceptInvite(token: String, displayName: String?) async throws -> InviteAccept {
        let response: InviteAcceptResponse = try await api.post(
            "/api/v1/invites/\(token)/accept", body: ["displayName": orNull(displayName)])
        return response.result
    }

    func candidates(tripId: String) async throws -> [CandidateView] {
        let response: CandidatesResponse = try await api.get("\(tripPath(tripId))/candidates")
        return response.candidates
    }

    func addCandidate(tripId: String, title: String, note: String?, lat: Double?, lng: Double?, placeId: String?, addr: String?) async throws -> Int {
        let body: [String: Any] = [
            "title": title, "note": orNull(note), "lat": orNull(lat), "lng": orNull(lng),
            "place_id": orNull(placeId), "addr": orNull(addr), "url": NSNull()
        ]
        let response: CreatedIdResponse = try await api.post("\(tripPath(tripId))/candidates", body: body)
        return response.id
    }

    /// 한 사람 한 표. nil이면 거두기. 멱등.
    func react(tripId: String, candidateId: Int, reaction: Reaction?) async throws {
        let _: OkResponse = try await api.put(
            "\(tripPath(tripId))/candidates/\(candidateId)/reaction", body: ["reaction": orNull(reaction?.rawValue)])
    }

    func manageCandidate(tripId: String, candidateId: Int, action: String, value: String?) async throws {
        let _: OkResponse = try await api.patch(
            "\(tripPath(tripId))/candidates/\(candidateId)", body: ["action": action, "value": orNull(value)])
    }

    func comments(tripId: String, candidateId: Int) async throws -> [CommentView] {
        let response: CommentsResponse = try await api.get("\(tripPath(tripId))/candidates/\(candidateId)/comments")
        return response.comments
    }

    func addComment(tripId: String, candidateId: Int, body: String) async throws {
        let _: CreatedIdResponse = try await api.post("\(tripPath(tripId))/candidates/\(candidateId)/comments", body: ["body": body])
    }

    func deleteComment(tripId: String, commentId: Int) async throws {
        let _: OkResponse = try await api.delete("\(tripPath(tripId))/comments/\(commentId)")
    }

    func activity(tripId: String, limit: Int) async throws -> [ActivityView] {
        let response: ActivityResponse = try await api.get(
            "\(tripPath(tripId))/activity", query: [URLQueryItem(name: "limit", value: String(limit))])
        return response.activity
    }

    func preferences(tripId: String) async throws -> [PreferenceView] {
        let response: PreferencesResponse = try await api.get("\(tripPath(tripId))/preferences")
        return response.preferences
    }

    /// 정규화된 결과를 돌려준다 — 저장 뒤에는 이것이 이긴다.
    func savePreferences(tripId: String, prefs: [String: JSONValue]) async throws -> [String: JSONValue] {
        let response: PrefsSavedResponse = try await api.put(
            "\(tripPath(tripId))/preferences", jsonBody: try JSONValue.data(from: ["prefs": .object(prefs)]))
        return response.prefs
    }
}
