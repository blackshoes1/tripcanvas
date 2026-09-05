import SwiftUI
import UIKit

/// 함께하기 — 멤버 · 초대 · 여행 취향 · 최근 활동(§56). 웹의 함께하기 모달과 같은 절이다.
///
/// 보기 권한은 의견(취향)만 남긴다. 초대·역할·내보내기는 주최자만 보이고, 서버도 같은 경계로 거절한다.
struct CollabView: View {
    let trip: TripSummary
    /// 나갔을 때 목록으로 돌아가기 위해 — 이 여행은 더 이상 내 것이 아니다.
    var onLeft: (() -> Void)?

    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @State private var model: CollabViewModel?
    @State private var nameDraft = ""
    @State private var prefsDraft = TripPrefs()
    @State private var prefsLoaded = false
    @State private var inviteRole: MemberRole = .editor
    @State private var removing: MemberView?
    @State private var showsLeaveConfirm = false

    var body: some View {
        List {
            if let model {
                if let error = model.errorMessage {
                    Section {
                        InlineErrorBanner(message: "처리하지 못했어요", detail: error) {
                            model.dismissError()
                            Task { await model.load() }
                        }
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    }
                }
                membersSection(model)
                myNameSection(model)
                if model.canManage { inviteSection(model) }
                prefsSection(model)
                activitySection(model)
                if model.canLeave {
                    Section {
                        Button("여행에서 나가기", role: .destructive) { showsLeaveConfirm = true }
                    } footer: {
                        Text("나가면 이 여행이 목록에서 사라져요. 다시 들어오려면 새 초대 링크가 필요합니다.")
                    }
                }
            } else {
                ProgressView()
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("함께하기")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let model {
                ToolbarItem(placement: .topBarTrailing) {
                    StatusChip(text: "나: \(CollabModel.roleIcon(model.role)) \(CollabModel.roleLabel(model.role))", symbol: "person")
                }
            }
        }
        .refreshable { await model?.load() }
        .task {
            if model == nil { model = CollabViewModel(trip: trip, service: env.service, webBaseURL: AppConfig.webBaseURL) }
            await model?.load()
            syncDrafts()
        }
        .onChange(of: model?.preferences) { _, _ in syncDrafts() }
        // 저장하면 서버가 정규화한 값이 이긴다 — 서버가 떨어뜨린 값이 입력칸에 남아 있으면 안 된다.
        .onChange(of: model?.prefsSaveStamp) { _, _ in
            if let model { prefsDraft = model.myPrefs }
        }
        .onChange(of: model?.hasLeft) { _, left in
            if left == true { onLeft?(); dismiss() }
        }
        .overlay(alignment: .bottom) {
            if let model, let toast = model.toast {
                ToastView(text: toast)
                    .padding(Space.l)
                    .task {
                        try? await Task.sleep(for: .seconds(2))
                        model.clearToast()
                    }
            }
        }
        .confirmationDialog("\"\(trip.name)\" 여행에서 나갈까요?", isPresented: $showsLeaveConfirm, titleVisibility: .visible) {
            Button("나가기", role: .destructive) { Task { await model?.leave() } }
        } message: {
            Text("이 여행이 내 목록에서 사라져요. 실제 일정은 남은 멤버에게 그대로 있습니다.")
        }
        .confirmationDialog(
            "\(removing.map(CollabModel.memberName) ?? "멤버") 님을 이 여행에서 내보낼까요?",
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            titleVisibility: .visible
        ) {
            Button("내보내기", role: .destructive) {
                if let member = removing { Task { await model?.remove(memberId: member.id) } }
                removing = nil
            }
        }
    }

    private func syncDrafts() {
        guard let model else { return }
        if let me = model.me { nameDraft = me.displayName ?? "" }
        if !prefsLoaded || prefsDraft == TripPrefs() { prefsDraft = model.myPrefs; prefsLoaded = true }
    }

    // MARK: 멤버

    private func membersSection(_ model: CollabViewModel) -> some View {
        Section {
            if model.isLoading && model.members.isEmpty {
                ProgressView()
            }
            ForEach(model.members) { member in
                HStack(spacing: Space.s) {
                    Text(CollabModel.roleIcon(member.role))
                    Text(CollabModel.memberName(member))
                    if member.me { Text("(나)").font(.caption).foregroundStyle(.secondary) }
                    Spacer()
                    if model.canManage && member.role != .owner {
                        Menu {
                            Picker("권한", selection: Binding(
                                get: { member.role },
                                set: { role in Task { await model.setRole(memberId: member.id, role: role) } })) {
                                Text("✏️ 편집").tag(MemberRole.editor)
                                Text("👀 보기").tag(MemberRole.viewer)
                            }
                            Button("내보내기", role: .destructive) { removing = member }
                        } label: {
                            StatusChip(text: CollabModel.roleLabel(member.role), symbol: "chevron.down")
                        }
                        .accessibilityLabel("\(CollabModel.memberName(member)) 권한")
                    } else {
                        Text(CollabModel.roleLabel(member.role)).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        } header: {
            Text("멤버 \(model.members.count)명")
        } footer: {
            Text("편집자는 일정을 바꿀 수 있고, 보기 권한은 볼 수만 있어요. 의견(반응·한마디·취향)은 누구나 남깁니다.")
        }
    }

    private func myNameSection(_ model: CollabViewModel) -> some View {
        Section {
            HStack {
                TextField("예: 영희", text: $nameDraft)
                    .textInputAutocapitalization(.never)
                Button("저장") { Task { await model.rename(nameDraft) } }
                    .disabled(model.isWorking || nameDraft.trimmingCharacters(in: .whitespaces).isEmpty
                              || nameDraft.trimmingCharacters(in: .whitespaces) == (model.me?.displayName ?? ""))
            }
        } header: {
            Text("이 여행에서 보일 내 이름")
        } footer: {
            Text("계정 이메일은 일행에게 보이지 않아요. 이름을 정하지 않으면 역할로 불립니다.")
        }
    }

    // MARK: 초대 — 주최자만

    private func inviteSection(_ model: CollabViewModel) -> some View {
        Section {
            Picker("초대 권한", selection: $inviteRole) {
                Text("✏️ 편집자로").tag(MemberRole.editor)
                Text("👀 보기만").tag(MemberRole.viewer)
            }
            Button {
                Task { await model.createInvite(role: inviteRole) }
            } label: {
                Label("초대 링크 만들기", systemImage: "link")
            }
            .disabled(model.isWorking)
            if let link = model.createdInviteLink {
                VStack(alignment: .leading, spacing: Space.s) {
                    Text(link).font(.caption.monospaced()).textSelection(.enabled).lineLimit(3)
                    HStack(spacing: Space.m) {
                        ShareLink(item: link) { Label("보내기", systemImage: "square.and.arrow.up") }
                        Button {
                            UIPasteboard.general.string = link
                        } label: { Label("복사", systemImage: "doc.on.doc") }
                        Spacer()
                        Button("닫기") { model.clearCreatedInvite() }.font(.caption)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }
            ForEach(model.invites) { invite in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(CollabModel.roleIcon(invite.role)) \(CollabModel.roleLabel(invite.role)) 초대 링크")
                            .font(.subheadline)
                        Text(inviteMeta(invite)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("취소") { Task { await model.revokeInvite(id: invite.id) } }
                        .font(.caption)
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }
            }
        } header: {
            Text("초대")
        } footer: {
            Text("링크는 7일 동안 유효하고 웹 주소예요 — 받는 사람은 웹이나 앱 어디서든 참여할 수 있어요. 링크가 새면 취소하세요.")
        }
    }

    private func inviteMeta(_ invite: InviteView) -> String {
        var parts: [String] = []
        if let date = ISODateText.parseTimestamp(invite.expiresAt) {
            let components = ISODateText.calendar.dateComponents([.month, .day], from: date)
            parts.append("\(components.month ?? 1)/\(components.day ?? 1)까지")
        }
        if invite.useCount > 0 { parts.append("\(invite.useCount)명 참여") }
        return parts.joined(separator: " · ")
    }

    // MARK: 여행 취향 — 이 여행에 대한 것. 보기 권한도 남긴다

    private func prefsSection(_ model: CollabViewModel) -> some View {
        Section {
            ForEach(model.groupContext, id: \.self) { line in
                Text(line).font(.subheadline)
            }
            Picker("페이스", selection: $prefsDraft.pace) {
                Text("안 정함").tag(PrefPace?.none)
                ForEach(PrefPace.allCases, id: \.self) { Text($0.label).tag(PrefPace?.some($0)) }
            }
            Picker("걷기", selection: $prefsDraft.walking) {
                Text("안 정함").tag(PrefWalking?.none)
                ForEach(PrefWalking.allCases, id: \.self) { Text($0.label).tag(PrefWalking?.some($0)) }
            }
            Picker("아침 일찍", selection: $prefsDraft.morning) {
                Text("안 정함").tag(Bool?.none)
                Text("괜찮아요").tag(Bool?.some(true))
                Text("어려워요").tag(Bool?.some(false))
            }
            Picker("늦은 밤", selection: $prefsDraft.night) {
                Text("안 정함").tag(Bool?.none)
                Text("좋아요").tag(Bool?.some(true))
                Text("싫어요").tag(Bool?.some(false))
            }
            TopicChips(title: "관심", topics: CollabModel.topics, selected: prefsDraft.interests, tint: .accentColor) { prefsDraft.toggleInterest($0) }
            TopicChips(title: "별로", topics: CollabModel.topics, selected: prefsDraft.dislikes, tint: .orange) { prefsDraft.toggleDislike($0) }
            TextField("한 줄 (예: 신혼여행이라 여유롭게)", text: $prefsDraft.note)
            Button {
                Task { await model.savePrefs(prefsDraft) }
            } label: {
                Label("내 취향 저장", systemImage: "checkmark")
            }
            .disabled(model.isWorking || prefsDraft == model.myPrefs)
            ForEach(model.preferences.filter { !$0.mine }) { row in
                let text = TripPrefs(raw: row.prefs).text
                Text("\(row.label.trimmingCharacters(in: .whitespaces).isEmpty ? "멤버" : row.label): \(text.isEmpty ? "아직 안 남겼어요" : text)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("여행 취향")
        } footer: {
            Text("이 여행에 대한 취향이에요. 결정은 하지 않고, 어디가 맞고 어디가 갈리는지만 정리합니다.")
        }
    }

    // MARK: 최근 활동 — 문장은 CollabModel이 만든다

    private func activitySection(_ model: CollabViewModel) -> some View {
        Section {
            if model.activity.isEmpty {
                Text("아직 기록이 없어요. 일행이 후보를 담거나 일정을 바꾸면 여기에 쌓여요.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(model.activity) { row in
                let text = CollabModel.activityText(row.event, count: row.count)
                if !text.isEmpty {
                    HStack(alignment: .top) {
                        Text(text).font(.subheadline)
                        Spacer()
                        Text(CollabModel.relativeTime(row.event.createdAt)).font(.caption2).foregroundStyle(.tertiary)
                    }
                }
            }
        } header: {
            Text("최근 활동")
        } footer: {
            Text("실시간 연결은 아직 없어요. 당겨서 새로고침하면 최신 활동을 불러옵니다.")
        }
    }
}

/// 주제 칩 — 한 번의 탭. 같은 주제가 관심과 별로에 동시에 있을 수 없다.
struct TopicChips: View {
    let title: String
    let topics: [String]
    let selected: [String]
    let tint: Color
    let toggle: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            FlowLayout(spacing: Space.s) {
                ForEach(topics, id: \.self) { topic in
                    let on = selected.contains(topic)
                    Button { toggle(topic) } label: {
                        Text(topic)
                            .font(.caption.weight(on ? .semibold : .regular))
                            .padding(.horizontal, Space.m)
                            .padding(.vertical, Space.xs + 2)
                            .background(on ? tint.opacity(0.18) : Color(.tertiarySystemFill), in: Capsule())
                            .foregroundStyle(on ? tint : .primary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? [.isSelected] : [])
                }
            }
        }
        .padding(.vertical, Space.xs)
    }
}

/// 칩이 줄을 넘어가게 — 12개 주제는 한 줄에 들어가지 않는다.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: width == .infinity ? x : width, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX { x = bounds.minX; y += rowHeight + spacing; rowHeight = 0 }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
