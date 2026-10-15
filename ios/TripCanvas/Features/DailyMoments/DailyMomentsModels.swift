import Foundation

/// A person's one wish for a day. These rows are not a group agreement.
struct DailyMomentOption: Codable, Identifiable, Hashable, Sendable {
    let key: String
    let name: String
    let activityId: String
    let selectable: Bool
    var disabledReason: String? = nil
    var id: String { activityId }
}

struct DailyMoment: Codable, Identifiable, Hashable, Sendable {
    let userId: String
    let label: String
    let mine: Bool
    let spotKey: String
    let spotName: String
    let activityId: String?
    let status: String
    var id: String { userId }
    var needsReview: Bool { status != "ACTIVE" }
}

struct DailyMomentsResponse: Codable, Hashable, Sendable {
    let dayIndex: Int
    let dayKey: String
    let revision: Int
    let options: [DailyMomentOption]
    let moments: [DailyMoment]
}

@MainActor
protocol DailyMomentsSource {
    func dailyMoments(tripId: String, dayIndex: Int) async throws -> DailyMomentsResponse
    func saveDailyMoment(tripId: String, dayIndex: Int, expectedRevision: Int, spotKey: String?) async throws -> DailyMomentsResponse
}

extension TripService: DailyMomentsSource {
    func dailyMoments(tripId: String, dayIndex: Int) async throws -> DailyMomentsResponse {
        let scope = cacheScope
        let response: DailyMomentsResponse = try await api.get("/api/v1/trips/\(tripId)/daily-moments",
            query: [URLQueryItem(name: "dayIndex", value: String(dayIndex))])
        guard scope == cacheScope else { throw APIError.unauthorized }
        return response
    }

    func saveDailyMoment(tripId: String, dayIndex: Int, expectedRevision: Int, spotKey: String?) async throws -> DailyMomentsResponse {
        let scope = cacheScope
        let response: DailyMomentsResponse = try await api.put("/api/v1/trips/\(tripId)/daily-moments", body: [
            "dayIndex": dayIndex, "expectedRevision": expectedRevision, "spotKey": spotKey as Any? ?? NSNull()
        ])
        guard scope == cacheScope else { throw APIError.unauthorized }
        return response
    }
}
