import Foundation
import Observation

struct PlaceSearchArea: Hashable, Sendable {
    let south: Double
    let west: Double
    let north: Double
    let east: Double

    var center: GeoPoint { GeoPoint(lat: (south + north) / 2, lng: (west + east) / 2) }
    var queryValue: String { [south, west, north, east].map { String($0) }.joined(separator: ",") }
    var isValid: Bool {
        [south, west, north, east].allSatisfy(\.isFinite)
            && south >= -90 && north <= 90 && south < north
            && west >= -180 && east <= 180 && west < east
    }

    func contains(_ point: GeoPoint) -> Bool {
        point.lat >= south && point.lat <= north && point.lng >= west && point.lng <= east
    }
}

enum PlaceSearchCategory: String, CaseIterable, Identifiable {
    case food, cafe, attraction, stay
    var id: String { rawValue }
    var label: String {
        switch self { case .food: "음식점"; case .cafe: "카페"; case .attraction: "관광"; case .stay: "숙소" }
    }
    var googleType: String {
        switch self { case .food: "restaurant"; case .cafe: "cafe"; case .attraction: "tourist_attraction"; case .stay: "lodging" }
    }
}

enum PlaceSearchRegion: String, CaseIterable { case korea, international }

/// 지도 탐색은 순서 없는 후보를 모은다. 검색 세대와 저장 상태를 분리해 연속 탐색을 유지한다.
@Observable @MainActor
final class MapDiscoveryModel {
    var query = ""
    var category: PlaceSearchCategory? = .attraction
    var area: PlaceSearchArea?
    var selected: PlaceHit?
    private(set) var hits: [PlaceHit] = []
    private(set) var candidates: [CandidateView] = []
    private(set) var isSearching = false
    private(set) var isSaving = false
    private(set) var didSearch = false
    private(set) var searchedArea: PlaceSearchArea?
    private(set) var errorMessage: String?
    private(set) var candidatesLoaded = false
    private var generation = 0
    private var savedHits: [PlaceHit] = []
    private var uncertainHit: PlaceHit?
    private var savedCandidateIDs: [String: Int] = [:]
    private var pendingWrites: [String: (hit: PlaceHit, withoutLocation: Bool, key: String)] = [:]
    private var candidateRead = 0
    private let searcher: PlaceSearching
    private let source: CollabSource
    let trip: TripSummary

    init(trip: TripSummary, searcher: PlaceSearching, source: CollabSource) {
        self.trip = trip; self.searcher = searcher; self.source = source
    }

    var canSave: Bool { CollabModel.canPropose(trip.role ?? .owner) }
    var activeCandidates: [CandidateView] { candidates.filter { $0.status != "REJECTED" } }
    var undatedCandidates: [CandidateView] { activeCandidates.filter { $0.status != "SCHEDULED" } }

    func updateArea(_ value: PlaceSearchArea) {
        guard value != area else { return }
        area = value
        // 이동 중 시작한 검색은 새 화면에 붙이지 않는다. 이미 표시된 결과는 다음 검색까지 유지한다.
        generation += 1
        isSearching = false
    }

    func loadCandidates() async {
        candidateRead += 1
        let request = candidateRead
        do {
            let received = try await source.candidates(tripId: trip.id)
            guard request == candidateRead else { return }
            candidates = received
            candidatesLoaded = true
            errorMessage = nil
        } catch {
            guard request == candidateRead else { return }
            candidatesLoaded = false
            errorMessage = "담은 장소를 확인하지 못했어요. 다시 불러온 뒤 담아 주세요."
        }
    }

    func invalidateSearch() {
        generation += 1
        isSearching = false
        hits = []
        selected = nil
        didSearch = false
    }

    func search() async {
        guard let area, area.isValid else {
            errorMessage = "여행 지역을 고르거나 지도를 더 확대해 주세요."
            return
        }
        generation += 1
        let request = generation
        let region: PlaceSearchRegion = MapRegion.isKorea(area.center) ? .korea : .international
        isSearching = true
        errorMessage = nil
        selected = nil
        do {
            let found = try await searcher.search(query, area: area, category: category, region: region)
            guard generation == request else { return }
            hits = found
            searchedArea = area
            didSearch = true
        } catch {
            guard generation == request else { return }
            hits = []
            errorMessage = error.localizedDescription
            didSearch = true
        }
        if generation == request { isSearching = false }
    }

    func isSaved(_ hit: PlaceHit) -> Bool {
        if let candidate = candidate(for: hit) { return candidate.status != "REJECTED" }
        return savedHits.contains { Self.samePlace($0, hit) }
    }

    func candidate(for hit: PlaceHit) -> CandidateView? {
        candidates.first { candidate in
            if let provider = hit.provider, let id = hit.providerId,
               candidate.provider == provider, candidate.providerId == id { return true }
            if let placeId = hit.placeId, let id = candidate.placeId { return placeId == id }
            return savedCandidateIDs[hit.id] == candidate.id || hit.id == "candidate-\(candidate.id)"
        }
    }

    func reopen(_ hit: PlaceHit) async {
        guard canSave, !isSaving, let candidate = candidate(for: hit), candidate.status == "REJECTED" else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await source.manageCandidate(tripId: trip.id, candidateId: candidate.id, action: "REOPEN", value: nil)
            await loadCandidates()
        } catch { errorMessage = "가고 싶은 곳으로 되돌리지 못했어요. \(error.localizedDescription)" }
    }

    static func samePlace(_ a: PlaceHit, _ b: PlaceHit) -> Bool {
        if let aId = a.providerId, let bId = b.providerId, a.provider == b.provider { return aId == bId }
        if let aId = a.placeId, let bId = b.placeId { return aId == bId }
        return a.id == b.id
    }

    func save(_ hit: PlaceHit, withoutLocation: Bool = false) async {
        guard canSave, candidatesLoaded, !isSaving, !isSaved(hit) else { return }
        guard candidate(for: hit)?.status != "REJECTED" else {
            errorMessage = "이전에 뺀 장소예요. 가고 싶은 곳으로 되돌리기를 눌러 주세요."
            return
        }
        isSaving = true
        defer { isSaving = false }
        // 결과를 먼저 확인하고 같은 요청 키로 재전송한다. 서버가 같은 쓰기를 한 번만 저장한다.
        if let uncertainHit, Self.samePlace(uncertainHit, hit) {
            await loadCandidates()
            if isSaved(hit) || !candidatesLoaded { return }
            self.uncertainHit = nil
        }
        errorMessage = nil
        let write = pendingWrites[hit.id] ?? (hit: hit, withoutLocation: withoutLocation, key: UUID().uuidString)
        pendingWrites[hit.id] = write
        let place = write.hit
        if selected?.id == hit.id { selected = place }
        do {
            let candidateID = try await source.addCandidate(tripId: trip.id, title: place.name, note: nil,
                lat: write.withoutLocation ? nil : place.point.lat, lng: write.withoutLocation ? nil : place.point.lng,
                placeId: place.placeId, addr: place.address.isEmpty ? nil : place.address,
                provider: write.withoutLocation ? nil : place.provider,
                providerId: write.withoutLocation ? nil : place.providerId, clientKey: write.key)
            savedCandidateIDs[hit.id] = candidateID
            savedHits.append(place)
            await loadCandidates()
        } catch {
            if case .offline = error as? APIError { uncertainHit = hit }
            errorMessage = "장소를 담지 못했어요. \(error.localizedDescription)"
        }
    }
}
