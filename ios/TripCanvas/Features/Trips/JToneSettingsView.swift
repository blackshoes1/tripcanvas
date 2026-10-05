import SwiftUI

struct JToneSettingsView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(JTone.allCases, id: \.self) { tone in
                        Button {
                            Task { await env.jTone.select(tone) }
                        } label: {
                            HStack(alignment: .top, spacing: Space.m) {
                                VStack(alignment: .leading, spacing: Space.s) {
                                    Text(tone.label + (tone == .friendly ? " · 기본" : ""))
                                        .font(.headline).foregroundStyle(Ink.ink)
                                    Text(tone.example).font(.subheadline).foregroundStyle(Ink.soft)
                                }
                                Spacer(minLength: Space.s)
                                if env.jTone.selected == tone {
                                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Ink.accent)
                                }
                            }
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(env.jTone.isSaving)
                        .accessibilityValue(env.jTone.selected == tone ? "선택됨" : "")
                    }
                } header: {
                    Text("J가 어떻게 말하면 좋겠어요?")
                } footer: {
                    Text("J의 제안과 안내에 적용돼요. 언제든 바꿀 수 있어요.")
                }
                Section {
                    if env.jTone.isSaving { ProgressView("계정에 저장하는 중") }
                    if let message = env.jTone.message { Text(message).font(.footnote) }
                    else { Text("계정에 저장해 다른 기기에서도 이어져요.").font(.footnote) }
                    if env.jTone.pending, !env.jTone.isSaving {
                        Button("계정에 다시 저장") { Task { await env.jTone.select(env.jTone.selected) } }
                    }
                }
            }
            .navigationTitle("J의 말투")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("닫기") { dismiss() } } }
            .task { await env.jTone.load() }
        }
    }
}
