import SwiftUI

/// 이야기 창을 여는 표. 장소 id만 든다 — 내용은 언제나 지금 카탈로그에서 다시 찾는다.
struct StoryTarget: Identifiable, Hashable {
    let id: String
}

/// '🎧 With J 이야기 듣기' — 장소 정보·편집기·지금 화면이 같은 모양으로 쓴다(웹 `storyButtonHtml`).
/// 붙는 장소가 아니면 아무것도 그리지 않는다.
struct StoryOpenButton: View {
    let spot: StorySpot
    var title = "With J 이야기 듣기"
    /// 창을 대신 띄울 곳. 이 버튼이 다시 받기로 계층에서 빠질 수 있는 화면(`지금` 카드 — 다음 일정이 바뀌면
    /// 버튼이 사라진다)은 넘긴다 — 띄운 뷰가 빠지면 SwiftUI가 창도 내린다. 없으면 버튼이 직접 띄운다.
    var onOpen: ((String) -> Void)? = nil
    /// 여행 화면 밖(디버그 하네스 등)에서 열리면 없다 — 그때는 아무것도 그리지 않는다.
    @Environment(AppEnvironment.self) private var env: AppEnvironment?
    @State private var target: StoryTarget?

    var body: some View {
        if let place = env?.stories.catalog.story(for: spot) {
            Button {
                if let onOpen { onOpen(place.id) } else { target = StoryTarget(id: place.id) }
            } label: {
                Label(title, systemImage: "headphones")
                    .frame(minHeight: 44)
            }
            .accessibilityIdentifier("storyOpen")
            .accessibilityHint("\(place.name) 해설 목록 열기")
            .sheet(item: $target) { StorySheet(placeID: $0.id) }
        }
    }
}

/// 이야기 한 곳의 창 — 트랙 목록·지금 듣는 것·오프라인 저장·출처(웹 `#storyDialog`).
struct StorySheet: View {
    let placeID: String
    @Environment(AppEnvironment.self) private var env: AppEnvironment?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if let env, let place = env.stories.catalog.place(id: placeID) {
                    StorySheetBody(place: place, library: env.stories, player: env.storyPlayer)
                } else {
                    EmptyStateView(symbol: "headphones", title: "이야기를 찾지 못했어요",
                                   message: "인터넷에 연결된 뒤 다시 열어 주세요.")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Ink.paper)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("닫기") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
        .task { await env?.stories.loadIfNeeded() }
    }
}

/// 창의 내용. 카탈로그·재생기를 받아 그리기만 한다 — 관찰은 `body`가 읽는 값으로 저절로 걸린다.
private struct StorySheetBody: View {
    let place: StoryPlace
    let library: StoryLibrary
    let player: StoryPlayer
    /// 저장 중이면 몇 편째인가. 창 안에서만 쓰는 상태다.
    @State private var saving: Int?
    @State private var saveFailures = 0

    var body: some View { content(place) }

    private func content(_ place: StoryPlace) -> some View {
        PaperList {
            Section {
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text("With J 이야기")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Ink.accent)
                    Text(place.name)
                        .font(Typeface.editorial(.title2))
                        .foregroundStyle(Ink.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text(subtitle(place)).font(.caption).foregroundStyle(Ink.soft)
                }
                .padding(.vertical, Space.xs)
                statusLine(place)
                if let current = player.current, current.place.id == place.id {
                    StoryPlaybackControls(player: player)
                }
            }
            ForEach(groups(place), id: \.role) { group in
                Section {
                    ForEach(group.tracks) { track in trackRow(track, in: place) }
                } header: {
                    // 묶음이 하나뿐이면 머리를 달지 않는다(웹과 같다).
                    if groups(place).count > 1 {
                        Text(group.role.label).font(.headline).foregroundStyle(Ink.ink).textCase(nil)
                    }
                }
            }
            Section { saveRow(place) } footer: { saveNote(place) }
            sourcesSection(place)
        }
    }

    /// `Plaza de España · 2편 · 3분 4초`
    private func subtitle(_ place: StoryPlace) -> String {
        [place.localName, "\(place.tracks.count)편 · \(StoryRules.durationText(place.totalSeconds))"]
            .filter { !$0.isEmpty }.joined(separator: " · ")
    }

    @ViewBuilder
    private func statusLine(_ place: StoryPlace) -> some View {
        if let message = player.message, player.messagePlaceID == place.id {
            Label(message, systemImage: "exclamationmark.circle")
                .font(.subheadline).foregroundStyle(Ink.warning)
                .fixedSize(horizontal: false, vertical: true)
        } else if let current = player.current, current.place.id == place.id {
            Text("지금 듣는 이야기 · \(current.track.title)")
                .font(.subheadline).foregroundStyle(Ink.soft)
        } else {
            Text("듣고 싶은 이야기를 눌러 주세요.").font(.subheadline).foregroundStyle(Ink.soft)
        }
    }

    private struct TrackGroup {
        let role: StoryRole
        let tracks: [StoryTrack]
    }

    /// 핵심 → 더 듣기 → 관람 지점. 정규화가 이미 그 순서로 줄 세웠다.
    private func groups(_ place: StoryPlace) -> [TrackGroup] {
        StoryRole.allCases.compactMap { role in
            let tracks = place.tracks.filter { $0.role == role }
            return tracks.isEmpty ? nil : TrackGroup(role: role, tracks: tracks)
        }
    }

    private func trackRow(_ track: StoryTrack, in place: StoryPlace) -> some View {
        let isCurrent = player.isCurrent(place: place, track: track)
        let playing = isCurrent && player.isPlaying
        let loading = player.loadingKey == StoryPlayer.key(place: place, track: track)
        let title = (track.stop.map { String(format: "%02d · ", $0.n) } ?? "") + track.title
        let meta = [playing ? "듣는 중" : nil, StoryRules.durationText(track.seconds), track.stop?.localName]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        return Button {
            if isCurrent { player.togglePlayback() } else { Task { await player.play(track, in: place) } }
        } label: {
            HStack(alignment: .top, spacing: Space.m) {
                ZStack {
                    RoundedRectangle(cornerRadius: Radius.small).fill(Ink.accent.opacity(0.12))
                    if loading {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: playing ? "speaker.wave.2.fill" : (isCurrent ? "pause.fill" : "play.fill"))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Ink.accent)
                    }
                }
                .frame(width: 32, height: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.body).foregroundStyle(Ink.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(meta).font(.caption).foregroundStyle(Ink.soft)
                    if let find = track.stop?.find, !find.isEmpty {
                        Text("찾는 법: " + find.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Ink.soft)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
                if library.isSaved(track) {
                    Image(systemName: "arrow.down.circle.fill")
                        .font(.caption)
                        .foregroundStyle(Ink.faint)
                        .accessibilityLabel("저장됨")
                }
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(loading)
        .accessibilityElement(children: .combine)
        .accessibilityValue(playing ? "듣는 중" : (loading ? "불러오는 중" : ""))
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
    }

    /// 오프라인 저장 — 다 담겼으면 그렇다고만 말한다(웹 `renderStorySave`).
    @ViewBuilder
    private func saveRow(_ place: StoryPlace) -> some View {
        let total = place.tracks.count
        let saved = library.savedCount(place)
        if saved == total {
            Label("오프라인에서도 들을 수 있어요", systemImage: "checkmark.circle")
                .font(.subheadline).foregroundStyle(Ink.positive)
        } else if let saving {
            HStack(spacing: Space.s) {
                ProgressView().controlSize(.small)
                Text("저장 중 \(saving)/\(total)").font(.subheadline).foregroundStyle(Ink.soft)
            }
            .frame(minHeight: 44)
        } else {
            SecondaryActionButton(title: saveFailures > 0 ? "다시 저장하기" : "이 장소 이야기 저장 · 약 \(StoryRules.sizeText(place.totalBytes))",
                                  systemImage: "arrow.down.circle") {
                Task { await save(place) }
            }
            .listRowInsets(EdgeInsets(top: Space.s, leading: Space.l, bottom: Space.s, trailing: Space.l))
        }
    }

    @ViewBuilder
    private func saveNote(_ place: StoryPlace) -> some View {
        let total = place.tracks.count
        let saved = library.savedCount(place)
        if saved < total {
            if saveFailures > 0 {
                Text("\(saveFailures)편을 저장하지 못했어요. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.")
            } else if saved > 0 {
                Text("\(total)편 중 \(saved)편은 이미 저장했어요. 비행기 모드에서도 들으려면 나머지도 저장해 주세요.")
            } else {
                Text("여행지에 가기 전에 와이파이에서 저장해 두면 비행기 모드에서도 들려요.")
            }
        }
    }

    private func save(_ place: StoryPlace) async {
        saveFailures = 0
        var failed = 0
        for (index, track) in place.tracks.enumerated() {
            saving = index + 1
            do { _ = try await library.file(for: track, placeID: place.id) } catch { failed += 1 }
        }
        saving = nil
        saveFailures = failed
    }

    @ViewBuilder
    private func sourcesSection(_ place: StoryPlace) -> some View {
        let sources = library.catalog.sources(of: place)
        Section {
            DisclosureGroup {
                ForEach(sources, id: \.id) { source in
                    if let url = SafeURL.web(source.url) {
                        Link(destination: url) {
                            Label(source.title, systemImage: "arrow.up.right.square")
                                .frame(minHeight: 44, alignment: .leading)
                        }
                    }
                }
                Text("With J가 쓰고 사람이 검수한 해설을 AI 음성으로 읽었어요. 현장 안내와 다르면 현장 안내를 따라 주세요.")
                    .font(.caption).foregroundStyle(Ink.soft)
                    .fixedSize(horizontal: false, vertical: true)
            } label: {
                Text("\(library.catalog.disclosure) · 출처 \(sources.count)건")
                    .font(.subheadline).foregroundStyle(Ink.soft)
            }
        }
    }
}

/// 지금 듣는 이야기의 조작 — 진행·15초 뒤로·재생/일시정지·끝내기. 창과 아래 막대가 같이 쓴다.
struct StoryPlaybackControls: View {
    let player: StoryPlayer
    var compact = false

    var body: some View {
        // 진행은 관찰하는 값이 아니다 — 1초마다 다시 읽는다(타이머를 모델에 두지 않는다).
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            let total = max(player.duration, 1)
            let elapsed = min(player.elapsed, total)
            VStack(spacing: Space.xs) {
                if !compact {
                    ProgressView(value: elapsed, total: total)
                        .tint(Ink.accent)
                        .accessibilityLabel("진행")
                        .accessibilityValue("\(StoryRules.durationText(Int(elapsed))) / \(StoryRules.durationText(Int(total)))")
                    HStack {
                        Text(StoryRules.durationText(Int(elapsed)))
                        Spacer()
                        Text(StoryRules.durationText(Int(total)))
                    }
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(Ink.faint)
                    .accessibilityHidden(true)
                }
                // ⚠️ plain 버튼은 그려진 기호만 눌린다 — `.contentShape`가 있어야 44pt 칸 전체가 눌린다.
                HStack(spacing: Space.l) {
                    Button { player.rewind() } label: {
                        Image(systemName: "gobackward.15").frame(width: 44, height: 44).contentShape(Rectangle())
                    }
                    .accessibilityLabel("15초 뒤로")
                    Button { player.togglePlayback() } label: {
                        Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                            .font(.largeTitle)
                            .frame(width: 52, height: 52)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel(player.isPlaying ? "일시정지" : "재생")
                    Button { player.stop() } label: {
                        Image(systemName: "stop.circle").frame(width: 44, height: 44).contentShape(Rectangle())
                    }
                    .accessibilityLabel("듣기 끝내기")
                }
                .font(.title3)
                .foregroundStyle(Ink.accent)
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity)
            }
        }
    }
}

/// 창을 닫아도 계속 들린다 — 탭 바 바로 위에 뜨는 막대(웹 `#storyBar`).
/// 이름을 누르면 그 장소의 창이 다시 열린다.
///
/// ⚠️ 창은 막대가 띄우지 않는다(`onOpen`). 막대는 듣는 것이 없으면 계층에서 빠지는데, 띄운 뷰가 빠지면
/// SwiftUI가 그 창도 내린다 — 막대에서 연 창에서 '듣기 끝내기'를 누르면 창이 갑자기 닫혔다.
struct StoryListeningBar: View {
    /// 막대 높이. 탭 바처럼 재지 않고 정한다 — 내용이 이만큼 위에서 끝나야 마지막 줄이 가리지 않는다.
    static let height: CGFloat = 56

    let player: StoryPlayer
    /// 이 장소(id)의 이야기 창을 연다.
    let onOpen: (String) -> Void

    var body: some View {
        if let current = player.current {
            HStack(spacing: Space.s) {
                Button {
                    onOpen(current.place.id)
                } label: {
                    HStack(spacing: Space.m) {
                        Image(systemName: player.isPlaying ? "speaker.wave.2.fill" : "headphones")
                            .foregroundStyle(Ink.accent)
                            .frame(width: 24)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(current.track.title)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Ink.ink)
                                .lineLimit(1)
                            Text(current.place.name)
                                .font(.caption)
                                .foregroundStyle(Ink.soft)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(current.place.name) · \(current.track.title)")
                .accessibilityHint("이야기 목록 열기")
                Button { player.togglePlayback() } label: {
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(player.isPlaying ? "일시정지" : "재생")
                Button { player.stop() } label: {
                    Image(systemName: "xmark").frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .accessibilityLabel("듣기 끝내기")
            }
            .font(.body.weight(.semibold))
            .foregroundStyle(Ink.ink)
            .buttonStyle(.plain)
            .padding(.horizontal, Space.l)
            .frame(height: Self.height)
            .frame(maxWidth: .infinity)
            .background(.bar)
            .overlay(alignment: .top) {
                TimelineView(.periodic(from: .now, by: 1)) { _ in
                    let total = max(player.duration, 1)
                    GeometryReader { proxy in
                        Rectangle().fill(Ink.accent)
                            .frame(width: proxy.size.width * min(1, player.elapsed / total), height: 2)
                    }
                    .frame(height: 2)
                }
                .accessibilityHidden(true)
            }
        }
    }
}
