import SwiftUI
import XCTest
@testable import TripCanvas

@MainActor
final class CreateTripDraftTests: XCTestCase {
    func testScratchViewRecreationKeepsTheTypedTripAndSeparatePasteText() throws {
        let scratch = NewTripFormState()
        let paste = PasteItineraryFormState()
        var first: NewTripView? = NewTripView(mode: .constant(.scratch), form: scratch, onCreate: { _ in nil })
        first?.form.city = "교토"
        first?.form.name = "엄마와 교토"
        first?.form.nameEdited = true
        first?.form.start = try XCTUnwrap(ISODateText.date(from: "2026-10-03"))
        first?.form.dayCount = 5
        let before = try XCTUnwrap(first?.form.draft)

        first = nil // 방식 전환으로 자식 View가 사라지는 상황
        paste.text = "10월 3일 12:07 교토역"
        let restored = NewTripView(mode: .constant(.scratch), form: scratch, onCreate: { _ in nil })

        XCTAssertEqual(restored.form.draft, before)
        XCTAssertEqual(restored.form.draft, NewTripDraft(name: "엄마와 교토", start: "2026-10-03", dayCount: 5, city: "교토"))
        XCTAssertTrue(restored.form.nameEdited)
        XCTAssertEqual(paste.text, "10월 3일 12:07 교토역", "두 방식의 입력은 서로 덮어쓰지 않는다")
    }

    func testPastePreviewRecreationKeepsCheckedRowsLocationsAndFinalDocument() throws {
        let form = PasteItineraryFormState()
        let todayURL = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "today", withExtension: "json"))
        let today = try JSONDecoder().decode(TodayResponse.self, from: Data(contentsOf: todayURL))
        let service = TodayViewModelTests.StubDataSource(todayResponse: today)
        let places = NoDraftSearch()
        var first: PasteItineraryView? = PasteItineraryView(service: service, places: places, mode: .constant(.paste), form: form, onCreated: { _ in })
        let included = item("교토역", at: "12:07")
        let excluded = item("잠깐 쉬기")
        let draft = ItineraryDraft(name: "읽은 이름", start: "2026-10-03", startAmbiguous: false, days: [
            ItineraryDraftDay(index: 0, title: "도착", date: "2026-10-03", note: "원래 메모", items: [included, excluded])
        ])
        first?.form.text = "원문 일정 그대로"
        first?.form.draft = draft
        first?.form.tripName = "직접 고친 이름"
        first?.form.start = "2026-10-03"
        first?.form.rows = [
            .init(dayIndex: 0, item: included, include: true,
                  found: PlaceHit(id: "kyoto-station", name: "교토역", city: "교토", address: "교토역 주소",
                                  point: GeoPoint(lat: 34.9858, lng: 135.7588), category: .transport, placeId: "station-place"), searched: true),
            .init(dayIndex: 0, item: excluded, include: false)
        ]
        let rowIDs = form.rows.map(\.id)
        let before = madeDocument(form)

        first = nil
        let scratch = NewTripFormState()
        scratch.city = "오사카"
        let restored = PasteItineraryView(service: service, places: places, mode: .constant(.paste), form: form, onCreated: { _ in })

        XCTAssertEqual(restored.form.text, "원문 일정 그대로")
        XCTAssertEqual(restored.form.draft, draft)
        XCTAssertEqual(restored.form.rows.map(\.id), rowIDs)
        XCTAssertEqual(restored.form.rows.map(\.include), [true, false])
        XCTAssertEqual(restored.form.rows[0].found?.point, GeoPoint(lat: 34.9858, lng: 135.7588))
        XCTAssertTrue(restored.form.rows[0].searched)
        XCTAssertEqual(madeDocument(restored.form), before)
        XCTAssertEqual(before["name"], .string("직접 고친 이름"))
        let day = before["days"]?.arrayValue?.first
        XCTAssertEqual(day?["spots"]?.arrayValue?.count, 1)
        XCTAssertTrue(day?["note"]?.stringValue?.contains("잠깐 쉬기") == true)
        XCTAssertEqual(service.todayCallCount, 0)
        XCTAssertEqual(places.calls, 0, "방식 전환만으로 이미 찾은 장소를 다시 검색하지 않는다")
    }

    private func item(_ name: String, at: String? = nil) -> ItineraryDraftItem {
        ItineraryDraftItem(raw: name, name: name, city: "교토", desc: "", at: at, endAt: nil,
                           stayMinutes: nil, url: nil, cost: nil, currency: nil, optional: false,
                           stay: false, location: nil, kind: .place, reasons: [])
    }

    private func madeDocument(_ form: PasteItineraryFormState) -> [String: JSONValue] {
        guard let draft = form.draft else { return [:] }
        return ItineraryDocument.make(draft: draft,
            lines: form.rows.map { .init(dayIndex: $0.dayIndex, item: $0.item, include: $0.include, found: $0.found) },
            name: form.tripName, start: form.start)
    }
}

@MainActor
private final class NoDraftSearch: PlaceSearching {
    private(set) var calls = 0
    func search(_ query: String, near: GeoPoint?) async throws -> [PlaceHit] {
        calls += 1
        return []
    }
}
