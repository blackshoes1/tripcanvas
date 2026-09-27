import SwiftUI

/// 설명 슬라이드가 아니라 열어 볼 수 있는 여행. 계정·네트워크·사용자 저장소를 사용하지 않는다.
struct SampleTripView: View {
    @Environment(\.dismiss) private var dismiss
    let onStart: () -> Void
    @State private var day = 0
    @State private var section = "일정"
    @State private var checked: Set<String> = []
    private let days: [(title: String, places: [(time: String, name: String, note: String)])] = [
        ("제주에 도착하는 날", [("11:00", "제주공항", "도착 후 짐을 찾고 점심을 먹어요. 항공편 도착 시각에 맞춰 첫 일정을 정해 보세요."),
                          ("14:00", "함덕해수욕장", "바다를 보고 산책해요. 실제 여행에서는 머무를 시간과 이동수단을 바꿀 수 있어요."),
                          ("17:00", "샘플 숙소", "예약과 숙소 장소를 연결하면 일정에서 예약 정보를 찾을 수 있어요.")]),
        ("동쪽 바다를 따라", [("09:00", "성산일출봉", "날씨와 컨디션을 보고 일정을 조정해 보세요. 이 샘플의 시각은 실제 이동 시간을 계산한 결과가 아니에요."),
                        ("12:00", "점심과 카페", "가고 싶은 곳을 담고 날짜와 순서를 정해요."),
                        ("16:00", "제주공항", "출발 전에 예약번호와 준비 메모를 다시 확인해요.")])
    ]
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("제주에서 보내는 이틀").font(Typeface.editorial(.title))
                    Text("샘플 여행 · 예시 일정과 예약이에요. 변경은 계정에 저장되지 않아요.").font(.footnote).foregroundStyle(Ink.soft)
                    Picker("둘러볼 화면", selection: $section) {
                        Text("일정").tag("일정"); Text("예약").tag("예약"); Text("준비 메모").tag("준비 메모")
                    }.pickerStyle(.segmented)
                }
                if section == "일정" {
                    Section {
                        Picker("날짜", selection: $day) {
                            Text("Day 1").tag(0); Text("Day 2").tag(1)
                        }.pickerStyle(.segmented)
                        ForEach(days[day].places, id: \.name) { place in
                            NavigationLink {
                                List {
                                    Section(place.name) {
                                        Label(place.time, systemImage: "clock")
                                        Text(place.note)
                                    }
                                    Section {} footer: { Text("실제 여행에서는 장소 정보·예약·머무를 시간을 여기서 확인하고 고칠 수 있어요.") }
                                }.navigationTitle("장소 정보")
                            } label: {
                                HStack(spacing: Space.l) {
                                    Text(place.time).font(.subheadline.monospacedDigit()).foregroundStyle(Ink.soft)
                                    Text(place.name).font(.headline)
                                }.frame(minHeight: 44)
                            }
                        }
                    } header: { Text(days[day].title) }
                } else if section == "예약" {
                    Section("예시 예약") {
                        DisclosureGroup("샘플 숙소 · 1박") {
                            LabeledContent("예약번호", value: "SAMPLE-001")
                            LabeledContent("금액", value: "120,000원 · 예시")
                            Text("실제 예약에서는 취소 조건과 결제 상태를 확인할 수 있어요. 이 예약은 체험용이에요.")
                        }
                    }
                } else {
                    Section("눌러서 준비 상태를 바꿔 보세요") {
                        ForEach(["신분증 챙기기", "숙소 체크인 시간 확인", "충전기와 우산 챙기기"], id: \.self) { title in
                            Button {
                                if checked.contains(title) { checked.remove(title) } else { checked.insert(title) }
                            } label: {
                                Label(title, systemImage: checked.contains(title) ? "checkmark.circle.fill" : "circle")
                                    .frame(minHeight: 44)
                            }.accessibilityValue(checked.contains(title) ? "확인 완료" : "준비 중")
                        }
                    }
                }
            }
            .paperGround()
            .navigationTitle("샘플 여행")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } } }
            .safeAreaInset(edge: .bottom) {
                Button("내 여행 만들기") { dismiss(); onStart() }
                    .prominentButton().padding().frame(maxWidth: .infinity).background(Ink.paper)
            }
        }
    }
}
