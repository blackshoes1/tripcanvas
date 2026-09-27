import Foundation
import Observation

@MainActor
protocol SharedImportSource: TripDocumentSource {
    func previewShare(_ input: SharedTravelInput) async throws -> ImportPreviewResponse
}

extension TripService: SharedImportSource {
    func previewShare(_ input: SharedTravelInput) async throws -> ImportPreviewResponse {
        var body: [String: Any] = ["sourceType": input.sourceType.rawValue]
        body["url"] = input.url; body["text"] = input.text; body["title"] = input.title
        return try await api.post("/api/v1/import/preview", body: body)
    }
}

/// 원문은 대기열에 남겨 두고, 확인된 변경만 문서의 CAS 저장 경로로 보낸다.
@Observable @MainActor
final class SharedImportModel {
    let input: SharedTravelInput
    private let service: SharedImportSource
    private(set) var preview: ImportPreviewResponse?
    private(set) var snapshot: TripDocumentSnapshot?
    private(set) var isWorking = false
    private(set) var error: String?
    private(set) var saved = false
    private(set) var tripID = ""
    private var attemptedTripID: String?
    var canChooseTrip: Bool { !isWorking && attemptedTripID == nil }

    init(input: SharedTravelInput, service: SharedImportSource) {
        self.input = input; self.service = service
    }

    func previewInput() async {
        do { preview = try await service.previewShare(input) }
        catch { self.error = "내용을 자동으로 읽지 못했어요. 원문을 보고 직접 확인해 주세요." }
    }

    func selectTrip(_ id: String) async {
        guard !isWorking else { return }
        guard attemptedTripID == nil || attemptedTripID == id else {
            error = "이전에 저장을 시도한 여행에서 결과를 먼저 확인해 주세요."; return
        }
        tripID = id; snapshot = nil; error = nil
        guard !id.isEmpty else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            snapshot = try await service.document(tripId: id)
            if snapshot?.canEdit != true { error = "온라인에서 편집 권한이 있는 여행을 선택해 주세요." }
        } catch { self.error = error.localizedDescription }
    }

    /// 네트워크 오류 뒤 재시도는 최신 문서에서 같은 공유 키를 찾는다. 응답만 유실됐어도 두 번 넣지 않는다.
    func save(_ change: (inout TripDocument) throws -> Void) async -> String? {
        guard !isWorking, let snapshot, snapshot.canEdit else { return "온라인에서 여행을 다시 불러와 주세요." }
        isWorking = true; error = nil
        defer { isWorking = false }
        do {
            let latest = try await service.document(tripId: tripID)
            guard latest.canEdit else { throw APIError.badRequest("온라인에서 편집 권한을 확인해 주세요.") }
            if Self.contains(input.id, in: latest.document) { saved = true; return nil }
            guard latest.revision == snapshot.revision else {
                throw APIError.badRequest("여행이 바뀌었어요. 편집기를 닫고 여행을 다시 불러온 뒤 날짜와 내용을 확인해 주세요.")
            }
            var document = latest.document
            try change(&document)
            attemptedTripID = tripID
            _ = try await service.saveDocument(tripId: tripID, document: document, expectedRevision: latest.revision)
            saved = true
            return nil
        } catch {
            self.error = error.localizedDescription
            return self.error
        }
    }

    static func contains(_ key: String, in document: TripDocument) -> Bool {
        let items = (document.raw["bookings"]?.arrayValue ?? []) + (document.raw["notes"]?.arrayValue ?? [])
            + document.days.flatMap { $0.spots.map { JSONValue.object($0.raw) } }
        return items.contains { $0.objectValue?["importKey"]?.stringValue == key }
    }

    func bookingSeed(currency: String) -> TripBooking {
        let candidate = preview?.candidate
        let type: TripBookingType = candidate?.type == .car ? .car : (candidate?.type == .flight ? .flight : .hotel)
        var booking = TripBooking(type: type)
        booking.title = candidate?.title ?? input.title ?? ""
        booking.provider = candidate?.provider ?? ""
        booking.confirmation = candidate?.confirmationNumber
        booking.price = candidate?.amount ?? 0
        booking.currency = Currency(rawValue: currency)
        booking.start = candidate?.ambiguities.isEmpty == true ? candidate?.startAt.map { String($0.prefix(10)) } : nil
        booking.end = candidate?.ambiguities.isEmpty == true ? candidate?.endAt.map { String($0.prefix(10)) } : nil
        booking.url = input.url
        booking.track = false
        return booking
    }
}
