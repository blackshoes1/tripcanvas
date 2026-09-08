import SwiftUI

/// 여행을 시작하는 두 길. **한 시트 안에 나란히 둔다.**
///
/// 예전에는 `+` 메뉴에 `새 여행 만들기`와 `가진 일정 붙여넣기`가 따로 있었다. 처음 온 사람은
/// 메뉴를 열기 전에는 둘 중 무엇이 자기 상황인지 모른다 — 여는 순간 둘이 보여야 고를 수 있다.
///
/// ⚠️ **시트를 닫으면서 다른 시트를 여는 길은 택하지 않았다.** SwiftUI에서 어긋나서
/// `onDismiss` 대기 플래그로 한 박자 넘겨야 하는데, 그 함정을 감수할 값이 아니다.
/// 대신 두 화면이 각자 `NavigationStack`을 그대로 들고 이 안에서 갈린다.
///
/// ⚠️ 길을 바꾸면 적던 내용은 사라진다 — 두 화면의 `@State`가 따로다. 서로 다른 일이라
/// 이어 붙일 것도 없다(도시 이름과 붙여넣은 일정 글).
struct CreateTripView: View {
    let service: TripDataSource
    let places: PlaceSearching
    /// 만든 여행. 부모가 그 여행으로 들어간다.
    let onCreated: (TripSummary) -> Void
    /// 처음부터 만들기가 실패했을 때 보여 줄 문구(nil이면 성공). 목록이 서버를 부른다.
    let onCreateFromScratch: (NewTripDraft) async -> String?

    @State private var mode: CreateTripMode

    init(service: TripDataSource, places: PlaceSearching, startMode: CreateTripMode = .scratch,
         onCreated: @escaping (TripSummary) -> Void,
         onCreateFromScratch: @escaping (NewTripDraft) async -> String?) {
        self.service = service
        self.places = places
        self.onCreated = onCreated
        self.onCreateFromScratch = onCreateFromScratch
        _mode = State(initialValue: startMode)
    }

    var body: some View {
        switch mode {
        case .scratch:
            NewTripView(mode: $mode, onCreate: onCreateFromScratch)
        case .paste:
            PasteItineraryView(service: service, places: places, mode: $mode, onCreated: onCreated)
        }
    }
}

/// 여행을 시작하는 길. 화면 둘이 같은 값을 나눠 쓴다.
enum CreateTripMode: Hashable, CaseIterable {
    case scratch
    case paste

    var label: String {
        switch self {
        case .scratch: return "처음부터"
        case .paste: return "가진 일정으로"
        }
    }
}

/// 두 화면 맨 위에 같은 모양으로 놓는 갈림길.
struct CreateTripModePicker: View {
    @Binding var mode: CreateTripMode

    var body: some View {
        Picker("어떻게 시작할까요?", selection: $mode) {
            ForEach(CreateTripMode.allCases, id: \.self) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
        .listRowInsets(EdgeInsets())
        .listRowBackground(Color.clear)
    }
}
