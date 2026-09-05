import Foundation

// 함께하기 API 계약 — `next/src/server/application/collaboration/types.ts`의 모양 그대로(snake_case).
// 서버 응답은 RPC 반환형과 같아서 키가 snake_case다. 여기서 한 번 옮기고 화면은 Swift 이름만 본다.
//
// ⚠️ 이 파일은 앱 타깃 전용이다 — 위젯·공유·Watch는 `Contract.swift`만 함께 컴파일한다.

/// 활성 멤버 한 사람. 계정 이메일은 없다(§69) — 이름표(`display_name`)가 없으면 역할로 부른다.
struct MemberView: Codable, Hashable, Sendable, Identifiable {
    let id: Int
    let userId: String
    let role: MemberRole
    let status: String
    let displayName: String?
    let joinedAt: String?
    let me: Bool

    enum CodingKeys: String, CodingKey {
        case id, role, status, me
        case userId = "user_id", displayName = "display_name", joinedAt = "joined_at"
    }
}

struct InviteView: Codable, Hashable, Sendable, Identifiable {
    let id: Int
    let role: MemberRole
    let expiresAt: String
    let useCount: Int
    let maxUses: Int?
    let createdAt: String
    let active: Bool

    enum CodingKeys: String, CodingKey {
        case id, role, active
        case expiresAt = "expires_at", useCount = "use_count", maxUses = "max_uses", createdAt = "created_at"
    }
}

/// 토큰은 **이 응답에만 한 번** 온다 — 서버는 해시만 저장한다.
struct InviteCreated: Codable, Hashable, Sendable {
    let id: Int
    let token: String
    let role: MemberRole
    let expiresAt: String

    enum CodingKeys: String, CodingKey {
        case id, token, role
        case expiresAt = "expires_at"
    }
}

/// 로그인 전에도 보이는 만큼만 — 이름·시작일·일수·역할. 일정 본문은 절대 없다(§6).
struct InvitePreview: Codable, Hashable, Sendable {
    let valid: Bool
    let reason: String
    let tripName: String?
    let startDate: String?
    let dayCount: Int?
    let role: MemberRole?
    let expiresAt: String?
    let alreadyMember: Bool

    enum CodingKeys: String, CodingKey {
        case valid, reason, role
        case tripName = "trip_name", startDate = "start_date", dayCount = "day_count"
        case expiresAt = "expires_at", alreadyMember = "already_member"
    }
}

struct InviteAccept: Codable, Hashable, Sendable {
    let ok: Bool
    let reason: String
    let clientId: String?
    let tripName: String?
    let role: MemberRole?
    let alreadyMember: Bool

    enum CodingKeys: String, CodingKey {
        case ok, reason, role
        case clientId = "client_id", tripName = "trip_name", alreadyMember = "already_member"
    }
}

/// 후보 하나 + 집계 + 내 반응 + 누가 뭐라 했는지. 서버가 세어 주지만 낙관적 갱신 뒤에도 같은 답이 나와야 해서
/// 화면은 `reactions`로 다시 센다(`CollabModel.tally`).
struct CandidateView: Codable, Hashable, Sendable, Identifiable {
    struct ReactionEntry: Codable, Hashable, Sendable {
        let name: String
        let reaction: String
        let me: Bool
    }

    let id: Int
    let title: String
    let placeId: String?
    let lat: Double?
    let lng: Double?
    let addr: String?
    let note: String?
    let url: String?
    let status: String
    let scheduledRef: String?
    let proposedByLabel: String
    let mine: Bool
    let myReaction: String?
    let mustCount: Int
    let okCount: Int
    let passCount: Int
    let reactions: [ReactionEntry]
    let commentCount: Int
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, title, lat, lng, addr, note, url, status, mine, reactions
        case placeId = "place_id", scheduledRef = "scheduled_ref", proposedByLabel = "proposed_by_label"
        case myReaction = "my_reaction", mustCount = "must_count", okCount = "ok_count", passCount = "pass_count"
        case commentCount = "comment_count", createdAt = "created_at"
    }
}

struct CommentView: Codable, Hashable, Sendable, Identifiable {
    let id: Int
    let body: String
    let authorLabel: String
    let mine: Bool
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, body, mine
        case authorLabel = "author_label", createdAt = "created_at"
    }
}

/// 활동 한 건의 재료. 문장은 `CollabModel.activityText`가 만든다(§39) — 서버는 kind·subject·이름표만 준다.
struct ActivityView: Codable, Hashable, Sendable, Identifiable {
    let id: Int
    let kind: String
    let actorLabel: String
    let mine: Bool
    let memberLabel: String?
    let subject: [String: JSONValue]
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, kind, mine, subject
        case actorLabel = "actor_label", memberLabel = "member_label", createdAt = "created_at"
    }
}

struct PreferenceView: Codable, Hashable, Sendable, Identifiable {
    let userId: String
    let label: String
    let role: MemberRole
    let mine: Bool
    let prefs: [String: JSONValue]

    var id: String { userId }

    enum CodingKeys: String, CodingKey {
        case label, role, mine, prefs
        case userId = "user_id"
    }
}

// MARK: 응답 봉투

struct MembersResponse: Codable, Sendable { let members: [MemberView] }
struct InvitesResponse: Codable, Sendable { let invites: [InviteView] }
struct InviteCreatedResponse: Codable, Sendable { let invite: InviteCreated }
struct InvitePreviewResponse: Codable, Sendable { let preview: InvitePreview }
struct InviteAcceptResponse: Codable, Sendable { let result: InviteAccept }
struct CandidatesResponse: Codable, Sendable { let candidates: [CandidateView] }
struct CommentsResponse: Codable, Sendable { let comments: [CommentView] }
struct ActivityResponse: Codable, Sendable { let activity: [ActivityView] }
struct PreferencesResponse: Codable, Sendable { let preferences: [PreferenceView] }
struct PrefsSavedResponse: Codable, Sendable { let prefs: [String: JSONValue] }
struct OkResponse: Codable, Sendable { let ok: Bool }
struct CreatedIdResponse: Codable, Sendable { let id: Int }
