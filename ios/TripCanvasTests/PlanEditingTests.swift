import XCTest
@testable import TripCanvas

@MainActor
final class PlanEditingTests: XCTestCase {
    private func document(_ days: [[TripSpot]], start: String = "2026-10-01") -> TripDocument {
        TripDocument(raw: ["name": .string("계획 연습"), "start": .string(start),
                           "days": .array(days.map { .object(["spots": .array($0.map { .object($0.raw) })]) })])
    }

    private func spot(_ name: String) -> TripSpot { TripSpot(name: name, city: "교토") }

    func testMovingSeveralPlacesPreservesTheirOrderAndRawReservations() {
        var ticket = spot("예약 입장")
        ticket.bookedAt = "12:07"
        ticket.bookingId = "ticket-booking"
        ticket.setField("futureReservation", .object(["absoluteDate": .string("2026-10-01")]))
        ticket.setField("who", .array([.string("traveler-a")]))
        let originalTicket = ticket.raw
        var doc = document([[spot("A"), ticket, spot("C"), spot("D")], [spot("X"), spot("Y")]])
        let before = doc

        doc.moveSpots(fromDay: 0, indexes: IndexSet([1, 3]), toDay: 1, position: 1)

        XCTAssertEqual(doc.days[0].spots.map(\.name), ["A", "C"])
        XCTAssertEqual(doc.days[1].spots.map(\.name), ["X", "예약 입장", "D", "Y"])
        XCTAssertEqual(doc.days[1].spots[1].raw, originalTicket)
        XCTAssertEqual(before.days[0].spots.count, 4, "미리보기용 값 복사가 원문을 바꾸면 안 된다")
    }

    func testMovingPlacesToFirstAndLastPositionsKeepsTheSelectionOrder() {
        for position in [0, 2] {
            var doc = document([[spot("A"), spot("B")], [spot("X"), spot("Y")]])
            doc.moveSpots(fromDay: 0, indexes: IndexSet([0, 1]), toDay: 1, position: position)
            XCTAssertTrue(doc.days[0].spots.isEmpty)
            XCTAssertEqual(doc.days[1].spots.map(\.name), position == 0 ? ["A", "B", "X", "Y"] : ["X", "Y", "A", "B"])
        }
    }

    func testSameDayMoveUsesThePositionBeforeRemovingTheSelection() {
        var doc = document([[spot("A"), spot("B"), spot("C"), spot("D"), spot("E")]])
        doc.moveSpots(fromDay: 0, indexes: IndexSet([1, 3]), toDay: 0, position: 5)
        XCTAssertEqual(doc.days[0].spots.map(\.name), ["A", "C", "E", "B", "D"])
    }

    func testEarlierTripStartKeepsCalendarDatesAndBookingFields() throws {
        var doc = document([[spot("10월 3일 일정")], [spot("10월 4일 일정")]], start: "2026-10-03")
        doc.setField("bookings", .array([.object([
            "id": .string("hotel"), "type": .string("hotel"), "title": .string("숙소"),
            "start": .string("2026-10-03"), "end": .string("2026-10-05"), "price": .number(100),
            "externalField": .string("unchanged")])]))
        doc.setField("futureTripField", .string("keep"))

        let changed = try XCTUnwrap(PlanCalendarChange.draft(doc, start: "2026-10-01", count: 4))

        XCTAssertEqual(changed.start, "2026-10-01")
        XCTAssertEqual(changed.days.count, 4)
        XCTAssertTrue(changed.days[0].spots.isEmpty)
        XCTAssertTrue(changed.days[1].spots.isEmpty)
        XCTAssertEqual(changed.days[2].raw, doc.days[0].raw)
        XCTAssertEqual(changed.days[3].raw, doc.days[1].raw)
        XCTAssertEqual(changed.raw["bookings"], doc.raw["bookings"])
        XCTAssertEqual(changed.raw["futureTripField"], .string("keep"))
    }

    func testShorterPeriodCannotDropAPlaceOrAZeroBudget() {
        let populated = document([[], [spot("예약 장소")]])
        XCTAssertNil(PlanCalendarChange.draft(populated, start: populated.start, count: 1))

        var budgeted = document([[], []])
        var days = budgeted.days
        days[1].budget = CostEntry(raw: ["amount": .number(0)])
        budgeted.days = days
        XCTAssertNil(PlanCalendarChange.draft(budgeted, start: budgeted.start, count: 1))
        XCTAssertNil(PlanCalendarChange.draft(document([[spot("첫날")], []]), start: "2026-10-02", count: 1))
    }

    func testShorterPeriodDoesNotSilentlyDeleteOtherDaySettings() {
        let settings: [[String: JSONValue]] = [
            ["flight": .object(["code": .string("KE001")])],
            ["drive": .string("렌터카 픽업")],
            ["timeZone": .string("Asia/Tokyo")],
            ["mode": .string("train")],
            ["futureDayField": .object(["note": .string("keep")])]
        ]
        for setting in settings {
            var doc = document([[], []])
            var days = doc.days
            for (key, value) in setting { days[1].setField(key, value) }
            doc.days = days
            XCTAssertNil(PlanCalendarChange.draft(doc, start: doc.start, count: 1), "설정한 날짜를 지우면 안 된다: \(setting.keys)")
        }
    }

    func testAnEmptyTripCanGainDaysAndLaterTrimOnlyEmptyDays() throws {
        let original = document([[]], start: "")
        let expanded = try XCTUnwrap(PlanCalendarChange.draft(original, start: "2026-10-01", count: 3))
        XCTAssertEqual(expanded.days.count, 3)
        XCTAssertTrue(expanded.days.allSatisfy { $0.spots.isEmpty })
        let trimmed = try XCTUnwrap(PlanCalendarChange.draft(expanded, start: "2026-10-01", count: 1))
        XCTAssertEqual(trimmed.days.count, 1)
    }

    func testFirstCalendarDateMustBeARealDate() {
        let original = document([[]], start: "")
        XCTAssertNil(PlanCalendarChange.draft(original, start: "잘못된 날짜", count: 2))
        XCTAssertNil(PlanCalendarChange.draft(original, start: "2026-02-30", count: 2))
        XCTAssertNotNil(PlanCalendarChange.draft(original, start: "2028-02-29", count: 2))
    }

    func testReservationMinuteIsNotRoundedToFiveMinutes() throws {
        let entered = ClockText.text(hour: 12, minute: 7)
        XCTAssertEqual(entered, "12:07")
        XCTAssertEqual(ClockText.parts(entered).minute, 7)
        var reserved = spot("열차")
        reserved.bookedAt = entered
        let data = try JSONValue.data(from: document([[reserved]]).raw)
        let restored = try JSONDecoder().decode(JSONValue.self, from: data)
        XCTAssertEqual(TripDocument(raw: try XCTUnwrap(restored.objectValue)).days[0].spots[0].bookedAt, "12:07")
    }

    func testPreparedMoveSavesOneRevisionAndCanBeUndoneWithoutLosingRawData() async throws {
        var original = document([[spot("A"), spot("B")], [spot("X")]])
        original.setField("unknownRoot", .string("keep"))
        let service = FakeDocumentService(snapshot: .init(document: original, revision: 7, role: .owner))
        let model = TripPlanViewModel(tripId: "test-trip", service: service)
        await model.load()
        var draft = try XCTUnwrap(model.document)
        draft.moveSpots(fromDay: 0, indexes: IndexSet([0, 1]), toDay: 1, position: 0)

        let saved = await model.savePreparedDocument(draft, expectedRevision: 7, message: "이동")
        XCTAssertTrue(saved)
        XCTAssertEqual(service.saves.count, 1)
        XCTAssertEqual(service.saves[0].expectedRevision, 7)
        XCTAssertEqual(model.document?.days[1].spots.map(\.name), ["A", "B", "X"])
        XCTAssertTrue(model.canUndo)

        await model.undoLastChange()

        XCTAssertEqual(service.saves.count, 2)
        XCTAssertEqual(service.saves[1].expectedRevision, 8)
        XCTAssertEqual(model.document, original)
        XCTAssertFalse(model.canUndo)
    }

    func testStalePreviewAndViewerCannotSavePreparedChanges() async throws {
        let original = document([[spot("A")]])
        for role in [MemberRole.owner, .viewer] {
            let service = FakeDocumentService(snapshot: .init(document: original, revision: 7, role: role))
            let model = TripPlanViewModel(tripId: "test-trip", service: service)
            await model.load()
            var changed = original
            changed.name = "변경된 이름"
            let saved = await model.savePreparedDocument(changed, expectedRevision: role == .viewer ? 7 : 6, message: "변경")
            XCTAssertFalse(saved)
            XCTAssertTrue(service.saves.isEmpty)
            XCTAssertEqual(model.document, original)
        }
    }

    func testFailedUndoKeepsSavedChangeAndAllowsRetry() async throws {
        let original = document([[spot("A")]])
        let service = FakeDocumentService(snapshot: .init(document: original, revision: 7, role: .owner))
        let model = TripPlanViewModel(tripId: "test-trip", service: service)
        await model.load()
        var changed = original
        changed.name = "새 이름"
        let saved = await model.savePreparedDocument(changed, expectedRevision: 7, message: "변경")
        XCTAssertTrue(saved)
        service.failure = .offline

        await model.undoLastChange()

        XCTAssertEqual(model.document, changed)
        XCTAssertTrue(model.canUndo)
        XCTAssertNotNil(model.errorMessage)
        service.failure = nil
        await model.undoLastChange()
        XCTAssertEqual(model.document, original)
        XCTAssertFalse(model.canUndo)
    }
}

/// 여행 기간 상한 — 웹·서버와 같은 숫자여야 하고, 이미 더 긴 문서의 편집을 막아서는 안 된다.
@MainActor
final class TripPeriodLimitTests: XCTestCase {
    private func document(dayCount: Int, start: String = "2026-10-01") -> TripDocument {
        TripDocument(raw: ["name": .string("장기 여행"), "start": .string(start),
                           "days": .array((0..<dayCount).map { _ in .object(["spots": .array([])]) })])
    }

    func testPeriodCapIsNinetyEverywhereInTheApp() {
        // lib.js의 TC_LIMITS.days와 같은 숫자다. next의 tripLimitsParity가 둘을 대조한다.
        XCTAssertEqual(TripLimits.maxDays, 90)
        XCTAssertEqual(NewTripDraft.maxDays, TripLimits.maxDays,
                       "새 여행과 여행 설정이 서로 다른 상한을 쓰면 앱으로 만든 여행을 앱에서 못 늘린다")
    }

    func testNewTripAcceptsTheCapAndRejectsOneMore() {
        let at = NewTripDraft(name: "산티아고 순례", start: "2026-10-01", dayCount: TripLimits.maxDays, city: nil)
        let over = NewTripDraft(name: "산티아고 순례", start: "2026-10-01", dayCount: TripLimits.maxDays + 1, city: nil)
        XCTAssertTrue(at.isValid)
        XCTAssertFalse(over.isValid, "서버가 거부할 기간을 만들게 두면 저장에서야 실패한다")
    }

    func testPeriodChangeAcceptsTheCapAndRejectsOneMore() {
        let doc = document(dayCount: 3)
        XCTAssertNotNil(PlanCalendarChange.draft(doc, start: doc.start, count: TripLimits.maxDays))
        XCTAssertNil(PlanCalendarChange.draft(doc, start: doc.start, count: TripLimits.maxDays + 1))
    }

    /// 상한보다 긴 문서(레거시 경로로 들어온 것)를 열었을 때 — 기간을 건드리지 않는 편집은 저장돼야 한다.
    /// 이걸 막으면 화면에는 꺼진 저장 버튼만 남고 이유가 어디에도 없다(`datesChanged`가 거짓이라
    /// 이유를 말하는 '날짜 변경 미리보기' 섹션이 뜨지도 않는다).
    func testDocumentLongerThanTheCapCanStillBeEdited() throws {
        let long = document(dayCount: TripLimits.maxDays + 30)

        let sameLength = try XCTUnwrap(PlanCalendarChange.draft(long, start: long.start, count: long.days.count),
                                       "기간을 그대로 둔 편집까지 막으면 이름도 못 고친다")
        XCTAssertEqual(sameLength.days.count, long.days.count)

        XCTAssertNotNil(PlanCalendarChange.draft(long, start: long.start, count: TripLimits.maxDays),
                        "줄이는 것은 언제나 되어야 한다")
        XCTAssertNil(PlanCalendarChange.draft(long, start: long.start, count: long.days.count + 1),
                     "이미 상한을 넘은 문서라도 더 늘리지는 못한다")
    }
}
