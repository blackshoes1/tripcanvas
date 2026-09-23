import SwiftUI

/// 여행 전의 준비 화면. D-day는 서버 값, 기간은 날짜 문자열의 표시만 담당한다.
struct TripDepartureCard: View {
    let trip: TripSummary
    let days: Int
    let onOpenPlan: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .largeTitle) private var countdownSize = 44

    var body: some View {
        VStack(alignment: .leading, spacing: Space.l) {
            VStack(alignment: .leading, spacing: Space.xs) {
                Text("출발까지").font(.subheadline).foregroundStyle(Ink.soft)
                Text("D-\(days)")
                    .font(.system(size: countdownSize, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(Ink.accent)
                    .accessibilityLabel("출발까지 \(days)일 남았어요")
            }
            Divider()
            VStack(alignment: .leading, spacing: Space.s) {
                Label(Self.dateRange(trip), systemImage: "calendar")
                if !trip.cities.isEmpty {
                    Label(trip.cities.joined(separator: " · "), systemImage: "mappin.and.ellipse")
                }
            }
            .font(.subheadline)
            .foregroundStyle(Ink.soft)
            .fixedSize(horizontal: false, vertical: true)

            HStack(alignment: .top, spacing: Space.m) {
                Image(systemName: "airplane").foregroundStyle(Ink.accent)
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text("아직 여행 전이에요").font(.subheadline.weight(.semibold))
                    Text("일정 탭에서 계획을 다듬어 두세요.")
                        .font(.footnote).foregroundStyle(Ink.soft)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Space.m)
            .background(Ink.accent.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))

            let layout = typeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(spacing: Space.s))
                : AnyLayout(HStackLayout(spacing: Space.s))
            layout {
                Button(action: onOpenPlan) {
                    actionLabel("일정 보기", symbol: "calendar")
                        .foregroundStyle(.white)
                        .background(Ink.accent, in: RoundedRectangle(cornerRadius: 12))
                }
                NavigationLink { BookingListView(trip: trip) } label: {
                    actionLabel("예약 정보", symbol: "ticket")
                        .foregroundStyle(Ink.ink)
                        .background(Ink.sunken, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            .buttonStyle(.plain)
        }
        .padding(Space.l)
        .background(Ink.raised, in: RoundedRectangle(cornerRadius: 18))
    }

    private func actionLabel(_ title: String, symbol: String) -> some View {
        Label(title, systemImage: symbol)
            .font(.subheadline.weight(.semibold))
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.horizontal, Space.s)
    }

    static func dateRange(_ trip: TripSummary) -> String {
        guard let start = ISODateText.date(from: trip.start) else {
            return trip.dayCount > 0 ? "날짜 미정 · \(trip.dayCount)일" : "날짜 미정"
        }
        let formatter = DateFormatter()
        formatter.calendar = ISODateText.calendar
        formatter.timeZone = ISODateText.calendar.timeZone
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = "yyyy. M. d. (E)"
        let first = formatter.string(from: start)
        guard trip.dayCount > 1,
              let end = ISODateText.calendar.date(byAdding: .day, value: trip.dayCount - 1, to: start) else {
            return first + (trip.dayCount == 1 ? " · 1일" : "")
        }
        if ISODateText.calendar.component(.year, from: start) == ISODateText.calendar.component(.year, from: end) {
            formatter.dateFormat = "M. d. (E)"
        }
        return "\(first) – \(formatter.string(from: end)) · \(trip.dayCount)일"
    }
}
