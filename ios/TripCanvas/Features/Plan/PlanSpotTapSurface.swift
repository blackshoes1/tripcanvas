import SwiftUI
import UIKit

/// 행 위에서 시작한 드래그를 탭으로 해석하지 않는 UIKit 터치 표면.
struct PlanSpotTapSurface: UIViewRepresentable {
    var onTap: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onTap: onTap) }

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.backgroundColor = .clear
        view.isAccessibilityElement = false
        let tap = PlanTapRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped))
        tap.cancelsTouchesInView = false
        tap.delegate = context.coordinator
        view.addGestureRecognizer(tap)
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        context.coordinator.onTap = onTap
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var onTap: () -> Void
        init(onTap: @escaping () -> Void) { self.onTap = onTap }
        @objc func tapped(_ recognizer: UITapGestureRecognizer) {
            if recognizer.state == .ended { onTap() }
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }
    }
}

/// UIKit의 기본 탭 허용 이동량 대신 날짜 드래그와 같은 12pt를 경계로 쓴다.
private final class PlanTapRecognizer: UITapGestureRecognizer {
    private var origin: CGPoint?

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        origin = touches.first?.location(in: nil)
        super.touchesBegan(touches, with: event)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        guard !movedTooFar(touches) else { state = .failed; return }
        super.touchesMoved(touches, with: event)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        guard !movedTooFar(touches) else { state = .failed; return }
        super.touchesEnded(touches, with: event)
    }

    override func reset() {
        super.reset()
        origin = nil
    }

    private func movedTooFar(_ touches: Set<UITouch>) -> Bool {
        guard let origin, let point = touches.first?.location(in: nil) else { return false }
        return hypot(point.x - origin.x, point.y - origin.y) >= 12
    }
}
