import Foundation
import Observation

/// 여행 문서 하나의 **편집·저장·충돌·실행 취소**만 맡는다.
///
/// 왜 곧바로 저장하는가 — 저장 버튼을 두면 앱을 끄거나 다른 기기가 먼저 바꿨을 때 어느 쪽이
/// 맞는지 사람이 판단해야 한다. 한 번에 한 가지 변경만 올리면 충돌은 그 변경 하나로 좁아진다.
///
/// 충돌(다른 기기가 먼저 저장)은 **조용히 덮어쓰지 않는다**(§91). 방금 바꾼 것이 서버에 없다는
/// 사실을 그대로 말하고, 최신을 불러올지 사용자가 고른다.
///
/// ⚠️ **`revision`의 소유자는 여기 하나뿐이다.** 날짜별 계산 캐시(`DayPlanCache`)는 이 값을
/// 복제하지 않고 호출할 때마다 받는다 — 두 곳이 각자 들고 비교하면 어느 쪽이 참인지가 갈린다.
/// 무효화도 `onApplied`라는 한 줄로만 나간다.
@Observable
@MainActor
final class TripDocumentStore {
    /// 지금 보고 있는 문서. 저장에 성공하면 서버가 돌려준 문서로 바뀐다.
    private(set) var document: TripDocument?
    private(set) var revision = 0
    private(set) var role: MemberRole = .owner
    private(set) var isLoading = false
    /// 문서를 서버에서 마지막으로 받은 시각 — 탭에 다시 들어왔을 때 또 받을지의 기준.
    private(set) var loadedAt: Date?
    private(set) var isSaving = false
    private(set) var errorMessage: String?
    /// 다른 기기가 먼저 바꿨다. 화면은 이걸 보고 물어본다 — 자동으로 어느 쪽도 고르지 않는다.
    private(set) var conflict: String?
    private(set) var toast: String?

    private var undoDocument: TripDocument?
    private var undoRevision: Int?

    /// 문서 읽기의 세대. 늦게 온 읽기가 새 읽기의 결과나 로딩 상태를 덮지 못하게 한다.
    /// **저장에는 쓰지 않는다** — 저장은 `isSaving`과 서버의 revision CAS가 지킨다.
    private var loadGeneration = 0

    let tripId: String
    private let service: TripDocumentSource

    /// 문서를 새로 반영할 때마다 불린다. `revisionChanged`가 참이면 이 문서로 계산된 것이
    /// 전부 옛것이라는 뜻이다 — 캐시를 버리는 판단은 받는 쪽이 한다.
    /// 참·거짓과 무관하게 **매번** 불린다(문서 길이가 줄면 보는 날을 당겨야 하므로).
    var onApplied: ((_ revisionChanged: Bool) -> Void)?
    /// 저장이 성공한 직후. 계산을 다시 받는 것은 문서의 일이 아니라 화면의 일이라 밖으로 넘긴다.
    /// ⚠️ **여기서 기다리지 않는다** — 저장 완료를 계산 대기에 묶으면 편집기가 그동안 저장 중으로 멈춘다.
    var onSaved: (() -> Void)?

    init(tripId: String, service: TripDocumentSource) {
        self.tripId = tripId
        self.service = service
    }

    var canEdit: Bool { role.canEdit }
    var canUndo: Bool { undoDocument != nil && undoRevision == revision && canEdit && !isSaving }
    var dayCount: Int { document?.days.count ?? 0 }

    // MARK: 읽기

    /// 탭에 들어올 때 부른다. 문서가 있고 방금 받은 것이면 아무것도 하지 않는다 — 탭을 오갈 때마다
    /// 문서를 다시 받으면 그때마다 로딩이 뜨고 고른 날이 튄다(2026-09-17). 오래됐으면 `load()`인데,
    /// 문서가 이미 있으므로 화면은 로딩으로 바뀌지 않고 바뀐 것만 갈아끼워진다.
    func loadIfStale(maxAge: TimeInterval = 60, now: Date = Date()) async {
        if document != nil, let loadedAt, now.timeIntervalSince(loadedAt) < maxAge { return }
        await load()
    }

    /// 서버에서 문서를 받아 반영한다. 돌려주는 값은 **이 요청이 끝까지 유효했는가**다 —
    /// 늦게 온 요청은 참을 돌려주지 않으므로 호출부가 그 뒤에 계산을 받으러 가지 않는다.
    @discardableResult
    func load() async -> Bool {
        loadGeneration += 1
        let request = loadGeneration
        let requestedRevision = revision
        if document == nil { isLoading = true }
        defer { if request == loadGeneration { isLoading = false } }
        do {
            let snapshot = try await service.document(tripId: tripId)
            guard request == loadGeneration, requestedRevision == revision, !isSaving else { return false }
            apply(snapshot)
            loadedAt = Date()
            errorMessage = nil
        } catch {
            guard request == loadGeneration, requestedRevision == revision, !isSaving else { return false }
            errorMessage = message(for: error)
        }
        return true
    }

    /// 충돌 뒤 "최신 불러오기". 방금 바꾼 것은 서버에 없으므로 사라진다 — 화면이 그렇게 말한 뒤에 부른다.
    func reloadFromServer() async -> Bool {
        conflict = nil
        return await load()
    }

    func dismissConflict() { conflict = nil }
    func clearToast() { toast = nil }

    // MARK: 편집 — 전부 "문서를 고치고 저장한다" 한 갈래로 지나간다

    /// 고치고 → 화면에 먼저 반영하고 → 저장한다. 실패하면 **서버가 아는 상태로 되돌린다** —
    /// 저장되지 않은 것이 저장된 것처럼 남아 있으면 다음 편집이 그 위에 쌓인다.
    @discardableResult
    func edit(_ successToast: String?, _ change: (inout TripDocument) -> Void) async -> Bool {
        guard !isSaving else { return false }
        guard canEdit, let current = document else {
            errorMessage = "이 일정을 바꿀 수 없어요. 권한과 연결 상태를 확인해 주세요."
            return false
        }
        guard conflict == nil else { return false }
        var edited = current
        change(&edited)
        guard edited != current else { return true }

        document = edited
        isSaving = true
        defer { isSaving = false }
        do {
            apply(try await service.saveDocument(tripId: tripId, document: edited, expectedRevision: revision))
            undoDocument = current
            undoRevision = revision
            errorMessage = nil
            toast = successToast
            // 저장 완료를 계산 대기에 묶지 않고, 현재 일자의 로딩도 다시 끝나게 한다.
            onSaved?()
            return true
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
        return false
    }

    /// 미리보기에서 만든 문서를 통째로 저장한다. **미리보기를 연 뒤 문서가 바뀌었으면 거절한다** —
    /// 그 미리보기는 지금 문서의 결과가 아니다.
    @discardableResult
    func savePreparedDocument(_ draft: TripDocument, expectedRevision: Int, message: String) async -> Bool {
        guard revision == expectedRevision else {
            errorMessage = "미리보기를 연 뒤 일정이 바뀌었어요. 닫고 최신 일정에서 다시 선택해 주세요."
            return false
        }
        return await edit(message) { $0 = draft }
    }

    /// 직전 문서로 되돌린다. 되돌린 문서와 **되돌리기 전** 문서를 함께 돌려준다 —
    /// 후보 보드 표시를 맞추는 일은 문서의 일이 아니라 화면의 일이라 밖에서 한다.
    /// 되돌리기에 실패하면 실행 취소 기록을 **남겨 둔다**(다시 누를 수 있어야 한다).
    func undoLastChange() async -> (restored: TripDocument, replacedIDs: Set<Int>)? {
        guard canUndo, let previous = undoDocument else { return nil }
        let currentIDs = Set(document?.days.flatMap(\.spots).compactMap { $0.raw["candidateId"]?.intValue } ?? [])
        guard await edit("변경을 되돌렸어요", { $0 = previous }) else { return nil }
        undoDocument = nil
        undoRevision = nil
        return (previous, currentIDs)
    }

    /// 편집 시트는 이 문구를 보여주며 사용자의 초안을 계속 보존한다.
    var saveFailureMessage: String {
        if conflict != nil {
            return "다른 기기에서 먼저 바뀌었어요. 입력은 여기에 남아 있어요. 입력을 복사한 뒤 닫고 최신 일정을 확인해 주세요."
        }
        return errorMessage ?? "아직 저장하지 못했어요. 잠시 후 다시 시도해 주세요."
    }

    /// 화면이 실패를 알린 뒤 남길 문구. 저장 자체와 무관한 실패(후보 표시 복구 등)에 쓴다.
    func report(_ message: String) { errorMessage = message }

    // MARK: 반영

    /// 서버가 준 문서를 받아들인다. **뒤처진 것은 받지 않는다** — 늦게 온 옛 문서가 새 문서를 덮으면
    /// 방금 저장한 것이 사라진 것처럼 보인다.
    private func apply(_ snapshot: TripDocumentSnapshot) {
        guard snapshot.revision >= revision else { return }
        let revisionChanged = snapshot.revision != revision
        // 문서가 바뀌면 기억해 둔 계산은 전부 옛것이다 — 옛 시각을 보여 주느니 다시 받는다.
        if revisionChanged, !isSaving {
            undoDocument = nil
            undoRevision = nil
        }
        document = snapshot.document
        revision = snapshot.revision
        role = snapshot.role
        onApplied?(revisionChanged)
    }

    private func message(for error: Error) -> String {
        (error as? APIError)?.errorDescription ?? error.localizedDescription
    }
}
