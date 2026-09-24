import XCTest
@testable import TripCanvas

@MainActor
final class SocialSignInTests: XCTestCase {
    func testPKCEStandardVector() {
        XCTAssertEqual(SocialSignIn.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
                       "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }
    func testCallbackMustMatchOriginAndState() throws {
        XCTAssertEqual(try SocialSignIn.ticket(from: URL(string: "tripcanvas://oauth#social_state=proof&social_ticket=ticket")!, challenge: "proof"), "ticket")
        for url in ["tripcanvas://other#social_state=proof&social_ticket=ticket",
                    "https://oauth#social_state=proof&social_ticket=ticket",
                    "tripcanvas://oauth#social_state=wrong&social_ticket=ticket",
                    "tripcanvas://oauth#social_state=proof&social_state=proof&social_ticket=ticket",
                    "tripcanvas://oauth#social_state=proof&social_ticket=ticket&social_ticket=other",
                    "tripcanvas://oauth#social_state=proof&social_error=EMAIL_NOT_VERIFIED"] {
            XCTAssertThrowsError(try SocialSignIn.ticket(from: URL(string: url)!, challenge: "proof"))
        }
    }
}
