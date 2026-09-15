import SwiftUI

enum AdmissionRequirement: String, Codable, CaseIterable, Sendable {
    case required = "REQUIRED", recommended = "RECOMMENDED", notRequired = "NOT_REQUIRED", unknown = "UNKNOWN"
    var label: String {
        switch self { case .required: "예약 필수"; case .recommended: "예약 권장"; case .notRequired: "예약 없이 입장 가능"; case .unknown: "예약 요건 확인 필요" }
    }
}

struct SpotAdmission: Hashable, Sendable {
    var raw: [String: JSONValue] = [:]
    var requirement: AdmissionRequirement {
        get { AdmissionRequirement(rawValue: raw["requirement"]?.stringValue ?? "") ?? .unknown }
        set { set("requirement", .string(newValue.rawValue)) }
    }
    var isBooked: Bool {
        get { raw["personalStatus"]?.stringValue == "BOOKED" }
        set { set("personalStatus", .string(newValue ? "BOOKED" : "NOT_BOOKED")) }
    }
    var officialURL: String {
        get { raw["officialURL"]?.stringValue ?? "" }
        set { set("officialURL", newValue.isEmpty ? nil : .string(newValue)) }
    }
    var note: String {
        get { raw["note"]?.stringValue ?? "" }
        set { set("note", newValue.isEmpty ? nil : .string(newValue)) }
    }
    var people: Int {
        get { raw["people"]?.intValue ?? 1 }
        set { set("people", .number(newValue)) }
    }
    var checkedAt: String? { raw["checkedAt"]?.stringValue }
    mutating func confirm(now: Date) { set("checkedAt", .string(ISO8601DateFormatter().string(from: now))) }
    private mutating func set(_ key: String, _ value: JSONValue?) {
        raw["source"] = .string("USER")
        raw.setOrRemove(key, value)
        if raw["requirement"] == nil { raw["requirement"] = .string("UNKNOWN") }
    }
    static func safeURL(_ text: String) -> URL? {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              url.scheme?.lowercased() == "https", url.host != nil, url.user == nil, url.password == nil else { return nil }
        return url
    }
}

extension TripSpot {
    var admission: SpotAdmission {
        get { SpotAdmission(raw: raw["admission"]?.objectValue ?? [:]) }
        set { setField("admission", newValue.raw.isEmpty ? nil : .object(newValue.raw)) }
    }
    var needsReservation: Bool { admission.requirement == .required && !admission.isBooked }
}

struct PlaceAdmissionResponse: Decodable {
    let status: String
    let requirement: AdmissionRequirement
    let sourceURL: String?
    let checkedAt: String?
    let stale: Bool
}

/// 조회는 카드에서 요청할 때만. 현재 연결 상태를 그대로 말하고 사용자 확인 비용과 섞지 않는다.
struct PlaceAdmissionLookup: View {
    let provider: String?
    let providerID: String?
    @Environment(AppEnvironment.self) private var env
    @State private var response: PlaceAdmissionResponse?
    @State private var error: String?
    @State private var working = false

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            if let response {
                Text(response.status == "NOT_CONNECTED" ? "입장료·예약 요건 자동 조회가 아직 연결되지 않았어요." : response.requirement.label)
                    .font(.caption).foregroundStyle(.secondary)
                Text("공식 페이지에서 확인한 뒤 직접 입력할 수 있어요. 정보가 없다고 무료인 것은 아니에요.")
                    .font(.caption).foregroundStyle(.secondary)
                if let link = response.sourceURL.flatMap(SpotAdmission.safeURL) { Link("출처 확인", destination: link).frame(minHeight: 44) }
            }
            if let error { Text(error).font(.caption).foregroundStyle(.orange) }
            if let provider, let providerID {
                Button {
                    working = true
                    Task {
                        do {
                            response = try await env.service.api.get("/api/v1/places/details", query: [
                                URLQueryItem(name: "provider", value: provider), URLQueryItem(name: "id", value: providerID)])
                            error = nil
                        } catch { self.error = "참고 정보를 확인하지 못했어요. 직접 확인한 내용을 입력해 주세요." }
                        working = false
                    }
                } label: {
                    HStack { if working { ProgressView().controlSize(.small) }; Text(response == nil ? "입장료·예약 참고 정보 확인" : "참고 정보 다시 확인") }
                        .font(.subheadline).frame(minHeight: 44)
                }.disabled(working)
            } else {
                Text("장소를 검색해서 연결하면 참고 정보의 연결 상태를 확인할 수 있어요.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

struct AdmissionEditorSection: View {
    @Binding var spot: TripSpot
    var body: some View {
        Section {
            DisclosureGroup("명소 예약·입장 준비") {
                Picker("예약 요건", selection: $spot.admission.requirement) {
                    ForEach(AdmissionRequirement.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                Toggle("내 예약 완료", isOn: $spot.admission.isBooked)
                Stepper("예약 인원 \(spot.admission.people)명", value: $spot.admission.people, in: 1...100)
                TextField("공식 예약 페이지 https://", text: $spot.admission.officialURL)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                if let url = SpotAdmission.safeURL(spot.admission.officialURL) {
                    Link("공식 예약 페이지 열기", destination: url).frame(minHeight: 44)
                }
                TextField("권종·성인/어린이·적용 날짜 등", text: $spot.admission.note, axis: .vertical)
                Button("공식 정보를 지금 확인했어요") { spot.admission.confirm(now: Date()) }.frame(minHeight: 44)
                if let checked = spot.admission.checkedAt {
                    Text("직접 확인 · \(checked)").font(.caption).foregroundStyle(.secondary)
                }
                PlaceAdmissionLookup(provider: spot.kakaoId != nil ? "kakao" : (spot.placeId != nil ? "google" : nil),
                                     providerID: spot.kakaoId ?? spot.placeId)
            }
        } footer: {
            Text("직접 확인한 정보만 기록해 주세요. 예약 시각을 입력하거나 링크를 열어도 예약 완료로 바뀌지 않습니다. 금액은 비용에 별도로 입력합니다.")
        }
    }
}

/// 보기 권한에서도 현장에서 필요한 정보를 읽는다. 문서 변경이나 외부 정보 조회는 하지 않는다.
struct SpotInformationView: View {
    let spot: TripSpot
    let contextLabel: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if let contextLabel, !contextLabel.isEmpty {
                        Text(contextLabel).font(.caption).foregroundStyle(.secondary)
                    }
                    Text(spot.name).font(.title2.weight(.semibold))
                    if !spot.city.isEmpty { Text(spot.city).foregroundStyle(.secondary) }
                    if let address = spot.raw["addr"]?.stringValue, !address.isEmpty { Text(address) }
                    else { Text("주소 미정") }
                    if spot.point == nil { Label("위치 미정", systemImage: "mappin.slash").font(.caption) }
                }
                Section("시간 계획") {
                    information("내가 정한 도착", value: spot.arriveAt ?? "직접 정하지 않음")
                    information("예약·입장 시각", value: spot.bookedAt ?? "정하지 않음")
                    information("머무는 시간", value: spot.stayMinutes.map {
                        $0 == 0 ? "0분 · 바로 이동" : TimeFormat.duration($0)
                    } ?? "미정 · 현재 0분으로 계산")
                }
                Section {
                    information("예약 요건", value: spot.admission.requirement.label)
                    information("예약 상태", value: spot.admission.isBooked ? "예약 완료로 표시됨" : "예약 전·미완료")
                    if let people = spot.admission.raw["people"]?.intValue {
                        information("예약 인원", value: "\(people)명")
                    } else { information("예약 인원", value: "정하지 않음") }
                    if let url = SpotAdmission.safeURL(spot.admission.officialURL) {
                        Link("공식 예약 페이지 열기", destination: url).frame(minHeight: 44)
                    }
                    if !spot.admission.note.isEmpty { Text(spot.admission.note) }
                    if let checked = spot.admission.checkedAt {
                        Text("직접 확인 · \(checked)").font(.caption).foregroundStyle(.secondary)
                    }
                } header: { Text("예약·입장 준비") } footer: {
                    Text("여행에 기록된 정보입니다. 링크를 열어도 예약 완료로 바뀌지 않습니다.")
                }
                Section("기록한 비용") {
                    let entry = CostEntry(spot: spot)
                    if let amount = entry.amount {
                        Text("\(TimeFormat.money(amount, currency: entry.currency.rawValue)) · \(entry.currency.rawValue)")
                        if entry.isPartial { Text("일부 금액만 확인").font(.caption) }
                        else if amount == 0 { Text("확인한 무료").font(.caption) }
                        Text(entry.basis.label).font(.caption).foregroundStyle(.secondary)
                        if entry.basis != .entered { Text("\(entry.people)명 적용").font(.caption) }
                    } else {
                        Text("비용 미정").foregroundStyle(.secondary)
                    }
                }
                if !spot.desc.isEmpty { Section("메모") { Text(spot.desc) } }
            }
            .listStyle(.insetGrouped)
            .paperGround()
            .foregroundStyle(Ink.ink)
            .tint(Ink.accent)
            .textSelection(.enabled)
            .navigationTitle("장소 정보")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("닫기") { dismiss() }.frame(minHeight: 44)
                }
            }
        }
    }

    private func information(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value)
        }
        .accessibilityElement(children: .combine)
    }
}
