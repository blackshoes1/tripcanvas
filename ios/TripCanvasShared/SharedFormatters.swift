import Foundation

extension ISO8601DateFormatter {
    /// 서버는 소수점 없는 Z 형식을 보낸다. 매번 만들면 비싸서 공유한다.
    ///
    /// ActivityKit이 없는 플랫폼(watchOS)도 이 포맷터를 쓰므로 Live Activity 정의와 **같은 파일에 두지 않는다**.
    /// 한 파일에 두면 `#if canImport(ActivityKit)`으로 감쌀 때 포맷터까지 함께 사라진다.
    static let tripCanvas: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}
