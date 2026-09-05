import Foundation
import Observation

/// 일정 편집 화면의 상태. 문서를 읽고, 고치고, **곧바로** 저장한다.
///
/// 왜 곧바로 저장하는가 — 저장 버튼을 두면 앱을 끄거나 다른 기기가 먼저 바꿨을 때 어느 쪽이
/// 맞는지 사람이 판단해야 한다. 한 번에 한 가지 변경만 올리면 충돌은 그 변경 하나로 좁아진다.
///
/// 충돌(다른 기기가 먼저 저장)은 **조용히 덮어쓰지 않는다**(§91). 방금 바꾼 것이 서버에 없다는
/// 사실을 그대로 말하고, 최신을 불러올지 사용자가 고른다.
@Observable
@MainActor
final class TripPlanViewModel {
    /// 지금 보고 있는 문서. 저장에 성공하면 서버가 돌려준 문서로 바뀐다.
    private(set) var document: TripDocument?
    private(set) var revision = 0
    private(set) var role: MemberRole = .owner
    private(set) var isLoading = false
    private(set) var isSaving = false
    private(set) var errorMessage: String?
    /// 다른 기기가 먼저 바꿨다. 화면은 이걸 보고 물어본다 — 자동으로 어느 쪽도 고르지 않는다.
    private(set) var conflict: String?
    private(set) var toast: String?

    /// 보고 있는 일자. 문서가 줄어들면 마지막 날로 당긴다.
    var selectedDay = 0 {
        didSet { if let document, selectedDay >= document.days.count { selectedDay = max(0, document.days.count - 1) } }
    }

    let tripId: String
    private let service: TripDocumentSource

    init(tripId: String, service: TripDocumentSource) {
        self.tripId = tripId
        self.service = service
    }

    var canEdit: Bool { role.canEdit }

    var day: TripDay? {
        guard let document, document.hasDay(selectedDay) else { return nil }
        return document.days[selectedDay]
    }

    var dayCount: Int { document?.days.count ?? 0 }

    func load() async {
        if document == nil { isLoading = true }
        defer { isLoading = false }
        do {
            apply(try await service.document(tripId: tripId))
            errorMessage = nil
        } catch {
            errorMessage = message(for: error)
        }
    }

    /// 충돌 뒤 "최신 불러오기". 방금 바꾼 것은 서버에 없으므로 사라진다 — 화면이 그렇게 말한 뒤에 부른다.
    func reloadFromServer() async {
        conflict = nil
        await load()
    }

    func dismissConflict() { conflict = nil }
    func clearToast() { toast = nil }

    // MARK: 편집 — 전부 "문서를 고치고 저장한다" 한 갈래로 지나간다

    /// 편집 화면이 만든 장소를 그대로 넣는다. 이름만 있는 장소도 일정에 남는다(좌표는 나중에).
    func addSpot(_ spot: TripSpot, after index: Int? = nil) async {
        guard !spot.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        await edit("장소를 추가했어요") { $0.insertSpot(spot, dayIndex: self.selectedDay, after: index) }
    }

    func updateSpot(at index: Int, with spot: TripSpot) async {
        await edit(nil) { $0.updateSpot(dayIndex: self.selectedDay, at: index, with: spot) }
    }

    func removeSpot(at index: Int) async {
        await edit("장소를 뺐어요") { $0.removeSpot(dayIndex: self.selectedDay, at: index) }
    }

    func moveSpots(from source: IndexSet, to destination: Int) async {
        await edit(nil) { $0.moveSpots(dayIndex: self.selectedDay, from: source, to: destination) }
    }

    func moveSpot(at index: Int, toDay targetDay: Int) async {
        await edit("Day \(targetDay + 1)로 옮겼어요") { $0.moveSpot(from: (day: self.selectedDay, index: index), toDay: targetDay) }
    }

    func setDayMode(_ mode: TravelMode) async {
        await edit(nil) { document in
            guard document.hasDay(self.selectedDay) else { return }
            var day = document.days[self.selectedDay]
            day.mode = mode
            var days = document.days
            days[self.selectedDay] = day
            document.days = days
        }
    }

    func setDayTitle(_ title: String) async {
        await edit(nil) { document in
            guard document.hasDay(self.selectedDay) else { return }
            var day = document.days[self.selectedDay]
            day.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
            var days = document.days
            days[self.selectedDay] = day
            document.days = days
        }
    }

    // MARK: 예약 — 장소와 같은 문서라 같은 길로 저장된다

    var bookings: [TripBooking] { document?.bookings ?? [] }

    /// 예약을 넣거나 고친다. 검증(웹 `bkSave`와 같은 규칙)을 지나지 못하면 저장하지 않고 이유를 말한다.
    /// 돌려주는 값은 저장 요청이 나갔는지다 — 화면은 이걸 보고 닫을지 정한다.
    @discardableResult
    func saveBooking(_ booking: TripBooking, links: BookingLinks = .empty) async -> Bool {
        if let problem = booking.validate() {
            errorMessage = problem.message
            return false
        }
        let isNew = document?.booking(id: booking.id) == nil
        await edit(isNew ? "예약을 추가했어요" : "예약을 저장했어요") { $0.upsertBooking(booking, links: links) }
        return true
    }

    /// 예약 추적을 뺀다. 실제 예약이 취소되지는 않는다 — 화면이 그렇게 말한 뒤에 부른다.
    func removeBooking(id: String) async {
        await edit("예약을 뺐어요") { $0.removeBooking(id: id) }
    }

    /// 고치고 → 화면에 먼저 반영하고 → 저장한다. 실패하면 **서버가 아는 상태로 되돌린다** —
    /// 저장되지 않은 것이 저장된 것처럼 남아 있으면 다음 편집이 그 위에 쌓인다.
    private func edit(_ successToast: String?, _ change: (inout TripDocument) -> Void) async {
        guard canEdit, let current = document else { return }
        var edited = current
        change(&edited)
        guard edited != current else { return }

        document = edited
        isSaving = true
        defer { isSaving = false }
        do {
            apply(try await service.saveDocument(tripId: tripId, document: edited, expectedRevision: revision))
            errorMessage = nil
            toast = successToast
        } catch let error as APIError {
            document = current
            if case .revisionConflict(let message, _) = error {
                conflict = message
            } else {
                errorMessage = message(for: error)
            }
        } catch {
            document = current
            errorMessage = message(for: error)
        }
    }

    private func apply(_ snapshot: TripDocumentSnapshot) {
        document = snapshot.document
        revision = snapshot.revision
        role = snapshot.role
        if selectedDay >= snapshot.document.days.count { selectedDay = max(0, snapshot.document.days.count - 1) }
    }

    private func message(for error: Error) -> String {
        (error as? APIError)?.errorDescription ?? error.localizedDescription
    }
}
