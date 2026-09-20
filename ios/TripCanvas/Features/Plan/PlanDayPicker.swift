import SwiftUI

/// 며칠짜리든 한 줄에 담기지 않는다 — 가로 스크롤 칩으로 고른다.
///
/// "며칠째"만 보여 주면 3일차가 무슨 요일인지, 오늘인지, 뭐가 들어 있는지 모른다.
/// 날짜·요일은 **서버가 준 것**을 쓴다(`start + index`를 앱에서 더하면 규칙이 두 곳이 된다).
///
/// ⚠️ **고른 날을 여기서 바꾸지 않는다.** 누가 바뀌었는지는 `onSelect`로 알리고 쓰는 것은
/// 부모 하나다 — 스와이프와 칩 두 곳이 각자 모델에 쓰면 애니메이션 방향이 갈린다.
struct PlanDayPicker: View {
    let strip: [DayPlanStripEntry]
    let selectedDay: Int
    /// 여행 기간 밖이면 nil. 서버가 정한다.
    let todayIndex: Int?
    let motion: Animation
    /// 고른 날과 **넘어가는 방향**(뒤쪽 날이면 true) — 목록 전환이 이 방향을 쓴다.
    let onSelect: (_ index: Int, _ goingForward: Bool) -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: Space.s) {
                    ForEach(strip) { entry in
                        chip(entry).id(entry.index)
                    }
                }
                .padding(.horizontal, Space.l)
                .padding(.vertical, Space.s)
            }
            // 14일짜리 일정에서 고른 날이 화면 밖에 있으면 안 된다 — 여행 중이면 오늘로 옮겨진 뒤다.
            .onChange(of: selectedDay) { _, day in
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(day, anchor: .center) }
            }
            .onAppear { proxy.scrollTo(selectedDay, anchor: .center) }
        }
    }

    private func chip(_ entry: DayPlanStripEntry) -> some View {
        let selected = entry.index == selectedDay
        let isToday = entry.index == todayIndex
        return Button {
            withAnimation(motion) { onSelect(entry.index, entry.index > selectedDay) }
        } label: {
            VStack(spacing: 2) {
                HStack(spacing: 4) {
                    Text("Day \(entry.index + 1)").font(.subheadline.weight(.semibold))
                    // 오늘은 번호보다 이 표시로 찾는다.
                    if isToday {
                        Text("오늘")
                            .font(.caption2.weight(.bold))
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Ink.accent, in: Capsule())
                            .foregroundStyle(Ink.paper)
                    }
                }
                // 날짜는 탭에, 하루 제목은 목록 머리에 한 번만 표시한다.
                if let date = selected ? TimeFormat.dayChipLabel(entry.date) : TimeFormat.dayChipShort(entry.date) {
                    Text(date).font(.caption2).foregroundStyle(selected ? Ink.accent : Ink.soft)
                }
            }
            .padding(.horizontal, Space.m)
            .padding(.vertical, Space.s)
            .frame(minWidth: 64, minHeight: 56, alignment: .top)
            .overlay(alignment: .bottom) {
                Rectangle().fill(selected ? Ink.accent : Ink.hairline).frame(height: selected ? 2 : 1)
            }
            .foregroundStyle(selected ? Ink.accent : Ink.ink)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Self.accessibilityLabel(entry, isToday: isToday))
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    /// 제목이 없는 날은 대신 그 날의 무게를 말한다 — 빈 날을 눈에 띄게.
    static func subtitle(for entry: DayPlanStripEntry) -> String {
        entry.spotCount == 0 ? "비어 있음" : "\(entry.spotCount)곳"
    }

    static func accessibilityLabel(_ entry: DayPlanStripEntry, isToday: Bool) -> String {
        var parts = ["Day \(entry.index + 1)"]
        if isToday { parts.append("오늘") }
        if let date = TimeFormat.dayChipLabel(entry.date) { parts.append(date) }
        if !entry.title.isEmpty { parts.append(entry.title) }
        parts.append(subtitle(for: entry))
        return parts.joined(separator: ", ")
    }
}
