import Foundation

// 함께하기 — 판정과 표현(순수). `collab.js`의 **복사본**이다.
//
// 접근 제어의 진짜 경계는 DB(RLS·RPC)고, 여기는 무엇을 감출지·어떤 문장을 보일지만 정한다. 여기서 '편집 가능'이라
// 해도 서버가 거절하면 그게 답이다. 규칙을 바꿀 때는 `collab.js`를 먼저 고치고 여기를 따라 맞춘다 —
// 두 벌이 갈리면 같은 후보를 두고 웹과 앱이 다른 말을 한다(`test/collab.test.js` ↔ `CollabModelTests`).
//
// 점수(0~100)는 **내부값**이다. 화면에는 문장만 나간다(§21·§22).

/// 반응 세 가지. 설문이 아니다 — 한 번의 탭이고, 다시 누르면 거둔다(§9).
enum Reaction: String, CaseIterable, Sendable {
    case must = "MUST", ok = "OK", pass = "PASS"

    init?(loose raw: String?) {
        guard let raw else { return nil }
        self.init(rawValue: raw.trimmingCharacters(in: .whitespaces).uppercased())
    }

    var label: String {
        switch self {
        case .must: "꼭 가고 싶어요"
        case .ok: "괜찮아요"
        case .pass: "이번엔 패스"
        }
    }

    var icon: String {
        switch self {
        case .must: "❤️"
        case .ok: "👍"
        case .pass: "👋"
        }
    }
}

/// 후보가 지금 어떤 상태인지 — 점수가 아니라 **다음에 무엇을 하면 되는지**(§57·§58).
enum CandidateMood: Sendable {
    case none, quiet, split, cool, loved

    var text: String {
        switch self {
        case .none: "아직 아무도 의견을 안 냈어요"
        case .quiet: "의견이 더 필요해요"
        case .split: "의견이 갈려요"
        case .cool: "아직 끌리는 사람이 없어요"
        case .loved: "다들 좋아해요"
        }
    }
}

enum ConsensusStatus: Sendable {
    case strongMatch, goodMatch, mixed, conflict

    var text: String {
        switch self {
        case .strongMatch: "모두가 좋아할 가능성이 높아요"
        case .goodMatch: "괜찮아 보여요 — 반대가 없어요"
        case .mixed: "의견이 조금 갈려요"
        case .conflict: "의견이 갈려 있어요"
        }
    }
}

enum VerdictTone: Sendable { case good, split, mixed, quiet }

struct ReactionTally: Equatable, Sendable {
    let must: Int, ok: Int, pass: Int
    let voted: Int, silent: Int, members: Int
}

struct Consensus: Equatable, Sendable {
    /// 내부값 — 정렬에만 쓴다. 화면에 쓰지 않는다.
    let score: Int
    let strongSupportCount: Int
    let oppositionCount: Int
    let status: ConsensusStatus?
    let voted: Int
    let members: Int
}

struct CandidateGroups: Sendable {
    var loved: [CandidateView] = []
    var needsOpinion: [CandidateView] = []
    var resting: [CandidateView] = []
    var scheduled: [CandidateView] = []
    var rejected: [CandidateView] = []
}

/// §23 갈린 후보 — MUST와 PASS가 같이 있을 때만. 자동 제거는 없다.
struct CandidateConflict: Equatable, Sendable {
    let title: String
    let must: [String], ok: [String], pass: [String]

    struct Option: Equatable, Sendable {
        enum Key: Sendable { case together, split, skip }
        let key: Key
        let title: String
        let text: String
        /// 서버 액션. 분리(SPLIT)는 다음 단계라 없다(안내만).
        let action: String?
    }

    /// §24 세 선택지.
    var options: [Option] {
        let mustNames = must.joined(separator: ", "), passNames = pass.joined(separator: ", ")
        return [
            Option(key: .together, title: "다 같이 방문",
                   text: passNames.isEmpty ? "다 같이 들러요" : "\(passNames)도 함께 — 짧게 들르는 걸로", action: "SCHEDULE"),
            Option(key: .split, title: "자유시간으로 분리",
                   text: "\(mustNames.isEmpty ? "원하는 분" : mustNames)은(는) \(title) · \(passNames.isEmpty ? "다른 분" : passNames)은(는) 다른 곳 — 분리 일정은 다음 단계에서",
                   action: nil),
            Option(key: .skip, title: "이번 일정에서는 제외",
                   text: "후보에는 남겨 두고 이번엔 빼요 — 언제든 되돌릴 수 있어요", action: "REJECT")
        ]
    }
}

enum CollabModel {
    // MARK: 역할 — 화면 판정(경계는 DB)

    static func canEdit(_ role: MemberRole) -> Bool { role == .owner || role == .editor }
    static func canManage(_ role: MemberRole) -> Bool { role == .owner }
    /// 소유자는 못 나간다(§71).
    static func canLeave(_ role: MemberRole) -> Bool { role == .editor || role == .viewer }
    static func canPropose(_ role: MemberRole) -> Bool { canEdit(role) }
    /// 반응·코멘트는 활성 멤버라면 누구나 — 의견을 내는 것은 일정을 바꾸는 것이 아니다.
    static func canReact(_ role: MemberRole) -> Bool { role != .unknown }
    static func canComment(_ role: MemberRole) -> Bool { role != .unknown }
    static func canScheduleCandidate(_ role: MemberRole) -> Bool { canEdit(role) }
    /// 후보를 거두는 기준은 역할이 아니라 '누가 냈는가'다 — 낸 사람이나 주최자만.
    static func canRemoveCandidate(_ role: MemberRole, mine: Bool) -> Bool { mine || role == .owner }
    static func canDeleteComment(_ role: MemberRole, mine: Bool) -> Bool { mine || role == .owner }

    static func roleLabel(_ role: MemberRole) -> String {
        switch role {
        case .owner: "주최자"
        case .editor: "편집"
        case .viewer: "보기"
        case .unknown: "멤버"
        }
    }

    static func roleIcon(_ role: MemberRole) -> String {
        switch role {
        case .owner: "👑"
        case .editor: "✏️"
        case .viewer: "👀"
        case .unknown: "👤"
        }
    }

    static let nameMax = 40
    static let inviteHours = 168      // 7일. 영원한 링크는 만들지 않는다
    static let tokenMin = 16, tokenMax = 128

    /// 멤버의 표시 이름. 계정 정보는 여행에 노출하지 않으므로(§69) 이름이 없으면 역할로 부른다.
    static func memberName(_ member: MemberView) -> String {
        let name = (member.displayName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty { return String(name.prefix(nameMax)) }
        return member.role == .owner ? "주최자" : "멤버"
    }

    // MARK: 함께 움직이지 않는 시간 (§25~§27)
    //
    // ⚠️ `collab.js`의 `whoLabels`/`whoText`/`includesMe` **복사본**이다.
    // 규칙을 바꿔야 하면 `collab.js`를 먼저 고치고, `who-text.json` 픽스처가 여기를 깨뜨린다.

    /// 참여자 이름표. **나는 늘 '나'로 부르고 맨 앞에 둔다** — 내 일정인지 한눈에 보이게.
    /// 모르는 id는 '멤버'로 둔다(나간 사람일 수 있다 — 지우지 않는다: 지난 일정의 기록이다).
    static func whoLabels(_ who: [String], members: [MemberView]) -> [String] {
        var byId: [String: (name: String, me: Bool)] = [:]
        for member in members {
            let name = (member.displayName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            byId[member.userId] = (name.isEmpty ? "멤버" : name, member.me)
        }
        var mine: [String] = []
        var rest: [String] = []
        for id in who {
            guard let hit = byId[id] else { rest.append("멤버"); continue }
            if hit.me { mine.append("나") } else { rest.append(hit.name) }
        }
        return mine + rest
    }

    /// '모두' 또는 '나 · 지민'. **비어 있으면 모든 여행자다**(§26) — 기본이 함께 다니는 것이다.
    static func whoText(_ who: [String], members: [MemberView]) -> String {
        who.isEmpty ? "모두" : whoLabels(who, members: members).joined(separator: " · ")
    }

    /// 이 일정에 내가 들어 있는가. 지정이 없으면 모두이므로 참이다.
    static func includesMe(_ who: [String], myId: String?) -> Bool {
        if who.isEmpty { return true }
        guard let myId, !myId.isEmpty else { return false }
        return who.contains(myId)
    }

    /// 이메일에서 기본 표시 이름(참여 화면의 프리필). 도메인은 버린다.
    static func displayNameFromEmail(_ email: String?) -> String {
        let local = (email ?? "").split(separator: "@", maxSplits: 1).first.map(String.init) ?? ""
        return String(local.trimmingCharacters(in: .whitespaces).prefix(nameMax))
    }

    // MARK: 초대 링크

    /// 초대 링크. 토큰만 싣는다 — 여행 id·역할·만료는 서버가 토큰으로 찾는다. 받는 사람에게 앱이 없을 수 있어 **웹 주소**다.
    static func inviteLink(webBase: URL, token: String) -> String {
        var base = webBase.absoluteString.split(separator: "#", maxSplits: 1).first.map(String.init) ?? ""
        if !base.hasSuffix("/") { base += "/" }
        let encoded = token.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? token
        return base + "#join=" + encoded
    }

    /// 붙여넣은 것에서 토큰을 꺼낸다 — 웹 링크(`…/#join=토큰`)·앱 링크(`tripcanvas://join/토큰`)·토큰 자체.
    /// 형식이 어긋나면 nil: 서버에 아무 문자열이나 보내지 않는다.
    static func joinToken(from text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        var candidate = trimmed
        if let range = trimmed.range(of: "#join=") {
            candidate = String(trimmed[range.upperBound...])
            if let amp = candidate.firstIndex(of: "&") { candidate = String(candidate[..<amp]) }
            candidate = candidate.removingPercentEncoding ?? candidate
        } else if let url = URL(string: trimmed), url.scheme == "tripcanvas" {
            let parts = [url.host].compactMap { $0 } + url.pathComponents.filter { $0 != "/" }
            guard parts.count == 2, parts[0] == "join" else { return nil }
            candidate = parts[1]
        }
        return isValidToken(candidate) ? candidate : nil
    }

    static func isValidToken(_ token: String) -> Bool {
        token.count >= tokenMin && token.count <= tokenMax
            && token.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
    }

    struct InviteVerdict: Equatable, Sendable {
        let ok: Bool
        let text: String
        let alreadyMember: Bool
        let role: MemberRole?
    }

    /// 서버 reason 코드 → 사람 말.
    static func joinReasonText(_ reason: String?) -> String {
        switch (reason ?? "").uppercased() {
        case "OK": ""
        case "EXPIRED": "초대 링크가 만료됐어요. 보낸 사람에게 새 링크를 받아 주세요"
        case "REVOKED": "취소된 초대 링크예요. 보낸 사람에게 새 링크를 받아 주세요"
        case "EXHAUSTED": "이 링크는 사용 한도에 도달했어요. 보낸 사람에게 새 링크를 받아 주세요"
        case "TRIP_DELETED": "그 여행은 삭제됐어요"
        case "REMOVED": "이 여행에서 내보내진 뒤라 이 링크로는 다시 참여할 수 없어요. 새 링크를 받아 주세요"
        case "NETWORK": "초대 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요"
        default: "초대 링크가 올바르지 않아요. 보낸 사람에게 다시 받아 주세요"
        }
    }

    static func inviteVerdict(_ preview: InvitePreview?) -> InviteVerdict {
        guard let preview else { return InviteVerdict(ok: false, text: joinReasonText("NETWORK"), alreadyMember: false, role: nil) }
        let role = preview.role.flatMap { $0 == .unknown ? nil : $0 }
        if preview.alreadyMember { return InviteVerdict(ok: true, text: "이미 이 여행에 참여하고 있어요", alreadyMember: true, role: role) }
        if !preview.valid {
            let reason = preview.reason.isEmpty ? "INVALID" : preview.reason
            return InviteVerdict(ok: false, text: joinReasonText(reason), alreadyMember: false, role: role)
        }
        return InviteVerdict(ok: true, text: "", alreadyMember: false, role: role)
    }

    /// "10/25 ~ 11/7 · 14일" — 초대 카드의 한 줄. 시작일이 없으면 일수만.
    static func inviteRangeText(start: String?, dayCount: Int?) -> String {
        let n = max(0, dayCount ?? 0)
        guard let start, let first = ISODateText.date(from: start) else { return n > 0 ? "\(n)일" : "" }
        let calendar = ISODateText.calendar
        let last = calendar.date(byAdding: .day, value: max(0, n - 1), to: first) ?? first
        func short(_ date: Date) -> String {
            let parts = calendar.dateComponents([.month, .day], from: date)
            return "\(parts.month ?? 1)/\(parts.day ?? 1)"
        }
        if n > 1 { return "\(short(first)) ~ \(short(last)) · \(n)일" }
        return short(first) + (n > 0 ? " · \(n)일" : "")
    }

    // MARK: 반응 집계 · 상태 · 합의

    /// 서버가 세어 주지만 낙관적 갱신 뒤에도 같은 답이 나와야 해서 `reactions`로 다시 센다.
    static func tally(_ candidate: CandidateView, memberCount: Int) -> ReactionTally {
        var must = 0, ok = 0, pass = 0
        for entry in candidate.reactions {
            switch Reaction(loose: entry.reaction) {
            case .must: must += 1
            case .ok: ok += 1
            case .pass: pass += 1
            case nil: break
            }
        }
        let voted = must + ok + pass
        let members = max(memberCount, voted, 1)
        return ReactionTally(must: must, ok: ok, pass: pass, voted: voted, silent: max(0, members - voted), members: members)
    }

    /// 순서가 곧 규칙이다: 아무도 말 안 함 → 갈림 → 아무도 안 끌림 → 전원 찬성 → 아직 다 말 안 함.
    /// '다들 좋아해요'는 **전원이 의견을 냈고 아무도 패스하지 않았을 때만** — 둘이 좋다고 넷의 마음을 말하지 않는다.
    static func mood(_ candidate: CandidateView, memberCount: Int) -> CandidateMood {
        let t = tally(candidate, memberCount: memberCount)
        if t.voted == 0 { return .none }
        if t.must > 0 && t.pass > 0 { return .split }
        if t.must == 0 && t.pass > 0 { return .cool }
        if t.pass == 0 && t.must > 0 && t.silent == 0 { return .loved }
        return .quiet
    }

    /// §20~§22. 단순 다수결이 아니다 — MUST와 PASS의 무게가 다르고, 아직 말하지 않은 사람만큼 확신을 줄인다.
    static func consensus(_ candidate: CandidateView, memberCount: Int) -> Consensus {
        let t = tally(candidate, memberCount: memberCount)
        if t.voted == 0 { return Consensus(score: 50, strongSupportCount: 0, oppositionCount: 0, status: nil, voted: 0, members: t.members) }
        let raw = (Double(t.must) + Double(t.ok) * 0.5 - Double(t.pass)) / Double(t.members)
        var score = 50 + 50 * raw
        score = 50 + (score - 50) * (Double(t.voted) / Double(t.members))
        let rounded = max(0, min(100, Int(score.rounded())))
        let status: ConsensusStatus
        if t.must > 0 && t.pass > 0 { status = .conflict }
        else if t.pass > 0 { status = .mixed }
        else if t.must > 0 && t.silent == 0 && t.must * 2 >= t.members { status = .strongMatch }
        else { status = .goodMatch }
        return Consensus(score: rounded, strongSupportCount: t.must, oppositionCount: t.pass, status: status, voted: t.voted, members: t.members)
    }

    /// 카드 배지. 두 명 이상이 말했으면 합의 문장, 아니면 '무엇을 더 하면 되는지'(mood). 숫자는 없다.
    static func verdict(_ candidate: CandidateView, memberCount: Int) -> (text: String, tone: VerdictTone) {
        let c = consensus(candidate, memberCount: memberCount)
        if let status = c.status, c.voted >= 2 {
            let tone: VerdictTone
            switch status {
            case .strongMatch, .goodMatch: tone = .good
            case .conflict: tone = .split
            case .mixed: tone = .mixed
            }
            return (status.text, tone)
        }
        let m = mood(candidate, memberCount: memberCount)
        return (m.text, m == .loved ? .good : m == .split ? .split : .quiet)
    }

    /// 반응 요약 한 줄 — '❤️ 3 · 👍 1'. 0인 것은 쓰지 않는다.
    static func reactionSummary(_ candidate: CandidateView, memberCount: Int) -> String {
        let t = tally(candidate, memberCount: memberCount)
        var parts: [String] = []
        if t.must > 0 { parts.append("\(Reaction.must.icon) \(t.must)") }
        if t.ok > 0 { parts.append("\(Reaction.ok.icon) \(t.ok)") }
        if t.pass > 0 { parts.append("\(Reaction.pass.icon) \(t.pass)") }
        return parts.joined(separator: " · ")
    }

    /// 누가 냈는지 — 가볍게. 책임을 묻는 말이 되지 않게 한다(§13).
    static func attribution(_ candidate: CandidateView) -> String {
        if candidate.mine { return "내가 추가" }
        let name = candidate.proposedByLabel.trimmingCharacters(in: .whitespaces)
        return (name.isEmpty ? "멤버" : name) + "가 추가"
    }

    /// 만든 순으로 가르는 안정 키 — 정렬이 렌더마다 흔들리지 않는다.
    private static func key(_ candidate: CandidateView) -> String { "\(candidate.createdAt)#\(candidate.id)" }

    /// 기본은 최근 순, `byInterest`는 관심이 모인 순. **정렬은 표시일 뿐 결정이 아니다**(§12).
    static func sorted(_ candidates: [CandidateView], byInterest: Bool, memberCount: Int) -> [CandidateView] {
        if !byInterest { return candidates.sorted { key($0) > key($1) } }
        return candidates.sorted { a, b in
            let ca = consensus(a, memberCount: memberCount), cb = consensus(b, memberCount: memberCount)
            if ca.score != cb.score { return ca.score > cb.score }
            if ca.strongSupportCount != cb.strongSupportCount { return ca.strongSupportCount > cb.strongSupportCount }
            return key(a) > key(b)
        }
    }

    /// 보드의 묶음(§57·§58). '의견 필요'는 아직 결정하지 못한 것이지 나쁜 것이 아니다. 묶음이 정렬보다 먼저다.
    static func grouped(_ candidates: [CandidateView], memberCount: Int) -> CandidateGroups {
        var groups = CandidateGroups()
        for candidate in candidates {
            switch candidate.status {
            case "SCHEDULED": groups.scheduled.append(candidate)
            case "REJECTED": groups.rejected.append(candidate)
            default:
                switch mood(candidate, memberCount: memberCount) {
                case .loved: groups.loved.append(candidate)
                case .cool: groups.resting.append(candidate)
                default: groups.needsOpinion.append(candidate)   // NONE · QUIET · SPLIT — 사람이 한마디 하면 풀린다
                }
            }
        }
        return groups
    }

    static func conflict(_ candidate: CandidateView, memberCount: Int) -> CandidateConflict? {
        guard candidate.status == "PROPOSED" || candidate.status.isEmpty else { return nil }
        guard consensus(candidate, memberCount: memberCount).status == .conflict else { return nil }
        func names(_ reaction: Reaction) -> [String] {
            candidate.reactions.filter { Reaction(loose: $0.reaction) == reaction }
                .map { $0.me ? "나" : ($0.name.trimmingCharacters(in: .whitespaces).isEmpty ? "멤버" : $0.name) }
        }
        let title = candidate.title.trimmingCharacters(in: .whitespaces)
        return CandidateConflict(title: title.isEmpty ? "후보" : title, must: names(.must), ok: names(.ok), pass: names(.pass))
    }

    /// 탭 즉시 화면이 바뀌고 서버가 거절하면 되돌린다 — 집계와 `reactions`를 서버 응답과 같은 모양으로 유지한다.
    static func applyingReaction(_ reaction: Reaction?, to candidate: CandidateView) -> CandidateView {
        var reactions = candidate.reactions.filter { !$0.me }
        if let reaction { reactions.append(CandidateView.ReactionEntry(name: "나", reaction: reaction.rawValue, me: true)) }
        let must = reactions.filter { Reaction(loose: $0.reaction) == .must }.count
        let ok = reactions.filter { Reaction(loose: $0.reaction) == .ok }.count
        let pass = reactions.filter { Reaction(loose: $0.reaction) == .pass }.count
        return CandidateView(
            id: candidate.id, title: candidate.title, placeId: candidate.placeId, lat: candidate.lat, lng: candidate.lng,
            addr: candidate.addr, note: candidate.note, url: candidate.url, status: candidate.status,
            scheduledRef: candidate.scheduledRef, proposedByLabel: candidate.proposedByLabel, mine: candidate.mine,
            myReaction: reaction?.rawValue, mustCount: must, okCount: ok, passCount: pass, reactions: reactions,
            commentCount: candidate.commentCount, createdAt: candidate.createdAt)
    }

    // MARK: 활동 기록 — 문장은 여기서 만든다(§39). 서버는 재료만 준다

    /// 을/를 — 받침이 있으면 '을'. 한글이 아니면 '를'(외국어 상호가 많다).
    static func objectParticle(_ word: String) -> String {
        guard let last = word.unicodeScalars.last else { return "를" }
        let code = Int(last.value) - 0xAC00
        guard code >= 0 && code <= 11171 else { return "를" }
        return code % 28 == 0 ? "를" : "을"
    }

    /// 활동 한 건을 사람 말로. 모르는 종류는 빈 문자열 — 화면이 그 줄을 건너뛴다.
    static func activityText(_ event: ActivityView, count: Int = 1) -> String {
        let actor = event.actorLabel.trimmingCharacters(in: .whitespaces)
        let who = event.mine ? "내가" : (actor.isEmpty ? "멤버" : actor) + "님이"
        let memberName = (event.memberLabel ?? "").trimmingCharacters(in: .whitespaces)
        let member = memberName.isEmpty ? "멤버" : memberName
        let rawTitle = (event.subject["title"]?.stringValue ?? "").trimmingCharacters(in: .whitespaces)
        let title = rawTitle.isEmpty ? "후보" : rawTitle
        let t = title + objectParticle(title)
        switch event.kind {
        case "MEMBER_JOINED": return event.mine ? "내가 함께하게 됐어요" : "\(member)님이 함께하게 됐어요"
        case "MEMBER_LEFT": return event.mine ? "내가 여행에서 나갔어요" : "\(member)님이 여행에서 나갔어요"
        case "MEMBER_REMOVED": return "\(who) \(member)님을 내보냈어요"
        case "CANDIDATE_PROPOSED": return "\(who) \(t) 후보로 담았어요"
        case "CANDIDATE_SCHEDULED":
            let ref = (event.subject["ref"]?.stringValue ?? event.subject["ref"]?.intValue.map(String.init) ?? "")
            return ref.isEmpty ? "\(who) \(t) 일정에 넣었어요" : "\(who) \(t) Day \(ref)에 넣었어요"
        case "CANDIDATE_REJECTED": return "\(who) \(t) 이번 일정에서 뺐어요"
        case "REACTION":
            if let reaction = Reaction(loose: event.subject["reaction"]?.stringValue) {
                return "\(who) \(t) \"\(reaction.label)\"로 골랐어요"
            }
            return "\(who) \(t) 골랐어요"
        case "COMMENT_ADDED":
            let excerpt = (event.subject["excerpt"]?.stringValue ?? "").trimmingCharacters(in: .whitespaces)
            return excerpt.isEmpty ? "\(who) \(title)에 한마디 남겼어요" : "\(who) \(title)에 한마디: “\(excerpt)”"
        case "SCHEDULE_CHANGED":
            let n = max(1, count)
            return n > 1 ? "\(who) 일정을 바꿨어요 (\(n)번)" : "\(who) 일정을 바꿨어요"
        case "BOOKING_ADDED":
            let n = max(1, event.subject["count"]?.intValue ?? 1)
            return n > 1 ? "\(who) 예약 \(n)건을 추가했어요" : "\(who) 예약을 추가했어요"
        default: return ""
        }
    }

    /// 읽기 쉬운 피드(§38·§39) — 같은 사람의 연속 일정 변경은 한 줄로(횟수), 같은 후보에 대한 반응은 마지막 것만.
    /// 입력·출력 모두 최신순이다.
    struct CondensedActivity: Identifiable, Equatable, Sendable {
        let event: ActivityView
        let count: Int
        var id: Int { event.id }
    }

    static func condensed(_ rows: [ActivityView], windowSeconds: TimeInterval = 600) -> [CondensedActivity] {
        var out: [CondensedActivity] = []
        var seenReactions = Set<String>()
        var firstAt: [Int: Date] = [:]
        for event in rows {
            if event.kind == "REACTION" {
                let key = "\(event.mine ? "me" : event.actorLabel)#\(event.subject["candidate_id"].map { $0.stringValue ?? $0.intValue.map(String.init) ?? "" } ?? "")"
                if seenReactions.contains(key) { continue }
                seenReactions.insert(key)
            }
            if event.kind == "SCHEDULE_CHANGED", let last = out.last, last.event.kind == "SCHEDULE_CHANGED",
               last.event.mine == event.mine, last.event.actorLabel == event.actorLabel,
               let edge = firstAt[last.event.id] ?? ISODateText.parseTimestamp(last.event.createdAt),
               let current = ISODateText.parseTimestamp(event.createdAt),
               abs(edge.timeIntervalSince(current)) <= windowSeconds {
                out[out.count - 1] = CondensedActivity(event: last.event, count: last.count + 1)
                firstAt[last.event.id] = current
                continue
            }
            out.append(CondensedActivity(event: event, count: 1))
        }
        return out
    }

    /// '방금' · 'N분 전' · 'N시간 전' · 'N일 전' · 'M/D'. 시각을 모르면 빈 문자열.
    static func relativeTime(_ iso: String?, now: Date = Date()) -> String {
        guard let iso, let date = ISODateText.parseTimestamp(iso) else { return "" }
        let d = max(0, now.timeIntervalSince(date))
        if d < 60 { return "방금" }
        if d < 3600 { return "\(Int(d / 60))분 전" }
        if d < 86400 { return "\(Int(d / 3600))시간 전" }
        if d < 7 * 86400 { return "\(Int(d / 86400))일 전" }
        let parts = ISODateText.calendar.dateComponents([.month, .day], from: date)
        return "\(parts.month ?? 1)/\(parts.day ?? 1)"
    }

    // MARK: 취향 — 서버 `tc_norm_prefs`와 같은 화이트리스트. 저장 뒤에는 서버가 돌려준 것이 이긴다

    static let topics = ["미술관", "박물관", "자연", "야경", "맛집", "카페", "쇼핑", "시장", "건축", "공연", "액티비티", "휴식"]
    static let prefListMax = 12, prefItemMax = 30, prefNoteMax = 120
}

enum PrefPace: String, CaseIterable, Sendable {
    case relaxed = "RELAXED", normal = "NORMAL", packed = "PACKED"
    var label: String {
        switch self {
        case .relaxed: "여유롭게"
        case .normal: "보통"
        case .packed: "빡빡하게"
        }
    }
}

enum PrefWalking: String, CaseIterable, Sendable {
    case low = "LOW", normal = "NORMAL", high = "HIGH"
    var label: String {
        switch self {
        case .low: "많이 걷기 싫어요"
        case .normal: "걷는 건 보통"
        case .high: "많이 걸어도 좋아요"
        }
    }
    fileprivate var order: Int {
        switch self {
        case .low: 0
        case .normal: 1
        case .high: 2
        }
    }
}

/// 이 여행에 대한 취향(§18) — 고정 프로필이 아니다. 선택형이 기본(§16).
struct TripPrefs: Equatable, Sendable {
    var pace: PrefPace?
    var walking: PrefWalking?
    var morning: Bool?
    var night: Bool?
    var interests: [String] = []
    var dislikes: [String] = []
    var note: String = ""

    var isEmpty: Bool { pace == nil && walking == nil && morning == nil && night == nil && interests.isEmpty && dislikes.isEmpty && note.isEmpty }

    /// 화면이 무엇을 보내든 아는 값만 남긴다 — 서버와 **같은 규칙**.
    init(raw: [String: JSONValue]) {
        pace = PrefPace(rawValue: raw["pace"]?.stringValue ?? "")
        walking = PrefWalking(rawValue: raw["walking"]?.stringValue ?? "")
        morning = raw["morning"]?.boolValue
        night = raw["night"]?.boolValue
        interests = TripPrefs.cleanList(raw["interests"])
        dislikes = TripPrefs.cleanList(raw["dislikes"])
        note = String((raw["note"]?.stringValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(CollabModel.prefNoteMax))
    }

    init() {}

    private static func cleanList(_ value: JSONValue?) -> [String] {
        guard let items = value?.arrayValue else { return [] }
        var seen = Set<String>(), out: [String] = []
        for item in items {
            guard let s = item.stringValue else { continue }
            let v = String(s.trimmingCharacters(in: .whitespacesAndNewlines).prefix(CollabModel.prefItemMax))
            if v.isEmpty || seen.contains(v) { continue }
            seen.insert(v); out.append(v)
            if out.count >= CollabModel.prefListMax { break }
        }
        return out.sorted { $0 < $1 }
    }

    /// 서버로 보내는 모양. 빈 배열·빈 메모는 정보가 없다 — 키를 넣지 않는다(서버도 같다).
    var raw: [String: JSONValue] {
        var out: [String: JSONValue] = [:]
        if let pace { out["pace"] = .string(pace.rawValue) }
        if let walking { out["walking"] = .string(walking.rawValue) }
        if let morning { out["morning"] = .bool(morning) }
        if let night { out["night"] = .bool(night) }
        let cleanInterests = TripPrefs.cleanList(.array(interests.map { .string($0) }))
        let cleanDislikes = TripPrefs.cleanList(.array(dislikes.map { .string($0) }))
        if !cleanInterests.isEmpty { out["interests"] = .array(cleanInterests.map { .string($0) }) }
        if !cleanDislikes.isEmpty { out["dislikes"] = .array(cleanDislikes.map { .string($0) }) }
        let trimmedNote = String(note.trimmingCharacters(in: .whitespacesAndNewlines).prefix(CollabModel.prefNoteMax))
        if !trimmedNote.isEmpty { out["note"] = .string(trimmedNote) }
        return out
    }

    /// 취향 한 줄 — '여유롭게 · 많이 걷기 싫어요 · 관심: 미술관, 야경 · 별로: 쇼핑'.
    var text: String {
        var parts: [String] = []
        if let pace { parts.append(pace.label) }
        if let walking { parts.append(walking.label) }
        if morning == true { parts.append("아침 일찍도 괜찮아요") } else if morning == false { parts.append("아침 일찍은 어려워요") }
        if night == true { parts.append("늦은 밤도 좋아요") } else if night == false { parts.append("늦은 밤은 싫어요") }
        if !interests.isEmpty { parts.append("관심: " + interests.joined(separator: ", ")) }
        if !dislikes.isEmpty { parts.append("별로: " + dislikes.joined(separator: ", ")) }
        if !note.isEmpty { parts.append("“\(note)”") }
        return parts.joined(separator: " · ")
    }

    /// 같은 주제가 관심과 별로에 동시에 있을 수 없다 — 한 번의 탭.
    mutating func toggleInterest(_ topic: String) {
        if interests.contains(topic) { interests.removeAll { $0 == topic } }
        else { interests.append(topic); dislikes.removeAll { $0 == topic } }
    }

    mutating func toggleDislike(_ topic: String) {
        if dislikes.contains(topic) { dislikes.removeAll { $0 == topic } }
        else { dislikes.append(topic); interests.removeAll { $0 == topic } }
    }
}

extension CollabModel {
    /// §19 그룹 컨텍스트 — 여행 전체의 결정은 하지 않는다. 어디가 맞고 어디가 갈리는지만 정리한 **문장들**(§61·§62).
    static func groupContextText(_ rows: [PreferenceView], memberCount: Int) -> [String] {
        struct Row { let name: String; let prefs: TripPrefs }
        let list = rows.map { Row(name: $0.mine ? "나" : ($0.label.trimmingCharacters(in: .whitespaces).isEmpty ? "멤버" : $0.label), prefs: TripPrefs(raw: $0.prefs)) }
        let answered = list.filter { !$0.prefs.isEmpty }
        guard !answered.isEmpty else { return ["아직 아무도 취향을 남기지 않았어요. 내 취향을 남기면 일행이 참고할 수 있어요."] }
        let members = max(memberCount, list.count, 1)
        var out = ["\(members)명 중 \(answered.count)명이 취향을 남겼어요"]

        var paceCount: [PrefPace: Int] = [:]
        for row in answered { if let pace = row.prefs.pace { paceCount[pace, default: 0] += 1 } }
        let relaxed = paceCount[.relaxed] ?? 0, packed = paceCount[.packed] ?? 0
        if relaxed > 0 && packed > 0 {
            out.append("여유롭게 vs 빡빡하게 — 페이스 생각이 갈려요")
        } else if let top = PrefPace.allCases.map({ ($0, paceCount[$0] ?? 0) }).max(by: { $0.1 < $1.1 }), top.1 > 0,
                  PrefPace.allCases.filter({ (paceCount[$0] ?? 0) == top.1 }).count == 1 {
            out.append("\(top.1)명이 \"\(top.0.label)\"를 원해요")
        }

        // 걷기는 답한 사람 중 **가장 낮은** 허용치 — 제약은 가장 약한 사람 기준이다.
        var walking: PrefWalking?
        var walkingWho: [String] = []
        for row in answered {
            guard let w = row.prefs.walking else { continue }
            if walking == nil || w.order < walking!.order { walking = w; walkingWho = [row.name] }
            else if w == walking { walkingWho.append(row.name) }
        }
        if walking == .low { out.append("많이 걷기 싫어요 (\(walkingWho.joined(separator: ", "))) — 동선은 이 기준으로") }

        let morningNo = answered.filter { $0.prefs.morning == false }.map(\.name)
        let nightNo = answered.filter { $0.prefs.night == false }.map(\.name)
        if !morningNo.isEmpty { out.append("아침 일찍은 어려워요 (\(morningNo.joined(separator: ", ")))") }
        if !nightNo.isEmpty { out.append("늦은 밤은 싫어요 (\(nightNo.joined(separator: ", ")))") }

        var likes: [String: [String]] = [:], dislikes: [String: [String]] = [:]
        for row in answered {
            for topic in row.prefs.interests { likes[topic, default: []].append(row.name) }
            for topic in row.prefs.dislikes { dislikes[topic, default: []].append(row.name) }
        }
        let shared = likes.filter { $0.value.count >= 2 }
            .sorted { a, b in a.value.count != b.value.count ? a.value.count > b.value.count : a.key < b.key }
            .map(\.key)
        if !shared.isEmpty { out.append("함께 관심: " + shared.joined(separator: ", ")) }
        for topic in likes.keys.filter({ dislikes[$0] != nil }).sorted() {
            out.append("\(topic): \((likes[topic] ?? []).joined(separator: ", "))은(는) 좋고 \((dislikes[topic] ?? []).joined(separator: ", "))은(는) 별로예요")
        }
        return out
    }

    /// 제안의 '걷기 부담' 한 줄에 쓰는 값 — 답한 사람 중 가장 낮은 허용치.
    static func lowestWalking(_ rows: [PreferenceView]) -> PrefWalking? {
        rows.compactMap { TripPrefs(raw: $0.prefs).walking }.min { $0.order < $1.order }
    }
}

extension ISODateText {
    private static let timestampParsers: [ISO8601DateFormatter] = {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return [fractional, plain]
    }()

    /// 서버의 `created_at`(ISO 8601, 소수점 있거나 없거나, `+00:00`이거나 `Z`).
    static func parseTimestamp(_ text: String) -> Date? {
        var normalized = text
        if normalized.contains(" ") && !normalized.contains("T") { normalized = normalized.replacingOccurrences(of: " ", with: "T") }
        for parser in timestampParsers { if let date = parser.date(from: normalized) { return date } }
        return nil
    }
}

// MARK: - 실시간 (§41·§43~§45)

/// 이벤트 하나가 **무엇을 다시 읽게 하는가**.
///
/// 소켓은 알림 채널일 뿐이고 진실은 PostgreSQL이다 — payload를 화면 상태로 쓰지 않는다.
/// 무엇이 바뀌었는지만 받고 내용은 API로 다시 읽는다.
struct LiveEffects: Equatable, Sendable {
    /// 후보 보드를 다시 읽는다
    let candidates: Bool
    /// 멤버·역할을 다시 읽는다
    let members: Bool
    /// 여행 문서를 당긴다 (내 저장이면 당기지 않는다)
    let pull: Bool
    /// 최근 활동 목록을 다시 읽는다
    let activity: Bool
    /// 토스트로 알린다 — 남이 후보를 담았을 때와 새 멤버뿐이다
    let notify: Bool
}

extension CollabModel {
    /// 실시간 이벤트가 무엇을 다시 읽게 하는지.
    ///
    /// ⚠️ **`collab.js`의 `liveEffects` 복사본이다.** 규칙을 바꿀 때는 `collab.js`를 먼저 고친다 —
    /// `liveEffectsParity.test.ts`가 모든 kind × mine의 답을 fixture로 떨어뜨리고
    /// `RealtimeTests`가 그 파일로 이 함수를 검사한다.
    static let activityKinds: [String] = [
        "MEMBER_JOINED", "MEMBER_LEFT", "MEMBER_REMOVED",
        "CANDIDATE_PROPOSED", "CANDIDATE_SCHEDULED", "CANDIDATE_REJECTED",
        "REACTION", "COMMENT_ADDED", "SCHEDULE_CHANGED", "BOOKING_ADDED"
    ]

    static func liveEffects(kind: String, mine: Bool) -> LiveEffects {
        let known = activityKinds.contains(kind)
        let candidates = kind.hasPrefix("CANDIDATE_") || kind == "REACTION" || kind == "COMMENT_ADDED"
        let members = kind.hasPrefix("MEMBER_")
        let doc = kind == "SCHEDULE_CHANGED" || kind == "BOOKING_ADDED"
        return LiveEffects(
            candidates: candidates,
            members: members,
            pull: doc && !mine,
            activity: known,
            // 알림은 적게 — 남이 후보를 담았을 때와 새 멤버뿐이다. 반응·코멘트·일정 변경은 화면 갱신으로 끝.
            notify: !mine && (kind == "CANDIDATE_PROPOSED" || kind == "MEMBER_JOINED")
        )
    }
}

