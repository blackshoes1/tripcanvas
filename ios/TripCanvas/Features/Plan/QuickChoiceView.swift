import SwiftUI
import Observation

@MainActor protocol QuickChoiceComparing {
    func compareChoice(tripID: String, activityID: String, revision: Int) async throws -> ChoiceComparison
}
extension TripService: QuickChoiceComparing {
    func compareChoice(tripID: String, activityID: String, revision: Int) async throws -> ChoiceComparison {
        let request = try await tripRequest(tripID)
        let comparison: ChoiceComparison = try await api.post("/api/v1/trips/\(tripID)/choice-comparison",
            body: ["activityId": activityID, "expectedRevision": revision])
        try await checkTripRequest(tripID, request)
        return comparison
    }
}

/// This sheet owns one captured slot/revision. It never saves a positional match from a newer document.
@Observable @MainActor
final class QuickChoiceModel: Identifiable {
    let id = UUID()
    let tripID: String
    let day: Int
    let activity: ActivitySummary
    private(set) var expectedRevision: Int
    private let source: TripDocumentSource
    private var original: TripDocumentSnapshot?
    private var saved: TripDocumentSnapshot?
    private(set) var spot: TripSpot?
    private(set) var plan: DayPlanSpot?
    private(set) var comparison: ChoiceComparison?
    private(set) var isWorking = false
    private(set) var error: String?
    private(set) var requiresRefresh = false
    var isSaved: Bool { saved != nil }
    var canUndo: Bool { saved != nil && !requiresRefresh }

    init(tripID: String, day: Int, activity: ActivitySummary, revision: Int, source: TripDocumentSource) {
        self.tripID = tripID; self.day = day; self.activity = activity; expectedRevision = revision; self.source = source
    }
    private var index: Int? {
        guard let document = original?.document, document.hasDay(day) else { return nil }
        return document.days[day].spots.indices.first { "d\(day)s\($0)" == activity.id }
    }
    func load() async {
        guard !isWorking, original == nil else { return }
        isWorking = true; error = nil
        defer { isWorking = false }
        do {
            let snapshot = try await source.document(tripId: tripID)
            guard snapshot.canEdit, snapshot.revision == expectedRevision, snapshot.document.hasDay(day),
                  let at = snapshot.document.days[day].spots.indices.first(where: { "d\(day)s\($0)" == activity.id }),
                  snapshot.document.days[day].spots[at].name == activity.name,
                  snapshot.document.days[day].spots[at].choice?.state == .pending else {
                requiresRefresh = true; error = "일정이 바뀌었어요. 최신 일정에서 다시 선택해 주세요."; return
            }
            original = snapshot; spot = snapshot.document.days[day].spots[at]
            if let comparing = source as? QuickChoiceComparing {
                let received = try await comparing.compareChoice(tripID: tripID, activityID: activity.id, revision: snapshot.revision)
                guard received.revision == snapshot.revision, received.activityId == activity.id else {
                    requiresRefresh = true; error = "일정이 바뀌었어요. 최신 선택을 확인해 주세요."; return
                }
                comparison = received
            }
            if let fetched = try? await source.dayPlan(tripId: tripID, dayIndex: day),
               fetched.value.trip.revision == snapshot.revision, fetched.value.day.spots.indices.contains(at) {
                plan = fetched.value.day.spots[at]
            }
        } catch {
            if !ReadCancellation.shouldIgnore(error) {
                if case APIError.revisionConflict = error { requiresRefresh = true }
                self.error = error.localizedDescription
            }
        }
    }
    func choose(alternative: Bool) async {
        guard !isWorking, !requiresRefresh, saved == nil, let original, let index, var next = spot,
              next.choice?.validationError(current: next) == nil else { return }
        next.selectChoice(alternative: alternative)
        var document = original.document
        document.updateSpot(dayIndex: day, at: index, with: next)
        isWorking = true; error = nil
        defer { isWorking = false }
        do {
            let result = try await source.saveDocument(tripId: tripID, document: document, expectedRevision: original.revision)
            saved = result; spot = result.document.days[day].spots[index]
        } catch {
            requiresRefresh = true
            self.error = "저장 여부를 확인하지 못했어요. 이미 반영됐을 수 있으니 최신 선택을 확인해 주세요. " + error.localizedDescription
        }
    }
    func undo() async {
        guard !isWorking, canUndo, let saved, let original else { return }
        isWorking = true; error = nil
        defer { isWorking = false }
        do {
            let restored = try await source.saveDocument(tripId: tripID, document: original.document, expectedRevision: saved.revision)
            expectedRevision = restored.revision
            self.saved = nil; self.original = nil; spot = nil
        } catch { requiresRefresh = true; self.error = "다른 변경을 덮지 않도록 되돌리기를 멈췄어요. 최신 일정을 확인해 주세요." }
    }
}

struct QuickChoiceView: View {
    @State var model: QuickChoiceModel
    let onRefresh: () -> Void
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.l) {
                    Text("지금 마음 가는 쪽으로").font(.title2)
                    Text("둘 중 한 곳만 일정에 남겨 계산해요. 버튼을 누르면 바로 저장돼요.").font(.subheadline).foregroundStyle(Ink.soft)
                    if let spot = model.spot {
                        if model.isSaved {
                            Label("저장됨 · \(spot.name)", systemImage: "checkmark.circle.fill").accessibilityIdentifier("quickChoiceSaved")
                            if model.canUndo { Button("선택 되돌리기") { Task { await model.undo(); await model.load() } }.frame(minHeight: 44).accessibilityIdentifier("quickChoiceUndo") }
                        } else if let choice = spot.choice {
                            option(spot, alternative: false)
                            option(choice.alternative, alternative: true)
                        }
                    } else if !model.isWorking, model.error != nil, !model.requiresRefresh {
                        Button("다시 불러오기") { Task { await model.load() } }.frame(minHeight: 44)
                    }
                    if model.isWorking { ProgressView("선택을 확인하고 있어요") }
                    if let error = model.error {
                        Text(error).foregroundStyle(Ink.warning).accessibilityIdentifier("quickChoiceError")
                        if model.requiresRefresh { Button("최신 선택 확인") { onRefresh(); dismiss() }.frame(minHeight: 44) }
                    }
                }.padding(Space.l)
            }.paperGround().navigationTitle("두 곳 중 고르기").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() }.disabled(model.isWorking) } }
                .interactiveDismissDisabled(model.isWorking)
                .task { await model.load() }
        }
    }
    private func option(_ spot: TripSpot, alternative: Bool) -> some View {
        VStack(alignment: .leading, spacing: Space.s) {
            PlacePhotoView(placeId: spot.placeId, kakaoId: spot.kakaoId, name: spot.name)
            Text(spot.name).font(.headline)
            if let stay = spot.stayMinutes { Text("머무름 \(TimeFormat.duration(stay))").font(.subheadline) }
            if let cost = spot.cost { Text("입력 비용 \(TimeFormat.money(cost, currency: spot.currency.rawValue))").font(.subheadline) }
            else { Text("비용 미정").font(.subheadline).foregroundStyle(Ink.soft) }
            if let leg = model.comparison?.choices.first(where: { $0.alternative == alternative })?.travel
                ?? (alternative ? nil : model.plan?.incomingLeg) {
                Text("이동 \(TimeFormat.duration(leg.minutes))\(leg.source == .routed ? " · 조회 경로" : " · 추정")").font(.subheadline)
            } else { Text("이동시간은 선택 후 조회 · 두 장소의 경로는 달라요").font(.caption).foregroundStyle(Ink.soft) }
            if let at = spot.bookedAt { Text("예약·입장 \(at) · 선택을 바꿔도 예약은 취소되지 않아요").font(.caption).foregroundStyle(Ink.warning) }
            PrimaryActionButton(title: "\(spot.name)으로 저장", systemImage: "checkmark", isBusy: model.isWorking) {
                Task { await model.choose(alternative: alternative) }
            }.disabled(model.isWorking || model.requiresRefresh).accessibilityIdentifier(alternative ? "quickChooseAlternative" : "quickChooseCurrent")
        }.card()
    }
}
