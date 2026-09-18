import Foundation

/// **예약 결제 금액**의 한 줄 — 예약(`trip.bookings`)과 여행 단위 비용(`trip.costItems`)을 같은 모양으로.
///
/// 둘은 저장되는 곳이 다르지만 사용자에게는 같은 것이다: 가기 전에 내는 돈. 그래서 한 목록·한 편집기로 다룬다.
/// 상태는 서버 응답의 `payState`(여행 시간대의 오늘로 정했다)가 먼저고, 응답이 없으면 기기 날짜로 같은 규칙을 쓴다.
struct PaymentRow: Identifiable, Hashable, Sendable {
    enum Source: Hashable, Sendable {
        case booking(TripBooking)
        case item(CostEntry)
    }

    let source: Source

    var booking: TripBooking? { if case .booking(let booking) = source { return booking }; return nil }
    var item: CostEntry? { if case .item(let item) = source { return item }; return nil }

    /// 응답의 줄(`TripCostLine`)을 찾는 키 — `source`·`key`.
    var lineSource: String { booking != nil ? "BOOKING" : "TRIP" }
    var key: String { booking?.id ?? item?.id ?? "" }
    var id: String { "\(lineSource):\(key)" }

    var kind: CostCategory {
        if let booking { return CostCategory(bookingType: booking.type) }
        return CostCategory(rawValue: item?.kind ?? "") ?? .other
    }
    var title: String {
        let text = booking?.title ?? item?.title ?? ""
        return text.isEmpty ? (booking != nil ? "예약" : "비용") : text
    }
    var amount: Double? {
        if let booking { return booking.price > 0 ? booking.price : nil }
        return item?.amount
    }
    var currencyCode: String { booking?.currencyCode ?? item?.currency.rawValue ?? "KRW" }
    var paidOn: String? { booking?.paidOn ?? item?.paidOn }
    /// 손으로 고른 상태 — 결제일이 있으면 `CostPayState.resolved`가 대신 답한다.
    var manualPayState: CostPayState { booking?.payState ?? item?.payState ?? .none }
    var photos: [String] { booking?.photos ?? item?.photos ?? [] }

    /// 결제일이 최근인 것부터, 결제일이 없는 것은 그 뒤에 등록 순(예약 → 비용). 웹 `paymentRows`와 같은 순서다.
    static func rows(bookings: [TripBooking], items: [CostEntry]) -> [PaymentRow] {
        let all = bookings.map { PaymentRow(source: .booking($0)) } + items.map { PaymentRow(source: .item($0)) }
        // 안정 정렬 — 결제일이 없는 것들끼리는 원래 순서를 지킨다.
        return all.enumerated().sorted { lhs, rhs in
            switch (lhs.element.paidOn, rhs.element.paidOn) {
            case let (l?, r?) where l != r: return l > r
            case (.some, .none): return true
            case (.none, .some): return false
            default: return lhs.offset < rhs.offset
            }
        }.map(\.element)
    }
}
