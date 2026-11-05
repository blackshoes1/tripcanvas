#if DEBUG
import SwiftUI

/// 편집 모드 밖의 '길게 눌러 끌기'를 무엇이 막는지 가르는 진단 화면.
/// 일정 목록의 장소 줄이 쓰는 수정자(컨텍스트 메뉴 · UIKit 탭 표면 · 목록의 날짜 넘기기 제스처)를 하나씩 더한다.
/// `--review-reorder-variant=<이름>`으로 고른다. 2026-11-05에 `tap`(탭 표면 하나)만 끌기가 막혀 원인을 갈랐다 —
/// 같은 사고가 되살아나지 않게 남겨 둔다.
struct ReorderGestureMatrixHarness: View {
    let variant: String
    @State private var items = ["하나", "둘", "셋", "넷"]

    private var menu: Bool { variant.contains("menu") || variant.contains("all") }
    private var tap: Bool { variant.contains("tap") || variant.contains("all") }
    private var swipe: Bool { variant.contains("swipe") || variant.contains("all") }

    var body: some View {
        VStack(spacing: 0) {
            Text("matrix=\(variant); order=\(items.joined(separator: ","))")
                .font(.caption).accessibilityIdentifier("matrixState")
            List {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in row(item) }
                    .onMove { items.move(fromOffsets: $0, toOffset: $1) }
            }
            .simultaneousGesture(DragGesture(minimumDistance: 12), including: swipe ? .all : .subviews)
        }
    }

    @ViewBuilder
    private func row(_ item: String) -> some View {
        let base = Text("행 \(item)").frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
        let tapped = Group {
            if tap { base.overlay(PlanSpotTapSurface {}) } else { base }
        }
        if menu {
            tapped.contextMenu { Button("메뉴 항목") {} }
        } else {
            tapped
        }
    }
}
#endif
