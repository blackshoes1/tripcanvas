#if DEBUG
import SwiftUI
import Observation

@MainActor struct ReviewFollowupHarness: View {
    private let arguments = ProcessInfo.processInfo.arguments
    @State private var scratch = NewTripFormState()
    @State private var savedScratch = ""
    @State private var presented = true
    @State private var day = TripDay(raw: ["spots": .array([.object([
        "name": .string("합성 호텔"), "stay": .bool(true), "bookingId": .string("hotel"), "cur": .string("EUR")
    ])])])
    @State private var shared = SharedFollowupBackend()
    private var hotel: TripBooking { .init(raw: ["id": .string("hotel"), "type": .string("hotel"), "price": .number(200), "cur": .string("EUR")]) }

    var body: some View {
        if arguments.contains("--review-shared") {
            SharedImportView(input: .init(id: "shared-followup", sourceType: .text, url: nil, text: "확인한 본문", title: "확인한 제목"),
                service: shared.service, trips: [shared.summary], initialTripID: shared.summary.id, onOpenTrip: { _ in })
        } else {
            NavigationStack {
                Text(arguments.contains("--review-scratch") ? savedScratch : "별도 비용 \(day.costItems.first?.amount ?? 0) \(day.costItems.first?.currency.rawValue ?? "EUR") · 예약 \(hotel.price) EUR")
                    .accessibilityIdentifier("reviewFollowupSaved")
                    .sheet(isPresented: $presented) {
                        if arguments.contains("--review-scratch") {
                            NewTripView(mode: .constant(.scratch), form: scratch) { draft in
                                try? await Task.sleep(for: .seconds(5))
                                savedScratch = draft.name; return nil
                            }
                        } else {
                            SpendEntryFlow(day: day, bookings: [hotel], draftKey: nil) { edited in
                                day = edited; presented = false; return true
                            }
                        }
                    }
            }
        }
    }
}

private final class SharedFollowupProtocol: URLProtocol, @unchecked Sendable {
    @MainActor static var handle: ((SharedFollowupProtocol) -> Void)?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Task { @MainActor in Self.handle?(self) } }
    override func stopLoading() {}
    func finish<T: Encodable>(_ value: T, status: Int = 200) {
        let data = try! JSONEncoder().encode(value)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
    }
    func body() -> [String: JSONValue] {
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let read = stream.read(&buffer, maxLength: buffer.count)
                if read <= 0 { break }; data.append(contentsOf: buffer.prefix(read))
            }
        }
        return (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
    }
}
@MainActor private struct SharedFollowupTokens: TokenProviding {
    func accessToken() async throws -> String { "synthetic-shared" }
    func refreshToken() async throws -> String { "synthetic-shared" }
}
@Observable @MainActor private final class SharedFollowupBackend {
    let service: TripService
    var revision = 1
    var reads = 0
    var document: [String: JSONValue] = ["name": .string("합성"), "days": .array([.object(["spots": .array([])])])]
    var summary: TripSummary { .init(id: "shared-ui", name: "합성 공유 여행", start: "2026-10-14", dayCount: 1, revision: revision,
        updatedAt: "", timeZone: "Asia/Seoul", cities: [], todayIndex: 0, daysUntilStart: 0, role: .owner, memberCount: 1) }
    init() {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [SharedFollowupProtocol.self]
        service = TripService(api: APIClient(baseURL: URL(string: "https://ui-review.invalid")!, tokens: SharedFollowupTokens(), session: URLSession(configuration: config)), cache: TripCache())
        SharedFollowupProtocol.handle = { [weak self] request in self?.respond(request) }
    }
    private func respond(_ request: SharedFollowupProtocol) {
        if request.request.url?.path.hasSuffix("/preview") == true || request.request.url?.path.hasSuffix("/bookings") == true {
            request.finish(["error": "UPSTREAM_ERROR", "message": "합성 자동 읽기 미사용"], status: 502); return
        }
        if request.request.httpMethod == "PUT" {
            let body = request.body()
            Task {
                try? await Task.sleep(for: .seconds(3))
                document = body["trip"]?.objectValue ?? document; revision += 1
                request.finish(TripDetailResponse(trip: summary, document: document))
            }
        } else {
            reads += 1
            let delay = reads > 1
            Task {
                if delay { try? await Task.sleep(for: .seconds(3)) }
                request.finish(TripDetailResponse(trip: summary, document: document))
            }
        }
    }
}
#endif
