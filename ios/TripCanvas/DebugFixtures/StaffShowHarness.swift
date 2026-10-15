#if DEBUG
import SwiftUI

/// 운영 데이터·인증·네트워크 없이 실제 보여주기 화면의 공개/숨김과 큰 글씨를 검증한다.
struct StaffShowHarness: View {
    private var card: StaffShowCard {
        var spot = TripSpot(name: "합성 호텔")
        spot.staffDetails.localName = "Hôtel de démonstration"
        spot.staffDetails.address = "10 Rue de démonstration\n75001 Paris"
        var booking = TripBooking(raw: ["id": .string("synthetic-staff"), "type": .string("hotel"),
            "confirmation": .string("SYNTHETIC-PRIVATE-123"), "start": .string("2026-10-15"),
            "end": .string("2026-10-17"), "adults": .number(2)])
        booking.staffDetails.bookingName = "SYNTHETIC GUEST"
        return StaffShowCard(spot: spot, booking: booking)
    }
    var body: some View {
        NavigationStack {
            VStack(spacing: Space.l) {
                Text("합성 오프라인 예약 · 네트워크 사용 없음")
                StaffShowButton(card: card)
            }.padding(Space.l).background(Ink.paper)
        }
    }
}
#endif
