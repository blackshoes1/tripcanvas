import XCTest
@testable import TripCanvas

/// 붙여넣기로 만드는 여행.
///
/// 여기서 지키는 것: **담기로 한 것만 장소가 되고, 담지 않은 줄은 버리지 않는다.**
/// 파서 규칙 자체는 서버(`intake.js` · `itineraryRoutes.test.ts`)가 본다 — 앱은 복제하지 않는다.
@MainActor
final class PasteItineraryTests: XCTestCase {

    private func item(_ name: String, kind: ItineraryItemKind, at: String? = nil,
                      raw: String? = nil, stayMinutes: Int? = nil) -> ItineraryDraftItem {
        ItineraryDraftItem(raw: raw ?? name, name: name, city: "", desc: "", at: at, endAt: nil,
                           stayMinutes: stayMinutes, url: nil, cost: nil, currency: nil,
                           optional: false, stay: false, location: nil, kind: kind,
                           reasons: kind == .place ? [] : ["장소가 아니라 행동으로 보여요"])
    }

    private func draft() -> ItineraryDraft {
        ItineraryDraft(name: "가루이자와", start: "2026-07-21", startAmbiguous: true, days: [
            ItineraryDraftDay(index: 0, title: "도착", date: "2026-07-21", note: "메모 한 줄", items: [
                item("이동", kind: .move, raw: "오전~오후｜이동"),
                item("규카루이자와 긴자 거리", kind: .place, at: "14:00", stayMinutes: 90)
            ]),
            ItineraryDraftDay(index: 1, title: "온천", date: "2026-07-22", note: "", items: [
                item("아침 식사", kind: .activity, at: "08:00", raw: "08:00~09:00｜아침 식사"),
                item("톰보노유 온천", kind: .place, at: "15:00")
            ])
        ])
    }

    /// 화면을 띄우지 않고 문서만 본다 — 여기서 확인할 것은 "무엇이 문서에 들어가는가"다.
    private func madeDocument(includeOverrides: [String: Bool] = [:]) -> [String: JSONValue] {
        let source = draft()
        let lines: [ItineraryDocument.Line] = source.days.flatMap { day in
            day.items.map { item in
                ItineraryDocument.Line(
                    dayIndex: day.index, item: item,
                    include: includeOverrides[item.name] ?? (item.kind == .place), found: nil)
            }
        }
        return ItineraryDocument.make(draft: source, lines: lines, name: "가루이자와 여행", start: "2026-07-21")
    }

    /// 글의 날짜가 건너뛰면(7/21 → 7/23) 빈 날을 넣기로 한 경우 서버가 정한 자리에 놓고 사이는 빈 일자다.
    /// 넣지 않기로 하면 예전처럼 순서대로 잇는다 — 사람이 고른다(웹 미리보기와 같은 선택).
    func testSkippedDateLeavesAnEmptyDayOnlyWhenChosen() {
        let base = draft()
        let gapped = ItineraryDraft(name: base.name, start: base.start, startAmbiguous: false, days: base.days,
                                    dayLayout: ItineraryDayLayout(at: [0, 2], gaps: [ItineraryDayGap(before: 1, from: "2026-07-22", count: 1)]))
        let lines = gapped.days.flatMap { day in
            day.items.map { ItineraryDocument.Line(dayIndex: day.index, item: $0, include: $0.kind == .place, found: nil) }
        }
        let filled = ItineraryDocument.make(draft: gapped, lines: lines, name: "여행", start: "2026-07-21", fillGaps: true)
        let filledDays = filled["days"]?.arrayValue ?? []
        XCTAssertEqual(filledDays.count, 3)
        XCTAssertEqual(filledDays[1].objectValue?["spots"]?.arrayValue?.count, 0, "건너뛴 날은 빈 일자다")
        XCTAssertEqual(filledDays[2].objectValue?["title"]?.stringValue, "온천")

        let kept = ItineraryDocument.make(draft: gapped, lines: lines, name: "여행", start: "2026-07-21", fillGaps: false)
        XCTAssertEqual(kept["days"]?.arrayValue?.count, 2)
        XCTAssertEqual(PasteItineraryView.gapText(ItineraryDayGap(before: 1, from: "2026-07-22", count: 3)), "7/22 외 2일")
    }

    func testOnlyCheckedLinesBecomeSpots() {
        let document = madeDocument()
        let days = document["days"]?.arrayValue ?? []
        XCTAssertEqual(days.count, 2)

        let day1 = days[0].objectValue ?? [:]
        let spots = day1["spots"]?.arrayValue ?? []
        XCTAssertEqual(spots.count, 1, "장소로 보이는 줄만 담긴다")
        XCTAssertEqual(spots.first?.objectValue?["name"]?.stringValue, "규카루이자와 긴자 거리")
        XCTAssertEqual(spots.first?.objectValue?["at"]?.stringValue, "14:00")
        XCTAssertEqual(spots.first?.objectValue?["stayMin"]?.intValue, 90)
    }

    func testUncheckedLinesAreKeptAsNotes() {
        let document = madeDocument()
        let day1 = document["days"]?.arrayValue?[0].objectValue ?? [:]
        let note = day1["note"]?.stringValue ?? ""
        XCTAssertTrue(note.contains("메모 한 줄"), "원래 메모는 남는다")
        XCTAssertTrue(note.contains("오전~오후｜이동"), "담지 않은 줄은 **원문 그대로** 남는다 — 버리지 않는다")
    }

    func testTheUserCanChangeWhatIsKept() {
        let document = madeDocument(includeOverrides: ["아침 식사": true, "톰보노유 온천": false])
        let day2 = document["days"]?.arrayValue?[1].objectValue ?? [:]
        let names = (day2["spots"]?.arrayValue ?? []).compactMap { $0.objectValue?["name"]?.stringValue }
        XCTAssertEqual(names, ["아침 식사"], "힌트는 기본값일 뿐 사람이 고친다")
        XCTAssertTrue((day2["note"]?.stringValue ?? "").contains("톰보노유 온천"))
    }

    func testNameAndStartComeFromTheScreen() {
        let document = madeDocument()
        XCTAssertEqual(document["name"]?.stringValue, "가루이자와 여행")
        XCTAssertEqual(document["start"]?.stringValue, "2026-07-21")
    }
}
