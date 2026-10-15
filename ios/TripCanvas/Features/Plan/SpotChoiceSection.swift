import SwiftUI

/// 장소 편집의 초안 안에서만 변경한다. 닫기·오프라인·저장 실패의 동작은 기존 편집기와 같다.
struct SpotChoiceSection: View {
    @Binding var spot: TripSpot
    let currentDay: Int
    let draftKey: EditorDraftKey?
    let onSelectionChanged: () -> Void
    @State private var showsAlternativeEditor = false
    @State private var showsRemoveConfirm = false

    var body: some View {
        Section {
            if let choice = spot.choice {
                Label(choice.state == .pending ? "출발할 때 골라도 괜찮아요" : "이 일정 칸의 장소를 골랐어요",
                      systemImage: choice.state == .pending ? "arrow.triangle.branch" : "checkmark.circle")
                    .font(.subheadline).foregroundStyle(Ink.accent)
                option(spot, current: true, selected: choice.state == .selected)
                option(choice.alternative, current: false, selected: false)
                Button("다른 선택지 편집") { showsAlternativeEditor = true }
                    .accessibilityIdentifier("editAlternativeChoice")
                    .disabled(spot.status != .planned || spot.raw["payState"]?.stringValue == "PAID")
                ClockField(title: "이날 결정할 시각", text: Binding(
                    get: { spot.choice?.decideBy },
                    set: { value in var next = choice; next.decideBy = value; spot.choice = next }))
                if choice.state == .selected, spot.status == .planned, spot.raw["payState"]?.stringValue != "PAID" {
                    Button("다시 미정으로 두기") { var next = choice; next.state = .pending; spot.choice = next }
                }
                Button("현재 장소만 남기기", role: .destructive) { showsRemoveConfirm = true }
                if let error = choice.validationError(current: spot) {
                    Text(error).font(.caption).foregroundStyle(Ink.danger)
                }
            } else if let reason = SpotChoice.unavailableReason(spot) {
                Text(reason).font(.caption).foregroundStyle(Ink.soft)
            } else {
                Button { showsAlternativeEditor = true } label: {
                    Label("다른 곳도 열어두기", systemImage: "arrow.triangle.branch")
                }.accessibilityIdentifier("addAlternativeChoice")
            }
        } header: { Text("그때 마음 가는 쪽으로") }
        footer: {
            Text("둘 중 한 곳만 일정에 계산해요. 미정일 때 이동·시간·하루 비용은 현재 장소 기준이에요. 결정 시각은 이날 여행지 시각이며 알림 예약은 아니에요. 선택 후에도 완료를 눌러야 저장돼요.")
        }
        .sheet(isPresented: $showsAlternativeEditor) {
            SpotEditorView(target: .createFromMap(spot.choice?.alternative ?? TripSpot(name: "", city: spot.city)),
                           dayCount: 1, currentDay: currentDay, contextLabel: "같은 시간에 갈 다른 선택지",
                           draftKey: draftKey?.appending("alternative"),
                           allowsChoice: false,
                           onSave: { alternate in
                               let choice = SpotChoice(alternative: alternate, state: .pending, decideBy: spot.choice?.decideBy)
                               if let error = choice.validationError(current: spot) { return error }
                               spot.choice = choice
                               return nil
                           }, onDelete: { _ in nil }, onMoveToDay: { _, _, _ in nil })
        }
        .confirmationDialog("다른 선택지를 지울까요?", isPresented: $showsRemoveConfirm, titleVisibility: .visible) {
            Button("현재 장소만 남기기", role: .destructive) { spot.choice = nil }
            Button("두 선택지 유지", role: .cancel) { }
        } message: { Text("현재 장소는 그대로 남고, 함께 보관한 다른 선택지만 지워져요. 완료를 눌러야 저장돼요.") }
    }

    private func option(_ value: TripSpot, current: Bool, selected: Bool) -> some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Text(value.name.isEmpty ? "장소 이름을 입력해 주세요" : value.name).font(.body.weight(.semibold))
            if let minutes = value.stayMinutes { Text("머무는 시간 \(minutes)분").font(.caption).foregroundStyle(Ink.soft) }
            if let at = value.bookedAt, !at.isEmpty {
                Label("예약·입장 \(at) · 선택을 바꿔도 예약은 취소되지 않아요", systemImage: "ticket")
                    .font(.caption).foregroundStyle(Ink.warning)
            }
            if !value.admission.raw.isEmpty {
                Text(value.admission.isBooked ? "예약 확인됨" : value.admission.requirement.label)
                    .font(.caption).foregroundStyle(value.needsReservation ? Ink.warning : Ink.soft)
            }
            if selected { Label("선택한 곳", systemImage: "checkmark").font(.caption).foregroundStyle(Ink.accent) }
            else {
                Button(current ? "현재 장소로 결정" : "이 장소로 결정") {
                    spot.selectChoice(alternative: !current)
                    onSelectionChanged()
                }
                .accessibilityIdentifier(current ? "chooseCurrentPlace" : "chooseAlternativePlace")
                .disabled(spot.status != .planned || spot.raw["payState"]?.stringValue == "PAID" || spot.choice?.validationError(current: spot) != nil)
            }
        }.padding(.vertical, Space.xs)
    }
}
