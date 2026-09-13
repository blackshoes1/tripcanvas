import Foundation
import Observation

/// 서버 성공과 시트 닫기를 연결한다. 실패한 입력은 각 편집기의 draft에 남긴다.
@Observable
@MainActor
final class EditorSaveState {
    private(set) var isWorking = false
    private(set) var error: String?

    func perform(_ operation: () async -> String?) async -> Bool {
        guard !isWorking else { return false }
        isWorking = true
        error = nil
        defer { isWorking = false }
        error = await operation()
        return error == nil
    }
}
