import XCTest
@testable import TripCanvas

/// 웹 화면(WebAppView)이 링크를 어디로 보내는지. 화면을 띄우지 않고 규칙만 본다.
final class WebLinkTests: XCTestCase {
    func testHttpStaysInsideTheWebView() {
        XCTAssertEqual(WebLink.route(for: URL(string: "https://tripcanvas-ai.vercel.app/#join=abc")), .inApp)
        XCTAssertEqual(WebLink.route(for: URL(string: "http://localhost:8000/")), .inApp)
    }

    /// 지도·검색 SDK는 다른 호스트에서 온다 — 호스트로 가르면 지도가 통째로 죽는다.
    func testOtherHostsAreStillOpenedInside() {
        XCTAssertEqual(WebLink.route(for: URL(string: "https://maps.googleapis.com/maps/api/js")), .inApp)
        XCTAssertEqual(WebLink.route(for: URL(string: "https://dapi.kakao.com/v2/maps/sdk.js")), .inApp)
    }

    /// 내보내기가 만드는 blob:·data: 는 웹뷰가 스스로 다룬다.
    func testBlobAndDataStayInside() {
        XCTAssertEqual(WebLink.route(for: URL(string: "blob:https://tripcanvas-ai.vercel.app/1234")), .inApp)
        XCTAssertEqual(WebLink.route(for: URL(string: "data:text/plain,hi")), .inApp)
    }

    func testAppSchemesGoToTheSystem() {
        let tel = URL(string: "tel:0212345678")!
        XCTAssertEqual(WebLink.route(for: tel), .system(tel))
        let kakao = URL(string: "kakaomap://route?ep=37.5,127.0")!
        XCTAssertEqual(WebLink.route(for: kakao), .system(kakao))
        let mail = URL(string: "mailto:hi@example.com")!
        XCTAssertEqual(WebLink.route(for: mail), .system(mail))
    }

    func testMissingURLIsBlocked() {
        XCTAssertEqual(WebLink.route(for: nil), .blocked)
        XCTAssertEqual(WebLink.route(for: URL(string: "/relative/path")), .blocked)
    }
}
