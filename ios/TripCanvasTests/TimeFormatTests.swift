import XCTest
@testable import TripCanvas

/// 서버가 주는 '자정부터의 분'을 사람이 읽는 형태로 옮기는 것 —
/// iOS가 스스로 판단하는 몇 안 되는 영역이라 여기만큼은 정확해야 한다.
final class TimeFormatTests: XCTestCase {

    func testClockFormatsMinutesAsLocalTime() {
        XCTAssertEqual(TimeFormat.clock(0), "00:00")
        XCTAssertEqual(TimeFormat.clock(9 * 60), "09:00")
        XCTAssertEqual(TimeFormat.clock(13 * 60 + 5), "13:05")
        XCTAssertEqual(TimeFormat.clock(23 * 60 + 59), "23:59")
    }

    /// 자정을 넘긴 일정(야간열차 등)도 깨지지 않아야 한다.
    func testClockWrapsPastMidnight() {
        XCTAssertEqual(TimeFormat.clock(24 * 60), "00:00")
        XCTAssertEqual(TimeFormat.clock(25 * 60 + 30), "01:30")
        XCTAssertEqual(TimeFormat.clock(-30), "23:30")
    }

    func testDurationReadsNaturally() {
        XCTAssertEqual(TimeFormat.duration(0), "0분")
        XCTAssertEqual(TimeFormat.duration(45), "45분")
        XCTAssertEqual(TimeFormat.duration(60), "1시간")
        XCTAssertEqual(TimeFormat.duration(90), "1시간 30분")
        XCTAssertEqual(TimeFormat.duration(-5), "0분", "음수는 0분으로 — 마이너스 시간을 보여주지 않는다")
    }

    func testMoneyUsesCurrencySymbolWhenKnown() {
        XCTAssertEqual(TimeFormat.money(128000, currency: "KRW"), "₩128,000")
        XCTAssertEqual(TimeFormat.money(1292, currency: "EUR"), "€1,292")
        // 모르는 통화는 기호를 지어내지 않고 코드를 그대로 붙인다.
        XCTAssertEqual(TimeFormat.money(100, currency: "THB"), "100 THB")
    }

    func testStatusLabelsExistForEveryState() {
        let all: [TravelStatus] = [.noPlan, .upcoming, .readyToLeave, .traveling, .arrived, .inProgress, .delayed, .completed, .unknown]
        for status in all {
            XCTAssertFalse(StatusPalette.label(for: status).isEmpty, "\(status) 문구 없음")
            XCTAssertFalse(StatusPalette.symbol(for: status).isEmpty, "\(status) 기호 없음 — 색만으로 구분하면 안 된다")
        }
    }
}
