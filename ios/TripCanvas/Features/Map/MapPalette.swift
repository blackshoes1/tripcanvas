import UIKit

/// 일자 색 — **웹과 같은 순서**(`app.js`의 `PALETTE`)다.
///
/// 지도 도로색(노랑·주황)과 겹치지 않게 대비 강한 색을 앞에 둔다. 웹의 일자 카드·범례·경로선이
/// 이 순서를 공유하므로, 앱이 다른 순서를 쓰면 같은 여행을 두 화면에서 다른 색으로 보게 된다.
enum MapPalette {
    static let colors: [UIColor] = [
        UIColor(red: 0.90, green: 0.22, blue: 0.27, alpha: 1),   // #e63946 빨강
        UIColor(red: 0.12, green: 0.53, blue: 0.90, alpha: 1),   // #1e88e5 파랑
        UIColor(red: 0.18, green: 0.80, blue: 0.44, alpha: 1),   // #2ecc71 초록
        UIColor(red: 0.61, green: 0.35, blue: 0.71, alpha: 1),   // #9b59b6 보라
        UIColor(red: 0.93, green: 0.28, blue: 0.60, alpha: 1),   // #ec4899 핑크
        UIColor(red: 0.08, green: 0.72, blue: 0.65, alpha: 1),   // #14b8a6 청록
        UIColor(red: 0.55, green: 0.43, blue: 0.39, alpha: 1),   // #8d6e63 브라운
        UIColor(red: 1.00, green: 0.50, blue: 0.31, alpha: 1),   // #ff7f50 코랄
        UIColor(red: 0.64, green: 0.90, blue: 0.21, alpha: 1),   // #a3e635 라임
        UIColor(red: 0.96, green: 0.73, blue: 0.24, alpha: 1)    // #f6b93b 노랑
    ]

    /// 음수면 기본색(한 날만 볼 때는 색을 나눌 이유가 없다).
    static func color(_ index: Int) -> UIColor {
        guard index >= 0 else { return .tintColor }
        return colors[index % colors.count]
    }
}
