import SwiftUI

/// 일정을 자동으로 바꾸지 않는다(§18). 무엇이 어떻게 달라지는지 먼저 보여주고 사용자가 정한다.
struct ReplanCard: View {
    let suggestion: TripSuggestion
    let preview: ReplanPreview
    let isBusy: Bool
    var tone: JTone = .friendly
    let onApply: () -> Void
    let onKeep: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            Label("일정 조정 제안", systemImage: "arrow.triangle.branch")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Ink.warning)

            Text(headline).font(.headline)

            // 무엇을 빼면 어떻게 되는지 — 엔진 문장 그대로다(맞출 수 없으면 그 사실과 다음 길까지 말한다)
            if !suggestion.description.isEmpty {
                Text(suggestion.description)
                    .font(.subheadline)
                    .foregroundStyle(Ink.soft)
            }

            VStack(alignment: .leading, spacing: Space.s) {
                ComparisonRow(label: "기존", names: preview.before, muted: true)
                ComparisonRow(label: "제안", names: preview.after, muted: false)
            }
            .padding(Space.m)
            .background(Ink.sunken, in: RoundedRectangle(cornerRadius: Radius.control))

            if !preview.dropNames.isEmpty {
                Text(dropNote)
                    .font(.caption)
                    .foregroundStyle(Ink.soft)
            }

            HStack(spacing: Space.s) {
                PrimaryActionButton(title: "이대로 조정", systemImage: "checkmark", isBusy: isBusy, action: onApply)
                SecondaryActionButton(title: "그대로 두기", expands: false, action: onKeep)
            }
        }
        .card()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("일정 조정 제안. \(headline)")
    }

    /// 제목은 서버(엔진)가 쓴다 — '이대로면 광장시장 11:45 예약에 25분 늦어요'.
    /// 2026-10-03 전에는 앱이 'N분 늦어지고 있어요'를 따로 만들어, 아직 늦지 않았는데 늦었다고 말했다(웹은 엔진 문장이었다).
    private var headline: String { suggestion.title.isEmpty ? JCopy.text("replan.simulated", tone: tone) : suggestion.title }

    private var dropNote: String {
        if let note = preview.note, !note.isEmpty { return note }
        // 옛 서버 — 같은 문장을 조사까지 맞춰 만든다
        let names = preview.dropNames.joined(separator: ", ")
        let topic = names + Self.topicParticle(preview.dropNames.last ?? "")
        return JCopy.text(preview.movesToNextDay ? "replan.moveNote" : "replan.skipNote", params: ["topic": topic], tone: tone)
    }

    /// 은/는 — 받침이 있으면 '은'. 한글이 아니면 '는'(엔진 `josa`와 같은 규칙).
    static func topicParticle(_ word: String) -> String {
        guard let last = word.trimmingCharacters(in: .whitespaces).unicodeScalars.last else { return "는" }
        let code = Int(last.value) - 0xAC00
        guard code >= 0 && code <= 11171 else { return "는" }
        return code % 28 == 0 ? "는" : "은"
    }
}

private struct ComparisonRow: View {
    let label: String
    let names: [String]
    let muted: Bool

    var body: some View {
        HStack(alignment: .top, spacing: Space.s) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Ink.soft)
                .frame(width: 32, alignment: .leading)
            Text(names.isEmpty ? "없음" : names.joined(separator: " → "))
                .font(.caption)
                .foregroundStyle(muted ? Ink.soft : Ink.ink)
                .strikethrough(muted)
        }
        .accessibilityElement(children: .combine)
    }
}
