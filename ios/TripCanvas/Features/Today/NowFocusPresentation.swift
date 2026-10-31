import Foundation

extension TodayResponse {
    /// 서버가 고른 카드의 데이터만 이어 붙인다. 시각·위치로 주역을 다시 판정하지 않는다.
    var displayedNextAction: NextAction? {
        guard let focus = nowFocus, focus.kind != .unknown, focus.kind != .schedule else { return nextAction }
        if focus.kind == .freeTime { return nil }
        guard let target = focus.focusedTarget, target.dayIndex == day.index,
              target.revision == trip.revision, target.spotIndex != nil,
              let activity = activities.first(where: { $0.id == target.activityId }) else { return nextAction }
        let staying = focus.kind == .currentStay
        return NextAction(activityId: activity.id, title: staying ? (focus.currentStay?.title ?? activity.name) : (focus.next?.title ?? activity.name),
            status: staying ? (focus.currentStay?.status ?? .inProgress) : .upcoming,
            travelMinutes: staying ? nil : focus.next?.travelMinutes, etaMinutes: nil,
            startMinutes: activity.startMinutes, stayMinutes: activity.stayMinutes, departure: nil,
            location: activity.location, type: activity.type, flexibility: activity.flexibility, reasons: [])
    }
}
