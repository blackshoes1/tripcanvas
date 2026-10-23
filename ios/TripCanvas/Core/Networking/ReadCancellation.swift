import Foundation

/// 화면을 떠나 중단된 읽기는 통신 실패가 아니다. 쓰기의 수신 여부 판단에는 사용하지 않는다.
enum ReadCancellation {
    static func shouldIgnore(_ error: Error? = nil) -> Bool {
        if Task.isCancelled { return true }
        guard let error else { return false }
        if error is CancellationError { return true }
        let network = error as NSError
        return network.domain == NSURLErrorDomain && network.code == URLError.cancelled.rawValue
    }
}
