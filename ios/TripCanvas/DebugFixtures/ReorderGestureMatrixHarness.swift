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
    /// 2026-11-05 전 일정 목록의 날짜 넘기기 — 손이 움직일 때마다 `@State`·`@GestureState`를 써 목록을 다시 그렸다.
    private var oldSwipe: Bool { variant.contains("oldswipe") }
    private var swipe: Bool { !oldSwipe && (variant.contains("swipe") || variant.contains("all")) }
    /// 일정 목록에만 있는 것들 — insetGrouped·섹션·같은 섹션의 머리 줄 / 당겨서 새로고침 / 계속 도는 '계산 중'.
    private var product: Bool { variant.contains("product") }
    private var inset: Bool { product || variant.contains("inset") }
    private var refresh: Bool { product || variant.contains("refresh") }
    private var spinner: Bool { product || variant.contains("spinner") }
    @State private var oldIntent = PlanDaySwipeIntent()
    @GestureState private var oldSwiping = false

    var body: some View {
        VStack(spacing: 0) {
            Text("matrix=\(variant); order=\(items.joined(separator: ","))")
                .font(.caption).accessibilityIdentifier("matrixState")
            List {
                if spinner {
                    Section { ProgressView("이동·도착 시각을 계산하는 중").font(.caption) }
                }
                Section {
                    if inset {
                        Text("방문 일정").font(.headline).moveDisabled(true).deleteDisabled(true)
                    }
                    ForEach(Array(items.enumerated()), id: \.offset) { _, item in row(item) }
                        .onMove { items.move(fromOffsets: $0, toOffset: $1) }
                }
            }
            .matrixListStyle(inset ? .insetGrouped : .plain)
            .modifier(MatrixRefresh(on: refresh))
            .scrollDisabled(oldSwipe && oldIntent.axis == .horizontal)
            .simultaneousGesture(DragGesture(minimumDistance: 12), including: swipe ? .all : .subviews)
            .simultaneousGesture(DragGesture(minimumDistance: 12, coordinateSpace: .global)
                .updating($oldSwiping) { _, active, _ in active = true }
                .onChanged { oldIntent.update($0.translation) }
                .onEnded { _ in oldIntent = PlanDaySwipeIntent() },
                including: oldSwipe ? .all : .subviews)
            .onChange(of: oldSwiping) { _, active in if !active { oldIntent = PlanDaySwipeIntent() } }
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
private enum AnyListStyle { case insetGrouped, plain }

private extension View {
    @ViewBuilder func matrixListStyle(_ style: AnyListStyle) -> some View {
        switch style {
        case .insetGrouped: listStyle(InsetGroupedListStyle())
        case .plain: listStyle(PlainListStyle())
        }
    }
}

private struct MatrixRefresh: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View {
        if on { content.refreshable {} } else { content }
    }
}
#endif
