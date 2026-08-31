import SwiftUI

/// 여행 당일에 한 번 권한다. 자동으로 켜지 않는다 — 켜는 것은 사용자의 결정이다(§8).
struct TravelModeInviteCard: View {
    let tripName: String
    let isBusy: Bool
    let onStart: () -> Void
    let onLater: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            Label("오늘 여행 일정이 있어요", systemImage: "location.circle")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text("Travel Mode를 시작하면")
                .font(.headline)
            VStack(alignment: .leading, spacing: Space.xs) {
                BulletLine("다음 일정까지 이동 시간을")
                BulletLine("나서기 좋은 시간을")
                BulletLine("잠금화면에서 지금 상황을")
            }
            Text("바로 알려드릴게요.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            HStack(spacing: Space.s) {
                PrimaryActionButton(title: "시작", systemImage: "play.fill", isBusy: isBusy, action: onStart)
                SecondaryActionButton(title: "나중에", action: onLater)
            }
        }
        .card()
    }
}

private struct BulletLine: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Space.s) {
            Image(systemName: "circle.fill").font(.system(size: 4)).foregroundStyle(.tertiary)
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
                .foregroundStyle(.secondary)
            HStack(spacing: Space.s) {
                PrimaryActionButton(title: "위치 사용", systemImage: "location.fill", action: onAllow)
                SecondaryActionButton(title: "나중에", action: onSkip)
            }
        }
        .padding(Space.xl)
        .presentationDetents([.medium])
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
            Text("예약 시간에 맞춰 “이제 출발하면 여유 있어요” 같은 안내만 보내요.\n일정마다 울리는 알람은 보내지 않습니다.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            HStack(spacing: Space.s) {
                PrimaryActionButton(title: "알림 받기", systemImage: "bell.fill", action: onAllow)
                SecondaryActionButton(title: "나중에", action: onSkip)
            }
        }
        .padding(Space.xl)
        .presentationDetents([.medium])
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
                    Text(pulse.detail).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer(minLength: Space.s)
            Button(travelModeOn ? "끄기" : "Travel Mode", action: onToggle)
                .font(.caption.weight(.semibold))
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
        case .delayed, .needsAttention: .orange
        case .freeTime: .blue
        case .dayComplete, .onTrack, .ahead: .green
        case .resting, .noPlan, .unknown: .secondary
        }
    }
}
