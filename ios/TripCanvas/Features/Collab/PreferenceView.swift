import SwiftUI

/// 이 여행에서 나는 어떤 사람인가. **여행별**이라 고정 프로필이 아니다(§18) —
/// 평소엔 빡빡해도 "이번엔 신혼여행이라 여유롭게"가 가능해야 한다.
///
/// 취향은 의견이라 보기 권한도 남길 수 있고, 바꿀 수 있는 것은 본인 것뿐이다.
/// 그룹 요약은 **정리만 한다** — 자동으로 무엇을 빼자고 하지 않는다(§62).
struct PreferenceView: View {
    @State private var model: PreferenceViewModel

    init(trip: TripSummary, service: CollabDataSource) {
        _model = State(initialValue: PreferenceViewModel(trip: trip, service: service))
    }

    var body: some View {
        Form {
            if let message = model.errorMessage {
                Section {
                    InlineErrorBanner(message: "취향을 불러오지 못했어요", detail: message) {
                        Task { await model.load() }
                    }
                }
            }

            Section("페이스") {
                ChipRow(options: [PacePreference.relaxed, .normal, .packed],
                        label: { $0.label },
                        isOn: { model.draft.pace == $0 },
                        tap: { model.toggle(pace: $0) })
            }

            Section("걷기") {
                ChipRow(options: [WalkingPreference.low, .normal, .high],
                        label: { $0.label },
                        isOn: { model.draft.walking == $0 },
                        tap: { model.toggle(walking: $0) })
            }

            Section("시간대") {
                TriStateRow(title: "아침 일찍", value: model.draft.morning) { model.cycleMorning() }
                TriStateRow(title: "늦은 밤", value: model.draft.night) { model.cycleNight() }
            }

            Section {
                Button {
                    Task { await model.save() }
                } label: {
                    HStack {
                        if model.isSaving { ProgressView().controlSize(.small) }
                        Text("취향 남기기")
                    }
                }
                .disabled(model.isSaving)
            } footer: {
                Text("일행에게 보이는 것은 요약 한 줄이에요. 계정 이메일은 여행에 나오지 않아요.")
            }

            if !model.groupContext.isEmpty {
                Section("우리 일행은") {
                    ForEach(model.groupContext, id: \.self) { line in
                        Text(line).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            }

            if !model.members.isEmpty {
                Section("일행의 취향") {
                    ForEach(model.members) { row in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.name).font(.subheadline.weight(.semibold))
                            Text(row.summary).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("여행 취향")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load() }
        .overlay { if model.isLoading { ProgressView() } }
        .toast(model.toast) { model.clearToast() }
    }
}

/// 다시 누르면 꺼진다 — 고른 것을 되돌릴 수 없게 만들지 않는다.
private struct ChipRow<Option: Hashable>: View {
    let options: [Option]
    let label: (Option) -> String
    let isOn: (Option) -> Bool
    let tap: (Option) -> Void

    var body: some View {
        HStack(spacing: Space.s) {
            ForEach(options, id: \.self) { option in
                Button(label(option)) { tap(option) }
                    .font(.caption.weight(.semibold))
                    .frame(minHeight: 44)
                    .padding(.horizontal, Space.m)
                    .buttonStyle(.bordered)
                    .tint(isOn(option) ? .accentColor : .secondary)
                    .accessibilityAddTraits(isOn(option) ? [.isSelected] : [])
            }
        }
    }
}

/// 예 · 아니오 · 답하지 않음 세 상태. 답하지 않은 것을 '아니오'로 저장하지 않는다.
private struct TriStateRow: View {
    let title: String
    let value: Bool?
    let cycle: () -> Void

    var body: some View {
        Button(action: cycle) {
            HStack {
                Text(title).foregroundStyle(.primary)
                Spacer()
                Text(text).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            .frame(minHeight: 44)
        }
        .accessibilityValue(text)
    }

    private var text: String {
        switch value {
        case .none: "답하지 않음"
        case .some(true): "괜찮아요"
        case .some(false): "어려워요"
        }
    }
}
