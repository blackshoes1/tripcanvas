import XCTest
@testable import TripCanvas

/// feat/ux-structure-audit(2026-10-16) — F-3 · F-5 · F-6 · F-12의 iOS 쪽 확인.
/// 기준은 `.claude/agent-work/spec.md`의 AC와 "## 결정"이다.
@MainActor
final class UxStructureAuditTests: XCTestCase {
    private func note(_ id: String, cat: String = "VISA", title: String, body: String = "", extra: [String: JSONValue] = [:]) -> JSONValue {
        var raw: [String: JSONValue] = ["id": .string(id), "cat": .string(cat), "title": .string(title)]
        if !body.isEmpty { raw["body"] = .string(body) }
        for (key, value) in extra { raw[key] = value }
        return .object(raw)
    }

    private func loaded(notes: [JSONValue], role: MemberRole = .owner) async -> (TripPlanViewModel, FakeDocumentService) {
        var doc = TripDocument(raw: ["days": .array([.object(["spots": .array([])])]), "webOnly": .string("보존")])
        doc.setField("notes", .array(notes))
        let source = FakeDocumentService(snapshot: .init(document: doc, revision: 4, role: role))
        let model = TripPlanViewModel(tripId: "t1", service: source, loadsPlans: false)
        await model.load()
        return (model, source)
    }

    // MARK: AC-7 메모 고치기

    func testUpdateNoteChangesCategoryTitleBodyAndKeepsEverythingElse() async throws {
        let (model, source) = await loaded(notes: [
            note("n1", title: "ESTA", body: "옛 본문", extra: ["done": .bool(true), "webOnly": .string("유지")]),
            note("n2", cat: "MONEY", title: "환전")
        ])
        let ok = await model.updateNote(id: "n1", title: "  ESTA 신청  ", body: "출발 72시간 전", category: "ENTRY")
        XCTAssertTrue(ok)
        XCTAssertEqual(source.saves.count, 1, "PUT 한 번")
        XCTAssertEqual(source.saves.first?.expectedRevision, 4, "revision CAS")
        let notes = try XCTUnwrap(model.document?.raw["notes"]?.arrayValue)
        XCTAssertEqual(notes.count, 2)
        let edited = try XCTUnwrap(notes[0].objectValue)
        XCTAssertEqual(edited["cat"], .string("ENTRY"))
        XCTAssertEqual(edited["title"], .string("ESTA 신청"), "앞뒤 공백은 다듬는다")
        XCTAssertEqual(edited["body"], .string("출발 72시간 전"))
        XCTAssertEqual(edited["done"], .bool(true), "확인 표시는 건드리지 않는다")
        XCTAssertEqual(edited["webOnly"], .string("유지"), "모르는 키가 앱 저장 한 번에 사라지지 않는다")
        XCTAssertNotNil(edited["updatedAt"]?.stringValue, "웹과 같은 ISO 문자열")
        XCTAssertNotNil(ISO8601DateFormatter().date(from: (edited["updatedAt"]?.stringValue ?? "").replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression)),
                        "ISO 8601 문자열이다")
        XCTAssertEqual(notes[1].objectValue?["title"], .string("환전"), "다른 메모는 그대로")
        XCTAssertEqual(model.document?.raw["webOnly"], .string("보존"))
        // 웹이 읽는 규칙(normalizeTripNote와 같은 거름)으로도 같은 내용이다
        let read = TripNote.notes(in: model.document)
        XCTAssertEqual(read.first?.category, "ENTRY")
        XCTAssertEqual(read.first?.title, "ESTA 신청")
        XCTAssertEqual(read.first?.body, "출발 72시간 전")
    }

    /// 실패 케이스 — 제목·본문이 모두 비면 저장하지 않는다(서버가 조용히 버리므로).
    func testUpdateNoteRejectsEmptyTitleAndBodyWithoutSaving() async {
        let (model, source) = await loaded(notes: [note("n1", title: "ESTA", body: "본문")])
        let ok = await model.updateNote(id: "n1", title: "   ", body: "\n ", category: "VISA")
        XCTAssertFalse(ok)
        XCTAssertTrue(source.saves.isEmpty, "요청이 나가지 않는다")
        XCTAssertEqual(TripNote.notes(in: model.document).first?.title, "ESTA", "원래 메모가 그대로")
        let tooLong = await model.updateNote(id: "n1", title: String(repeating: "가", count: 121), body: "", category: "VISA")
        XCTAssertFalse(tooLong, "제목은 120자까지")
        let badCategory = await model.updateNote(id: "n1", title: "ok", body: "", category: "NOPE")
        XCTAssertFalse(badCategory, "모르는 분류는 막는다")
        XCTAssertTrue(source.saves.isEmpty)
    }

    /// 실패 케이스 — 편집 중 원격에서 지워진 메모는 다른 메모를 덮지 않고 이유를 말한다.
    func testUpdateNoteForAMissingIdDoesNotTouchAnotherNote() async {
        let (model, source) = await loaded(notes: [note("n2", title: "환전")])
        let ok = await model.updateNote(id: "gone", title: "새 제목", body: "", category: "MONEY")
        XCTAssertFalse(ok)
        XCTAssertTrue(source.saves.isEmpty)
        XCTAssertEqual(TripNote.notes(in: model.document).map(\.title), ["환전"])
        XCTAssertNotNil(model.errorMessage, "이유를 말한다")
    }

    /// 실패 케이스 — 편집기를 연 뒤 revision이 바뀌었으면(남의 변경) 덮어쓰지 않는다.
    func testUpdateNoteWithStaleRevisionDoesNotSave() async {
        let (model, source) = await loaded(notes: [note("n1", title: "ESTA")])
        let ok = await model.updateNote(id: "n1", title: "바뀐 제목", body: "", category: "VISA", expectedRevision: 3)
        XCTAssertFalse(ok)
        XCTAssertTrue(source.saves.isEmpty)
        XCTAssertEqual(TripNote.notes(in: model.document).first?.title, "ESTA")
    }

    /// 실패 케이스 — 보기 권한에서는 고칠 수 없다.
    func testViewerCannotUpdateOrRemoveNotes() async {
        let (model, source) = await loaded(notes: [note("n1", title: "ESTA")], role: .viewer)
        XCTAssertFalse(model.canEdit, "화면의 고치기·지우기는 canEdit일 때만 보인다")
        let updated = await model.updateNote(id: "n1", title: "바뀜", body: "", category: "VISA")
        let removed = await model.removeNote(id: "n1")
        XCTAssertFalse(updated)
        XCTAssertFalse(removed)
        XCTAssertTrue(source.saves.isEmpty)
        XCTAssertEqual(TripNote.notes(in: model.document).map(\.title), ["ESTA"])
    }

    /// 실패 케이스 — 저장이 실패(오프라인)하면 화면을 서버가 아는 상태로 되돌린다.
    func testUpdateNoteRollsBackWhenSaveFails() async {
        let (model, source) = await loaded(notes: [note("n1", title: "ESTA")])
        source.failure = .offline
        let ok = await model.updateNote(id: "n1", title: "바뀐 제목", body: "", category: "VISA")
        XCTAssertFalse(ok)
        XCTAssertEqual(TripNote.notes(in: model.document).first?.title, "ESTA")
    }

    // MARK: AC-8 메모 지우기

    func testRemoveNoteDropsOnlyThatIdAndOffersUndo() async throws {
        let (model, source) = await loaded(notes: [
            note("n1", title: "ESTA", extra: ["webOnly": .string("유지")]),
            note("n2", cat: "MONEY", title: "환전", extra: ["done": .bool(true)]),
            note("n3", cat: "ETC", title: "기타")
        ])
        let ok = await model.removeNote(id: "n2")
        XCTAssertTrue(ok)
        XCTAssertEqual(source.saves.count, 1)
        XCTAssertEqual(TripNote.notes(in: model.document).map(\.id), ["n1", "n3"], "그 id만 빠지고 순서는 그대로")
        XCTAssertEqual(model.document?.raw["notes"]?.arrayValue?.first?.objectValue?["webOnly"], .string("유지"))
        XCTAssertEqual(model.toast, "메모를 지웠어요")
        XCTAssertTrue(model.canUndo, "직후 되돌리기가 제공된다")
        await model.undoLastChange()
        XCTAssertEqual(TripNote.notes(in: model.document).map(\.id), ["n1", "n2", "n3"], "되돌리면 같은 자리로 돌아온다")
        XCTAssertTrue(TripNote.notes(in: model.document)[1].done)
    }

    func testRemovingTheLastNoteDropsTheField() async {
        let (model, _) = await loaded(notes: [note("n1", title: "ESTA")])
        let ok = await model.removeNote(id: "n1")
        XCTAssertTrue(ok)
        XCTAssertNil(model.document?.raw["notes"], "빈 배열을 남기지 않는다(웹 normalizeTrip과 같다)")
    }

    /// 실패 케이스 — 이미 없는 메모는 저장하지 않는다.
    func testRemoveNoteWithUnknownIdDoesNothing() async {
        let (model, source) = await loaded(notes: [note("n1", title: "ESTA")])
        let ok = await model.removeNote(id: "ghost")
        XCTAssertFalse(ok)
        XCTAssertTrue(source.saves.isEmpty)
    }

    /// 실패 케이스 — 지우기 저장이 오프라인으로 실패하면 메모가 목록에 남는다.
    func testRemoveNoteRollsBackWhenOffline() async {
        let (model, source) = await loaded(notes: [note("n1", title: "ESTA")])
        source.failure = .offline
        let ok = await model.removeNote(id: "n1")
        XCTAssertFalse(ok)
        XCTAssertEqual(TripNote.notes(in: model.document).map(\.id), ["n1"])
    }

    // MARK: AC-5 '미구분'은 화면에 나오지 않는다

    func testUnsetPayStateIsCalledByItsOfficialName() {
        XCTAssertEqual(CostPayState.none.label, "고르지 않음")
        XCTAssertFalse(CostPayState.none.label.contains("미구분"))
    }

    // MARK: AC-9 참고 정보 조회 버튼은 연결되기 전까지 없다

    func testAdmissionLookupButtonIsHiddenWhileServerIsNotConnected() {
        XCTAssertFalse(PlaceAdmissionLookup.isConnected,
                       "서버가 NOT_CONNECTED만 돌려주는 동안 장소 편집기·지도 장소 정보에 조회 버튼이 없다(요청도 나가지 않는다)")
    }

    // MARK: AC-17 조사

    func testToastsUseTheRightParticle() {
        XCTAssertEqual(CollabModel.withJosa("경복궁", "을", "를"), "경복궁을")
        XCTAssertEqual(CollabModel.withJosa("남산타워", "을", "를"), "남산타워를")
        XCTAssertEqual(CollabModel.withJosa("서울", "으로", "로"), "서울로", "ㄹ 받침은 '으로'가 아니라 '로'")
        XCTAssertEqual(CollabModel.withJosa("", "은", "는"), "는", "빈 값은 받침 없는 쪽 — 괄호 꼴이 나오지 않는다")
        for word in ["경복궁", "남산타워", "Camp Nou", "", "민수, 철수"] {
            XCTAssertFalse(CollabModel.withJosa(word, "을", "를").contains("("))
        }
    }

    /// 숫자로 끝나는 말은 읽는 소리의 받침을 따른다 — Day 3·6·10은 '으로', 일·칠·팔(1·7·8)은 ㄹ 받침이라 '로', 이·사·오·구는 받침 없음.
    func testNumberEndingsFollowTheSpokenFinalConsonant() {
        let expected = [0: "으로", 1: "로", 2: "로", 3: "으로", 4: "로", 5: "로", 6: "으로", 7: "로", 8: "로", 9: "로"]
        for (d, p) in expected {
            XCTAssertEqual(CollabModel.josa("Day \(d)", "으로", "로"), p, "Day \(d)")
        }
        XCTAssertEqual(CollabModel.withJosa("Day 10", "으로", "로"), "Day 10으로")
        XCTAssertEqual(CollabModel.withJosa("Hotel 3", "을", "를"), "Hotel 3을")
        XCTAssertEqual(CollabModel.withJosa("Hotel 2", "을", "를"), "Hotel 2를")
    }

    /// 장소를 다른 날로 옮긴 토스트의 조사 — Day 3은 '으로', Day 2는 '로'(받침에 맞춘 조사, spec AC-17).
    func testMoveSpotToastUsesTheRightParticle() async {
        func doc() -> TripDocument {
            TripDocument(raw: [
                "name": .string("조사"),
                "days": .array([
                    .object(["title": .string("1일차"), "spots": .array([.object(["name": .string("A")]), .object(["name": .string("B")])])]),
                    .object(["title": .string("2일차"), "spots": .array([])]),
                    .object(["title": .string("3일차"), "spots": .array([])]),
                ]),
            ])
        }
        let service = FakeDocumentService(snapshot: .init(document: doc(), revision: 1, role: .owner))
        let model = TripPlanViewModel(tripId: "t", service: service)
        await model.load()
        let toDay3 = await model.moveSpot(at: 0, toDay: 2, dayIndex: 0)
        XCTAssertTrue(toDay3)
        XCTAssertEqual(model.toast, "Day 3으로 옮겼어요")
        let toDay2 = await model.moveSpot(at: 0, toDay: 1, dayIndex: 0)
        XCTAssertTrue(toDay2)
        XCTAssertEqual(model.toast, "Day 2로 옮겼어요")
    }
}
