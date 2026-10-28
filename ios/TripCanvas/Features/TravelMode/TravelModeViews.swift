import SwiftUI

/// 여행 당일에 한 번 권한다. 자동으로 켜지 않는다 — 켜는 것은 사용자의 결정이다(§8).
///
/// 얇은 띠 하나다(2026-09-27) — 전에는 불릿 세 줄과 버튼 두 개짜리 카드라 '다음 일정'만큼 컸다.
/// 권유가 지금 할 일보다 크게 읽히면 안 된다. '나중에'는 닫기(✕)로 남는다 — 빠져나갈 길은 언제나 있다.
struct TravelModeInviteCard: View {
    let tripName: String
    let isBusy: Bool
    let onStart: () -> Void
    let onLater: () -> Void

    var body: some View {
        HStack(spacing: Space.m) {
            Image(systemName: "location.fill")
                .foregroundStyle(Ink.accent)
                .accessibilityHidden(true)
            // 내부 이름은 Travel Mode지만 화면에서는 "여행 중"이다(§28).
            Text("여행 중 안내를 켜면 나설 때를 잠금화면에서 알려 드려요")
                .font(.subheadline)
                .foregroundStyle(Ink.ink)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button(action: onStart) {
                Group {
                    if isBusy { ProgressView().controlSize(.small) } else { Text("켜기") }
                }
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, Space.l)
                .frame(minHeight: 36)
                .background(Ink.accent, in: Capsule())
                .foregroundStyle(Ink.onAccent)
            }
            .buttonStyle(.plain)
            .frame(minHeight: 44)
            .disabled(isBusy)
            .accessibilityLabel("여행 중 안내 켜기")
            Button(action: onLater) {
                Image(systemName: "xmark")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Ink.soft)
                    .frame(width: 32, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("나중에")
        }
        .padding(.leading, Space.l)
        .padding(.trailing, Space.s)
        .padding(.vertical, Space.s)
        .background(Ink.accent.opacity(0.09), in: RoundedRectangle(cornerRadius: Radius.card))
    }
}

private struct BulletLine: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Space.s) {
            Image(systemName: "circle.fill").font(.system(size: 4)).foregroundStyle(Ink.faint)
            Text(text).font(.subheadline)
        }
    }
}

/// 위치 권한을 시스템 팝업으로 곧바로 띄우지 않는다(§6).
/// 왜 필요한지 먼저 말하고, 사용자가 "위치 사용"을 고른 다음에 시스템에 묻는다.
struct LocationPrimerView: View {
    let onAllow: () -> Void
    let onSkip: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.l) {
            Image(systemName: "location.circle.fill")
                .font(.largeTitle)
                .foregroundStyle(.tint)
            Text("현재 위치를 사용하면")
                .font(.title3.weight(.bold))
            VStack(alignment: .leading, spacing: Space.s) {
                BulletLine("다음 장소까지 이동 시간을")
                BulletLine("나서기 좋은 시간을")
                BulletLine("근처에서 들를 만한 곳을")
            }
            Text("더 정확하게 알려드릴 수 있어요.\n위치는 지금 계산에만 쓰고 저장하지 않아요.")
                .font(.subheadline)
                .foregroundStyle(Ink.soft)
            HStack(spacing: Space.s) {
                PrimaryActionButton(title: "위치 사용", systemImage: "location.fill", action: onAllow)
                SecondaryActionButton(title: "나중에", expands: false, action: onSkip)
            }
        }
        .padding(Space.xl)
        .presentationDetents([.medium, .large])
    }
}

/// 알림도 마찬가지다 — 첫 실행에 묻지 않고, 쓸모를 설명할 수 있을 때 묻는다(§75.4).
struct NotificationPrimerView: View {
    let onAllow: () -> Void
    let onSkip: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.l) {
            Image(systemName: "bell.badge")
                .font(.largeTitle)
                .foregroundStyle(.tint)
            Text("나설 때가 되면 알려드릴까요?")
                .font(.title3.weight(.bold))
            Text("예약 시간에 맞춰 “이제 출발하면 여유 있어요” 같은 안내만 보내요.\n일정마다 울리는 알람은 보내지 않아요.")
                .font(.subheadline)
                .foregroundStyle(Ink.soft)
            HStack(spacing: Space.s) {
                PrimaryActionButton(title: "알림 받기", systemImage: "bell.fill", action: onAllow)
                SecondaryActionButton(title: "나중에", expands: false, action: onSkip)
            }
        }
        .padding(Space.xl)
        .presentationDetents([.medium, .large])
    }
}

/// Today 상단의 작은 상황 표시(§50). "일정대로 잘 가고 있어요" 한 줄.
struct TripPulseBar: View {
    let pulse: TripPulse
    let travelModeOn: Bool
    let onToggle: () -> Void

    var body: some View {
        HStack(spacing: Space.s) {
            Image(systemName: symbol)
                .foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 1) {
                Text(pulse.text).font(.subheadline.weight(.semibold))
                if !pulse.detail.isEmpty {
                    Text(pulse.detail).font(.caption).foregroundStyle(Ink.soft).lineLimit(2)
                }
            }
            Spacer(minLength: Space.s)
            Button(travelModeOn ? "안내 끄기" : "안내 켜기", action: onToggle)
                .font(.caption.weight(.semibold))
                .frame(minHeight: 44)
                .buttonStyle(.bordered)
        }
        .padding(Space.m)
        .background(tint.opacity(0.10), in: RoundedRectangle(cornerRadius: Radius.card))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(pulse.text). \(pulse.detail)")
    }

    // 색만으로 구분하지 않는다 — 기호와 문구가 항상 함께 간다(§47).
    private var symbol: String {
        switch pulse.code {
        case .delayed, .needsAttention: "exclamationmark.triangle.fill"
        case .freeTime: "hourglass"
        case .resting: "cup.and.saucer.fill"
        case .dayComplete: "checkmark.circle.fill"
        case .ahead: "hare.fill"
        case .noPlan: "sparkles"
        case .onTrack, .unknown: "checkmark.circle"
        }
    }
    private var tint: Color {
        switch pulse.code {
        case .delayed, .needsAttention: Ink.warning
        case .freeTime: Ink.info
        case .dayComplete, .onTrack, .ahead: Ink.positive
        case .resting, .noPlan, .unknown: Ink.soft
        }
    }
}

/// 시작을 고른 뒤에만 권한의 쓰임을 설명한다. 나중에를 골라도 여행은 시작할 수 있다.
struct TravelModeSetupView: View {
    let onStart: () async -> Void
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @State private var step: Step = .loading
    @State private var isWorking = false

    private enum Step { case loading, location, notifications }

    var body: some View {
        NavigationStack {
            ScrollView {
                switch step {
                case .loading:
                    ProgressView("여행 중 안내 준비 중").padding(Space.xl)
                case .location:
                    LocationPrimerView(
                        onAllow: {
                            Task {
                                isWorking = true
                                _ = await env.location.requestOnce()
                                isWorking = false
                                await nextStep()
                            }
                        },
                        onSkip: { Task { await nextStep() } })
                case .notifications:
                    NotificationPrimerView(
                        onAllow: {
                            Task {
                                isWorking = true
                                await env.push.requestAuthorization()
                                await start()
                            }
                        },
                        onSkip: { Task { await start() } })
                }
            }
            .disabled(isWorking)
            .navigationTitle("여행 중 안내 켜기")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("취소") { dismiss() }.disabled(isWorking)
                }
            }
            .task {
                await env.push.refreshPermission()
                if env.location.permission == .unknown { step = .location }
                else { await nextStep() }
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(isWorking)
    }

    private func nextStep() async {
        if env.push.permission == .unknown { step = .notifications }
        else { await start() }
    }

    private func start() async {
        isWorking = true
        step = .loading
        await onStart()
        dismiss()
    }
}

/// 실시간 현황이 꺼져 있을 때 `지금`이 하는 말. 여행 중 권유(`TravelModeInviteCard`)와 같은 얇은 띠이고 같은 자리,
/// 다음 일정 카드 **바로 아래**에 둔다 — 지금 할 일보다 먼저 읽히면 안 된다. 꺼 둔 것은 사용자의 선택이라 조르지 않는다:
/// '이대로 둘게요'(✕)로 접으면 여행 중 안내를 다시 켜거나 설정이 바뀔 때까지 말하지 않는다.
/// ⚠️ 켜는 곳을 글로도 적는다 — '설정에서 켜기'(`openSettingsURLString`)가 앱 페이지가 아니라 설정 첫 화면에
/// 떨어지는 경우가 있다(시뮬레이터 iOS 26.5·27에서 7번 중 7번, 2026-10-26). 경로에 '앱' 단계를 적지 않는다 —
/// iOS 17(최소 지원)에는 그 메뉴가 없고 앱이 설정 첫 화면 아래에 바로 있다.
/// ⚠️ "바로 시작해요"라고 약속하지 않는다 — 켜고 돌아와도 연결이 없으면 다음에 새로 받을 때 뜬다.
struct LiveActivitySettingsNotice: View {
    let onDismiss: () -> Void
    @Environment(\.openURL) private var openURL
    @Environment(\.dynamicTypeSize) private var typeSize

    /// 언제 말하는가 — 이 여행의 여행 중 안내가 켜져 있고, 설정에서 꺼져 있고, 접지 않았을 때.
    /// `지금`과 검증 하네스가 같은 판정을 쓴다.
    static func isShown(travelModeTripId: String?, tripId: String, disabledInSettings: Bool, dismissed: Bool) -> Bool {
        travelModeTripId == tripId && disabledInSettings && !dismissed
    }

    var body: some View {
        // 큰 글씨에서는 버튼이 줄 끝에 들어가지 않는다 — 문구 아래로 내린다.
        let stacked = typeSize >= .xxxLarge
        HStack(alignment: stacked ? .top : .center, spacing: Space.m) {
            Image(systemName: "lock.iphone")
                .foregroundStyle(Ink.warning)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("잠금화면 실시간 현황이 꺼져 있어요")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Ink.ink)
                Text("설정 앱의 With J > 실시간 현황에서 켤 수 있어요")
                    .font(.caption)
                    .foregroundStyle(Ink.soft)
                if stacked { settingsButton.padding(.top, Space.s) }
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if !stacked { settingsButton }
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Ink.soft)
                    .frame(width: 32, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("이대로 둘게요")
        }
        .padding(.leading, Space.l)
        .padding(.trailing, Space.s)
        .padding(.vertical, Space.s)
        .background(Ink.warning.opacity(0.09), in: RoundedRectangle(cornerRadius: Radius.card))
    }

    private var settingsButton: some View {
        Button {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
            openURL(url)
        } label: {
            Text("설정에서 켜기")
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .padding(.horizontal, Space.m)
                .frame(minHeight: 36)
                .background(Ink.accent, in: Capsule())
                .foregroundStyle(Ink.onAccent)
        }
        .buttonStyle(.plain)
        .frame(minHeight: 44)
    }
}
