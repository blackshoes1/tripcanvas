import Foundation

/// 서버가 준 경계 시각에 한 번 다시 묻는다. 활동 선택·상태 판정은 서버에 남긴다.
enum TodayRefreshTiming {
    static func nextBoundary(for today: TodayResponse) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard today.currentState.live,
              let generated = formatter.date(from: today.generatedAt) ?? ISO8601DateFormatter.tripCanvas.date(from: today.generatedAt),
              let zone = TimeZone(identifier: today.day.timeZone) ?? TimeZone(identifier: today.trip.timeZone) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let parts = today.day.date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3,
              let day = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return nil }

        var minutes = today.activities.filter { !$0.status.isDone }.flatMap { [$0.startMinutes, $0.endMinutes] }
        if let leave = today.nextAction?.departure?.leaveMinutes { minutes.append(leave) }
        var dates = minutes.compactMap { minute -> Date? in
            guard minute >= 0,
                  let targetDay = calendar.date(byAdding: .day, value: minute / 1440, to: day) else { return nil }
            return calendar.date(bySettingHour: (minute % 1440) / 60, minute: minute % 60, second: 0, of: targetDay)
        }
        if let switchAt = today.nowFocus?.switchAt { dates.append(switchAt) }
        if let leaveAt = today.nowFocus?.leaveAt { dates.append(leaveAt) }
        if let expiresAt = ISO8601DateFormatter.tripCanvasDate(today.nowFocus?.currentStay?.expiresAtISO) { dates.append(expiresAt) }
        // 출발 안내 중에는 서버에 매분 다시 묻는다. 출발·지각 판정은 서버에 남긴다.
        if today.nowFocus?.kind == .departure { dates.append(generated.addingTimeInterval(60)) }
        // 자정은 24시간 뒤가 아니다 — 여행지의 일광절약시간 전환을 따른다.
        if let midnight = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: generated)) { dates.append(midnight) }
        return dates.filter { $0 > generated }.min()
    }
}
