#if DEBUG
import SwiftUI
import Observation

/// 실제 일정 목록의 refreshable 수명을 검증한다. 문서 소스만 합성으로 바꾸고 지도는 열지 않는다.
@MainActor
struct RefreshReviewHarness: View {
    @Environment(AppEnvironment.self) private var env
    @State private var source = RefreshReviewSource()
    @State private var model: TripPlanViewModel?
    @State private var discovery: MapDiscoveryModel?
    @State private var showsPlan = true
    @State private var showsMap = false
    @State private var lastReturnWasFresh: Bool?

    private var cancellationScenario: Bool { ProcessInfo.processInfo.arguments.contains("--review-refresh-cancel") }
    private var remoteName: String { cancellationScenario ? "합성 복귀 최신 장소" : "합성 당김 최신 장소" }
    private var freshRead: Bool {
        guard let loadedAt = model?.loadedAt else { return false }
        return Date().timeIntervalSince(loadedAt) < 60
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: Space.s) {
                diagnostics
                HStack(spacing: Space.m) {
                    Button("합성 일정 탭") {
                        lastReturnWasFresh = freshRead
                        showsPlan = true
                    }
                        .accessibilityIdentifier("refreshPlanTab")
                    Button("합성 다른 탭") { showsPlan = false }
                        .accessibilityIdentifier("refreshOtherTab")
                }.frame(minHeight: 44)
                if showsPlan {
                    if let model, let discovery {
                        TripPlanView(trip: source.trip, model: model, discovery: discovery, showsMap: $showsMap)
                    } else { ProgressView("합성 일정 준비 중") }
                } else {
                    Text("일정 뷰를 제거한 합성 다른 탭")
                        .accessibilityIdentifier("refreshOtherTabContent")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .background(Ink.paper)
            .navigationTitle("합성 새로고침 검증")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            guard model == nil else { return }
            // MapDiscoveryModel의 생성자는 요청하지 않는다. showsMap=false라 지도와 검색은 생성·실행되지 않는다.
            discovery = MapDiscoveryModel(trip: source.trip, searcher: env.places, source: env.service)
            model = TripPlanViewModel(tripId: source.trip.id, service: source, loadsPlans: false)
        }
    }

    private var diagnostics: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Text("합성 자료 · 실제 여행/서버 요청 없음")
                .font(.caption)
            Text("started=\(source.startedReads); completed=\(source.completedReads); cancelled=\(source.cancelledReads)")
                .font(.caption.monospaced()).accessibilityIdentifier("refreshReadCounts")
            Text("revision=\(model?.revision ?? 0); first=\(model?.day?.spots.first?.name ?? "none"); fresh=\(freshRead ? "true" : "false")")
                .font(.caption).accessibilityIdentifier("refreshAppliedState")
            Text("load=\(model?.loadErrorMessage ?? "none"); save=\(model?.saveErrorMessage ?? "none")")
                .font(.caption).accessibilityIdentifier("refreshErrorState")
            Text("gate=\(source.isResponseHeld ? "waiting" : "closed"); released=\(source.releasedReads)")
                .font(.caption).accessibilityIdentifier("refreshResponseGate")
            Text("returnFresh=\(lastReturnWasFresh.map { $0 ? "true" : "false" } ?? "unset")")
                .font(.caption).accessibilityIdentifier("refreshFreshReturn")
            HStack {
                Button("다음 GET 보류 · 원격 변경 준비") {
                    source.armRemoteChange(name: remoteName)
                }
                .font(.caption)
                .frame(minHeight: 44)
                .disabled(model?.document == nil || !freshRead || source.inFlightReads != 0 || source.isArmed)
                .accessibilityIdentifier("refreshArmDelayedRead")
                Button("합성 GET 응답 보내기") { source.releaseHeldRead() }
                    .font(.caption).frame(minHeight: 44)
                    .disabled(!source.isResponseHeld)
                    .accessibilityIdentifier("refreshReleaseRead")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Space.l)
    }
}

/// 응답은 테스트가 버튼으로 해제할 때까지 suspend한다. 타이머나 UI idle 타이밍에 의존하지 않는다.
/// 실제 refreshable Task의 취소는 continuation을 URLError.cancelled로 깨운다.
@Observable @MainActor
private final class RefreshReviewSource: TripDocumentSource {
    private(set) var startedReads = 0
    private(set) var completedReads = 0
    private(set) var cancelledReads = 0
    private(set) var releasedReads = 0
    private(set) var isArmed = false
    private var remote: TripDocumentSnapshot
    private var heldRead: (number: Int, continuation: CheckedContinuation<Void, Error>)?
    var isResponseHeld: Bool { heldRead != nil }
    var inFlightReads: Int { startedReads - completedReads - cancelledReads }
    let trip = TripSummary(id: "synthetic-refresh", name: "합성 새로고침 여행", start: "2026-10-16", dayCount: 1,
        revision: 1, updatedAt: "", timeZone: "Asia/Seoul", cities: [], todayIndex: 0,
        daysUntilStart: 0, role: .owner, memberCount: 1)

    init() { remote = Self.snapshot(revision: 1, firstName: "합성 초기 장소") }

    func armRemoteChange(name: String) {
        guard inFlightReads == 0, !isArmed else { return }
        remote = Self.snapshot(revision: 2, firstName: name)
        isArmed = true
    }

    func document(tripId: String) async throws -> TripDocumentSnapshot {
        startedReads += 1
        let gated = isArmed, response = remote, number = startedReads
        isArmed = false
        do {
            if gated {
                try await withTaskCancellationHandler(operation: {
                    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                        guard !Task.isCancelled else { continuation.resume(throwing: CancellationError()); return }
                        heldRead = (number, continuation)
                    }
                }, onCancel: {
                    Task { @MainActor [weak self] in self?.cancelHeldRead(number: number) }
                })
            }
            try Task.checkCancellation()
        } catch {
            cancelledReads += 1
            throw URLError(.cancelled)
        }
        completedReads += 1
        return response
    }

    func releaseHeldRead() {
        guard let pending = heldRead else { return }
        heldRead = nil
        releasedReads += 1
        pending.continuation.resume()
    }

    private func cancelHeldRead(number: Int) {
        guard let pending = heldRead, pending.number == number else { return }
        heldRead = nil
        pending.continuation.resume(throwing: URLError(.cancelled))
    }

    func saveDocument(tripId: String, document: TripDocument, expectedRevision: Int) async throws -> TripDocumentSnapshot {
        throw APIError.forbidden("합성 새로고침 검증에서는 저장하지 않아요.")
    }
    func dayPlan(tripId: String, dayIndex: Int) async throws -> TripService.Fetched<DayPlanResponse> {
        throw APIError.badRequest("합성 검증은 문서 GET만 사용해요.")
    }
    func cachedDayPlan(tripId: String, dayIndex: Int) async -> DayPlanResponse? { nil }
    func tripRoutes(tripId: String) async throws -> TripRoutesResponse {
        throw APIError.badRequest("합성 검증에서는 지도를 열지 않아요.")
    }

    private static func snapshot(revision: Int, firstName: String) -> TripDocumentSnapshot {
        let spots = (0..<12).map { index in
            JSONValue.object(["name": .string(index == 0 ? firstName : "합성 장소 \(index + 1)"),
                              "city": .string("합성 도시"), "stayMin": .number(15)])
        }
        return .init(document: TripDocument(raw: ["name": .string("합성 새로고침 여행"),
            "start": .string("2026-10-16"), "days": .array([.object(["title": .string("당겨서 새로고침"),
                "spots": .array(spots)])])]), revision: revision, role: .owner)
    }
}
#endif
