import AVFoundation
import MediaPlayer
import Observation

/// With J 이야기를 트는 곳. 앱 전체에 **하나**다(`shared`) — 시트를 닫거나 여행을 나가도 계속 들린다
/// (웹 `parkStoryAudio`와 같은 약속). `AppEnvironment`에 두면 Siri 동작이 따로 만드는 환경마다 잠금화면
/// 조작이 한 번씩 더 붙는다.
///
/// - 자동 재생은 없다 — 사람이 누를 때만 튼다(docs/with-j-stories.md).
/// - **지문을 확인한 파일만** 튼다(`StoryLibrary.file(for:placeID:)`). 스트리밍하면 확인 전에 소리가 나온다.
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
    /// `message`가 난 장소 — 다른 장소의 창에는 그 문장을 보이지 않는다(누르지도 않은 곳이 실패했다고 말하게 된다).
    private(set) var messagePlaceID: String?

    @ObservationIgnored private let library: StoryLibrary
    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private let finishDelegate = StoryPlayerFinish()
    @ObservationIgnored private var systemHooked = false
    @ObservationIgnored private var observers: [NSObjectProtocol] = []
    /// 끊긴 순간 듣고 있었으면 그 시각. 짧게 끊었다 돌려주면(길 안내 한 마디) 이어 튼다.
    @ObservationIgnored private var interruptedWhilePlaying: Date?

    /// 이 안에 돌려받으면 이어 튼다. 길 안내는 몇 초다 — 전화처럼 오래 끊긴 뒤에는 저절로 틀지 않는다.
    static let resumeWindow: TimeInterval = 30

    init(library: StoryLibrary) {
        self.library = library
        finishDelegate.onFinish = { [weak self] finished in
            guard let self else { return }
            Task { @MainActor [weak self] in self?.didFinish(finished) }
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
        messagePlaceID = nil
        let key = Self.key(place: place, track: track)
        loadingKey = key
        do {
            // 지문이 바뀐 트랙이면 라이브러리가 카탈로그를 다시 받아 새 트랙으로 준다.
            let (heard, file) = try await library.file(for: track, placeID: place.id)
            // 받는 사이에 다른 이야기를 눌렀으면 이건 버린다
            guard loadingKey == key else { return }
            let next = try AVAudioPlayer(contentsOf: file)
            next.delegate = finishDelegate
            next.prepareToPlay()
            player?.stop()
            player = next
            current = Current(place: library.catalog.place(id: place.id) ?? place, track: heard)
            hookSystemIfNeeded()
            setRemoteCommands(enabled: true)
            activateSession()
            isPlaying = next.play()
            loadingKey = nil
            updateNowPlaying()
        } catch {
            guard loadingKey == key else { return }
            loadingKey = nil
            messagePlaceID = place.id
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
        messagePlaceID = nil
        interruptedWhilePlaying = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        // 듣는 것이 없는데 잠금화면·이어폰 버튼을 받아 두면, 눌러도 아무 일이 없고 다른 앱으로도 넘어가지 않는다.
        setRemoteCommands(enabled: false)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// 트랙 하나를 다 들었다. 그사이 다른 트랙으로 바꿨으면 그 트랙의 일이 아니다 — 막 튼 새 트랙을 처음으로 되감지 않는다.
    private func didFinish(_ finished: ObjectIdentifier) {
        guard let player, ObjectIdentifier(player) == finished else { return }
        isPlaying = false
        player.currentTime = 0
        updateNowPlaying()
        // 세션을 놓아야 이야기 때문에 끊긴 음악·팟캐스트가 다시 이어진다. 다시 누르면 `resume()`이 켠다.
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func setRemoteCommands(enabled: Bool) {
        let center = MPRemoteCommandCenter.shared()
        for command in [center.playCommand, center.pauseCommand, center.togglePlayPauseCommand, center.skipBackwardCommand] {
            command.isEnabled = enabled
        }
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
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw), let self else { return }
            let options = AVAudioSession.InterruptionOptions(rawValue: note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
            Task { @MainActor [weak self] in
                switch type {
                case .began: self?.interrupted()
                case .ended: self?.interruptionEnded(shouldResume: options.contains(.shouldResume))
                @unknown default: break
                }
            }
        })
        observers.append(notifications.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            // 이어폰을 뽑았다 — 스피커로 이어 나오지 않게 멈춘다.
            guard raw == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue, let self else { return }
            Task { @MainActor [weak self] in self?.pause() }
        })
    }

    /// 끊겼다 — 시스템이 이미 멈췄다.
    private func interrupted() {
        interruptedWhilePlaying = isPlaying ? Date() : nil
        isPlaying = false
        updateNowPlaying()
    }

    /// 돌려받았다. `.spokenAudio`라 길 안내(지도 도보 안내)가 말할 때마다 이야기가 끊기는데, 시스템이 이어도 된다고
    /// 하고(`shouldResume`) 짧게 끊겼을 때만 이어 튼다. 전화처럼 오래 끊긴 뒤에는 저절로 틀지 않는다(누를 때만 튼다).
    private func interruptionEnded(shouldResume: Bool) {
        defer { interruptedWhilePlaying = nil }
        guard shouldResume, let since = interruptedWhilePlaying,
              Date().timeIntervalSince(since) <= Self.resumeWindow else { return }
        resume()
    }
}

/// `AVAudioPlayerDelegate`는 NSObject여야 한다. `@Observable` 클래스가 NSObject를 물려받지 않게 따로 둔다.
private final class StoryPlayerFinish: NSObject, AVAudioPlayerDelegate {
    /// 끝난 재생기 — 그사이 바꾼 새 트랙과 가린다.
    var onFinish: ((ObjectIdentifier) -> Void)?

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        onFinish?(ObjectIdentifier(player))
    }
}
