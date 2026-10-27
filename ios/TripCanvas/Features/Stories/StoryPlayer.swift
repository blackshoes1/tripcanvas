import AVFoundation
import MediaPlayer
import Observation

/// With J 이야기를 트는 곳. 앱 전체에 **하나**다(`shared`) — 시트를 닫거나 여행을 나가도 계속 들린다
/// (웹 `parkStoryAudio`와 같은 약속). `AppEnvironment`에 두면 Siri 동작이 따로 만드는 환경마다 잠금화면
/// 조작이 한 번씩 더 붙는다.
///
/// - 자동 재생은 없다 — 사람이 누를 때만 튼다(docs/with-j-stories.md).
/// - **지문을 확인한 파일만** 튼다(`StoryLibrary.file(for:)`). 스트리밍하면 확인 전에 소리가 나온다.
/// - 화면이 꺼져도 들린다(`UIBackgroundModes: audio`, `project.yml`). 전화가 오거나 이어폰을 뽑으면 멈춘다 —
///   성당 안에서 스피커로 이어 나오면 안 된다.
@Observable
@MainActor
final class StoryPlayer {
    static let shared = StoryPlayer(library: .shared)

    struct Current: Equatable {
        let place: StoryPlace
        let track: StoryTrack
    }

    private(set) var current: Current?
    private(set) var isPlaying = false
    /// 받는 중인 트랙(`key(place:track:)`) — 그 줄에 '불러오는 중'을 보인다.
    private(set) var loadingKey: String?
    /// 마지막으로 실패한 까닭(웹과 같은 문장). 새로 누르면 지운다.
    private(set) var message: String?

    @ObservationIgnored private let library: StoryLibrary
    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private let finishDelegate = StoryPlayerFinish()
    @ObservationIgnored private var systemHooked = false
    @ObservationIgnored private var observers: [NSObjectProtocol] = []

    init(library: StoryLibrary) {
        self.library = library
        finishDelegate.onFinish = { [weak self] in
            guard let self else { return }
            Task { @MainActor [weak self] in self?.didFinish() }
        }
    }

    static func key(place: StoryPlace, track: StoryTrack) -> String { place.id + "/" + track.id }

    func isCurrent(place: StoryPlace, track: StoryTrack) -> Bool {
        current?.place.id == place.id && current?.track.id == track.id
    }

    /// 지금 몇 초째인가 · 전체 몇 초인가. 관찰하지 않는 값이라 화면은 `TimelineView`로 1초마다 읽는다.
    var elapsed: TimeInterval { player?.currentTime ?? 0 }
    var duration: TimeInterval { player?.duration ?? TimeInterval(current?.track.seconds ?? 0) }

    /// 누른 트랙을 튼다. 지금 그 트랙이면 멈춘 자리에서 잇는다.
    func play(_ track: StoryTrack, in place: StoryPlace) async {
        if isCurrent(place: place, track: track), player != nil {
            resume()
            return
        }
        message = nil
        let key = Self.key(place: place, track: track)
        loadingKey = key
        do {
            let file = try await library.file(for: track)
            // 받는 사이에 다른 이야기를 눌렀으면 이건 버린다
            guard loadingKey == key else { return }
            let next = try AVAudioPlayer(contentsOf: file)
            next.delegate = finishDelegate
            next.prepareToPlay()
            player?.stop()
            player = next
            current = Current(place: place, track: track)
            hookSystemIfNeeded()
            activateSession()
            isPlaying = next.play()
            loadingKey = nil
            updateNowPlaying()
        } catch {
            guard loadingKey == key else { return }
            loadingKey = nil
            message = (error as? StoryLibraryError) == .integrity
                ? "음성을 끝까지 받지 못했어요. 다시 눌러 주세요."
                : "음성을 불러오지 못했어요. 인터넷에 연결된 뒤 다시 눌러 주세요 — 한 번 들은 이야기는 오프라인에서도 들려요."
        }
    }

    func pause() {
        player?.pause()
        isPlaying = false
        updateNowPlaying()
    }

    func resume() {
        guard let player else { return }
        activateSession()
        isPlaying = player.play()
        updateNowPlaying()
    }

    func togglePlayback() {
        if isPlaying { pause() } else { resume() }
    }

    /// 15초 뒤로 — 놓친 문장을 다시 듣는다.
    func rewind(_ seconds: TimeInterval = 15) {
        guard let player else { return }
        player.currentTime = max(0, player.currentTime - seconds)
        updateNowPlaying()
    }

    /// 듣기 끝내기 — 막대가 사라지고 잠금화면의 재생 정보도 걷는다.
    func stop() {
        // 듣는 것이 없으면 아무것도 건드리지 않는다 — 계정 전환이 늘 부르므로 남의 오디오 세션을 끄면 안 된다.
        guard player != nil || current != nil || loadingKey != nil else { return }
        player?.stop()
        player = nil
        current = nil
        isPlaying = false
        loadingKey = nil
        message = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func didFinish() {
        isPlaying = false
        player?.currentTime = 0
        updateNowPlaying()
    }

    private func activateSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio)
        try? session.setActive(true)
    }

    /// 잠금화면·제어 센터의 재생 정보.
    private func updateNowPlaying() {
        guard let current, let player else { return }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: current.track.title,
            MPMediaItemPropertyArtist: current.place.name,
            MPMediaItemPropertyAlbumTitle: "With J 이야기",
            MPMediaItemPropertyPlaybackDuration: player.duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: player.currentTime,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
        ]
    }

    /// 잠금화면 조작과 끊김·이어폰 처리는 **처음 틀 때** 한 번만 붙인다 — 듣지 않는 사람에게는 붙이지 않는다.
    private func hookSystemIfNeeded() {
        guard !systemHooked else { return }
        systemHooked = true
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            Task { @MainActor [weak self] in self?.resume() }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            Task { @MainActor [weak self] in self?.pause() }
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            Task { @MainActor [weak self] in self?.togglePlayback() }
            return .success
        }
        center.skipBackwardCommand.preferredIntervals = [15]
        center.skipBackwardCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            Task { @MainActor [weak self] in self?.rewind() }
            return .success
        }
        center.nextTrackCommand.isEnabled = false
        center.previousTrackCommand.isEnabled = false

        let notifications = NotificationCenter.default
        observers.append(notifications.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            guard raw == AVAudioSession.InterruptionType.began.rawValue, let self else { return }
            Task { @MainActor [weak self] in self?.interrupted() }
        })
        observers.append(notifications.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            // 이어폰을 뽑았다 — 스피커로 이어 나오지 않게 멈춘다.
            guard raw == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue, let self else { return }
            Task { @MainActor [weak self] in self?.pause() }
        })
    }

    /// 전화 등으로 끊겼다 — 시스템이 이미 멈췄다. 저절로 다시 틀지 않는다(누를 때만 튼다).
    private func interrupted() {
        isPlaying = false
        updateNowPlaying()
    }
}

/// `AVAudioPlayerDelegate`는 NSObject여야 한다. `@Observable` 클래스가 NSObject를 물려받지 않게 따로 둔다.
private final class StoryPlayerFinish: NSObject, AVAudioPlayerDelegate {
    var onFinish: (() -> Void)?

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        onFinish?()
    }
}
