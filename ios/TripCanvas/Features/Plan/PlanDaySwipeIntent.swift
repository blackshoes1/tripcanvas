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
