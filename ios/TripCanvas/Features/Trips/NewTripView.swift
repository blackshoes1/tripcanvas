import SwiftUI
import Observation

/// 만드는 방식을 전환해 화면이 재생성되어도 상위 시트에서 계속 소유하는 입력이다.
@Observable
@MainActor
final class NewTripFormState {
    var city = ""
    var name = ""
    var nameEdited = false
    var start = Date()
    var dayCount = 3

    var draft: NewTripDraft {
        let typed = name.trimmingCharacters(in: .whitespaces)
        return NewTripDraft(name: typed.isEmpty ? NewTripView.fallbackName : typed,
                            start: ISODateText.text(from: start), dayCount: dayCount,
                            city: city.trimmingCharacters(in: .whitespaces))
    }
}

/// 새 여행 만들기 — **두 가지만 묻는다: 어디로, 언제.**
///
/// 그 이상(장소·숙소·예산)은 만든 뒤에 채우면 되는 것들이다. 처음 온 사람에게 빈 화면 대신
/// 질문 두 개를 주는 것이 이 화면의 전부다.
///
/// ⚠️ 도시는 **이름의 기본값**으로만 쓴다 — 여행 문서에 우리만 아는 필드를 새로 만들지 않는다.
struct NewTripView: View {
    /// 어떻게 시작할지 — 붙여넣기와 한 시트를 나눠 쓴다.
    @Binding var mode: CreateTripMode
    @Bindable var form: NewTripFormState
    /// 만들기. 실패하면 화면에 그대로 보여 줄 문구를 돌려준다(nil이면 성공).
    let onCreate: (NewTripDraft) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section { CreateTripModePicker(mode: $mode).disabled(isSaving) }
                Section {
                    TextField("가루이자와, 제주, 파리…", text: $form.city)
                        .textInputAutocapitalization(.never)
                        .onChange(of: form.city) { _, value in
                            guard !form.nameEdited else { return }
                            let trimmed = value.trimmingCharacters(in: .whitespaces)
                            form.name = trimmed.isEmpty ? "" : "\(trimmed) 여행"
                        }
                } header: {
                    Text("어디로 가세요?")
                } footer: {
                    Text("비워 두어도 됩니다. 여행 이름을 지어 주는 데만 씁니다.")
                }

                Section("언제 가세요?") {
                    DatePicker("시작일", selection: $form.start, displayedComponents: .date)
                    Stepper(value: $form.dayCount, in: 1...NewTripDraft.maxDays) {
                        HStack {
                            Text("기간")
                            Spacer()
                            Text("\(form.dayCount)일").foregroundStyle(.secondary)
                        }
                    }
                    LabeledContent("일정", value: rangeText)
                }

                Section {
                    TextField(NewTripView.fallbackName, text: $form.name)
                        .onChange(of: form.name) { _, _ in form.nameEdited = true }
                } header: {
                    Text("여행 이름")
                } footer: {
                    Text("비워 두면 ‘\(NewTripView.fallbackName)’으로 만들고, 나중에 바꿀 수 있어요.")
                }

                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red).font(.footnote) }
                }
            }
            .paperGround()
            .navigationTitle("새 여행")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") { dismiss() }.disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving { ProgressView() } else {
                        Button("만들기") { Task { await create() } }.disabled(!draft.isValid)
                    }
                }
            }
        }
        .interactiveDismissDisabled(isSaving)
    }

    /// 이름을 안 적었다고 막지 않는다 — 눌리지 않는 버튼은 이유를 말해 주지 못한다.
    static let fallbackName = "새 여행"

    private var draft: NewTripDraft { form.draft }

    /// "7월 21일 → 7월 24일" — 며칠인지 숫자로만 말하지 않는다. 끝나는 날이 보여야 정할 수 있다.
    private var rangeText: String {
        let end = ISODateText.calendar.date(byAdding: .day, value: max(0, form.dayCount - 1), to: form.start) ?? form.start
        let format = Date.FormatStyle.dateTime.month(.defaultDigits).day()
        return form.dayCount <= 1 ? form.start.formatted(format) : "\(form.start.formatted(format)) → \(end.formatted(format))"
    }

    private func create() async {
        guard draft.isValid, !isSaving else { return }
        isSaving = true
        errorMessage = nil
        let failure = await onCreate(draft)
        isSaving = false
        if let failure { errorMessage = failure } else { dismiss() }
    }
}
