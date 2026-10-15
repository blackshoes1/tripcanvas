import Foundation
import Observation

@Observable @MainActor
final class DailyMomentsViewModel {
    private(set) var response: DailyMomentsResponse?
    private(set) var dayIndex: Int
    private(set) var isLoading = false
    private(set) var isSaving = false
    private(set) var errorMessage: String?
    private(set) var confirmation: String?
    private var generation = 0
    private let tripId: String
    private let service: DailyMomentsSource

    init(tripId: String, dayIndex: Int, service: DailyMomentsSource) {
        self.tripId = tripId; self.dayIndex = dayIndex; self.service = service
    }

    func load(dayIndex: Int? = nil) async {
        guard !isSaving else { return }
        let nextDay = dayIndex ?? self.dayIndex
        generation += 1
        let request = generation
        if nextDay != self.dayIndex { response = nil; confirmation = nil }
        self.dayIndex = nextDay
        isLoading = true
        defer { if generation == request { isLoading = false } }
        do {
            let received = try await service.dailyMoments(tripId: tripId, dayIndex: nextDay)
            guard request == generation, received.dayIndex == self.dayIndex else { return }
            response = received; errorMessage = nil
        } catch {
            guard request == generation else { return }
            clearIfAccessEnded(error)
            errorMessage = error.localizedDescription
        }
    }

    func choose(_ option: DailyMomentOption?) async {
        guard !isSaving, !isLoading, let response, option?.selectable != false else { return }
        if let option, !response.options.contains(option) { return }
        let day = dayIndex
        isSaving = true; confirmation = nil; errorMessage = nil
        defer { isSaving = false }
        do {
            let received = try await service.saveDailyMoment(tripId: tripId, dayIndex: day,
                expectedRevision: response.revision, spotKey: option?.key)
            guard received.dayIndex == dayIndex else { return }
            self.response = received
            confirmation = option == nil ? "내 선택을 거뒀어요" : "오늘 꼭 하고 싶은 하나를 남겼어요"
        } catch {
            // No optimistic replacement: offline/409 leaves the last confirmed wish visible.
            clearIfAccessEnded(error)
            errorMessage = error.localizedDescription
        }
    }

    private func clearIfAccessEnded(_ error: Error) {
        guard let apiError = error as? APIError else { return }
        switch apiError {
        case .unauthorized, .notFound(_), .forbidden(_): response = nil
        default: break
        }
    }
}
