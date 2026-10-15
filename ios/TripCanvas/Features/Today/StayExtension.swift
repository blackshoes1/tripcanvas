import Foundation
import Observation
import SwiftUI

struct StayExtensionPreview: Codable, Hashable, Sendable {
    struct Change: Codable, Hashable, Sendable {
        let activityId: String
        let name: String
        let beforeStayMinutes: Int
        let afterStayMinutes: Int
    }
    struct Commitment: Codable, Hashable, Sendable {
        let activityId: String
        let name: String
        let atMinutes: Int
        let arrivalMinutes: Int?
        let slackMinutes: Int?
        let bufferMinutes: Int
    }
    let schemaVersion: Int
    let revision: Int
    let generatedAt: String
    let dayIndex: Int
    let activityId: String
    let currentName: String
    let extraMinutes: Int
    let oldDepartureMinutes: Int
    let newDepartureMinutes: Int
    let feasible: Bool
    let reason: String?
    let hasUnknownTravel: Bool
    let changes: [Change]
    var affectedActivityIds: [String]? = nil
    let fixedCommitments: [Commitment]
    let dayEndBeforeMinutes: Int?
    let dayEndAfterMinutes: Int?
    let travelTimeSource: String
    let previewKey: String
}

@MainActor
protocol StayExtensionSource {
    func previewStay(tripId: String, activityId: String, minutes: Int, revision: Int) async throws -> StayExtensionPreview
    func applyStay(tripId: String, preview: StayExtensionPreview) async throws -> MutationResponse
}

extension TripService: StayExtensionSource {
    func previewStay(tripId: String, activityId: String, minutes: Int, revision: Int) async throws -> StayExtensionPreview {
        let request = try await tripRequest(tripId)
        let value: StayExtensionPreview = try await api.post("/api/v1/trips/\(tripId)/stay-extension/preview",
            body: ["expectedRevision": revision, "activityId": activityId, "extraMinutes": minutes])
        try await checkTripRequest(tripId, request)
        return value
    }
    func applyStay(tripId: String, preview: StayExtensionPreview) async throws -> MutationResponse {
        let request = try await tripRequest(tripId)
        let response: MutationResponse = try await api.post("/api/v1/trips/\(tripId)/stay-extension/apply",
            body: ["expectedRevision": preview.revision, "activityId": preview.activityId,
                   "extraMinutes": preview.extraMinutes, "previewKey": preview.previewKey])
        try await checkTripRequest(tripId, request)
        await cache.save(response.today, key: TripCache.todayKey(tripId: tripId, dayIndex: nil), scope: request.scope,
                         tripID: tripId, tripGeneration: request.generation)
        return response
    }
}

@Observable @MainActor
final class StayExtensionModel: Identifiable {
    let id = UUID()
    let tripID: String
    let activityID: String
    let revision: Int
    private let source: StayExtensionSource
    private let isCurrent: () -> Bool
    private var generation = 0
    private(set) var minutes = 10
    private(set) var preview: StayExtensionPreview?
    private(set) var isLoading = false
    private(set) var isApplying = false
    private(set) var error: String?
    private(set) var requiresReopen = false
    init(tripID: String, activityID: String, revision: Int, source: StayExtensionSource, isCurrent: @escaping () -> Bool = { true }) {
        self.tripID = tripID; self.activityID = activityID; self.revision = revision; self.source = source
        self.isCurrent = isCurrent
    }
    func select(_ value: Int) async {
        guard !isApplying, !requiresReopen, [10, 20, 30].contains(value), isCurrent() else { return }
        generation += 1
        let request = generation
        minutes = value; preview = nil; error = nil; isLoading = true
        defer { if request == generation { isLoading = false } }
        do {
            let fetched = try await source.previewStay(tripId: tripID, activityId: activityID, minutes: value, revision: revision)
            guard generation == request, isCurrent() else { return }
            guard fetched.revision == revision, fetched.activityId == activityID, fetched.extraMinutes == value else {
                throw APIError.stale("계산 결과가 달라 다시 확인이 필요해요.")
            }
            preview = fetched
        } catch {
            guard generation == request else { return }
            self.error = error.localizedDescription
        }
    }
    func apply() async -> MutationResponse? {
        guard !isApplying, !isLoading, !requiresReopen, let preview, preview.feasible, isCurrent() else { return nil }
        isApplying = true; error = nil; generation += 1
        defer { isApplying = false }
        do {
            let result = try await source.applyStay(tripId: tripID, preview: preview)
            return isCurrent() ? result : nil
        }
        catch {
            // The write may already have committed. Never offer a blind second extension.
            requiresReopen = true
            self.preview = nil
            self.error = "저장 완료를 확인하지 못했어요. 이미 반영됐을 수 있으니 최신 일정부터 확인해 주세요. " + error.localizedDescription
            return nil
        }
    }
}

struct StayExtensionSheet: View {
    @State var model: StayExtensionModel
    let onApplied: (MutationResponse) -> Void
    let onRefresh: () -> Void
    var trip: TripSummary? = nil
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.l) {
                    Text("예정된 떠날 시각에서 얼마나 더 머물까요?").font(.headline)
                    HStack {
                        ForEach([10, 20, 30], id: \.self) { amount in
                            Button { Task { await model.select(amount) } } label: {
                                Text("\(amount)분").frame(maxWidth: .infinity, minHeight: 44)
                            }
                            .buttonStyle(.bordered)
                            .tint(model.minutes == amount ? Ink.accent : Ink.soft)
                            .accessibilityAddTraits(model.minutes == amount ? .isSelected : [])
                            .accessibilityIdentifier("stayMinutes\(amount)")
                        }
                    }.disabled(model.isApplying || model.requiresReopen)
                    if model.isLoading { ProgressView("남은 일정을 계산하고 있어요") }
                    if let p = model.preview {
                        Text("\(p.currentName)에서 \(TimeFormat.clock(p.newDepartureMinutes)) 출발").font(.title3)
                        ForEach(p.changes.filter { $0.activityId != p.activityId }, id: \.activityId) { change in
                            Text("\(change.name) 머무름 · \(change.beforeStayMinutes)분 → \(change.afterStayMinutes)분")
                        }
                        ForEach(p.fixedCommitments, id: \.activityId) { fixed in
                            VStack(alignment: .leading, spacing: Space.xs) {
                                Text("\(fixed.name) · \(TimeFormat.clock(fixed.atMinutes)) 예약")
                                if let slack = fixed.slackMinutes {
                                    Text(slack >= 0 ? "도착 후 예상 여유 \(slack)분" : "예상 도착이 \(-slack)분 늦어요")
                                    if slack < fixed.bufferMinutes { Text("준비 여유 \(fixed.bufferMinutes)분보다 짧아요").foregroundStyle(Ink.warning) }
                                } else { Text("이동 정보가 부족해 도착 여유를 확인할 수 없어요").foregroundStyle(Ink.warning) }
                            }
                        }
                        if let before = p.dayEndBeforeMinutes, let after = p.dayEndAfterMinutes {
                            Text("마지막 방문을 마치는 시각 · \(TimeFormat.clock(before)) → \(TimeFormat.clock(after))")
                        }
                        if let trip {
                            DailyMomentsImpactSection(trip: trip, dayIndex: p.dayIndex, revision: p.revision,
                                changedActivityIds: p.affectedActivityIds ?? p.changes.map(\.activityId))
                        }
                        Text(p.travelTimeSource == "ROUTED" && !p.hasUnknownTravel
                             ? "조회한 경로 기준 예상이에요. 현장 상황에 따라 달라질 수 있어요."
                             : "이동시간에 추정 또는 미확인 구간이 있어요. 예약·교통편은 현장 상황도 확인해 주세요.")
                            .font(.caption).foregroundStyle(Ink.soft)
                        if let reason = p.reason { Text(reason).foregroundStyle(Ink.warning) }
                        PrimaryActionButton(title: "이렇게 보내기", systemImage: "checkmark", isBusy: model.isApplying) {
                            Task { if let response = await model.apply() { onApplied(response); dismiss() } }
                        }.disabled(!p.feasible || model.isApplying).accessibilityIdentifier("stayApply")
                    }
                    if let error = model.error {
                        Text(error).foregroundStyle(Ink.warning).accessibilityIdentifier("stayError")
                        if model.requiresReopen {
                            Button("최신 일정 확인") { onRefresh(); dismiss() }.frame(minHeight: 44)
                        } else {
                            Button("다시 계산") { Task { await model.select(model.minutes) } }.frame(minHeight: 44)
                        }
                    }
                }.padding(Space.l)
            }
            .paperGround().navigationTitle("조금 더 머물기")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("원래대로") { dismiss() }.disabled(model.isApplying) } }
            .interactiveDismissDisabled(model.isApplying)
            .task { await model.select(model.minutes) }
        }
    }
}
