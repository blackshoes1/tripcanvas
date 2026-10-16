import Foundation

extension Notification.Name {
    static let dailyMomentsChanged = Notification.Name("withj.dailyMomentsChanged")
}

extension TripSummary {
    func dayLabel(_ index: Int) -> String {
        let prefix = "Day \(index + 1)"
        guard index >= 0, let first = ISODateText.date(from: start),
              let date = ISODateText.calendar.date(byAdding: .day, value: index, to: first) else { return prefix }
        let parts = ISODateText.calendar.dateComponents([.month, .day], from: date)
        guard let month = parts.month, let day = parts.day else { return prefix }
        return "\(prefix) · \(month)월 \(day)일"
    }
}

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
    func dayLabel(_ index: Int) -> String {
        let prefix = "Day \(index + 1)"
        guard dayKey.hasPrefix("date:"), let current = ISODateText.date(from: String(dayKey.dropFirst(5))),
              let date = ISODateText.calendar.date(byAdding: .day, value: index - dayIndex, to: current) else { return prefix }
        let parts = ISODateText.calendar.dateComponents([.month, .day], from: date)
        guard let month = parts.month, let day = parts.day else { return prefix }
        return "\(prefix) · \(month)월 \(day)일"
    }
}

@MainActor
protocol DailyMomentsSource {
    func dailyMoments(tripId: String, dayIndex: Int) async throws -> DailyMomentsResponse
    func saveDailyMoment(tripId: String, dayIndex: Int, expectedRevision: Int, spotKey: String?) async throws -> DailyMomentsResponse
}

extension TripService: DailyMomentsSource {
    func dailyMoments(tripId: String, dayIndex: Int) async throws -> DailyMomentsResponse {
        let request = try await tripRequest(tripId)
        let response: DailyMomentsResponse = try await api.get("/api/v1/trips/\(tripId)/daily-moments",
            query: [URLQueryItem(name: "dayIndex", value: String(dayIndex))])
        try await checkTripRequest(tripId, request)
        return response
    }

    func saveDailyMoment(tripId: String, dayIndex: Int, expectedRevision: Int, spotKey: String?) async throws -> DailyMomentsResponse {
        let request = try await tripRequest(tripId)
        let response: DailyMomentsResponse = try await api.put("/api/v1/trips/\(tripId)/daily-moments", body: [
            "dayIndex": dayIndex, "expectedRevision": expectedRevision, "spotKey": spotKey as Any? ?? NSNull()
        ])
        try await checkTripRequest(tripId, request)
        NotificationCenter.default.post(name: .dailyMomentsChanged, object: tripId)
        return response
    }
}
