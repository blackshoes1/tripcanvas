import SwiftUI

/// 가고 싶은 곳 — 아직 일정이 아닌 것들.
///
/// 화면이 정하는 것은 없다. 묶음의 순서도, 배지의 문장도, 갈렸을 때의 선택지도 서버가 준 그대로다.
/// **인기가 많다고 자동으로 일정에 들어가지 않는다**(§12·§79) — 넣는 것은 언제나 사람이 누른다.
struct CandidateBoardView: View {
    @State private var model: CandidateBoardViewModel
    @State private var isAdding = false
    @State private var newTitle = ""
    @State private var newNote = ""
    private let service: CollabDataSource

    init(trip: TripSummary, service: CollabDataSource) {
        self.service = service
        _model = State(initialValue: CandidateBoardViewModel(trip: trip, service: service))
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Space.l) {
                if let message = model.errorMessage {
                    InlineErrorBanner(message: "후보를 불러오지 못했어요", detail: message) {
                        Task { await model.load() }
                    }
                }
                if let proposal = model.proposal, model.canPropose {
                    ProposalCard(proposal: proposal,
                                 accept: { Task { await model.acceptProposal(proposal) } },
                                 dismiss: { model.dismissProposal() })
                }
                if !model.groupContext.isEmpty {
                    GroupContextCard(lines: model.groupContext)
                }
                if model.groups.isEmpty && !model.isLoading {
                    EmptyStateView(
                        symbol: "heart.text.square",
                        title: "아직 담은 곳이 없어요",
                        message: model.canPropose
                            ? "가고 싶은 곳을 담아 두면 일행이 의견을 남길 수 있어요."
                            : "일행이 담은 곳에 의견을 남길 수 있어요.")
                }
                ForEach(model.groups) { group in
                    if !group.candidates.isEmpty {
                        VStack(alignment: .leading, spacing: Space.m) {
                            Text(group.title)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.secondary)
                            ForEach(group.candidates) { candidate in
                                CandidateCard(
                                    candidate: candidate,
                                    canReact: model.canReact,
                                    isBusy: model.pending.contains(candidate.id),
                                    tripId: model.trip.id,
                                    service: service,
                                    react: { reaction in Task { await model.react(candidate, reaction) } },
                                    manage: { action in Task { await model.manage(candidate, action) } })
                            }
                        }
                    }
                }
            }
            .padding(Space.l)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("가고 싶은 곳")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if model.canPropose {
                ToolbarItem(placement: .primaryAction) {
                    Button { isAdding = true } label: { Label("담기", systemImage: "plus") }
                }
            }
        }
        .refreshable { await model.load() }
        .task { await model.load() }
        .overlay { if model.isLoading && model.groups.isEmpty { ProgressView() } }
        .sheet(isPresented: $isAdding) {
            AddCandidateSheet(title: $newTitle, note: $newNote) {
                Task {
                    await model.addCandidate(title: newTitle, note: newNote.isEmpty ? nil : newNote)
                    newTitle = ""; newNote = ""; isAdding = false
                }
            }
        }
        .toast(model.toast) { model.clearToast() }
    }
}

/// 한 후보. 배지 문장은 서버가 준 것을 그대로 쓴다 — 점수는 아예 오지 않는다(§21·§22).
private struct CandidateCard: View {
    let candidate: TripCandidate
    let canReact: Bool
    let isBusy: Bool
    let tripId: String
    let service: CollabDataSource
    let react: (ReactionKind) -> Void
    let manage: (CollabService.CandidateAction) -> Void

    @State private var showComments = false

    var body: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            HStack(alignment: .firstTextBaseline) {
                Text(candidate.title).font(.headline)
                Spacer()
                StatusChip(text: candidate.verdict.text, symbol: symbol, tint: tint)
            }
            HStack(spacing: Space.s) {
                Text(candidate.proposedBy)
                if !candidate.reactionSummary.isEmpty {
                    Text("·")
                    Text(candidate.reactionSummary)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            if let note = candidate.note, !note.isEmpty {
                Text(note).font(.subheadline).foregroundStyle(.secondary)
            }

            if canReact && candidate.status != .rejected {
                HStack(spacing: Space.s) {
                    ForEach([ReactionKind.must, .ok, .pass], id: \.rawValue) { kind in
                        ReactionButton(kind: kind, isOn: candidate.myReaction == kind, isBusy: isBusy) { react(kind) }
                    }
                }
            }

            // 갈렸다고 자동으로 빼지 않는다 — 선택지를 보이고 사람이 고른다(§23·§24).
            if let conflict = candidate.conflict, candidate.status == .proposed {
                ConflictPanel(conflict: conflict, isBusy: isBusy) { action in
                    switch action {
                    case "SCHEDULE": manage(.schedule)
                    case "REJECT": manage(.reject)
                    default: break
                    }
                }
            }

            HStack(spacing: Space.m) {
                Button { showComments = true } label: {
                    Label(candidate.commentCount > 0 ? "한마디 \(candidate.commentCount)" : "한마디",
                          systemImage: "bubble.left")
                        .font(.caption.weight(.semibold))
                }
                Spacer()
                if candidate.status == .rejected {
                    Button("되돌리기") { manage(.reopen) }.font(.caption.weight(.semibold))
                }
                if candidate.canRemove {
                    Button("빼기", role: .destructive) { manage(.remove) }.font(.caption)
                }
            }
            .disabled(isBusy)
        }
        .card()
        .sheet(isPresented: $showComments) {
            NavigationStack {
                CandidateCommentsView(tripId: tripId, candidate: candidate, service: service)
            }
        }
    }

    private var tint: Color {
        switch candidate.verdict.tone {
        case .good: .green
        case .split: .orange
        case .mixed: .blue
        case .quiet, .unknown: .secondary
        }
    }
    private var symbol: String {
        switch candidate.verdict.tone {
        case .good: "checkmark.circle"
        case .split: "arrow.triangle.branch"
        case .mixed: "ellipsis.circle"
        case .quiet, .unknown: "clock"
        }
    }
}

private struct ReactionButton: View {
    let kind: ReactionKind
    let isOn: Bool
    let isBusy: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(kind.label, systemImage: kind.symbol)
                .font(.caption.weight(.semibold))
                .labelStyle(.titleAndIcon)
                .frame(minHeight: 44)
                .padding(.horizontal, Space.m)
        }
        .buttonStyle(.bordered)
        .tint(isOn ? .accentColor : .secondary)
        .disabled(isBusy)
        .accessibilityAddTraits(isOn ? [.isSelected] : [])
    }
}

private struct ConflictPanel: View {
    let conflict: CandidateConflict
    let isBusy: Bool
    let choose: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            Text(who).font(.caption).foregroundStyle(.secondary)
            ForEach(conflict.options, id: \.key) { option in
                VStack(alignment: .leading, spacing: 2) {
                    if let action = option.action {
                        Button(option.title) { choose(action) }
                            .font(.caption.weight(.semibold))
                            .disabled(isBusy)
                    } else {
                        Text(option.title).font(.caption.weight(.semibold))
                    }
                    Text(option.text).font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .padding(Space.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: Radius.card))
    }

    private var who: String {
        let must = conflict.must.joined(separator: ", ")
        let pass = conflict.pass.joined(separator: ", ")
        return "\(must)은(는) 꼭 가고 싶고 \(pass)은(는) 이번엔 패스예요"
    }
}

/// 그룹 제안은 **미리보기**다 — 누르기 전에는 아무것도 저장되지 않는다(§79).
private struct ProposalCard: View {
    let proposal: GroupProposal
    let accept: () -> Void
    let dismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            Text(proposal.headline).font(.subheadline.weight(.semibold))
            ForEach(proposal.picks) { pick in
                VStack(alignment: .leading, spacing: 2) {
                    Text("Day \(pick.dayIndex + 1) · \(pick.title)").font(.caption.weight(.semibold))
                    ForEach(pick.reasons, id: \.self) { reason in
                        Text(reason).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            HStack(spacing: Space.m) {
                PrimaryActionButton(title: "일정으로 만들기", systemImage: "calendar.badge.plus", action: accept)
                SecondaryActionButton(title: "나중에", action: dismiss)
            }
        }
        .card()
    }
}

/// 정리만 한다 — 자동으로 빼자고 하지 않는다(§62).
private struct GroupContextCard: View {
    let lines: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            ForEach(lines, id: \.self) { line in
                Text(line).font(.caption).foregroundStyle(.secondary)
            }
        }
        .card()
    }
}

private struct AddCandidateSheet: View {
    @Binding var title: String
    @Binding var note: String
    let save: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("어디를 담을까요") {
                    TextField("장소 이름", text: $title)
                    TextField("한마디 (선택)", text: $note, axis: .vertical)
                }
            }
            .navigationTitle("가고 싶은 곳 담기")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("담기", action: save)
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}
