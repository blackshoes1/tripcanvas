import Foundation

/// 표시 당시의 위치와 문서 버전을 함께 전달한다. 이전 활동은 `지금` 화면으로 이어진다.
enum LiveActivityLink {
    static func url(tripId: String, target: LiveActivityTarget?) -> URL? {
        var link = URLComponents()
        link.scheme = "tripcanvas"
        link.host = "trip"
        link.path = "/\(tripId)/\(target == nil ? "today" : "activity")"
        if let target {
            guard target.spotIndex != nil else { return nil }
            link.queryItems = [URLQueryItem(name: "day", value: String(target.dayIndex)),
                               URLQueryItem(name: "focus", value: target.activityId),
                               URLQueryItem(name: "revision", value: String(target.revision))]
        }
        return link.url
    }
}

extension ISO8601DateFormatter {
    static func tripCanvasDate(_ value: String?) -> Date? {
        guard let value else { return nil }
        return tripCanvas.date(from: value) ?? tripCanvasFractional.date(from: value)
    }

    private static let tripCanvasFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
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

extension NowFocus {
    var focusedTarget: LiveActivityTarget? {
        switch kind {
        case .currentStay: currentStay?.target
        case .departure: next?.target
        case .schedule, .freeTime, .unknown: nil
        }
    }
    var leaveAt: Date? { ISO8601DateFormatter.tripCanvasDate(next?.leaveAtISO) }
    var switchAt: Date? { ISO8601DateFormatter.tripCanvasDate(switchAtISO) }
}
