import XCTest
@testable import TripCanvas

/// 로그인 브랜드 장면의 시간표 — 화면이 아니라 화면이 그리는 **값**을 본다.
final class ItineraryIntroTests: XCTestCase {
    private typealias Timeline = ItineraryIntroTimeline

    func testStartsWithScatteredPlacesAndHiddenActions() {
        let start = Timeline.frame(at: 0)
        XCTAssertEqual(start.card, 1)
        XCTAssertEqual(start.head, 0)
        XCTAssertTrue(start.chips.allSatisfy { $0.appear == 1 && $0.travel == 0 && $0.settled == 0 })
        XCTAssertEqual(start.spine, 0)
        XCTAssertEqual(start.reachedStops, 0)
        XCTAssertEqual([start.signature, start.cap, start.headline, start.subline, start.google, start.email, start.signup], [0, 0, 0, 0, 0, 0, 0])
    }

    /// 움직임 줄이기에서 곧바로 쓰는 모양이 **다 그려진 장면**이어야 한다 — 반쯤 그린 카드가 남으면 안 된다.
    func testFinalIsTheCompletedScene() {
        let end = Timeline.final
        XCTAssertEqual(end.card, 1)
        XCTAssertEqual(end.head, 1)
        XCTAssertEqual(end.chips.count, Timeline.stopCount)
        XCTAssertTrue(end.chips.allSatisfy { $0.appear == 1 && $0.travel == 1 && $0.settled == 1 })
        XCTAssertEqual(end.spine, 1)
        XCTAssertEqual(end.reachedStops, Timeline.stopCount)
        XCTAssertEqual([end.signature, end.cap, end.headline, end.subline, end.google, end.email, end.signup], [1, 1, 1, 1, 1, 1, 1])
        XCTAssertEqual(Timeline.frame(at: 60), end, "끝난 뒤에는 멈춰 있다 — 반복하지 않는다")
    }

    /// 모든 값은 0…1 안에서 뒤로 가지 않는다. 되감기는 순간이 있으면 화면이 떨린다.
    func testEveryValueOnlyMovesForward() {
        var previous = Timeline.frame(at: 0)
        for step in 1...Int(Timeline.duration * 120) {
            let now = Timeline.frame(at: Double(step) / 120)
            let pairs: [(Double, Double)] = [
                (previous.card, now.card), (previous.head, now.head), (previous.spine, now.spine),
                (previous.signature, now.signature), (previous.cap, now.cap),
                (previous.google, now.google), (previous.email, now.email), (previous.signup, now.signup),
                (previous.headline, now.headline), (previous.subline, now.subline),
            ] + zip(previous.chips, now.chips).flatMap { [($0.appear, $1.appear), ($0.travel, $1.travel), ($0.settled, $1.settled)] }
            for (before, after) in pairs {
                XCTAssertGreaterThanOrEqual(after, before - 1e-12, "t=\(Double(step) / 120)")
                XCTAssertTrue((0...1).contains(after))
            }
            XCTAssertGreaterThanOrEqual(now.reachedStops, previous.reachedStops)
            previous = now
        }
    }

    /// 이야기의 순서: 흩어짐 → 하루의 순서로 내려앉음 → 경로가 잇는다 → J가 서명한다.
    func testStoryHappensInOrder() throws {
        func firstMoment(_ value: (Timeline.Frame) -> Double) -> Double? {
            stride(from: 0.0, through: Timeline.duration, by: 0.01).first { value(Timeline.frame(at: $0)) > 0 }
        }
        func doneMoment(_ value: (Timeline.Frame) -> Double) -> Double? {
            stride(from: 0.0, through: Timeline.duration, by: 0.01).first { value(Timeline.frame(at: $0)) >= 1 }
        }
        let travels = (0..<Timeline.stopCount).compactMap { i in firstMoment { $0.chips[i].travel } }
        XCTAssertEqual(travels, travels.sorted(), "위에서부터 차례로 내려앉는다")
        let lastSettled = try XCTUnwrap(doneMoment { $0.chips.last!.travel })
        let spineDone = try XCTUnwrap(doneMoment { $0.spine })
        let signing = try XCTUnwrap(firstMoment { $0.signature })
        XCTAssertLessThanOrEqual(lastSettled, try XCTUnwrap(firstMoment { $0.spine }) + 0.5, "경로는 줄이 거의 자리 잡은 뒤에 긋는다")
        XCTAssertLessThan(spineDone, signing, "서명은 하루가 이어진 다음이다")
        let google = try XCTUnwrap(firstMoment { $0.google })
        XCTAssertLessThan(try XCTUnwrap(doneMoment { $0.signature }), google)
        XCTAssertLessThan(try XCTUnwrap(doneMoment { $0.cap }), google)
        XCTAssertLessThan(try XCTUnwrap(doneMoment { $0.subline }), google)
        XCTAssertLessThan(google, try XCTUnwrap(firstMoment { $0.email }))
        XCTAssertLessThan(try XCTUnwrap(firstMoment { $0.email }), try XCTUnwrap(firstMoment { $0.signup }))
    }

    /// 점은 경로가 **지나간 줄**에만 찍힌다.
    func testStopsLightUpAsTheRoutePasses() {
        XCTAssertEqual(Timeline.frame(at: 1.17).reachedStops, 0, "경로가 시작하기 전")
        XCTAssertEqual(Timeline.frame(at: 1.18).reachedStops, 1, "첫 줄은 경로의 출발점")
        for t in stride(from: 1.18, through: 2.1, by: 0.01) {
            let frame = Timeline.frame(at: t)
            let covered = Int((frame.spine * Double(Timeline.stopCount - 1) + 0.003).rounded(.down)) + 1
            XCTAssertEqual(frame.reachedStops, min(covered, Timeline.stopCount), "t=\(t)")
        }
    }

    /// 장면의 하루는 특정 도시가 아니고, 시각은 하루의 순서다.
    func testSceneIsAnOrderedGenericDay() {
        let stops = ItineraryIntroScene.stops
        XCTAssertEqual(stops.count, Timeline.stopCount)
        XCTAssertEqual(stops.map(\.time), stops.map(\.time).sorted())
        XCTAssertTrue(stops.allSatisfy { $0.symbol.allSatisfy(\.isASCII) }, "기호는 SF Symbols — 이모지를 섞지 않는다")
    }
}
