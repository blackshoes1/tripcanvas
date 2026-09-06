import XCTest
@testable import TripCanvas

/// 편집 화면의 저장 규칙. 여기서 지키는 것은 셋이다 —
/// **바꾸면 곧바로 저장한다**, **실패하면 화면을 되돌린다**, **충돌은 조용히 덮어쓰지 않는다.**
@MainActor
final class TripPlanViewModelTests: XCTestCase {
    private func document(days: Int = 2) -> TripDocument {
        var spots: [JSONValue] = [.object(["name": .string("도톤보리"), "city": .string("오사카")])]
        if days == 0 { spots = [] }
        return TripDocument(raw: [
            "name": .string("오사카"),
            "days": .array((0..<max(days, 1)).map { index in
                .object(["title": .string("Day \(index + 1)"), "mode": .string("car"),
                         "spots": .array(index == 0 ? spots : [])])
            })
        ])
    }

    func testLoadsDocumentAndRole() async {
        let service = FakeDocumentService(snapshot: .init(document: document(), revision: 7, role: .viewer))
        let model = TripPlanViewModel(tripId: "t1", service: service)
        await model.load()

        XCTAssertEqual(model.revision, 7)
        XCTAssertEqual(model.dayCount, 2)
        XCTAssertFalse(model.canEdit)
        XCTAssertEqual(model.day?.spots.first?.name, "도톤보리")
    }

    func testAddSavesImmediatelyWithTheReadRevision() async {
        let service = FakeDocumentService(snapshot: .init(document: document(), revision: 7, role: .owner))
        let model = TripPlanViewModel(tripId: "t1", service: service)
        await model.load()
        await model.addSpot(TripSpot(name: "우메다"))

        XCTAssertEqual(service.saves.count, 1)
        XCTAssertEqual(service.saves.first?.expectedRevision, 7)
        XCTAssertEqual(service.saves.first?.document.days[0].spots.map(\.name), ["도톤보리", "우메다"])
        XCTAssertEqual(model.revision, 8)          // 서버가 돌려준 revision으로 갈아탄다
        XCTAssertNil(model.errorMessage)
    }

    /// 보기 권한은 의견만 낸다 — 여행 내용을 만들지 않는다. 요청 자체가 나가지 않아야 한다.
    func testViewerCannotEdit() async {
        let service = FakeDocumentService(snapshot: .init(document: document(), revision: 3, role: .viewer))
        let model = TripPlanViewModel(tripId: "t1", service: service)
        await model.load()
        await model.addSpot(TripSpot(name: "우메다"))

        XCTAssertTrue(service.saves.isEmpty)
        XCTAssertEqual(model.day?.spots.count, 1)
    }

    func testFailedSaveRollsBackTheScreen() async {
        let service = FakeDocumentService(snapshot: .init(document: document(), revision: 4, role: .owner))
        let model = TripPlanViewModel(tripId: "t1", service: service)
        await model.load()
        service.failure = .offline                    // 불러온 뒤에 끊긴다
        await model.addSpot(TripSpot(name: "우메다"))

        // 저장되지 않은 것이 저장된 것처럼 남으면 다음 편집이 그 위에 쌓인다.
        XCTAssertEqual(model.day?.spots.map(\.name), ["도톤보리"])
        XCTAssertNotNil(model.errorMessage)
        XCTAssertNil(model.conflict)
    }

    func testConflictAsksInsteadOfOverwriting() async {
        let service = FakeDocumentService(snapshot: .init(document: document(), revision: 4, role: .owner))
        let model = TripPlanViewModel(tripId: "t1", service: service)
        await model.load()
        service.failure = .revisionConflict(message: "다른 기기에서 먼저 바뀌었습니다.", revision: 9)
        await model.removeSpot(at: 0)

        XCTAssertNotNil(model.conflict)
        XCTAssertNil(model.errorMessage)              // 충돌은 오류 배너가 아니라 질문이다
        XCTAssertEqual(model.day?.spots.count, 1)     // 되돌려 놓는다
        XCTAssertEqual(service.saves.count, 1)        // 강제로 다시 밀지 않는다

        service.failure = nil
        await model.reloadFromServer()
        XCTAssertNil(model.conflict)
    }

    func testMoveToAnotherDayFollowsTheDocumentRules() async {
        let service = FakeDocumentService(snapshot: .init(document: document(), revision: 1, role: .owner))
        let model = TripPlanViewModel(tripId: "t1", service: service)
        await model.load()
        await model.moveSpot(at: 0, toDay: 1)

        XCTAssertEqual(model.document?.days[0].spots.count, 0)
        XCTAssertEqual(model.document?.days[1].spots.map(\.name), ["도톤보리"])
    }

    /// 바뀐 게 없으면 저장하지 않는다 — 같은 값을 다시 눌렀다고 revision을 올리지 않는다.
    func testNoChangeMeansNoSave() async {
        let service = FakeDocumentService(snapshot: .init(document: document(), revision: 1, role: .owner))
        let model = TripPlanViewModel(tripId: "t1", service: service)
        await model.load()
        await model.setDayMode(.car)        // 이미 car
        await model.addSpot(TripSpot(name: "   "))

        XCTAssertTrue(service.saves.isEmpty)
    }

    // MARK: 예약 — 장소와 같은 길

    func testBookingSavesThroughTheSameDocumentPath() async {
        let service = FakeDocumentService(snapshot: .init(document: document(), revision: 5, role: .editor))
        let model = TripPlanViewModel(tripId: "t1", service: service)
        await model.load()

        var booking = TripBooking(type: .hotel, id: "bkNew")
        booking.title = "호텔"
        booking.price = 300
        booking.track = false
        let saved = await model.saveBooking(booking, links: BookingLinks(stay: SpotRef(day: 0, index: 0)))

        XCTAssertTrue(saved)
        XCTAssertEqual(service.saves.count, 1)
        XCTAssertEqual(service.saves.first?.expectedRevision, 5)
        XCTAssertEqual(model.bookings.map(\.id), ["bkNew"])
        XCTAssertEqual(model.document?.days[0].spots[0].bookingId, "bkNew")
        XCTAssertEqual(model.revision, 6)
        XCTAssertEqual(model.toast, "예약을 추가했어요")

        await model.removeBooking(id: "bkNew")
        XCTAssertTrue(model.bookings.isEmpty)
        XCTAssertNil(model.document?.days[0].spots[0].bookingId)
        XCTAssertEqual(service.saves.count, 2)
    }

    /// 검증에 걸리면 요청이 나가지 않고 이유를 말한다 — 웹 toast와 같은 문장.
    func testInvalidBookingIsNotSaved() async {
        let service = FakeDocumentService(snapshot: .init(document: document(), revision: 5, role: .owner))
        let model = TripPlanViewModel(tripId: "t1", service: service)
        await model.load()

        var booking = TripBooking(type: .hotel, id: "bkNew")
        booking.title = "호텔"
        booking.price = 300          // 추적 on인데 기간이 없다
        let saved = await model.saveBooking(booking)

        XCTAssertFalse(saved)
        XCTAssertTrue(service.saves.isEmpty)
        XCTAssertEqual(model.errorMessage, BookingDraftError.trackNeedsDates.message)
    }

    func testViewerCannotSaveBookings() async {
        let service = FakeDocumentService(snapshot: .init(document: document(), revision: 5, role: .viewer))
        let model = TripPlanViewModel(tripId: "t1", service: service)
        await model.load()

        var booking = TripBooking(type: .flight, id: "bkNew")
        booking.title = "KE001"
        booking.price = 1
        await model.saveBooking(booking)
        XCTAssertTrue(service.saves.isEmpty)
        XCTAssertTrue(model.bookings.isEmpty)
    }

    func testCostTextAcceptsOnlyNumbers() {
        XCTAssertEqual(SpotEditorView.cost(from: "12,000원"), 12000)
        XCTAssertEqual(SpotEditorView.cost(from: ""), nil)
        XCTAssertEqual(SpotEditorView.cost(from: "무료"), nil)
        XCTAssertEqual(SpotEditorView.cost(from: "0"), nil)
    }

    // ── 일자 스트립 ──────────────────────────────────────────────────────────
    //
    // 스트립은 "며칠째"만이 아니라 **언제, 어떤 날**인지 말해야 한다. 날짜는 서버가 준 것을 쓴다.

    private func plan(days: Int = 2, todayIndex: Int = -1, selected: Int = 0) -> DayPlanResponse {
        let strip = (0..<days).map { i in
            DayPlanStripEntry(index: i, date: "2026-10-0\(i + 1)", title: "Day \(i + 1)", spotCount: i == 0 ? 1 : 0)
        }
        let summary = TripSummary(id: "t1", name: "오사카", start: "2026-10-01", dayCount: days, revision: 7,
                                  updatedAt: "", timeZone: "Asia/Seoul", cities: [],
                                  todayIndex: todayIndex, role: nil, memberCount: nil)
        let day = DayPlanDay(index: selected, date: strip[selected].date, title: "", note: "", mode: "car",
                             startMinutes: 540, timeZone: "Asia/Seoul", carriedStay: nil, spots: [],
                             carPickups: [], carReturns: [], back: nil, spotsWithoutLocation: 0,
                             totals: .init(distanceKm: 0, travelMinutes: 0, endMinutes: nil, overloaded: false,
                                           cost: .init(total: 0, parts: [])))
        return DayPlanResponse(schemaVersion: 1, generatedAt: "", travelTimeSource: .straightLineEstimate,
                               trip: summary, dayCount: days, days: strip, day: day)
    }

    func testStripUsesTheServerDates() async {
        let service = FakeDocumentService(snapshot: .init(document: document(), revision: 7, role: .owner))
        service.dayPlanResponse = plan()
        let model = TripPlanViewModel(tripId: "t1", service: service)
        await model.load()

        XCTAssertEqual(model.strip.map(\.date), ["2026-10-01", "2026-10-02"])
    }

    /// 계산을 못 받아도 일정 편집은 그대로 된다 — 스트립만 날짜 없이 나온다.
    func testStripFallsBackWithoutDatesWhenThePlanIsMissing() async {
        let service = FakeDocumentService(snapshot: .init(document: document(), revision: 7, role: .owner))
        service.dayPlanResponse = nil                      // 서버 계산 실패
        let model = TripPlanViewModel(tripId: "t1", service: service)
        await model.load()

        XCTAssertNil(model.plan)
        XCTAssertNil(model.errorMessage, "계산이 없다고 편집 화면에 오류를 띄우지 않는다")
        XCTAssertEqual(model.strip.count, 2)
        // ⚠️ 날짜를 앱에서 지어내지 않는다 — start + index를 더하면 규칙이 두 곳이 된다
        XCTAssertEqual(model.strip.map(\.date), ["", ""])
        XCTAssertEqual(model.dayCount, 2, "편집은 문서만으로 그대로 돈다")
    }

    /// 14일짜리 일정에서 1일차부터 스크롤하게 두지 않는다.
    func testJumpsToTodayOnceWhenTheTripIsRunning() async {
        let service = FakeDocumentService(snapshot: .init(document: document(days: 5), revision: 7, role: .owner))
        service.dayPlanResponse = plan(days: 5, todayIndex: 2)
        let model = TripPlanViewModel(tripId: "t1", service: service)
        await model.load()

        XCTAssertEqual(model.todayIndex, 2)
        XCTAssertEqual(model.selectedDay, 2)

        // 사용자가 고른 날을 나중에 되돌리면 안 된다
        model.selectedDay = 0
        await model.load()
        XCTAssertEqual(model.selectedDay, 0, "오늘로 옮기는 것은 한 번뿐이다")
    }

    /// 여행 기간 밖이면 오늘이 없다 — 서버가 -1로 준다.
    func testNoTodayOutsideTheTrip() async {
        let service = FakeDocumentService(snapshot: .init(document: document(days: 3), revision: 7, role: .owner))
        service.dayPlanResponse = plan(days: 3, todayIndex: -1)
        let model = TripPlanViewModel(tripId: "t1", service: service)
        await model.load()

        XCTAssertNil(model.todayIndex)
        XCTAssertEqual(model.selectedDay, 0)
    }

    func testClockTextRoundTrip() {
        XCTAssertEqual(ClockText.parts("18:35").hour, 18)
        XCTAssertEqual(ClockText.parts("18:35").minute, 35)
        XCTAssertEqual(ClockText.parts(nil).hour, 9)        // 켤 때의 기본
        XCTAssertEqual(ClockText.parts("엉망").minute, 0)
        XCTAssertEqual(ClockText.text(hour: 9, minute: 5), "09:05")
        XCTAssertEqual(ClockText.text(hour: 99, minute: 99), "23:59")
    }
}

@MainActor
private final class FakeDocumentService: TripDocumentSource {
    var snapshot: TripDocumentSnapshot
    var failure: APIError?
    private(set) var saves: [(document: TripDocument, expectedRevision: Int)] = []

    init(snapshot: TripDocumentSnapshot) { self.snapshot = snapshot }

    func document(tripId: String) async throws -> TripDocumentSnapshot {
        if let failure { throw failure }
        return snapshot
    }

    func saveDocument(tripId: String, document: TripDocument, expectedRevision: Int) async throws -> TripDocumentSnapshot {
        saves.append((document, expectedRevision))
        if let failure { throw failure }
        snapshot = TripDocumentSnapshot(document: document, revision: expectedRevision + 1, role: snapshot.role)
        return snapshot
    }

    /// 서버 계산. nil이면 "못 받았다"는 뜻이고, 그래도 편집은 그대로 돌아야 한다.
    var dayPlanResponse: DayPlanResponse?
    var dayPlanCalls: [Int] = []
    func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse> {
        dayPlanCalls.append(dayIndex)
        guard let dayPlanResponse else { throw APIError.notFound("일자 계획 없음") }
        return TripService.Fetched(value: dayPlanResponse, cachedAt: nil)
    }
}
