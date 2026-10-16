import SwiftUI

enum CalmMomentPresentation {
    static func isCurrent(_ moment: CalmMoment, offline: Bool, now: Date) -> Bool {
        guard !offline, ["RELAX", "CHECK"].contains(moment.state),
              let expiry = ISO8601DateFormatter().date(from: moment.expiresAt) ?? fractional.date(from: moment.expiresAt) else { return false }
        return now < expiry
    }
    static func text(_ moment: CalmMoment, offline: Bool, now: Date) -> String {
        guard isCurrent(moment, offline: offline, now: now) else {
            return "출발 여유를 다시 확인해 주세요. 마지막 계산 이후 상황이 달라졌을 수 있어요."
        }
        return moment.text
    }
    private static let fractional: ISO8601DateFormatter = {
        let value = ISO8601DateFormatter(); value.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return value
    }()
}

struct CalmMomentCard: View {
    let moment: CalmMoment
    let offline: Bool
    let onRefresh: () -> Void
    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            VStack(alignment: .leading, spacing: Space.s) {
                Label(CalmMomentPresentation.text(moment, offline: offline, now: context.date),
                      systemImage: moment.state == "RELAX" && CalmMomentPresentation.isCurrent(moment, offline: offline, now: context.date) ? "leaf" : "clock.badge.questionmark")
                    .font(.subheadline).accessibilityIdentifier("calmMomentText")
                Button("출발 여유 다시 확인", action: onRefresh).frame(minHeight: 44)
            }.card()
        }
    }
}

struct TomorrowBriefCard: View {
    let trip: TripSummary
    let brief: TomorrowBrief
    let offline: Bool
    let onOpenDay: () -> Void
    let onPrepareOffline: () -> Void
    @Environment(AppEnvironment.self) private var env
    @State private var pack: OfflineTrip?
    var body: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            Label(offline ? "저장된 다음 날 준비" : "내일 아침 30초", systemImage: "sunrise")
                .font(.headline).accessibilityIdentifier("tomorrowBriefTitle")
            Text(trip.dayLabel(brief.dayIndex)).font(.subheadline).foregroundStyle(Ink.soft)
            if let first = brief.firstPlace {
                Text("첫 장소 · \(first)")
                if let departure = brief.departureMinutes {
                    Text("첫 출발 예정 · \(TimeFormat.clockAcrossMidnight(departure))\(brief.travelTimeSource == .routed ? "" : " · 추정")")
                }
            } else { Text("아직 첫 장소가 정해지지 않았어요") }
            ForEach(Array(brief.checkouts.enumerated()), id: \.offset) { _, name in Text("체크아웃 · \(name)") }
            if brief.reservations.isEmpty { Text("저장된 예약 없음").foregroundStyle(Ink.soft) }
            ForEach(Array(brief.reservations.enumerated()), id: \.offset) { _, text in Text("예약 · \(text)") }
            Text(offlineStatus).font(.caption).foregroundStyle(Ink.soft).accessibilityIdentifier("tomorrowOfflineStatus")
            Button("내일 일정 확인", action: onOpenDay).frame(minHeight: 44).accessibilityIdentifier("tomorrowOpenDay")
            Button("오프라인 준비 확인", action: onPrepareOffline).frame(minHeight: 44)
        }.card()
        .task(id: "\(trip.revision)-\(String(describing: env.service.cacheScope))") {
            let scope = env.service.cacheScope
            let received = await env.service.offlineTrip(trip.id)
            guard scope == env.service.cacheScope else { return }
            pack = received
        }
    }
    private var offlineStatus: String {
        guard let pack else { return "오프라인 준비 필요 · 아직 여행 전체를 저장하지 않았어요" }
        let state = pack.detail.trip.revision == trip.revision ? "오프라인 준비 완료" : "오프라인 사본 업데이트 필요"
        return "\(state) · \(TimeFormat.shortTime(pack.savedAt)) 저장"
    }
}
