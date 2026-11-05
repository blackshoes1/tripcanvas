import SwiftUI
import UIKit

/// 행 위에서 시작한 드래그를 탭으로 해석하지 않는 UIKit 탭 판정.
///
/// ⚠️ **이 뷰는 터치를 받지 않는다**(`isUserInteractionEnabled = false`). 탭 인식기는 줄을 담은 **셀**에 붙이고,
///    이 뷰의 영역 안에서 시작한 터치만 받는다. 전에는 이 뷰가 줄 전체를 덮고 터치를 직접 받아서,
///    목록의 '길게 눌러 끌기'(편집 모드 밖 순서 바꾸기)가 시작되지 않았다(2026-11-05, `ReorderGestureMatrixUITests`의
///    `tap` 변형 — 이 표면 하나만 얹어도 끌기가 막혔다). 터치가 SwiftUI 줄에 그대로 닿아야 List가 끌기를 연다.
struct PlanSpotTapSurface: UIViewRepresentable {
    var onTap: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onTap: onTap) }

    func makeUIView(context: Context) -> AnchorView {
        let view = AnchorView()
        view.backgroundColor = .clear
        view.isAccessibilityElement = false
        view.isUserInteractionEnabled = false
        let tap = PlanTapRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped))
        tap.cancelsTouchesInView = false
        tap.delaysTouchesEnded = false
        tap.delegate = context.coordinator
        context.coordinator.anchor = view
        view.recognizer = tap
        return view
    }

    func updateUIView(_ uiView: AnchorView, context: Context) {
        context.coordinator.onTap = onTap
    }

    static func dismantleUIView(_ uiView: AnchorView, coordinator: Coordinator) {
        uiView.detachRecognizer()
    }

    /// 화면에 붙는 순간 가장 가까운 셀(없으면 바로 위 뷰)에 인식기를 옮겨 단다.
    final class AnchorView: UIView {
        var recognizer: UIGestureRecognizer?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard let recognizer else { return }
            guard window != nil else { detachRecognizer(); return }
            let host = hostView()
            if recognizer.view !== host {
                recognizer.view?.removeGestureRecognizer(recognizer)
                host?.addGestureRecognizer(recognizer)
            }
        }

        func detachRecognizer() {
            guard let recognizer else { return }
            recognizer.view?.removeGestureRecognizer(recognizer)
        }

        private func hostView() -> UIView? {
            var candidate = superview
            while let view = candidate {
                if view is UICollectionViewCell || view is UITableViewCell { return view }
                candidate = view.superview
            }
            return superview
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var onTap: () -> Void
        weak var anchor: UIView?
        init(onTap: @escaping () -> Void) { self.onTap = onTap }
        @objc func tapped(_ recognizer: UITapGestureRecognizer) {
            if recognizer.state == .ended { onTap() }
        }
        /// 셀에는 이 줄 말고도 다른 것(편집 모드의 손잡이 등)이 있다 — 이 뷰의 영역에서 시작한 터치만 탭이다.
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard let anchor, anchor.window != nil, !anchor.isHidden else { return false }
            return anchor.bounds.contains(touch.location(in: anchor))
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
