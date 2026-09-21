import Foundation

/// 밖에서 들어온 주소를 열기 전에 거르는 한 곳.
///
/// 예약 링크는 공유·붙여넣기·AI 파싱으로 들어온다 — `lib.js`의 `normalizeSpot`·`normalizeBooking`이
/// 저장할 때 `http(s)`만 남기지만, **여는 쪽도 다시 본다**: 옛 문서·다른 경로로 들어온 값이 있을 수 있고,
/// 스킴 하나 잘못 열면 그건 우리가 연 것이 된다.
///
/// 웹의 `safeUrl()`과 같은 규칙이다 — `http`·`https`만, 그 외에는 아무것도 돌려주지 않는다.
enum SafeURL {
    /// 웹에서 열어도 되는 주소면 그것, 아니면 nil.
    /// ⚠️ `scheme.hasPrefix("http")`로 보지 않는다 — `httpfoo:`까지 통과한다.
    static func web(_ raw: String?) -> URL? {
        guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty,
              let url = URL(string: trimmed), let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https", url.host?.isEmpty == false else { return nil }
        return url
    }
}
