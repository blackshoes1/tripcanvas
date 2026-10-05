// 생성 파일 — npm run copy:build. 원본은 copy/ 아래 파일이다.
import Foundation

enum JTone: String, Codable, CaseIterable, Sendable {
    case friendly = "FRIENDLY", casual = "CASUAL", polite = "POLITE"
    var label: String {
        switch self {
        case .friendly: return "여행 메이트"
        case .casual: return "찐친"
        case .polite: return "직장 동료"
        }
    }
    var example: String { JCopy.text("tone.preview", tone: self) }
}

enum JCopy {
    private static let catalogue: [String: [String: String]] = [
        "replan.simulated": ["FRIENDLY": "남은 일정을 지금부터 다시 이어 봤어요", "CASUAL": "남은 일정을 지금부터 다시 이어 봤어", "POLITE": "남은 일정을 지금부터 다시 이어 보았습니다"],
        "replan.moveNote": ["FRIENDLY": "{topic} 다음 날 앞쪽으로 옮겨요", "CASUAL": "{topic} 다음 날 앞쪽으로 옮겨", "POLITE": "{topic} 다음 날 앞쪽으로 옮깁니다"],
        "replan.skipNote": ["FRIENDLY": "{topic} '건너뜀'으로 표시해요", "CASUAL": "{topic} '건너뜀'으로 표시해", "POLITE": "{topic} '건너뜀'으로 표시합니다"],
        "pulse.complete": ["FRIENDLY": "오늘 계획한 일정은 다 마쳤어요", "CASUAL": "오늘 계획한 일정은 다 마쳤어", "POLITE": "오늘 계획하신 일정은 모두 마치셨습니다"],
        "tone.preview": ["FRIENDLY": "많이 걸었네요. 잠깐 쉬어갈까요?", "CASUAL": "많이 걸었네. 잠깐 쉬어갈까?", "POLITE": "많이 걸으셨네요. 잠시 쉬어가시면 어떨까요?"],
        "kicker.next": ["FRIENDLY": "지금 한 곳 더 들를 수 있어요", "CASUAL": "지금 한 곳 더 들를 수 있어", "POLITE": "지금 한 곳 더 들르실 수 있습니다"],
        "kicker.rest": ["FRIENDLY": "쉬어도 괜찮아요", "CASUAL": "쉬어도 괜찮아", "POLITE": "쉬셔도 괜찮습니다"],
        "flow.today": ["FRIENDLY": "오늘 이렇게 이어가면 어떨까요", "CASUAL": "오늘 이렇게 이어가면 어떨까", "POLITE": "오늘 이렇게 이어가시면 어떨까요"],
        "flow.preview": ["FRIENDLY": "이 날을 이렇게 채우면 어떨까요", "CASUAL": "이 날을 이렇게 채우면 어떨까", "POLITE": "이 날을 이렇게 채우시면 어떨까요"],
        "flow.blocked": ["FRIENDLY": "이대로면 예약 시간에 늦어서 더 넣지 않았어요 — 일정 조정 제안을 먼저 확인해 주세요.", "CASUAL": "이대로면 예약 시간에 늦어서 더 넣지 않았어 — 일정 조정 제안을 먼저 확인해 보면 좋겠어.", "POLITE": "이대로면 예약 시간에 늦어 더 넣지 않았습니다 — 일정 조정 제안을 먼저 확인해 보시면 좋겠습니다."],
        "flow.blockedNoCard": ["FRIENDLY": "이대로면 예약 시간에 늦어서 더 넣지 않았어요 — 예약 시간을 바꾸거나 미리 알려 두는 편이 나아요.", "CASUAL": "이대로면 예약 시간에 늦어서 더 넣지 않았어 — 예약 시간을 바꾸거나 미리 알려 두는 편이 나아.", "POLITE": "이대로면 예약 시간에 늦어 더 넣지 않았습니다 — 예약 시간을 바꾸시거나 미리 알려 두시는 편이 낫겠습니다."],
        "flow.empty": ["FRIENDLY": "지금 더 넣을 만한 곳이 없어요 — 남은 일정을 그대로 이어가면 돼요.", "CASUAL": "지금 더 넣을 만한 곳이 없어 — 남은 일정을 그대로 이어가면 돼.", "POLITE": "지금 더 넣을 만한 곳이 없습니다 — 남은 일정을 그대로 이어가시면 됩니다."],
        "flow.light": ["FRIENDLY": "이 날 메모가 가벼운 일정이라 한 곳만 골랐어요.", "CASUAL": "이 날 메모가 가벼운 일정이라 한 곳만 골랐어.", "POLITE": "이 날 메모가 가벼운 일정이라 한 곳만 골랐습니다."],
        "flow.dismissed": ["FRIENDLY": "알겠어요 — 일정은 그대로 둬요", "CASUAL": "알겠어 — 일정은 그대로 둘게", "POLITE": "알겠습니다 — 일정은 그대로 둡니다"],
        "suggest.afterTrip": ["FRIENDLY": "지난 여행이에요 — 일정을 돌아볼 수 있고, J의 제안은 여행 전과 여행 중에 드려요.", "CASUAL": "지난 여행이야 — 일정을 돌아볼 수 있고, J의 제안은 여행 전과 여행 중에 해줄게.", "POLITE": "지난 여행입니다 — 일정을 돌아보실 수 있고, J의 제안은 여행 전과 여행 중에 드립니다."],
        "suggest.past": ["FRIENDLY": "지난 날이에요 — 다녀온 곳은 아래 목록에서 표시할 수 있어요.", "CASUAL": "지난 날이야 — 다녀온 곳은 아래 목록에서 표시할 수 있어.", "POLITE": "지난 날입니다 — 다녀오신 곳은 아래 목록에서 표시하실 수 있습니다."],
        "suggest.emptyToday": ["FRIENDLY": "지금 새로 제안할 일정이 없어요 — 오늘 남은 일정을 그대로 이어가면 돼요.", "CASUAL": "지금 새로 제안할 일정이 없어 — 오늘 남은 일정을 그대로 이어가면 돼.", "POLITE": "지금 새로 제안할 일정이 없습니다 — 오늘 남은 일정을 그대로 이어가시면 됩니다."],
        "suggest.emptyPreview": ["FRIENDLY": "이 날은 더 넣을 만한 곳이 없어요 — 지금 일정 그대로 괜찮아요.", "CASUAL": "이 날은 더 넣을 만한 곳이 없어 — 지금 일정 그대로 괜찮아.", "POLITE": "이 날은 더 넣을 만한 곳이 없습니다 — 지금 일정 그대로 괜찮습니다."],
        "intent.normal": ["FRIENDLY": "컨디션은 '보통'으로 보고 있어요 — 다르면 아래 버튼으로 알려 주세요", "CASUAL": "컨디션은 '보통'으로 보고 있어 — 다르면 아래 버튼으로 알려줘", "POLITE": "컨디션은 '보통'으로 보고 있습니다 — 다르시면 아래 버튼으로 알려 주세요"],
        "intent.unknown": ["FRIENDLY": "그 문장은 아직 못 알아들었어요 — 아래 컨디션 버튼으로 알려 주세요", "CASUAL": "그 문장은 아직 못 알아들었어 — 아래 컨디션 버튼으로 알려줘", "POLITE": "그 문장은 아직 이해하지 못했습니다 — 아래 컨디션 버튼으로 알려 주세요"],
        "today.rest": ["FRIENDLY": "남은 시간은 그냥 쉬어도 좋아요.", "CASUAL": "남은 시간은 그냥 쉬어도 좋아.", "POLITE": "남은 시간은 그냥 쉬셔도 좋습니다."],
        "today.before": ["FRIENDLY": "아직 여행 전이에요", "CASUAL": "아직 여행 전이야", "POLITE": "아직 여행 전입니다"],
        "today.prepare": ["FRIENDLY": "일정 탭에서 계획을 다듬어 두세요.", "CASUAL": "일정 탭에서 계획을 다듬어 두면 좋겠어.", "POLITE": "일정 탭에서 계획을 다듬어 두시면 좋겠습니다."],
        "suggest.emptyNext": ["FRIENDLY": "지금 더 넣을 만한 곳은 없어요 — 다음 일정 {place}({time})로 그대로 이어가면 돼요.", "CASUAL": "지금 더 넣을 만한 곳은 없어 — 다음 일정 {place}({time})로 그대로 이어가면 돼.", "POLITE": "지금 더 넣을 만한 곳은 없습니다 — 다음 일정 {place}({time})로 그대로 이어가시면 됩니다."],
        "intent.echo": ["FRIENDLY": "이렇게 이해했어요 — {reasons}", "CASUAL": "이렇게 이해했어 — {reasons}", "POLITE": "이렇게 이해했습니다 — {reasons}"],
        "intent.unchanged": ["FRIENDLY": "컨디션은 바꾸지 않았어요 — 지금은 '{energy}'로 보고 있어요", "CASUAL": "컨디션은 바꾸지 않았어 — 지금은 '{energy}'로 보고 있어", "POLITE": "컨디션은 바꾸지 않았습니다 — 지금은 '{energy}'로 보고 있습니다"],
        "price.seller": ["FRIENDLY": "{seller}에서 같은 조건이 더 싸요{fee}", "CASUAL": "{seller}에서 같은 조건이 더 싸{fee}", "POLITE": "{seller}에서 같은 조건이 더 저렴합니다{fee}"],
        "price.lower": ["FRIENDLY": "예약한 뒤 가격이 내려갔어요", "CASUAL": "예약한 뒤 가격이 내려갔어", "POLITE": "예약하신 뒤 가격이 내려갔습니다"],
        "price.net": ["FRIENDLY": "취소 수수료를 빼고도 남는 금액이에요", "CASUAL": "취소 수수료를 빼고도 남는 금액이야", "POLITE": "취소 수수료를 빼고도 남는 금액입니다"],
        "rest.accepted": ["FRIENDLY": "쉬는 중이에요 — 남은 일정은 그대로 둬요", "CASUAL": "쉬는 중이야 — 남은 일정은 그대로 둘게", "POLITE": "쉬어가시는 중입니다 — 남은 일정은 그대로 둡니다"],
        "hotel.accepted": ["FRIENDLY": "숙소로 돌아가는 중이에요 — 남은 일정은 그대로 둬요", "CASUAL": "숙소로 돌아가는 중이야 — 남은 일정은 그대로 둘게", "POLITE": "숙소로 돌아가시는 중입니다 — 남은 일정은 그대로 둡니다"],
        "intent.unknownNative": ["FRIENDLY": "그 문장은 아직 못 알아들었어요 — 컨디션 버튼으로 알려 주세요", "CASUAL": "그 문장은 아직 못 알아들었어 — 컨디션 버튼으로 알려줘", "POLITE": "그 문장은 아직 이해하지 못했습니다 — 컨디션 버튼으로 알려 주세요"]
    ]
    static func text(_ key: String, params: [String: String] = [:], tone: JTone = .friendly) -> String {
        guard let template = catalogue[key]?[tone.rawValue] else { preconditionFailure("Unknown J copy key: \(key)") }
        let regex = try! NSRegularExpression(pattern: "\\{([a-zA-Z][a-zA-Z0-9]*)\\}")
        var result = template
        for match in regex.matches(in: template, range: NSRange(template.startIndex..., in: template)).reversed() {
            let name = String(template[Range(match.range(at: 1), in: template)!])
            guard let value = params[name] else { preconditionFailure("Missing J copy parameter: \(key).\(name)") }
            result.replaceSubrange(Range(match.range, in: result)!, with: value)
        }
        return result
    }
}
