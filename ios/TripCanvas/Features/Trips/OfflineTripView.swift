import SwiftUI

struct OfflineTripView: View {
    let trip: TripSummary
    let service: TripService
    let model: TripPlanViewModel
    @State private var pack: OfflineTrip?
    @State private var isWorking = false
    @State private var completed = 0
    @State private var total = 0
    @State private var error: String?
    @State private var download: Task<Void, Never>?

    private var latestRevision: Int { model.document == nil ? trip.revision : model.revision }
    var body: some View {
        List {
            Section {
                if let pack {
                    Label(pack.detail.trip.revision == latestRevision ? "오프라인 준비 완료" : "새로운 변경이 있어요", systemImage: pack.detail.trip.revision == latestRevision ? "checkmark.circle.fill" : "arrow.triangle.2.circlepath")
                    Text("\(pack.savedAt.formatted(date: .abbreviated, time: .shortened))에 저장한 사본").font(.caption)
                    Text("\(pack.plans.count)일 일정 · 예약 \(pack.bookings.count)개 · 준비 메모 \(TripNote.notes(in: TripDocument(raw: pack.detail.document)).count)개")
                } else { Text("아직 여행 전체를 저장하지 않았어요") }
                Text("일정·예약·저장된 주소·준비 메모를 인터넷 없이 읽을 수 있어요. 편집과 최신 정보 확인에는 연결이 필요해요.")
            }
            Section {
                if isWorking {
                    ProgressView(value: Double(completed), total: Double(max(1, total)))
                    Text("일정 \(completed)/\(total)일 준비 중…")
                    Button("중단") { download?.cancel() }
                } else {
                    Button(pack == nil ? "오프라인 준비하기" : "최신 내용으로 다시 준비") {
                        isWorking = true; error = nil
                        download = Task {
                            defer { isWorking = false }
                            do {
                                pack = try await service.prepareOffline(tripId: trip.id) { completed = $0; total = $1 }
                            } catch is CancellationError { error = "중단했어요. 이전에 저장한 사본은 그대로 남아 있어요." }
                            catch { self.error = error.localizedDescription }
                        }
                    }
                }
                if let error { Text(error).foregroundStyle(.red) }
            } footer: {
                Text("지도 타일·길찾기·장소 사진은 포함하지 않아요. 저장 후 다른 기기에서 바뀐 내용은 온라인에서 다시 준비해야 반영돼요. 기기의 캐시 정리 또는 로그아웃으로 사본이 지워질 수 있어요.")
            }
        }
        .navigationTitle("오프라인 준비")
        .task { pack = await service.offlineTrip(trip.id); await model.loadIfStale() }
        .onDisappear { download?.cancel() }
    }
}
