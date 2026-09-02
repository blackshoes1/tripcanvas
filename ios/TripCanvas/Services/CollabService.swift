import Foundation

/// 함께하기 호출을 화면에서 감춘다. 후보·반응·코멘트·취향·활동이 전부 여기를 지난다.
///
/// **판단은 서버가 끝내 준다.** 묶음·배지 문장·충돌 선택지·그룹 제안은 응답에 이미 들어 있고
/// 이 계층은 경로와 본문만 만든다 — `collab.js`를 Swift로 옮기지 않는다(§8).
///
/// 변경 응답이 **바뀐 보드 전체**인 것도 그 때문이다. 반응 하나를 눌렀을 때 달라지는 것은
/// 그 카드만이 아니다: 묶음이 옮겨 가고, 배지 문장이 바뀌고, 그룹 제안이 다시 계산된다.
/// 클라이언트가 그 파급을 흉내내면 웹과 갈린다.
@MainActor
protocol CollabDataSource {
    func board(tripId: String) async throws -> CandidateBoardResponse
    func addCandidate(tripId: String, title: String, location: GeoPoint?, note: String?, url: String?) async throws -> CandidateBoardResponse
    func react(tripId: String, candidateId: String, reaction: ReactionKind?) async throws -> CandidateBoardResponse
    func manage(tripId: String, candidateId: String, action: CollabService.CandidateAction, value: String?) async throws -> CandidateBoardResponse
    func comments(tripId: String, candidateId: String) async throws -> CommentListResponse
    func addComment(tripId: String, candidateId: String, body: String) async throws -> CommentListResponse
    func deleteComment(tripId: String, candidateId: String, commentId: String) async throws -> CommentListResponse
    func preferences(tripId: String) async throws -> PreferenceResponse
    func savePreferences(tripId: String, prefs: MemberPreference) async throws -> PreferenceResponse
    func activity(tripId: String, limit: Int) async throws -> ActivityListResponse
}

@MainActor
final class CollabService: CollabDataSource {
    private let api: APIClient

    init(api: APIClient) {
        self.api = api
    }

    /// 후보의 상태를 바꾸는 동작. 어떤 역할이 무엇을 할 수 있는지는 **서버(DB)가 정한다** —
    /// 여기서 미리 막는 것은 버튼을 감추는 정도이고, 경계는 RLS와 RPC다.
    enum CandidateAction: String {
        case remove = "REMOVE"
        case schedule = "SCHEDULE"
        case unschedule = "UNSCHEDULE"
        case reject = "REJECT"
        case reopen = "REOPEN"
    }

    private func base(_ tripId: String) -> String {
        "/api/v1/trips/\(tripId)/candidates"
    }

    func board(tripId: String) async throws -> CandidateBoardResponse {
        try await api.get(base(tripId))
    }

    func addCandidate(tripId: String, title: String, location: GeoPoint?, note: String?, url: String?) async throws -> CandidateBoardResponse {
        var body: [String: Any] = ["title": title]
        if let location { body["location"] = ["lat": location.lat, "lng": location.lng] }
        if let note, !note.isEmpty { body["note"] = note }
        if let url, !url.isEmpty { body["url"] = url }
        return try await api.post(base(tripId), body: body)
    }

    /// reaction이 nil이면 반응을 거둔다. 같은 값을 두 번 보내도 결과가 같다(멱등).
    func react(tripId: String, candidateId: String, reaction: ReactionKind?) async throws -> CandidateBoardResponse {
        // JSONSerialization은 Optional을 값으로 받지 못한다 — 거두기는 명시적인 null이어야 한다.
        let value: Any = (reaction == nil || reaction == .unknown) ? NSNull() : reaction!.rawValue
        return try await api.post("\(base(tripId))/\(candidateId)/react", body: ["reaction": value])
    }

    func manage(tripId: String, candidateId: String, action: CandidateAction, value: String? = nil) async throws -> CandidateBoardResponse {
        var body: [String: Any] = ["action": action.rawValue]
        if let value { body["value"] = value }
        return try await api.post("\(base(tripId))/\(candidateId)/manage", body: body)
    }

    func comments(tripId: String, candidateId: String) async throws -> CommentListResponse {
        try await api.get("\(base(tripId))/\(candidateId)/comments")
    }

    func addComment(tripId: String, candidateId: String, body: String) async throws -> CommentListResponse {
        try await api.post("\(base(tripId))/\(candidateId)/comments", body: ["body": body])
    }

    func deleteComment(tripId: String, candidateId: String, commentId: String) async throws -> CommentListResponse {
        try await api.delete("\(base(tripId))/\(candidateId)/comments/\(commentId)")
    }

    func preferences(tripId: String) async throws -> PreferenceResponse {
        try await api.get("/api/v1/trips/\(tripId)/preferences")
    }

    /// 저장 뒤에는 **서버가 돌려준 것이 이긴다** — 화면이 보낸 값을 그대로 믿지 않는다(§16).
    func savePreferences(tripId: String, prefs: MemberPreference) async throws -> PreferenceResponse {
        try await api.put("/api/v1/trips/\(tripId)/preferences", body: ["prefs": prefs.payload])
    }

    func activity(tripId: String, limit: Int = 40) async throws -> ActivityListResponse {
        try await api.get("/api/v1/trips/\(tripId)/activity", query: [URLQueryItem(name: "limit", value: String(limit))])
    }
}
