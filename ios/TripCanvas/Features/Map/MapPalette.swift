import UIKit

/// 일자 색 — **웹과 같은 순서**(`app.js`의 `PALETTE`)다.
///
/// 지도 도로색(노랑·주황)과 겹치지 않게 대비 강한 색을 앞에 둔다. 웹의 일자 카드·범례·경로선이
/// 이 순서를 공유하므로, 앱이 다른 순서를 쓰면 같은 여행을 두 화면에서 다른 색으로 보게 된다.
enum MapPalette {
    // ⚠️ 2026-09-27까지 주석만 '웹과 같은 순서'였고 값은 옛 원색(#e63946…)이었다 — 같은 여행이 두 화면에서 다른 색이었다.
    static let colors: [UIColor] = [
        UIColor(red: 0.776, green: 0.282, blue: 0.169, alpha: 1),   // #c6482b 주홍
        UIColor(red: 0.180, green: 0.361, blue: 0.431, alpha: 1),   // #2e5c6e 청록
        UIColor(red: 0.243, green: 0.478, blue: 0.298, alpha: 1),   // #3e7a4c 초록
        UIColor(red: 0.482, green: 0.369, blue: 0.655, alpha: 1),   // #7b5ea7 보라
        UIColor(red: 0.706, green: 0.314, blue: 0.416, alpha: 1),   // #b4506a 자주
        UIColor(red: 0.184, green: 0.490, blue: 0.490, alpha: 1),   // #2f7d7d 청록회색
        UIColor(red: 0.553, green: 0.431, blue: 0.388, alpha: 1),   // #8d6e63 브라운
        UIColor(red: 0.722, green: 0.396, blue: 0.059, alpha: 1),   // #b8650f 호박
        UIColor(red: 0.361, green: 0.478, blue: 0.184, alpha: 1),   // #5c7a2f 올리브
        UIColor(red: 0.663, green: 0.522, blue: 0.169, alpha: 1)   // #a9852b 황토
    ]

    /// 한 날의 일정 핀 — 앱의 올리브(`AccentColor` 라이트 값)다. 2026-09-27 전에는 시스템 파랑이라 올리브 경로선 위에
    /// 파란 핀이 앉았고, 목록 번호와도 색이 달랐다. **테마와 무관하게 고정**한다 — 다크의 밝은 연두에는 흰 번호가 읽히지 않는다.
    static let itinerary = UIColor(red: 0.275, green: 0.439, blue: 0.180, alpha: 1)   // #46702e
    /// 고른 핀. 타일 위에서 가장 먼저 눈에 띄어야 한다.
    static let selected = UIColor.systemOrange

    /// 음수면 기본색(한 날만 볼 때는 색을 나눌 이유가 없다).
    static func color(_ index: Int) -> UIColor {
        guard index >= 0 else { return .tintColor }
        return colors[index % colors.count]
    }
}
