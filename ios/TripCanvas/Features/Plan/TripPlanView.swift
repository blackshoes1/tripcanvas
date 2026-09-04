import SwiftUI

/// 일정 편집 — 하루씩 본다.
///
/// 웹의 일자 카드를 그대로 옮기지 않았다. 아이폰에서는 하루를 골라 그 날의 장소만 목록으로 보고,
/// 순서는 끌어서, 빼는 것은 스와이프로 한다. 바꾸는 즉시 저장된다(저장 버튼이 없다).
struct TripPlanView: View {
    let trip: TripSummary

    @Environment(AppEnvironment.self) private var env
    @State private var model: TripPlanViewModel?
    @State private var editor: SpotEditorTarget?

    var body: some View {
        Group {
            if let model {
                content(model)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("일정")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let model, model.canEdit, model.day != nil {
                ToolbarItem(placement: .topBarTrailing) { EditButton() }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { editor = .create } label: { Image(systemName: "plus") }
                        .accessibilityLabel("장소 추가")
                }
            }
        }
        .task {
            if model == nil { model = TripPlanViewModel(tripId: trip.id, service: env.service) }
            await model?.load()
        }
        .sheet(item: $editor) { target in
            if let model {
                SpotEditorView(
                    target: target,
                    dayCount: model.dayCount,
                    currentDay: model.selectedDay,
                    onSave: { spot in
                        Task {
                            switch target {
                            case .create: await model.addSpot(spot)
                            case .edit(let index, _): await model.updateSpot(at: index, with: spot)
                            }
                        }
                    },
                    onDelete: { index in Task { await model.removeSpot(at: index) } },
                    onMoveToDay: { index, day in Task { await model.moveSpot(at: index, toDay: day) } })
            }
        }
    }

    @ViewBuilder
    private func content(_ model: TripPlanViewModel) -> some View {
        if model.isLoading && model.document == nil {
            ProgressView("일정을 불러오는 중")
        } else if model.document == nil {
            VStack(spacing: Space.l) {
                EmptyStateView(
                    symbol: "exclamationmark.icloud",
                    title: "일정을 불러오지 못했어요",
                    message: model.errorMessage ?? "잠시 뒤 다시 시도해 주세요.")
                SecondaryActionButton(title: "다시 시도", systemImage: "arrow.clockwise") {
                    Task { await model.load() }
                }
            }
        } else {
            VStack(spacing: 0) {
                dayPicker(model)
                Divider()
                spotList(model)
            }
            .overlay(alignment: .top) {
                if let error = model.errorMessage {
                    InlineErrorBanner(message: "저장하지 못했어요", detail: error) {
                        Task { await model.load() }
                    }
                    .padding(Space.l)
                }
            }
            .overlay(alignment: .bottom) {
                if let toast = model.toast {
                    ToastView(text: toast)
                        .padding(Space.l)
                        .task {
                            try? await Task.sleep(for: .seconds(2))
                            model.clearToast()
                        }
                }
            }
            // 충돌은 자동으로 어느 쪽도 고르지 않는다 — 무엇이 사라지는지 말하고 사용자가 고른다(§91).
            .alert("다른 기기에서 먼저 바뀌었어요", isPresented: conflictBinding(model)) {
                Button("최신 불러오기") { Task { await model.reloadFromServer() } }
                Button("그대로 두기", role: .cancel) { model.dismissConflict() }
            } message: {
                Text("최신 일정을 불러오면 방금 바꾼 것은 사라집니다. 방금 바꾼 것은 아직 저장되지 않았어요.")
            }
        }
    }

    private func conflictBinding(_ model: TripPlanViewModel) -> Binding<Bool> {
        Binding(get: { model.conflict != nil }, set: { if !$0 { model.dismissConflict() } })
    }

    /// 며칠짜리든 한 줄에 담기지 않는다 — 가로 스크롤 칩으로 고른다.
    private func dayPicker(_ model: TripPlanViewModel) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Space.s) {
                ForEach(0..<model.dayCount, id: \.self) { index in
                    let selected = index == model.selectedDay
                    Button {
                        model.selectedDay = index
                    } label: {
                        VStack(spacing: 2) {
                            Text("Day \(index + 1)").font(.subheadline.weight(.semibold))
                            let title = model.document?.days[index].title ?? ""
                            if !title.isEmpty {
                                Text(title).font(.caption2).lineLimit(1)
                            }
                        }
                        .padding(.horizontal, Space.m)
                        .padding(.vertical, Space.s)
                        .frame(minWidth: 64)
                        .background(selected ? Color.accentColor.opacity(0.16) : Color(.secondarySystemBackground),
                                    in: RoundedRectangle(cornerRadius: Radius.card))
                        .foregroundStyle(selected ? Color.accentColor : .primary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selected ? [.isSelected] : [])
                }
            }
            .padding(.horizontal, Space.l)
            .padding(.vertical, Space.s)
        }
    }

    @ViewBuilder
    private func spotList(_ model: TripPlanViewModel) -> some View {
        if let day = model.day {
            List {
                Section {
                    if day.spots.isEmpty {
                        Text(model.canEdit ? "아직 장소가 없어요. 오른쪽 위 ＋로 추가합니다." : "이 날에는 장소가 없어요.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    ForEach(Array(day.spots.enumerated()), id: \.offset) { index, spot in
                        Button {
                            guard model.canEdit else { return }
                            editor = .edit(index: index, spot: spot)
                        } label: {
                            SpotRow(spot: spot, dayMode: day.mode)
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing) {
                            if model.canEdit {
                                Button("빼기", role: .destructive) { Task { await model.removeSpot(at: index) } }
                            }
                        }
                    }
                    .onMove { source, destination in
                        Task { await model.moveSpots(from: source, to: destination) }
                    }
                    .deleteDisabled(!model.canEdit)
                    .moveDisabled(!model.canEdit)
                } header: {
                    dayHeader(model, day: day)
                } footer: {
                    if !model.canEdit {
                        Text("보기 권한이라 일정을 바꿀 수 없어요. 주최자에게 요청하세요.")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { await model.load() }
        } else {
            EmptyStateView(symbol: "calendar", title: "일자가 없어요", message: "웹에서 일자를 먼저 만들어 주세요.")
        }
    }

    private func dayHeader(_ model: TripPlanViewModel, day: TripDay) -> some View {
        HStack(spacing: Space.s) {
            Text(day.title.isEmpty ? "Day \(model.selectedDay + 1)" : day.title)
            Spacer()
            if model.isSaving { ProgressView().controlSize(.mini) }
            if model.canEdit {
                Menu {
                    // 그날의 기본 이동수단. 구간마다 다르면 장소 편집에서 따로 정한다.
                    Picker("이동수단", selection: Binding(
                        get: { day.mode },
                        set: { mode in Task { await model.setDayMode(mode) } })) {
                        ForEach(TravelMode.allCases, id: \.self) { mode in
                            Label(mode.label, systemImage: mode.symbol).tag(mode)
                        }
                    }
                } label: {
                    Label(day.mode.label, systemImage: day.mode.symbol)
                        .font(.caption.weight(.semibold))
                }
            } else {
                Label(day.mode.label, systemImage: day.mode.symbol).font(.caption)
            }
        }
        .textCase(nil)
    }
}

/// 목록의 한 줄. 시각·상태·이동수단처럼 "그 장소가 언제 어떤 상태인지"만 보인다.
struct SpotRow: View {
    let spot: TripSpot
    let dayMode: TravelMode

    var body: some View {
        HStack(alignment: .top, spacing: Space.m) {
            Text(spot.category?.icon ?? "📍").font(.title3)
            VStack(alignment: .leading, spacing: Space.xs) {
                HStack(spacing: Space.s) {
                    Text(spot.name.isEmpty ? "이름 없는 장소" : spot.name)
                        .font(.body.weight(.semibold))
                        .strikethrough(spot.status == .skipped || spot.status == .cancelled)
                    if spot.isMust { Image(systemName: "star.fill").font(.caption2).foregroundStyle(.orange) }
                }
                if !meta.isEmpty {
                    Text(meta).font(.caption).foregroundStyle(.secondary)
                }
                if spot.point == nil {
                    Label("위치 없음", systemImage: "mappin.slash")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            if spot.status != .planned {
                StatusChip(text: spot.status.label, symbol: statusSymbol, tint: statusTint)
            }
        }
        .padding(.vertical, Space.xs)
        .contentShape(Rectangle())
    }

    /// 시각은 세 가지를 구분해 말한다 — 예약 시각(상대가 정함) · 도착 고정(내가 정함) · 머무는 시간.
    private var meta: String {
        var parts: [String] = []
        if let booked = spot.bookedAt { parts.append("예약 \(booked)") }
        if let arrive = spot.arriveAt { parts.append("도착 \(arrive)") }
        if let stay = spot.stayMinutes, stay > 0 { parts.append("\(stay)분") }
        if let mode = spot.legMode, mode != dayMode { parts.append(mode.label) }
        if !spot.city.isEmpty && spot.city != "기타" { parts.append(spot.city) }
        return parts.joined(separator: "  ·  ")
    }

    private var statusSymbol: String {
        switch spot.status {
        case .completed: "checkmark.circle.fill"
        case .skipped: "arrow.uturn.right"
        case .cancelled: "xmark.circle"
        case .planned: "circle"
        }
    }

    private var statusTint: Color {
        switch spot.status {
        case .completed: .green
        case .skipped, .cancelled: .secondary
        case .planned: .secondary
        }
    }
}
