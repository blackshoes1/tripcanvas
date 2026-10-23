import SwiftUI

/// A small attributed summary for Today, as well as the full choice screen.
struct DailyMomentsSummary: View {
    let response: DailyMomentsResponse
    var showsTitle = true

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            if showsTitle { Label("각자 오늘 하나만", systemImage: "heart").font(.headline) }
            if response.moments.isEmpty {
                Text("오늘 꼭 하고 싶은 하나를 남겨 보세요.").font(.subheadline).foregroundStyle(Ink.soft)
            }
            ForEach(response.moments) { moment in
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(moment.mine ? "나" : moment.label): \(moment.spotName)").font(.subheadline)
                    if moment.needsReview {
                        Text("일정이 바뀌어 다시 확인이 필요해요").font(.caption).foregroundStyle(Ink.warning)
                    }
                }
            }
            Text("각자의 바람이에요. 함께 결정한 일정으로 자동 확정하지 않아요.")
                .font(.caption).foregroundStyle(Ink.soft)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

struct DailyMomentsView: View {
    let trip: TripSummary
    var initialDayIndex: Int? = nil
    var service: DailyMomentsSource? = nil
    @Environment(AppEnvironment.self) private var env
    @Environment(\.scenePhase) private var phase
    @State private var model: DailyMomentsViewModel?

    var body: some View {
        PaperList {
            if let model {
                Section {
                    Picker("날짜", selection: Binding(get: { model.dayIndex }, set: { day in Task { await model.load(dayIndex: day) } })) {
                        ForEach(0..<max(1, trip.dayCount), id: \.self) { day in
                            Text(model.response?.dayLabel(day) ?? trip.dayLabel(day)).tag(day)
                        }
                    }
                    .disabled(model.isSaving)
                    if let error = model.errorMessage {
                        InlineErrorBanner(message: "선택을 확인해 주세요", detail: error) { Task { await model.load() } }
                    }
                    if model.isLoading { ProgressView() }
                    if let response = model.response { DailyMomentsSummary(response: response) }
                    if let checked = model.checkedAt { Text("마지막 확인 \(TimeFormat.shortTime(checked))").font(.caption).foregroundStyle(Ink.soft) }
                }
                if let response = model.response {
                    Section {
                        if response.options.isEmpty {
                            Text("그날의 일정에 장소를 담으면 여기서 고를 수 있어요.").foregroundStyle(Ink.soft)
                        }
                        ForEach(response.options) { option in
                            let selected = response.moments.first { $0.mine }?.spotKey == option.key
                            Button {
                                Task { await model.choose(option) }
                            } label: {
                                HStack(alignment: .top, spacing: Space.s) {
                                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(option.name)
                                        if !option.selectable {
                                            Text(option.disabledReason ?? "이 장소는 지금 고를 수 없어요").font(.caption).foregroundStyle(Ink.soft)
                                        }
                                    }
                                }
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .disabled(!option.selectable || model.isLoading || model.isSaving || selected)
                            .accessibilityAddTraits(selected ? .isSelected : [])
                            .accessibilityIdentifier("dailyMomentChoose-\(option.key)")
                        }
                        if response.moments.contains(where: { $0.mine }) {
                            Button("내 선택 거두기", role: .destructive) { Task { await model.choose(nil) } }
                                .frame(minHeight: 44)
                                .disabled(model.isLoading || model.isSaving)
                                .accessibilityIdentifier("dailyMomentWithdraw")
                        }
                    } header: { Text("내가 오늘 지키고 싶은 하나") } footer: {
                        Text("보기 권한도 남길 수 있어요. 내 선택만 바꿀 수 있고 일행의 선택은 그대로 남아요.")
                    }
                }
                if let confirmation = model.confirmation {
                    Section { Text(confirmation).foregroundStyle(Ink.soft) }
                }
            } else { ProgressView() }
        }
        .navigationTitle("각자 오늘 하나만")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model?.load() }
        .onReceive(NotificationCenter.default.publisher(for: .dailyMomentsChanged)) { note in
            if note.object as? String == trip.id { Task { await model?.load() } }
        }
        .task(id: phase) {
            guard phase == .active else { env.realtime.disconnect(key: liveKey); return }
            if model == nil { model = DailyMomentsViewModel(tripId: trip.id,
                dayIndex: min(max(0, initialDayIndex ?? trip.todayIndex), max(0, trip.dayCount - 1)), service: service ?? env.service) }
            if service == nil {
                env.realtime.connect(tripId: trip.id, key: liveKey) { event in
                    if event.kind == "DAILY_MOMENT_CHANGED" { Task { await model?.load() } }
                }
            }
            await model?.load()
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
                await model?.load()
            }
        }
        .onDisappear { env.realtime.disconnect(key: liveKey) }
    }
    private var liveKey: String { "daily-moments-\(trip.id)" }
}
