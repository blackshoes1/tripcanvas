import Foundation

/// 전 일자와 원문을 한 파일로 저장한다. 중간 실패를 준비 완료로 표시하지 않는다.
struct OfflineTrip: Codable {
    let detail: TripDetailResponse
    let plans: [DayPlanResponse]
    let bookings: [BookingSummary]
    let savedAt: Date
    static func key(_ id: String) -> String { "offline-trip-\(id)" }
    var isComplete: Bool {
        let count = TripDocument(raw: detail.document).days.count
        return count > 0 && plans.count == count && plans.enumerated().allSatisfy {
            $0.element.trip.id == detail.trip.id && $0.element.trip.revision == detail.trip.revision
                && $0.element.day.index == $0.offset
        }
    }
}

extension TripService {
    func offlineTrip(_ id: String) async -> OfflineTrip? {
        let pack = await cache.load(OfflineTrip.self, key: OfflineTrip.key(id), scope: cacheScope)?.value
        return pack?.isComplete == true ? pack : nil
    }

    func prepareOffline(tripId: String, progress: (Int, Int) -> Void) async throws -> OfflineTrip {
        let scope = cacheScope
        let detail: TripDetailResponse = try await api.get("/api/v1/trips/\(tripId)")
        let count = TripDocument(raw: detail.document).days.count
        var plans: [DayPlanResponse] = []
        progress(0, count)
        for index in 0..<count {
            try Task.checkCancellation()
            guard scope == cacheScope else { throw APIError.stale("계정이 바뀌었어요. 다시 열어 주세요.") }
            let plan: DayPlanResponse = try await api.get("/api/v1/trips/\(tripId)/days/\(index)")
            guard plan.trip.revision == detail.trip.revision else { throw APIError.badRequest("여행이 바뀌었어요. 최신 내용으로 다시 준비해 주세요.") }
            plans.append(plan); progress(index + 1, count)
        }
        try Task.checkCancellation()
        guard scope == cacheScope else { throw APIError.stale("계정이 바뀌었어요.") }
        let reservations: BookingListResponse = try await api.get("/api/v1/trips/\(tripId)/bookings")
        let latest: TripDetailResponse = try await api.get("/api/v1/trips/\(tripId)")
        guard latest.trip.revision == detail.trip.revision, scope == cacheScope else {
            throw APIError.badRequest("여행이 바뀌었어요. 최신 내용으로 다시 준비해 주세요.")
        }
        let pack = OfflineTrip(detail: detail, plans: plans, bookings: reservations.bookings, savedAt: Date())
        try Task.checkCancellation()
        guard pack.isComplete, await cache.save(pack, key: OfflineTrip.key(tripId), scope: scope) else {
            throw APIError.badRequest("기기에 저장하지 못했어요. 저장 공간을 확인해 주세요.")
        }
        // 기존 화면의 즉시 표시 캐시도 채운다. 완전한 원본은 위의 단일 파일이다.
        await cache.save(detail, key: TripCache.documentKey(tripId: tripId), scope: scope)
        for (index, plan) in plans.enumerated() {
            await cache.save(plan, key: TripCache.dayPlanKey(tripId: tripId, dayIndex: index), scope: scope)
        }
        await cache.save(reservations.bookings, key: TripCache.bookingsKey(tripId: tripId), scope: scope)
        return pack
    }
}
