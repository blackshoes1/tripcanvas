import SwiftUI
import Observation

/// 초대 링크로 참여. 미리보기(이름·기간·역할)만 보고 결정하고, 여행 본문은 참여한 뒤에 내려온다(§67).
@Observable
@MainActor
final class JoinInviteViewModel {
    private(set) var preview: InvitePreview?
    private(set) var isLoading = false
    private(set) var isWorking = false
    private(set) var errorMessage: String?
    /// 참여에 성공한 여행 — 화면은 이걸 보고 목록을 새로 읽는다.
    private(set) var joined: InviteAccept?
    var displayName = ""

    let token: String
    private let service: CollabSource

    init(token: String, service: CollabSource, defaultName: String = "") {
        self.token = token
        self.service = service
        self.displayName = defaultName
    }

    var verdict: CollabModel.InviteVerdict { CollabModel.inviteVerdict(preview) }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            preview = try await service.previewInvite(token: token)
            errorMessage = nil
        } catch {
            preview = nil
            errorMessage = CollabModel.joinReasonText("NETWORK")
        }
    }

    func accept() async {
        guard verdict.ok else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            let result = try await service.acceptInvite(token: token, displayName: displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : displayName)
            if result.ok {
                joined = result
            } else {
                // 서버가 거절한 이유를 그대로 말한다 — 만료·취소·내보내짐.
                errorMessage = CollabModel.joinReasonText(result.reason)
                preview = nil
            }
        } catch {
            errorMessage = "참여하지 못했어요 — 잠시 후 다시 시도해 주세요"
        }
    }
}

/// `sheet(item:)`에 넘기기 위한 감싸개 — 토큰 문자열 자체가 신원이다.
struct JoinToken: Identifiable, Hashable {
    let value: String
    var id: String { value }

    init(_ value: String) { self.value = value }
}

/// 초대 카드. 링크가 유출돼도 여기 보이는 것은 이름·기간·역할까지다(§6).
struct JoinInviteView: View {
    let token: String
    var onJoined: ((InviteAccept) -> Void)?

    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @State private var model: JoinInviteViewModel?

    var body: some View {
        NavigationStack {
            Form {
                if let model {
                    Section {
                        if model.isLoading {
                            ProgressView()
                        } else {
                            Text(model.preview?.tripName ?? "초대").font(.title3.weight(.semibold))
                            if let preview = model.preview {
                                let range = CollabModel.inviteRangeText(start: preview.startDate, dayCount: preview.dayCount)
                                if !range.isEmpty { Text(range).font(.subheadline).foregroundStyle(.secondary) }
                                if let role = model.verdict.role {
                                    Text("\(CollabModel.roleIcon(role)) \(CollabModel.roleLabel(role)) 권한으로 참여")
                                        .font(.subheadline).foregroundStyle(.secondary)
                                }
                            }
                        }
                    } header: {
                        Text("여행에 초대받았어요")
                    } footer: {
                        let text = model.errorMessage ?? model.verdict.text
                        if !text.isEmpty { Text(text) }
                    }

                    if model.verdict.ok && !model.verdict.alreadyMember {
                        Section {
                            TextField("예: 영희", text: Binding(get: { model.displayName }, set: { model.displayName = $0 }))
                        } header: {
                            Text("이 여행에서 보일 내 이름")
                        } footer: {
                            Text("계정 이메일은 일행에게 보이지 않아요.")
                        }
                    }

                    if model.verdict.ok {
                        Section {
                            PrimaryActionButton(
                                title: model.verdict.alreadyMember ? "여행 열기" : "여행 참여하기",
                                isBusy: model.isWorking
                            ) {
                                Task { await model.accept() }
                            }
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Color.clear)
                        }
                    }
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("초대")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("나중에") { dismiss() } }
            }
            .task {
                if model == nil {
                    model = JoinInviteViewModel(token: token, service: env.service,
                                                defaultName: CollabModel.displayNameFromEmail(env.auth.email))
                }
                await model?.load()
            }
            .onChange(of: model?.joined) { _, joined in
                if let joined { onJoined?(joined); dismiss() }
            }
        }
    }
}
