#if DEBUG
import SwiftUI

/// 편집 모드 밖의 '길게 눌러 끌기'를 장소 줄의 수정자가 막지 않는지 보는 화면.
/// `--review-reorder-variant=<이름>`으로 고른다.
///
/// 2026-11-05 진단 기록(CI 다섯 번):
/// - `tap` — UIKit 탭 표면이 터치를 직접 받던 동안 끌기가 **매번** 막혔다. 터치를 받지 않게 고친 뒤로 매번 된다.
/// - `menu` — 줄에 컨텍스트 메뉴를 붙이면 끌기가 **실행마다 갈렸다**(길게 누르기를 메뉴와 다툰다). 그래서 일정 줄은
///   컨텍스트 메뉴 대신 줄 끝 ⋯를 쓴다. 이 변형은 그 사실을 남기는 진단이라 실패로 세지 않는다.
/// - 목록의 날짜 넘기기 제스처·insetGrouped·섹션 머리 줄·당겨서 새로고침·계속 도는 '계산 중'은 원인이 아니었다.
struct ReorderGestureMatrixHarness: View {
    let variant: String
    @State private var items = ["하나", "둘", "셋", "넷"]

    /// 일정 줄과 같은 모양 — 탭 표면 · 줄 끝 ⋯ · 목록의 날짜 넘기기 제스처.
    private var all: Bool { variant == "all" }
    private var tap: Bool { all || variant == "tap" }
    private var menu: Bool { variant == "menu" }

    var body: some View {
        VStack(spacing: 0) {
            Text("matrix=\(variant); order=\(items.joined(separator: ","))")
                .font(.caption).accessibilityIdentifier("matrixState")
            List {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in row(item) }
                    .onMove { items.move(fromOffsets: $0, toOffset: $1) }
            }
            .simultaneousGesture(DragGesture(minimumDistance: 12), including: all ? .all : .subviews)
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
        } else if all {
            HStack(spacing: 0) {
                tapped
                Menu { Button("메뉴 항목") {} } label: {
                    Image(systemName: "ellipsis").frame(width: 44, height: 44)
                }
            }
        } else {
            tapped
        }
    }
}
#endif
