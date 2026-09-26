import XCTest
@testable import TripCanvas

/// 장소 추가 흐름(2026-09-27 시안)과 같은 검토에서 나온 저장 실패 규칙.
@MainActor
final class AddSpotFlowTests: XCTestCase {
    private func document() -> TripDocument {
        TripDocument(raw: [
            "name": .string("가루이자와"),
            "days": .array([
                .object(["title": .string("1일차"), "mode": .string("car"),
                         "spots": .array([.object(["name": .string("인천국제공항"), "city": .string("인천")])])]),
                .object(["title": .string("2일차"), "mode": .string("car"), "spots": .array([])]),
            ]),
        ])
    }

    private let station = PlaceHit(id: "k1", name: "가루이자와 역", city: "가루이자와", address: "일본 〒389-0102 Nagano",
                                   point: GeoPoint(lat: 36.342, lng: 138.635), category: .sight, placeId: nil,
                                   provider: "kakao", providerId: "12345")

    // MARK: ⑥ 위치 고르기

    /// 위치는 붙이되 **사용자가 쓴 이름은 덮지 않는다.**
    func testPickedPlaceDoesNotOverwriteTypedName() {
        var spot = TripSpot(name: "역 앞 빵집")
        spot = LocationChoice.place(station).applied(to: spot)
        XCTAssertEqual(spot.name, "역 앞 빵집")
        XCTAssertEqual(spot.point, station.point)
        XCTAssertEqual(spot.city, "가루이자와")
        XCTAssertEqual(spot.kakaoId, "12345")
        XCTAssertEqual(spot.raw["addr"]?.stringValue, station.address)
    }

    func testPickedPlaceFillsAnEmptyName() {
        let spot = LocationChoice.place(station).applied(to: TripSpot(name: "  "))
        XCTAssertEqual(spot.name, "가루이자와 역")
    }

    /// 지도 탭은 좌표만 — 이름을 지어내지 않고, 앞서 고른 주소·식별자를 남기지 않는다.
    func testMapTapKeepsOnlyTheCoordinate() {
        var spot = LocationChoice.place(station).applied(to: TripSpot(name: ""))
        spot = LocationChoice.point(MapPick(point: GeoPoint(lat: 36.3, lng: 138.6), name: nil, placeId: nil)).applied(to: spot)
        XCTAssertEqual(spot.name, "가루이자와 역", "있는 이름은 그대로")
        XCTAssertEqual(spot.point, GeoPoint(lat: 36.3, lng: 138.6))
        XCTAssertNil(spot.raw["addr"]?.stringValue)
        XCTAssertNil(spot.kakaoId)
    }

    // MARK: 머무는 시간

    /// 웹·붙여넣기로 정한 값이 목록에 없어도 **그 값 그대로** 고를 수 있어야 한다 — 빈칸이 되면 안 된다.
    func testStayOptionsKeepAValueFromElsewhere() {
        XCTAssertTrue(StayMinutesPicker.options(including: 150).contains(150))
        XCTAssertTrue(StayMinutesPicker.options(including: 75).contains(75))
        XCTAssertEqual(StayMinutesPicker.options(including: 75), StayMinutesPicker.options(including: 75).sorted())
        XCTAssertTrue(StayMinutesPicker.presets.contains(where: { $0 > 240 }), "4시간을 넘는 체류도 고를 수 있다")
        XCTAssertEqual(StayMinutesPicker.options(including: nil), StayMinutesPicker.presets)
    }

    // MARK: ④ 상세에서 바로 담기

    func testAddingFromDetailGoesToTheDayItWasOpenedFor() async {
        let service = FakeDocumentService(snapshot: .init(document: document(), revision: 3, role: .owner))
        let model = TripPlanViewModel(tripId: "t", service: service)
        await model.load()
        model.selectedDay = 0
        let saved = await model.addSpot(station.makeSpot(), dayIndex: 1, expectedRevision: 3, toast: "‘가루이자와 역’을(를) 2일차에 추가했어요")
        XCTAssertTrue(saved)
        XCTAssertEqual(model.document?.days[1].spots.map(\.name), ["가루이자와 역"])
        XCTAssertEqual(model.toast, "‘가루이자와 역’을(를) 2일차에 추가했어요")
        XCTAssertTrue(model.canUndo, "방금 담은 것은 토스트의 '되돌리기'로 되돌릴 수 있다")
    }

    // MARK: 저장 실패 ≠ 불러오기 실패

    /// 불러오기 실패는 '저장하지 못했어요'가 아니다.
    func testLoadFailureIsNotASaveFailure() async {
        let service = FakeDocumentService(snapshot: .init(document: document(), revision: 3, role: .owner))
        let model = TripPlanViewModel(tripId: "t", service: service)
        await model.load()
        service.failure = .offline
        await model.load()
        XCTAssertNotNil(model.loadErrorMessage)
        XCTAssertNil(model.saveErrorMessage)
        XCTAssertFalse(model.canRetrySave)
    }

    /// 저장 실패의 '다시 저장'은 새로고침이 아니라 **같은 변경을 다시 저장한다.**
    func testRetryAfterSaveFailureSavesTheSameChange() async {
        let service = FakeDocumentService(snapshot: .init(document: document(), revision: 3, role: .owner))
        let model = TripPlanViewModel(tripId: "t", service: service)
        await model.load()
        service.failure = .offline
        await model.addSpot(TripSpot(name: "구 가루이자와 거리"), dayIndex: 1)
        XCTAssertNotNil(model.saveErrorMessage)
        XCTAssertEqual(model.document?.days[1].spots.count, 0, "화면은 이전 일정으로 돌아와 있다")
        XCTAssertTrue(model.canRetrySave)

        service.failure = nil
        model.selectedDay = 0                       // 그 사이 다른 날을 봐도
        await model.retryFailedSave()
        XCTAssertEqual(model.document?.days[1].spots.map(\.name), ["구 가루이자와 거리"], "실패했던 그 날에 들어간다")
        XCTAssertNil(model.saveErrorMessage)
        XCTAssertFalse(model.canRetrySave)
    }

    /// 실패한 뒤 문서가 바뀌었으면 다시 밀지 않는다 — 같은 위치가 다른 장소를 가리킬 수 있다.
    func testNoRetryOnceTheDocumentMovedOn() async {
        let service = FakeDocumentService(snapshot: .init(document: document(), revision: 3, role: .owner))
        let model = TripPlanViewModel(tripId: "t", service: service)
        await model.load()
        service.failure = .offline
        await model.removeSpot(at: 0, dayIndex: 0)
        XCTAssertTrue(model.canRetrySave)
        service.failure = nil
        service.snapshot = TripDocumentSnapshot(document: document(), revision: 5, role: .owner)
        await model.load()
        XCTAssertFalse(model.canRetrySave)
    }

    /// 충돌은 재시도 대상이 아니다 — 남의 변경을 덮는다(§91).
    func testConflictIsNeverRetried() async {
        let service = FakeDocumentService(snapshot: .init(document: document(), revision: 3, role: .owner))
        let model = TripPlanViewModel(tripId: "t", service: service)
        await model.load()
        service.failure = .revisionConflict(message: "먼저 바뀌었어요", revision: 9)
        await model.removeSpot(at: 0, dayIndex: 0)
        XCTAssertNotNil(model.conflict)
        XCTAssertFalse(model.canRetrySave)
    }
}
