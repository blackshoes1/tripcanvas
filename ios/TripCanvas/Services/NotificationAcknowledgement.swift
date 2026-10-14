import Foundation

extension TripService {
    func acknowledgeNotifications(tripId: String, items: [NotificationPlanItem], stateVersion: String) async throws {
        struct Ack: Decodable { let acknowledged: Bool }
        guard !items.isEmpty else { return }
        let _: Ack = try await api.post("/api/v1/trips/\(tripId)/travel-state", body: [
            "stateVersion": stateVersion,
            "items": items.map { ["kind": $0.kind.rawValue, "dedupeKey": $0.dedupeKey] }
        ])
    }
}
