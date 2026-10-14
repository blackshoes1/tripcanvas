import Foundation
import Observation

enum PlaceSearchScope: String, CaseIterable, Identifiable {
    case automatic, korea, international
    var id: String { rawValue }
    var label: String {
        switch self { case .automatic: "자동"; case .korea: "국내"; case .international: "해외" }
    }
    var region: PlaceSearchRegion? {
        switch self { case .automatic: nil; case .korea: .korea; case .international: .international }
    }
    static func initial(near: GeoPoint?, timeZone: String?) -> Self {
        if let near { return MapRegion.isKorea(near) ? .korea : .international }
        guard let timeZone, !timeZone.isEmpty, TimeZone(identifier: timeZone) != nil else { return .automatic }
        return timeZone == "Asia/Seoul" ? .korea : .international
    }
}

/// 마지막으로 제출한 검색만 결과를 반영한다. 취소를 무시하는 transport도 세대로 막는다.
@Observable @MainActor
final class PlaceSearchViewModel {
    private(set) var hits: [PlaceHit] = []
    private(set) var isSearching = false
    private(set) var errorMessage: String?
    private(set) var searched = false
    private(set) var searchedQuery = ""
    private var generation = 0
    private let source: PlaceSearching

    init(source: PlaceSearching) { self.source = source }

    func invalidate() { generation += 1; isSearching = false }
    func clear() { invalidate(); hits = []; searched = false; errorMessage = nil }

    func search(_ query: String, near: GeoPoint?, scope: PlaceSearchScope) async {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { clear(); return }
        generation += 1
        let request = generation
        isSearching = true; errorMessage = nil; hits = []; searched = false
        defer { if request == generation { isSearching = false } }
        do {
            let found = try await source.search(text, near: near, region: scope.region)
            guard request == generation, !Task.isCancelled else { return }
            hits = found; searched = true; searchedQuery = text
        } catch {
            guard request == generation, !Task.isCancelled else { return }
            hits = []; searched = true; searchedQuery = text
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}
