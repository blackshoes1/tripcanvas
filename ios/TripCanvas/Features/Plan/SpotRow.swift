import SwiftUI

/// 목록의 한 줄. 시각·상태·이동수단처럼 "그 장소가 언제 어떤 상태인지"만 보인다.
struct SpotRow: View {
    let spot: TripSpot
    let dayMode: TravelMode
    /// 서버가 계산한 그 장소의 시각과 구간. nil이면 계산을 못 받은 것이다 —
    /// 그때는 **문서에 적힌 것만** 보인다(없는 시각을 앱이 지어내지 않는다).
    var plan: DayPlanSpot?
    /// 함께 다니지 않는 구간에 속할 때만. 규칙은 서버가 정하고 여기서는 그리기만 한다.
    var split: SplitInfo?
    /// 세로 선을 이 줄 위·아래로 잇는가. 하루의 첫 줄 위와 끝 줄 아래는 비운다(선이 허공에서 시작하지 않게).
    var railTop = true
    var railBottom = true

    /// 시간 칸 폭. 승인 시안의 왼쪽 시각 열이다 — `07:20`이 기준이고 글자 크기 설정을 따라 커진다.
    /// ⚠️ 고정 시각의 📌와 `(익일)`은 여기 그대로 남는다. 좁혔다고 **뜻을 버리지 않는다** —
    ///    모자라면 `minimumScaleFactor`가 줄인다.
    @ScaledMetric(relativeTo: .caption) private var timeColumnWidth: CGFloat = PlanRail.timeColumn
    /// 📌 자리. 고정 폭이라 아이콘 유무와 상관없이 시간이 같은 x에서 시작한다.
    @ScaledMetric(relativeTo: .caption) private var pinSlotWidth: CGFloat = 16
    @ScaledMetric(relativeTo: .body) private var markerSize: CGFloat = PlanRail.markerSize
    @Environment(\.dynamicTypeSize) private var typeSize

    /// 이름 칸이 시작하는 곳 = 시간 칸 + 선 위의 표지 칸. 이 줄의 모든 부가 줄이 여기서 시작한다.
    static func secondaryIndent(timeColumnWidth: CGFloat) -> CGFloat { timeColumnWidth + PlanRail.markerColumn }

    struct SplitInfo: Equatable {
        let whoText: String
        let includesMe: Bool
        /// 가지에서 처음 나오는 장소. 이름표를 여기에만 붙여 줄이 반복되지 않게 한다.
        let isBranchStart: Bool
    }

    private var admissionText: String? {
        let admission = spot.admission
        let known = admission.requirement != .unknown
        switch (admission.isBooked, known) {
        case (true, true): return "예약 완료 · \(admission.requirement.label)"
        case (true, false): return "예약 완료"
        case (false, true): return admission.requirement.label
        case (false, false): return nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 이 장소로 '들어오는' 구간. 장소 사이가 비어 있으면 "여기서 저기까지 얼마나"를 알 수 없다.
            // 선 위의 알약이다 — 장소 이름보다 언제나 가볍다.
            if let leg = plan?.incomingLeg {
                PlanRailLeg(mode: TravelMode(rawValue: leg.mode) ?? dayMode, minutes: leg.minutes,
                            distanceKm: leg.distanceKm, rail: railTop, walkInstead: leg.walkInstead == true)
            }

            // ⚠️ 접근성 글자 크기에서는 **옆에 두지 않는다.** 시간 칸이 화면의 절반을 먹어
            //    이름이 글자 단위로 갈린다. 그때는 시간을 이름 위로 올리고 선은 그리지 않는다.
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: Space.xs) {
                    timeColumn
                    HStack(alignment: .top, spacing: Space.s) {
                        marker
                        mainContent
                    }
                }
                .padding(.vertical, PlanRail.rowPadding)
            } else {
                HStack(alignment: .top, spacing: 0) {
                    timeColumn.padding(.top, 3)
                    marker.frame(width: PlanRail.markerColumn)
                    mainContent.padding(.leading, Space.s)
                }
                .padding(.vertical, PlanRail.rowPadding)
                .background(alignment: .leading) {
                    PlanRailLine(centerX: timeColumnWidth + PlanRail.markerColumn / 2,
                                 top: railTop, bottom: railBottom,
                                 split: PlanRail.rowPadding + markerSize / 2)
                }
            }
        }
        // ⚠️ 나란한 가지를 열로 쪼개지 않는다 — 드래그 인덱스가 자식 순서로 계산돼서
        //    다른 요소를 끼우면 순서가 어긋난다. 줄은 1:1로 두고 왼쪽 선으로 묶어 보인다.
        .padding(.leading, split != nil ? Space.s : 0)
        .overlay(alignment: .leading) {
            if split != nil {
                Rectangle()
                    .fill(Ink.accent.opacity(0.35))
                    .frame(width: 2)
            }
        }
        .contentShape(Rectangle())
    }

    /// 선 위의 표지 — 장소 유형 기호. 상대가 정한 시각(예약)이 있는 곳은 채운 원이다.
    /// ⚠️ 분류를 모르는 장소도 **자리는 잡는다** — 아니면 이름이 줄마다 다른 x에서 시작한다.
    private var marker: some View {
        let done = spot.status == .completed || spot.status == .skipped || spot.status == .cancelled
        let style: PlanRailMarker.Style = done ? .muted : (bookedText != nil ? .fixed : .plain)
        return PlanRailMarker(symbol: spot.category?.symbol ?? "mappin", style: style)
    }

    /// 이름·시각·메모와 그 부가 줄들. 모두 이름 칸 안에서 시작한다.
    private var mainContent: some View {
        HStack(alignment: .top, spacing: Space.s) {
            VStack(alignment: .leading, spacing: Space.xs) {
                // 누가 가는지는 **가지가 시작될 때 한 번만** 말한다.
                if let split, split.isBranchStart { branchHeader(split) }
                HStack(spacing: Space.s) {
                    Text(spot.name.isEmpty ? "이름 없는 장소" : spot.name)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(spot.status == .planned ? Ink.ink : Ink.soft)
                        .strikethrough(spot.status == .skipped || spot.status == .cancelled)
                        .fixedSize(horizontal: false, vertical: true)
                    if let symbol = spot.priority.symbol {
                        Image(systemName: symbol)
                            .font(.caption2)
                            .foregroundStyle(spot.priority == .must ? Ink.warning : Ink.soft)
                            .accessibilityLabel(spot.priority.label)
                    }
                }
                // 상대가 정한 약속은 가장 세게 말한다 — 내가 옮길 수 없는 시각이다.
                if let booked = bookedText { bookedChip(booked) }
                if !meta.isEmpty {
                    Text(meta).font(.caption).foregroundStyle(Ink.soft)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if spot.point == nil {
                    Label("위치 없음 · 동선에서 빠져요", systemImage: "mappin.slash")
                        .font(.caption2)
                        .foregroundStyle(Ink.warning)
                }
                // '확인 필요'뿐인 장소에는 아무것도 붙이지 않는다 — 모든 명소에 붙으면 정작 '예약 필수'가 묻힌다.
                if let text = admissionText {
                    Label(text, systemImage: spot.admission.isBooked ? "checkmark.seal" : "ticket")
                        .font(.caption).foregroundStyle(spot.needsReservation ? Ink.warning : Ink.soft)
                }
                // 갈라졌던 사람들이 다시 만나는 지점. 시각은 타임라인이 정하므로 여기서 말하지 않는다.
                if plan?.reunion == true {
                    Label("여기서 다시 만나요", systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                        .font(.caption2)
                        .foregroundStyle(Ink.accent)
                }
            }
            Spacer(minLength: 0)
            if spot.status != .planned {
                StatusChip(text: spot.status.label, symbol: statusSymbol, tint: statusTint)
            }
        }
    }

    /// 이 가지에 누가 가는가. 내가 빠진 구간은 옅게 — 없는 일정처럼 보이지 않게 지우지는 않는다.
    private func branchHeader(_ split: SplitInfo) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "person.2.fill").font(.caption2)
            Text(split.whoText).font(.caption.weight(.semibold))
            if !split.includesMe {
                Text("· 나는 안 가요").font(.caption2)
            }
        }
        .foregroundStyle(split.includesMe ? Ink.accent : Ink.soft)
    }

    /// 시각 3종 중 둘 — 📌 도착 고정(내가 정한 계획)과 예상 도착(계산).
    /// 세기를 달리해서 "내가 정한 것"과 "계산된 것"이 눈으로 갈린다.
    ///
    /// ⚠️ 폭을 **고정하지 않는다.** 예전에는 48pt에 `📌 09:30`을 넣어서, 📌가 붙는 줄만
    /// 시간이 줄바꿈됐다. 글자 크기 설정을 키우면 아이콘이 없어도 넘친다 —
    /// 그래서 폭이 글자 크기를 따라가고(`@ScaledMetric`), 시간은 어떤 경우에도 한 줄이다.
    @ViewBuilder
    private var timeColumn: some View {
        if let plan {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 2) {
                    // 핀 자리는 **있든 없든 같다** — 아니면 고정된 줄의 시간만 오른쪽으로 밀린다.
                    Image(systemName: "pin.fill")
                        .font(.caption2)
                        .opacity(plan.fixed ? 1 : 0)
                        .frame(width: pinSlotWidth, alignment: .leading)
                        .accessibilityHidden(true)
                    Text(TimeFormat.clockAcrossMidnight(plan.etaMinutes))
                        .font(.caption.weight(plan.fixed ? .bold : .regular))
                        .monospacedDigit()
                        .lineLimit(1)
                        // 접근성 글자 크기에서 폭이 모자라면 줄을 바꾸는 대신 조금 줄인다.
                        .minimumScaleFactor(0.7)
                }
                if plan.conflict {
                    // 고정 시각이 이동상 불가능하다 — 조용히 넘기지 않는다.
                    Image(systemName: "exclamationmark.triangle.fill").font(.caption2)
                }
            }
            .foregroundStyle(plan.conflict ? Ink.warning : (plan.fixed ? Ink.ink : Ink.soft))
            .frame(width: typeSize.isAccessibilitySize ? nil : timeColumnWidth, alignment: .leading)
            .accessibilityLabel(timeAccessibility(plan))
        } else {
            // 계산이 오기 전에도 **자리는 잡아 둔다.** 폭을 0으로 두면 시각이 도착하는 순간
            // 이름이 통째로 옆으로 밀려 화면이 튄다(2026-09-07 보고).
            // 값은 비워 둔다 — 문서의 `at`을 도착 예정처럼 보이게 하지 않는다.
            Color.clear
                .frame(width: typeSize.isAccessibilitySize ? 0 : timeColumnWidth, height: 0)
                .accessibilityHidden(true)
        }
    }

    private func timeAccessibility(_ plan: DayPlanSpot) -> String {
        var text = plan.fixed ? "도착 고정 " : "예상 도착 "
        text += TimeFormat.clockAcrossMidnight(plan.etaMinutes)
        if plan.conflict { text += ", 이동 시간상 맞추기 어려워요" }
        return text
    }

    private var bookedText: String? {
        if let minutes = plan?.bookedAtMinutes { return TimeFormat.clock(minutes) }
        return spot.bookedAt      // 계산이 없으면 문서에 적힌 그대로
    }

    /// 예약·입장은 **상대가 정한** 시각이다. 늦으면 그 사실을 그 자리에서 말한다.
    private func bookedChip(_ text: String) -> some View {
        let late = plan.map { $0.etaMinutes > ($0.bookedAtMinutes ?? Int.max) } ?? false
        return HStack(spacing: 4) {
            Image(systemName: "ticket.fill").font(.caption2)
            Text("예약 \(text)").font(.caption.weight(.semibold))
            if late { Text("· 도착이 늦어요").font(.caption2) }
        }
        // 상대가 정한 시각은 `info`다(색은 뜻이다) — 선 위의 채운 표지와 같은 색이다.
        .foregroundStyle(late ? Ink.warning : Ink.info)
    }

    /// 남는 것 — 머무는 시간 · 대기 · 구간 수단 재정의 · 도시.
    /// 시각(예약·도착)은 위에서 따로 말하므로 여기 섞지 않는다.
    private var meta: String {
        var parts: [String] = []
        if let category = spot.category { parts.append(category.label) }
        if let stay = stayMinutes, stay > 0 { parts.append("\(TimeFormat.duration(stay)) 머무름") }
        if let wait = plan?.waitMinutes, wait > 0 { parts.append("대기 \(TimeFormat.duration(wait))") }
        if plan == nil, let arrive = spot.arriveAt { parts.append("도착 \(arrive)") }
        if let mode = spot.legMode, mode != dayMode { parts.append(mode.label) }
        if !spot.city.isEmpty && spot.city != "기타" { parts.append(spot.city) }
        return parts.joined(separator: " · ")
    }

    private var stayMinutes: Int? { plan?.stayMinutes ?? spot.stayMinutes }

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
        case .completed: Ink.positive
        case .skipped, .cancelled: Ink.soft
        case .planned: Ink.soft
        }
    }
}
