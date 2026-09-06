import XCTest
@testable import TripCanvas

/// `lib.js`가 인코딩한 것을 앱이 같은 점으로 푸는지 — 픽스처는 `polylineParity.test.ts`가 만든다.
/// 어긋나면 지도에 엉뚱한 선이 그려진다(그리고 아무도 모른다).
final class PolylineTests: XCTestCase {

    private struct Fixture: Decodable {
        struct Case: Decodable { let name: String; let encoded: String; let points: [GeoPoint] }
        let cases: [Case]
    }

    func testMatchesTheWebDecoder() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "polyline", withExtension: "json"))
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        XCTAssertFalse(fixture.cases.isEmpty)

        for c in fixture.cases {
            let decoded = Polyline.decode(c.encoded)
            XCTAssertEqual(decoded.count, c.points.count, c.name)
            for (a, b) in zip(decoded, c.points) {
                XCTAssertEqual(a.lat, b.lat, accuracy: 0.000_01, c.name)
                XCTAssertEqual(a.lng, b.lng, accuracy: 0.000_01, c.name)
            }
        }
    }

    /// 없는 경로는 없는 것이다 — 빈 배열이지 (0,0)이 아니다.
    func testEmptyAndBrokenInputsGiveNothing() {
        XCTAssertTrue(Polyline.decode(nil).isEmpty)
        XCTAssertTrue(Polyline.decode("").isEmpty)
        // 위도만 있고 경도가 끊긴 문자열 — 읽은 데까지만 쓰고 반쪽 점을 만들지 않는다
        XCTAssertTrue(Polyline.decode("_p~iF").isEmpty)
    }
}
