import SwiftUI

/// 후보에 붙는 한마디. 채팅이 아니고 멘션도 없다 — 이 장소에 대한 짧은 의견이다(§14·§15).
/// 코멘트는 **후보에만** 붙는다: 일정의 장소에는 안정적인 id가 없다.
struct CandidateCommentsView: View {
    @State private var model: CandidateCommentsViewModel
    @Environment(\.dismiss) private var dismiss

    init(tripId: String, candidate: TripCandidate, service: CollabDataSource) {
        _model = State(initialValue: CandidateCommentsViewModel(tripId: tripId, candidate: candidate, service: service))
    }

    var body: some View {
        VStack(spacing: 0) {
            List {
                if let message = model.errorMessage {
                    InlineErrorBanner(message: "한마디를 불러오지 못했어요", detail: message) {
                        Task { await model.load() }
                    }
                    .listRowSeparator(.hidden)
                }
                if model.comments.isEmpty && !model.isLoading {
                    EmptyStateView(
                        symbol: "bubble.left",
                        title: "아직 한마디가 없어요",
                        message: "여기가 왜 좋은지, 언제 가면 좋을지 남겨 두면 일행이 정하기 쉬워요.")
                        .listRowSeparator(.hidden)
                }
                ForEach(model.comments) { comment in
                    VStack(alignment: .leading, spacing: Space.xs) {
                        Text(comment.body).font(.subheadline)
                        Text(comment.mine ? "나" : comment.authorLabel)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .swipeActions {
                        if comment.canDelete {
                            Button("지우기", role: .destructive) { Task { await model.delete(comment) } }
                        }
                    }
                }
            }
            .listStyle(.plain)

            if model.canComment {
                HStack(spacing: Space.s) {
                    TextField("한마디 남기기", text: $model.draft, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(1...3)
                    Button {
                        Task { await model.send() }
                    } label: {
                        if model.isSending { ProgressView().controlSize(.small) }
                        else { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                    }
                    .disabled(model.draft.trimmingCharacters(in: .whitespaces).isEmpty || model.isSending)
                }
                .padding(Space.m)
                .background(.bar)
            }
        }
        .navigationTitle(model.candidate.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button("닫기") { dismiss() } }
        }
        .task { await model.load() }
    }
}
