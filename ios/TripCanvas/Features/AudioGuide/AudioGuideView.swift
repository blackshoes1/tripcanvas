import SwiftUI
import AVFoundation
import Observation
import UniformTypeIdentifiers

/// 한 번에 한 음성만 재생한다. 화면을 닫거나 계정을 바꾸면 멈춘다.
@Observable @MainActor
final class AudioGuidePlayer: NSObject, AVAudioPlayerDelegate {
    private var player: AVAudioPlayer?
    @ObservationIgnored private var observers: [NSObjectProtocol] = []
    private(set) var guideID: UUID?
    private(set) var errorMessage: String?
    var rate: Float = 1 {
        didSet { player?.rate = rate }
    }
    var time: Double {
        get { player?.currentTime ?? 0 }
        set { player?.currentTime = max(0, min(newValue, player?.duration ?? 0)) }
    }
    var isPlaying: Bool { player?.isPlaying == true }

    override init() {
        super.init()
        observers = [
            NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notice in
                let began = (notice.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue
                if began { Task { @MainActor [weak self] in self?.player?.pause() } }
            },
            NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] notice in
                let disconnected = (notice.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue
                if disconnected { Task { @MainActor [weak self] in self?.player?.pause() } }
            }
        ]
    }

    deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }

    func toggle(_ guide: LocalAudioGuide, url: URL) {
        errorMessage = nil
        if guideID == guide.id, let player {
            if player.isPlaying { player.pause() }
            else {
                if player.currentTime >= player.duration - 0.05 { player.currentTime = 0 }
                do {
                    try AVAudioSession.sharedInstance().setActive(true)
                    guard player.play() else { throw AudioGuideStore.Failure.unplayable }
                } catch {
                    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
                    errorMessage = "음성을 재생하지 못했어요. 파일을 다시 확인해 주세요."
                }
            }
            return
        }
        stop()
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            try AVAudioSession.sharedInstance().setActive(true)
            let next = try AVAudioPlayer(contentsOf: url)
            next.delegate = self
            next.enableRate = true
            next.rate = rate
            guard next.prepareToPlay(), next.play() else { throw AudioGuideStore.Failure.unplayable }
            player = next; guideID = guide.id
        } catch {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            errorMessage = "음성을 재생하지 못했어요. MP3나 M4A 파일로 다시 추가해 주세요."
        }
    }
    func stop() {
        player?.stop(); player = nil; guideID = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let finished = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard let self, self.player.map(ObjectIdentifier.init) == finished else { return }
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            if !flag { self.errorMessage = "음성이 끝까지 재생되지 않았어요. 파일을 확인해 주세요." }
        }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        let failed = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard let self, self.player.map(ObjectIdentifier.init) == failed else { return }
            self.stop()
            self.errorMessage = "음성을 읽지 못했어요. 파일을 다시 추가해 주세요."
        }
    }
}

struct AudioGuideButton: View {
    let tripID: String
    let spot: TripSpot
    @State private var showsGuides = false
    var body: some View {
        Button { showsGuides = true } label: {
            Label("음성 가이드", systemImage: "headphones").frame(minHeight: 44)
        }
        .disabled(!AudioGuidePlace.canIdentify(spot))
        .accessibilityHint(AudioGuidePlace.canIdentify(spot) ? "이 장소에 음성을 연결하거나 재생해요" : "장소의 이름이나 위치를 먼저 정해 주세요")
        .accessibilityIdentifier("placeAudioGuides")
        .sheet(isPresented: $showsGuides) { SharedTripFilesView(tripID: tripID, spot: spot) }
    }
}

@MainActor
struct AudioGuideView: View {
    let tripID: String
    let spot: TripSpot
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @State private var guides: [LocalAudioGuide] = []
    @State private var player = AudioGuidePlayer()
    @State private var showsImporter = false
    @State private var deleting: LocalAudioGuide?
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var playbackGeneration = 0
    @State private var isVisible = false
    private var scope: AudioGuideScope? {
        guard AudioGuidePlace.canIdentify(spot) else { return nil }
        return env.auth.session.map { AudioGuideScope(accountID: $0.userId, tripID: tripID) }
    }
    private var placeKey: String { AudioGuidePlace.key(spot) }

    var body: some View {
        NavigationStack {
            PaperList {
                Section {
                    Text(spot.name).font(.headline)
                    if !spot.city.isEmpty { Text(spot.city).font(.subheadline).foregroundStyle(Ink.soft) }
                } footer: {
                    Text("이 장소에 직접 준비한 음성을 연결해요. 파일은 이 iPhone에만 저장돼요. PC·다른 기기에서는 따로 추가해 주세요.")
                }
                if !AudioGuidePlace.canIdentify(spot) {
                    Section { Text("장소의 이름이나 위치를 먼저 정해 주세요.").foregroundStyle(Ink.warning) }
                }
                Section {
                    Button { showsImporter = true } label: {
                        Label(busy ? "음성을 저장하는 중…" : "음성 파일 추가", systemImage: "plus.circle")
                            .frame(minHeight: 44)
                    }.disabled(busy || scope == nil)
                    if busy { ProgressView() }
                } footer: {
                    Text("파일 앱에서 MP3·M4A·WAV 등을 골라 주세요. 파일 하나에 100MB까지 담을 수 있고, 저장 뒤에는 인터넷 없이 들을 수 있어요.")
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(Ink.warning) }
                }
                if guides.isEmpty, !busy {
                    Section { Text("아직 연결한 음성이 없어요.").foregroundStyle(Ink.soft) }
                }
                ForEach(guides) { guide in
                    Section {
                        Text(guide.title).font(.subheadline.weight(.semibold))
                        Text("\(clock(guide.duration)) · \(ByteCountFormatter.string(fromByteCount: Int64(guide.bytes), countStyle: .file))")
                            .font(.caption).foregroundStyle(Ink.soft)
                        TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                            VStack(alignment: .leading, spacing: Space.s) {
                                Button {
                                    Task { await play(guide) }
                                } label: {
                                    Label(player.guideID == guide.id && player.isPlaying ? "일시정지" : "듣기",
                                          systemImage: player.guideID == guide.id && player.isPlaying ? "pause.fill" : "play.fill")
                                        .frame(minHeight: 44)
                                }.disabled(busy)
                                if player.guideID == guide.id {
                                    Slider(value: Binding(get: { player.time }, set: { player.time = $0 }),
                                           in: 0...max(guide.duration, 1))
                                        .accessibilityLabel("재생 위치")
                                    Text("\(clock(player.time)) / \(clock(guide.duration))")
                                        .font(.caption.monospacedDigit()).foregroundStyle(Ink.soft)
                                    Picker("재생 속도", selection: $player.rate) {
                                        Text("1배").tag(Float(1)); Text("1.25배").tag(Float(1.25)); Text("1.5배").tag(Float(1.5))
                                    }.pickerStyle(.segmented)
                                }
                            }
                        }
                        Button("이 음성 삭제", role: .destructive) { deleting = guide }
                            .frame(minHeight: 44).disabled(busy)
                    }
                }
                if let message = player.errorMessage {
                    Section { Text(message).foregroundStyle(Ink.warning) }
                }
            }
            .navigationTitle("음성 가이드")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("닫기") { dismiss() } } }
        }
        .fileImporter(isPresented: $showsImporter, allowedContentTypes: [.audio], allowsMultipleSelection: true) { result in
            switch result {
            case .success(let urls): Task { await add(urls) }
            case .failure: errorMessage = "파일을 열지 못했어요. 파일 앱에서 내려받은 뒤 다시 골라 주세요."
            }
        }
        .confirmationDialog("이 iPhone에서 음성을 삭제할까요?", isPresented: Binding(
            get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            if let deleting {
                Button("음성 삭제", role: .destructive) { Task { await remove(deleting) } }
            }
            Button("취소", role: .cancel) { deleting = nil }
        } message: { Text("원본 파일과 여행 일정은 그대로 남아요.") }
        .task { await reload() }
        .onAppear { isVisible = true; playbackGeneration += 1 }
        .onDisappear { endPlayback() }
        .onChange(of: env.service.cacheScope) { _, _ in endPlayback(); dismiss() }
        .onChange(of: env.auth.session?.userId) { _, _ in endPlayback(); dismiss() }
    }

    @MainActor private func reload() async {
        guard let scope else { guides = []; return }
        let accountGeneration = env.service.cacheScope
        do {
            let result = try await AudioGuideStore.shared.list(scope: scope, placeKey: placeKey)
            guard scope == self.scope, accountGeneration == env.service.cacheScope else { return }
            guides = result
        } catch { errorMessage = message(error) }
    }
    @MainActor private func add(_ urls: [URL]) async {
        guard let scope, !busy else { return }
        let accountGeneration = env.service.cacheScope
        busy = true; errorMessage = nil
        defer { busy = false }
        var failures: [String] = []
        for url in urls {
            guard scope == self.scope, accountGeneration == env.service.cacheScope else { return }
            do { _ = try await AudioGuideStore.shared.add(url: url, scope: scope, placeKey: placeKey) }
            catch { failures.append("\(url.lastPathComponent): \(message(error))") }
        }
        guard scope == self.scope, accountGeneration == env.service.cacheScope else { return }
        await reload()
        if !failures.isEmpty { errorMessage = failures.joined(separator: "\n") }
    }
    @MainActor private func remove(_ guide: LocalAudioGuide) async {
        guard let scope, !busy else { return }
        deleting = nil; busy = true; errorMessage = nil
        playbackGeneration += 1
        defer { busy = false }
        if player.guideID == guide.id { player.stop() }
        do { try await AudioGuideStore.shared.remove(id: guide.id, scope: scope); await reload() }
        catch { errorMessage = message(error) }
    }
    @MainActor private func play(_ guide: LocalAudioGuide) async {
        guard let scope, isVisible else { return }
        playbackGeneration += 1
        let request = playbackGeneration, accountGeneration = env.service.cacheScope
        do {
            let url = try await AudioGuideStore.shared.fileURL(id: guide.id, scope: scope)
            guard isVisible, request == playbackGeneration, scope == self.scope,
                  accountGeneration == env.service.cacheScope else { return }
            player.toggle(guide, url: url)
        } catch {
            guard isVisible, request == playbackGeneration, scope == self.scope,
                  accountGeneration == env.service.cacheScope else { return }
            errorMessage = message(error)
        }
    }
    @MainActor private func endPlayback() {
        isVisible = false; playbackGeneration += 1; player.stop()
    }
    private func message(_ error: Error) -> String {
        (error as? AudioGuideStore.Failure)?.errorDescription ?? "음성을 저장하거나 읽지 못했어요. 기기 저장 공간과 파일 상태를 확인해 주세요."
    }
    private func clock(_ seconds: Double) -> String {
        let value = max(0, Int(seconds.isFinite ? seconds : 0))
        return String(format: "%d:%02d", value / 60, value % 60)
    }
}

/// 오늘의 다음 장소를 원문과 맞춘 뒤 연다. 위치 인덱스를 영구 저장하지 않는다.
struct TodayAudioGuideButton: View {
    let tripID: String
    let activityID: String
    let expectedName: String
    let revision: Int
    @Environment(AppEnvironment.self) private var env
    @Environment(TripScreenModels.self) private var screenModels: TripScreenModels?
    @State private var spot: TripSpot?
    @State private var showsGuides = false
    @State private var loading = false
    @State private var errorMessage: String?
    @State private var generation = 0
    @State private var isVisible = false
    private var identity: String { "\(tripID)|\(activityID)|\(expectedName)|\(revision)" }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Button { Task { await open() } } label: {
                Label(loading ? "장소 확인 중…" : "음성 가이드", systemImage: "headphones").frame(minHeight: 44)
            }.disabled(loading).accessibilityIdentifier("todayAudioGuides")
            if let errorMessage { Text(errorMessage).font(.caption).foregroundStyle(Ink.warning) }
        }
        .sheet(isPresented: $showsGuides) {
            if let spot { SharedTripFilesView(tripID: tripID, spot: spot) }
        }
        .onChange(of: env.service.cacheScope) { _, _ in reset() }
        .onChange(of: env.auth.session?.userId) { _, _ in reset() }
        .onChange(of: identity) { _, _ in reset() }
        .onAppear { isVisible = true; generation += 1 }
        .onDisappear { isVisible = false; generation += 1; loading = false }
    }
    @MainActor private func reset() {
        generation += 1; loading = false; showsGuides = false; spot = nil; errorMessage = nil
    }
    @MainActor private func open() async {
        guard isVisible else { return }
        generation += 1
        let request = generation, account = env.auth.session?.userId, scope = env.service.cacheScope
        loading = true; errorMessage = nil
        defer { if request == generation { loading = false } }
        do {
            let document: TripDocument, documentRevision: Int
            if let plan = screenModels?.plan, plan.tripId == tripID, let cached = plan.document, plan.revision == revision {
                document = cached; documentRevision = plan.revision
            } else {
                let snapshot = try await env.service.document(tripId: tripID)
                document = snapshot.document; documentRevision = snapshot.revision
            }
            guard isVisible, request == generation, account == env.auth.session?.userId, scope == env.service.cacheScope else { return }
            spot = try AudioGuidePlace.resolve(document: document, documentRevision: documentRevision,
                activityID: activityID, expectedName: expectedName, expectedRevision: revision)
            showsGuides = true
        } catch {
            guard isVisible, request == generation, account == env.auth.session?.userId, scope == env.service.cacheScope else { return }
            errorMessage = (error as? StaffShowSelection.Failure)?.errorDescription ?? "장소 정보를 열지 못했어요. 연결 상태를 확인한 뒤 다시 눌러 주세요."
        }
    }
}
