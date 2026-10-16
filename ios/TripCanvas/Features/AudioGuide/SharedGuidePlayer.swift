import Foundation
import AVFoundation
import MediaPlayer
import Observation

/// One player survives sheet dismissal, maps and screen lock. Account changes always stop it.
@Observable @MainActor
final class SharedGuidePlayer: NSObject, AVAudioPlayerDelegate {
    static let shared = SharedGuidePlayer()
    private var player: AVAudioPlayer?
    private var resumeKey = ""
    private(set) var fileID: String?
    private(set) var title = ""
    private(set) var accountID: String?
    private(set) var errorMessage: String?
    @ObservationIgnored private var timer: Timer?
    @ObservationIgnored private var observers: [NSObjectProtocol] = []
    var isPlaying: Bool { player?.isPlaying == true }
    var duration: Double { player?.duration ?? 0 }
    var time: Double {
        get { player?.currentTime ?? 0 }
        set { player?.currentTime = max(0, min(newValue, duration)); update() }
    }
    override init() {
        super.init()
        let commands = MPRemoteCommandCenter.shared()
        commands.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.resume() }; return .success
        }
        commands.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.pause() }; return .success
        }
        commands.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let position = event.positionTime
            Task { @MainActor in self?.time = position }; return .success
        }
        observers = [
            NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
                let began = (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue
                if began { Task { @MainActor in self?.pause() } }
            },
            NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] notification in
                let removed = (notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue
                if removed { Task { @MainActor in self?.pause() } }
            }
        ]
    }
    func play(_ file: SharedTripFile, url: URL, account: String) throws {
        if fileID == file.id { if isPlaying { pause() } else { resume() }; return }
        stop(); errorMessage = nil
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            try AVAudioSession.sharedInstance().setActive(true)
            let next = try AVAudioPlayer(contentsOf: url)
            guard next.prepareToPlay(), next.duration > 0 else { throw AudioGuideStore.Failure.unplayable }
            next.delegate = self; player = next; fileID = file.id; title = file.title; accountID = account
            resumeKey = "withj-shared-guide-" + account + "-" + file.id
            let saved = UserDefaults.standard.double(forKey: resumeKey)
            if saved < next.duration - 2 { next.currentTime = saved }
            guard next.play() else { stop(); throw AudioGuideStore.Failure.unplayable }
            timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.update() }
            }
            update()
        } catch {
            stop(); errorMessage = "음성을 재생하지 못했어요. MP3·M4A로 변환해 다시 올려 주세요."
            throw error
        }
    }
    func pause() { player?.pause(); update() }
    func resume() {
        do {
            try AVAudioSession.sharedInstance().setActive(true)
            if time >= duration - 0.1 { time = 0 }
            if player?.play() != true { throw AudioGuideStore.Failure.unplayable }
            update()
        } catch { errorMessage = "음성을 재생하지 못했어요. 파일을 다시 확인해 주세요." }
    }
    func stop() {
        if player != nil { update() }
        timer?.invalidate(); timer = nil; player?.stop(); player = nil; fileID = nil; accountID = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
    private func update() {
        guard let player else { return }
        UserDefaults.standard.set(player.currentTime, forKey: resumeKey)
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: title, MPMediaItemPropertyArtist: "With J",
            MPMediaItemPropertyPlaybackDuration: player.duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: player.currentTime,
            MPNowPlayingInfoPropertyPlaybackRate: player.isPlaying ? 1.0 : 0.0
        ]
    }
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let finished = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard let self, self.player.map(ObjectIdentifier.init) == finished else { return }
            self.player?.currentTime = 0; self.update()
            if !flag { self.errorMessage = "음성을 끝까지 재생하지 못했어요." }
        }
    }
    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        let failed = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard let self, self.player.map(ObjectIdentifier.init) == failed else { return }
            self.stop(); self.errorMessage = "음성을 읽지 못했어요. MP3·M4A로 변환해 다시 올려 주세요."
        }
    }
}
