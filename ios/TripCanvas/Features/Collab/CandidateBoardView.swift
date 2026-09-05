import SwiftUI

/// 가고 싶은 곳 — 아직 일정이 아닌 후보를 일행과 함께 고른다.
///
/// 보드는 **결정 못 한 것을 맨 위에** 둔다(§57·§58). 보드가 할 일은 순위를 매기는 게 아니라 어디에 한마디가 필요한지
/// 가리키는 것이다. 반응은 한 번의 탭이고, 일정에 넣는 것은 언제나 사람이 누른다(§12·§79).
struct CandidateBoardView: View {
    let trip: TripSummary

    @Environment(AppEnvironment.self) private var env
    @Environment(\.scenePhase) private var scenePhase
    @State private var model: CandidateBoardViewModel?
    @State private var titleDraft = ""
    @State private var noteDraft = ""
    @State private var expanded: Set<Int> = []
    @State private var commentDrafts: [Int: String] = [:]
    @State private var scheduling: CandidateView?
    @State private var removing: CandidateView?
    @State private var showsSearch = false
    /// 지도에서 고른 자리. **아직 아무에게도 안 갔다** — 확인을 눌러야 후보가 된다(§37).
    @State private var pickedPlace: PlaceHit?

    var body: some View {
        Group {
            if let model {
                content(model)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("가고 싶은 곳")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showsSearch) {
            // 근처 우선의 기준은 이미 담은 후보의 좌표 — 없으면 그냥 검색어로 찾는다.
            PlaceSearchView(near: model?.candidates.lazy.compactMap { c in
                c.lat.flatMap { lat in c.lng.map { GeoPoint(lat: lat, lng: $0) } }
            }.first) { hit in
                // ⚠️ 여기서 저장하지 않는다. 탭 한 번으로 일행에게 공유되지 않게(§37).
                pickedPlace = hit
                if titleDraft.trimmingCharacters(in: .whitespaces).isEmpty { titleDraft = hit.name }
            }
        }
        // 앱이 뒤로 가면 소켓을 붙들지 않는다(§34) — 돌아올 때 다시 붙고 그때 최신을 읽는다.
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: if let model { startLive(model) }
            case .background, .inactive: env.realtime.disconnect()
            @unknown default: break
            }
        }
        .onDisappear { env.realtime.disconnect() }
        .task {
            if model == nil { model = CandidateBoardViewModel(trip: trip, service: env.service, documents: env.service) }
            await model?.load()
            if let model { startLive(model) }
        }
        .sheet(item: $scheduling) { candidate in
            if let model {
                DayPickerSheet(trip: trip, title: candidate.title) { dayIndex in
                    Task { await model.schedule(candidateId: candidate.id, dayIndex: dayIndex) }
                }
            }
        }
        .confirmationDialog(
            "\"\(removing?.title ?? "")\" 을(를) 후보에서 뺄까요?",
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            titleVisibility: .visible
        ) {
            Button("빼기", role: .destructive) {
                if let candidate = removing { Task { await model?.remove(candidateId: candidate.id) } }
                removing = nil
            }
        } message: {
            Text("남은 반응과 한마디도 함께 사라져요.")
        }
    }

    /// 실시간을 붙인다. **못 붙어도 앱은 그대로** — 상태만 바뀌고 폴백(당겨서 새로고침)으로 간다.
    private func startLive(_ model: CandidateBoardViewModel) {
        env.realtime.connect(tripId: trip.id) { event in
            Task { await model.handle(event) }
        }
    }

    @ViewBuilder
    private func content(_ model: CandidateBoardViewModel) -> some View {
        List {
            if let error = model.errorMessage {
                InlineErrorBanner(message: "처리하지 못했어요", detail: error) {
                    model.dismissError()
                    Task { await model.load() }
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }

            // 실시간인지 아닌지를 숨기지 않는다 — 안 되면 당겨서 새로고침하면 된다고 말한다.
            if env.realtime.state != .live {
                Section {
                    Label(env.realtime.state == .connecting ? "연결 중이에요" : "당겨서 새로고침하면 최신으로 볼 수 있어요",
                          systemImage: env.realtime.state == .connecting ? "antenna.radiowaves.left.and.right" : "arrow.clockwise")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if model.canPropose {
                Section {
                    TextField("가고 싶은 곳 (예: 사그라다 파밀리아)", text: $titleDraft)
                    TextField("한 줄 메모 (선택) — 예: 야경이 좋대", text: $noteDraft)

                    Button { showsSearch = true } label: {
                        Label("지도에서 찾기", systemImage: "map")
                    }
                    .disabled(model.isWorking)

                    // 고른 자리는 여기까지만 와 있다 — 담기를 눌러야 일행에게 간다(§37).
                    if let place = pickedPlace {
                        HStack(alignment: .top, spacing: Space.s) {
                            Text(place.category?.icon ?? "📍")
                            VStack(alignment: .leading, spacing: 2) {
                                Text(place.name).font(.subheadline.weight(.medium))
                                if !place.address.isEmpty {
                                    Text(place.address).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }
                                Text("위치가 함께 담겨요 — 어느 날에 넣을지 정할 때 쓰여요")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button {
                                pickedPlace = nil
                            } label: {
                                Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("고른 자리 지우기")
                        }
                    }

                    Button {
                        let place = pickedPlace
                        Task {
                            if await model.add(title: titleDraft, note: noteDraft,
                                               lat: place?.point.lat, lng: place?.point.lng,
                                               placeId: place?.placeId,
                                               addr: (place?.address).flatMap { $0.isEmpty ? nil : $0 }) {
                                titleDraft = ""; noteDraft = ""; pickedPlace = nil
                            }
                        }
                    } label: {
                        Label("후보로 담기", systemImage: "plus.circle")
                    }
                    .disabled(model.isWorking || titleDraft.trimmingCharacters(in: .whitespaces).isEmpty)
                } header: {
                    Text("후보 담기")
                } footer: {
                    Text("일정에 넣기 전에 일행과 먼저 골라 봐요. 반응은 서로 보이고, 일정에 넣는 건 직접 누를 때만 일어나요.")
                }
            }

            if model.candidates.isEmpty && !model.isLoading {
                Section {
                    EmptyStateView(
                        symbol: "mappin.and.ellipse",
                        title: "아직 담은 곳이 없어요",
                        message: model.canPropose
                            ? "이름을 적어 후보로 담으면 일행이 반응할 수 있어요."
                            : "주최자나 편집자가 후보를 담으면 여기에서 의견을 낼 수 있어요.")
                }
            } else {
                Section {
                    Picker("정렬", selection: Binding(get: { model.sortByInterest }, set: { model.sortByInterest = $0 })) {
                        Text("최근 순").tag(false)
                        Text("관심 순").tag(true)
                    }
                    .pickerStyle(.segmented)
                }
                if let plan = model.proposal, model.canSchedule {
                    Section { GroupProposalCard(plan: plan, isBusy: model.isWorking,
                                                onAccept: { Task { await model.acceptProposal() } },
                                                onDismiss: { model.dismissProposal() }) }
                }
                let groups = model.groups
                group("의견이 필요해요", groups.needsOpinion, model)
                group("다들 좋아해요", groups.loved, model)
                group("아직 끌리는 사람이 없어요", groups.resting, model)
                group("일정에 넣었어요", groups.scheduled, model)
                group("이번엔 뺐어요", groups.rejected, model)
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await model.load() }
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
    }

    @ViewBuilder
    private func group(_ title: String, _ candidates: [CandidateView], _ model: CandidateBoardViewModel) -> some View {
        if !candidates.isEmpty {
            Section(title) {
                ForEach(candidates) { candidate in
                    CandidateCard(
                        candidate: candidate,
                        memberCount: model.memberCount,
                        role: model.role,
                        isExpanded: expanded.contains(candidate.id),
                        comments: model.comments[candidate.id],
                        draft: Binding(
                            get: { commentDrafts[candidate.id] ?? "" },
                            set: { commentDrafts[candidate.id] = $0 }),
                        onReact: { reaction in Task { await model.react(candidateId: candidate.id, reaction: reaction) } },
                        onToggleComments: {
                            if expanded.contains(candidate.id) { expanded.remove(candidate.id) }
                            else {
                                expanded.insert(candidate.id)
                                Task { await model.loadComments(candidateId: candidate.id) }
                            }
                        },
                        onSendComment: {
                            let text = commentDrafts[candidate.id] ?? ""
                            Task {
                                if await model.addComment(candidateId: candidate.id, body: text) { commentDrafts[candidate.id] = "" }
                            }
                        },
                        onDeleteComment: { commentId in Task { await model.deleteComment(candidateId: candidate.id, commentId: commentId) } },
                        onSchedule: { scheduling = candidate },
                        onReject: { Task { await model.reject(candidateId: candidate.id) } },
                        onReopen: { Task { await model.reopen(candidateId: candidate.id) } },
                        onUnschedule: { Task { await model.unschedule(candidateId: candidate.id) } },
                        onRemove: { removing = candidate })
                }
            }
        }
    }
}

/// 후보 하나 — 무엇을 / 누가 냈는지 / 일행은 뭐라 하는지 / 내가 뭐라 할지.
struct CandidateCard: View {
    let candidate: CandidateView
    let memberCount: Int
    let role: MemberRole
    let isExpanded: Bool
    let comments: [CommentView]?
    @Binding var draft: String
    let onReact: (Reaction) -> Void
    let onToggleComments: () -> Void
    let onSendComment: () -> Void
    let onDeleteComment: (Int) -> Void
    let onSchedule: () -> Void
    let onReject: () -> Void
    let onReopen: () -> Void
    let onUnschedule: () -> Void
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            HStack(alignment: .top, spacing: Space.s) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(candidate.title.isEmpty ? "이름 없는 곳" : candidate.title).font(.body.weight(.semibold))
                    Text(meta).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: Space.s)
                StatusChip(text: badgeText, symbol: badgeSymbol, tint: badgeTint)
            }
            if let note = candidate.note, !note.isEmpty {
                Text(note).font(.subheadline).foregroundStyle(.secondary)
            }

            // 한 번의 탭 — 이미 고른 것을 다시 누르면 거둔다(§9).
            if CollabModel.canReact(role) {
                HStack(spacing: Space.s) {
                    ForEach(Reaction.allCases, id: \.self) { reaction in
                        let on = Reaction(loose: candidate.myReaction) == reaction
                        Button { onReact(reaction) } label: {
                            Text("\(reaction.icon) \(reaction.label)")
                                .font(.caption.weight(on ? .semibold : .regular))
                                .padding(.horizontal, Space.m)
                                .padding(.vertical, Space.xs + 2)
                                .background(on ? Color.accentColor.opacity(0.18) : Color(.tertiarySystemFill), in: Capsule())
                                .foregroundStyle(on ? Color.accentColor : .primary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(candidate.title) — \(reaction.label)")
                        .accessibilityAddTraits(on ? [.isSelected] : [])
                    }
                }
            }

            if !candidate.reactions.isEmpty {
                // 서로의 의견은 보인다(§10).
                Text(candidate.reactions.map { entry in
                    "\(Reaction(loose: entry.reaction)?.icon ?? "·") \(entry.me ? "나" : (entry.name.isEmpty ? "멤버" : entry.name))"
                }.joined(separator: "   "))
                .font(.caption2).foregroundStyle(.secondary)
            }

            // 의견이 갈렸으면 자동으로 빼지 않고 선택지를 보인다(§23·§24).
            if let conflict = CollabModel.conflict(candidate, memberCount: memberCount) {
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text("의견이 갈려 있어요 — 어떻게 할까요?").font(.caption.weight(.semibold))
                    ForEach(Array(conflict.options.enumerated()), id: \.offset) { _, option in
                        HStack(alignment: .top, spacing: Space.s) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(option.title).font(.caption.weight(.semibold))
                                Text(option.text).font(.caption2).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: Space.s)
                            if let action = option.action, CollabModel.canScheduleCandidate(role) {
                                Button("이렇게 할게요") {
                                    if action == "SCHEDULE" { onSchedule() } else { onReject() }
                                }
                                    .font(.caption2)
                                    .buttonStyle(.bordered)
                                    .controlSize(.small)
                                    .accessibilityLabel("\(candidate.title) — \(option.title)")
                            }
                        }
                    }
                }
                .padding(Space.s)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: Radius.card))
            }

            HStack(spacing: Space.s) {
                if CollabModel.canComment(role) {
                    Button {
                        onToggleComments()
                    } label: {
                        Label(candidate.commentCount > 0 ? "\(candidate.commentCount)" : "한마디", systemImage: "bubble.left")
                    }
                    .font(.caption)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .accessibilityHint(isExpanded ? "접기" : "펼치기")
                }
                if CollabModel.canScheduleCandidate(role) {
                    switch candidate.status {
                    case "REJECTED":
                        Button("후보로 되돌리기", action: onReopen).font(.caption).buttonStyle(.bordered).controlSize(.small)
                    case "SCHEDULED":
                        Button("후보로 되돌리기", action: onUnschedule).font(.caption).buttonStyle(.bordered).controlSize(.small)
                    default:
                        Button("일정에 넣기", action: onSchedule).font(.caption).buttonStyle(.borderedProminent).controlSize(.small)
                    }
                }
                if CollabModel.canRemoveCandidate(role, mine: candidate.mine) {
                    Button("빼기", role: .destructive, action: onRemove).font(.caption).buttonStyle(.bordered).controlSize(.small)
                }
            }

            if isExpanded { commentsPanel }
        }
        .padding(.vertical, Space.xs)
    }

    /// 한마디 — 채팅이 아니라 이 장소에 붙는 짧은 말이다(§14·§15).
    private var commentsPanel: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            if comments == nil {
                ProgressView().controlSize(.small)
            } else if comments?.isEmpty == true {
                Text("아직 한마디도 없어요. 왜 가고 싶은지, 언제가 좋을지 남겨 보세요.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            ForEach(comments ?? []) { comment in
                HStack(alignment: .top, spacing: Space.s) {
                    Text(comment.mine ? "나" : (comment.authorLabel.isEmpty ? "멤버" : comment.authorLabel))
                        .font(.caption.weight(.semibold))
                    Text(comment.body).font(.caption)
                    Spacer(minLength: Space.xs)
                    Text(CollabModel.relativeTime(comment.createdAt)).font(.caption2).foregroundStyle(.tertiary)
                    if CollabModel.canDeleteComment(role, mine: comment.mine) {
                        Button {
                            onDeleteComment(comment.id)
                        } label: {
                            Image(systemName: "xmark.circle").font(.caption2)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("한마디 지우기")
                    }
                }
            }
            HStack(spacing: Space.s) {
                TextField("한마디 (예: 야경 보고 저녁 먹자)", text: $draft)
                    .font(.caption)
                    .textFieldStyle(.roundedBorder)
                Button("남기기", action: onSendComment)
                    .font(.caption)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(.top, Space.xs)
    }

    private var meta: String {
        [CollabModel.attribution(candidate), CollabModel.reactionSummary(candidate, memberCount: memberCount), candidate.addr ?? ""]
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    private var badgeText: String {
        switch candidate.status {
        case "SCHEDULED": return candidate.scheduledRef.map { "Day \($0)" } ?? "일정에 있음"
        case "REJECTED": return "이번엔 뺐어요"
        default: return CollabModel.verdict(candidate, memberCount: memberCount).text
        }
    }

    private var badgeSymbol: String {
        switch candidate.status {
        case "SCHEDULED": "calendar"
        case "REJECTED": "tray"
        default: "person.2"
        }
    }

    private var badgeTint: Color {
        if candidate.status == "SCHEDULED" || candidate.status == "REJECTED" { return .secondary }
        switch CollabModel.verdict(candidate, memberCount: memberCount).tone {
        case .good: return .green
        case .split: return .orange
        case .mixed: return .yellow
        case .quiet: return .secondary
        }
    }
}

/// 며칠째에 넣을지 고른다. 위치는 그 날 **맨 뒤** — 최적 위치를 추측하지 않는다(§79).
struct DayPickerSheet: View {
    let trip: TripSummary
    let title: String
    let onPick: (Int) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(0..<max(trip.dayCount, 1), id: \.self) { index in
                        Button {
                            onPick(index)
                            dismiss()
                        } label: {
                            HStack {
                                Text("Day \(index + 1)")
                                if let date = dateText(index) {
                                    Text(date).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text("\"\(title)\" 을(를) 며칠째에 넣을까요?")
                } footer: {
                    Text("고른 날 맨 뒤에 붙습니다. 순서는 일정 화면에서 끌어 옮길 수 있어요.")
                }
            }
            .navigationTitle("일정에 넣기")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("취소") { dismiss() } }
            }
        }
    }

    private func dateText(_ index: Int) -> String? {
        guard let first = ISODateText.date(from: trip.start),
              let date = ISODateText.calendar.date(byAdding: .day, value: index, to: first) else { return nil }
        let parts = ISODateText.calendar.dateComponents([.month, .day], from: date)
        return "\(parts.month ?? 1)/\(parts.day ?? 1)"
    }
}

/// 그룹 제안 카드(§29·§36) — **서버가 만든 것을 그리기만 한다.**
/// 판정을 Swift로 복제하지 않는다: 같은 규칙 두 벌은 같은 상황에서 다른 답을 말하게 된다(§35).
/// 자동으로 적용하지 않는다 — 미리보기를 보이고 사람이 고른다(§79).
struct GroupProposalCard: View {
    let plan: GroupProposalView
    let isBusy: Bool
    let onAccept: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            // 제안의 서명. 앱 이름(With J)이 아니라 제안에만 붙는다.
            Text("From J")
                .font(.caption2.weight(.semibold))
                .padding(.horizontal, Space.s).padding(.vertical, 2)
                .background(Color.accentColor.opacity(0.15), in: Capsule())
                .foregroundStyle(Color.accentColor)

            Text(plan.summary).font(.headline)

            VStack(alignment: .leading, spacing: Space.s) {
                ForEach(plan.picks) { pick in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(pick.dayLabel) · \(pick.title)").font(.subheadline.weight(.medium))
                        // 이유는 서버가 준 문장 그대로다 — 여기서 다시 쓰지 않는다.
                        ForEach(pick.reasons, id: \.self) { reason in
                            Text(reason).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }

            if !plan.groupNotes.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(plan.groupNotes, id: \.self) { note in
                        Text(note).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }

            HStack(spacing: Space.s) {
                PrimaryActionButton(title: acceptLabel, isBusy: isBusy, action: onAccept)
                SecondaryActionButton(title: dismissLabel, action: onDismiss)
            }
        }
        .padding(.vertical, Space.xs)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("From J 제안: \(plan.summary)")
    }

    /// 문구는 서버가 준 것을 쓰되, 없으면 기본값으로 — 계약이 앞서 나가도 버튼이 비지 않게.
    private var acceptLabel: String {
        plan.options.first { $0.action == .accept }?.label ?? "이대로 할래요"
    }
    private var dismissLabel: String {
        plan.options.first { $0.action == .dismiss }?.label ?? "나중에"
    }
}
