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

    func testCostTextAcceptsOnlyNumbers() {
        XCTAssertEqual(SpotEditorView.cost(from: "12,000원"), 12000)
        XCTAssertEqual(SpotEditorView.cost(from: ""), nil)
        XCTAssertEqual(SpotEditorView.cost(from: "무료"), nil)
        XCTAssertEqual(SpotEditorView.cost(from: "0"), nil)
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
}
