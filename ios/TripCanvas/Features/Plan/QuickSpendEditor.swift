import SwiftUI

/// 현지에서 방금 쓴 돈을 적는 **가장 짧은 길** — 금액부터 친다.
///
/// 정산은 가계부와 손이 다르다. 가기 전에 낸 항공·숙박은 결제 뒤에 앉아서 적지만, 현지에서는
/// 계산대 앞에서 "얼마 · 뭐에" 두 가지만 남기고 싶다. 그래서 분류·통화·1인 기준·일부 확인을 다 묻는
/// `CostEntryEditor` 대신 이것을 먼저 연다. 낸 돈이니 **결제 상태는 묻지 않고 결제로 둔다.**
/// 통화는 마지막에 쓴 것을 기억한다 — 여행 내내 같은 통화다.
/// 자세한 기준은 나중에 하루 비용에서 같은 항목을 열어 고칠 수 있다(같은 `costItems`다).
struct QuickSpendEditor: View {
    let dayLabel: String
    let onSave: (CostEntry) async -> Bool

    @AppStorage("tc.quickSpend.currency") private var lastCurrency = Currency.krw.rawValue
    @State private var amount = ""
    @State private var title = ""
    @State private var kind: CostCategory = .food
    @State private var currency: Currency = .krw
    @State private var photos: [String] = []
    @State private var saving = false
    @State private var failed = false
    @FocusState private var amountFocused: Bool
    @Environment(\.dismiss) private var dismiss

    /// 현지에서 쓰는 돈의 분류만 — 항공·숙박·렌트는 가계부의 것이다.
    private static let kinds: [CostCategory] = [.food, .shopping, .ticket, .transport, .transit, .other]

    private var parsedAmount: Double? { MoneyInput.amount(from: amount, currency: currency) }
    private var valid: Bool { parsedAmount != nil }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: Space.s) {
                        TextField("얼마", text: $amount)
                            .keyboardType(.decimalPad)
                            .font(.title2.weight(.semibold))
                            .focused($amountFocused)
                        Picker("통화", selection: $currency) {
                            ForEach(Currency.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                        }
                        .labelsHidden()
                    }
                    TextField("뭐에 썼나요 (비우면 분류 이름)", text: $title)
                } header: {
                    Text(dayLabel)
                } footer: {
                    Text("낸 돈으로 적어요. 1인 금액·일부 확인 같은 기준은 하루 비용에서 같은 항목을 열어 고칠 수 있어요.")
                }
                Section("분류") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: Space.s) {
                            ForEach(Self.kinds, id: \.rawValue) { category in
                                Button {
                                    kind = category
                                } label: {
                                    Text(category.label)
                                        .font(.subheadline.weight(kind == category ? .semibold : .regular))
                                        .padding(.horizontal, Space.m)
                                        .frame(minHeight: 36)
                                        .background(kind == category ? Ink.accent.opacity(0.16) : Ink.sunken, in: Capsule())
                                        .foregroundStyle(kind == category ? Ink.accent : Ink.ink)
                                }
                                .buttonStyle(.plain)
                                .accessibilityAddTraits(kind == category ? [.isSelected] : [])
                            }
                        }
                        .padding(.vertical, Space.xs)
                    }
                }
                Section {
                    CostPhotosField(refs: $photos)
                } header: { Text("영수증 사진") } footer: {
                    Text("사진 자체는 올리지 않고 이 기기 사진 보관함의 위치만 기억해요.")
                }
                if failed { Section { Text("저장하지 못했어요. 입력 내용은 유지되어 있어요.").foregroundStyle(.orange) } }
            }
            .paperGround()
            .tint(Ink.accent)
            .navigationTitle("쓴 돈 적기")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("저장") { Task { await save() } }.disabled(!valid || saving)
                }
            }
            .onAppear {
                currency = Currency(rawValue: lastCurrency) ?? .krw
                amountFocused = true
            }
        }
    }

    /// 저장되는 모양은 `CostEntryEditor`가 만드는 하루 추가 비용과 같다 — 다른 길로 들어왔다고 다른 항목이 아니다.
    static func entry(amount: Double, title: String, kind: CostCategory, currency: Currency, photos: [String]) -> CostEntry {
        var entry = CostEntry(raw: ["id": .string(UUID().uuidString), "costBasis": .string(CostBasis.total.rawValue)])
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        entry.title = name.isEmpty ? kind.label : name
        entry.kind = kind.rawValue
        entry.amount = amount
        entry.currency = currency
        entry.payState = .paid
        entry.photos = photos
        return entry
    }

    private func save() async {
        guard !saving, let value = parsedAmount else { return }
        saving = true
        defer { saving = false }
        lastCurrency = currency.rawValue
        let entry = Self.entry(amount: value, title: title, kind: kind, currency: currency, photos: photos)
        if await onSave(entry) { dismiss() } else { failed = true }
    }
}
