import Foundation

/// 한 번의 드래그 방향만 다룬다. 날짜나 여행 판단을 계산하지 않는다.
struct PlanDaySwipeIntent {
    enum Axis { case undecided, horizontal, vertical }
    private(set) var axis: Axis = .undecided

    mutating func update(_ translation: CGSize) {
        guard axis == .undecided,
              max(abs(translation.width), abs(translation.height)) >= 12 else { return }
        axis = abs(translation.width) > abs(translation.height) * 1.5 ? .horizontal : .vertical
    }

    func destination(translation: CGSize, selectedDay: Int, dayCount: Int, isEditing: Bool) -> Int? {
        guard !isEditing, axis == .horizontal,
              abs(translation.width) > 60,
              abs(translation.width) > abs(translation.height) * 1.5 else { return nil }
        let target = selectedDay + (translation.width < 0 ? 1 : -1)
        return (0..<max(0, dayCount)).contains(target) ? target : nil
    }
}

/// 한 번의 드래그 방향 판정을 담는 상자. **SwiftUI 상태가 아니다.**
///
/// ⚠️ 전에는 판정을 `@State`/`@GestureState`에 두어 손이 움직일 때마다 일정 목록 전체를 다시 그렸다.
///    세로로 끄는 장소 순서 바꾸기(List의 길게 눌러 끌기)도 이 제스처를 함께 지나므로, 끄는 도중의 다시 그리기가
///    끌어 올린 줄을 놓치게 했다(2026-11-05 CI — 실행마다 갈렸다). 화면이 알아야 하는 것은 '가로로 잠겼는가' 하나뿐이라
///    그것만 상태로 두고(`PlanSpotList.lockedHorizontal`), 나머지는 여기서 조용히 센다.
final class PlanDaySwipeTracker {
    private(set) var intent = PlanDaySwipeIntent()
    private var start: CGPoint?

    /// 시작점이 바뀌면 새 드래그다 — 시스템이 취소해 `onEnded`가 오지 않은 지난 판정을 버린다.
    func update(start newStart: CGPoint, translation: CGSize) {
        if start != newStart {
            start = newStart
            intent = PlanDaySwipeIntent()
        }
        intent.update(translation)
    }

    func reset() {
        start = nil
        intent = PlanDaySwipeIntent()
    }
}
