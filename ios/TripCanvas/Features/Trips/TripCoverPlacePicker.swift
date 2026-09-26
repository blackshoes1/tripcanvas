import SwiftUI

/// 저장되는 것은 장소 ID와 구도뿐이다. 사진·출처는 표시할 때 다시 조회한다.
struct TripCoverPlace: Codable, Hashable {
    let placeId: String
    var zoom: CGFloat = 1
    var x: CGFloat = 0.5
    var y: CGFloat = 0.5

    var body: [String: Any] { ["placeId": placeId, "zoom": zoom, "x": x, "y": y] }
}

struct TripCoverPlaceOption: Identifiable {
    let id: String
    let name: String
    let day: Int

    static func options(in document: TripDocument) -> [Self] {
        var seen = Set<String>()
        return document.days.enumerated().flatMap { day, value in
            value.spots.compactMap { spot in
                guard spot.kakaoId?.isEmpty != false, let id = spot.placeId,
                      GooglePlaces.validPlaceId(id), seen.insert(id).inserted else { return nil }
                return Self(id: id, name: spot.name, day: day + 1)
            }
        }
    }
}

struct TripCoverPlacePicker: View {
    let tripId: String
    let select: (TripCoverPlace, PlacePhoto) -> Void
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @State private var options: [TripCoverPlaceOption] = []
    @State private var loading = true
    @State private var selectedID: String?
    @State private var error: String?
    @State private var retry = 0

    var body: some View {
        NavigationStack {
            List {
                Text("일정에 등록된 장소를 고르면 대표 사진을 확인하고 구도를 조절할 수 있어요.")
                    .font(.subheadline).foregroundStyle(Ink.soft)
                if loading { ProgressView("일정을 불러오는 중") }
                if let error {
                    Text(error).foregroundStyle(Ink.danger)
                    if options.isEmpty { Button("다시 불러오기") { retry += 1 } }
                }
                if !loading && error == nil && options.isEmpty {
                    Text("선택할 장소 사진이 없어요. 사진을 지원하는 장소를 일정에 담거나 앨범에서 사진을 골라 주세요.")
                        .foregroundStyle(Ink.soft)
                }
                ForEach(options) { option in
                    Button {
                        selectedID = option.id
                    } label: {
                        HStack(spacing: Space.m) {
                            Image(systemName: "photo").foregroundStyle(Ink.accent)
                            VStack(alignment: .leading, spacing: Space.xs) {
                                Text(option.name).foregroundStyle(Ink.ink)
                                Text("Day \(option.day)").font(.caption).foregroundStyle(Ink.soft)
                            }
                            Spacer()
                            if selectedID == option.id { ProgressView() }
                            else { Image(systemName: "chevron.right").foregroundStyle(Ink.soft) }
                        }.frame(minHeight: 52)
                    }.disabled(selectedID != nil)
                }
            }
            .paperGround()
            .navigationTitle("일정의 대표 사진")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() } } }
            .task(id: retry) {
                loading = true; error = nil
                do {
                    let snapshot = try await env.service.document(tripId: tripId)
                    try Task.checkCancellation()
                    options = TripCoverPlaceOption.options(in: snapshot.document)
                } catch {
                    guard !Task.isCancelled else { return }
                    self.error = "일정을 불러오지 못했어요. 다시 시도해 주세요."
                }
                loading = false
            }
            .task(id: selectedID) {
                guard let id = selectedID else { return }
                error = nil
                do {
                    let photo = try await env.placePhotos.photo(placeId: id)
                    try Task.checkCancellation()
                    if let photo {
                        select(TripCoverPlace(placeId: id), photo)
                        dismiss()
                    } else { error = "이 장소에는 표시할 대표 사진이 없어요. 다른 장소를 골라 주세요." }
                } catch {
                    guard !Task.isCancelled else { return }
                    self.error = "사진을 불러오지 못했어요. 다시 선택해 주세요."
                }
                selectedID = nil
            }
        }
    }
}

struct TripCoverPhotoCredit: View {
    let photo: PlacePhoto
    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Link("Google Maps · 원본 사진", destination: photo.sourceURL)
            ForEach(Array(photo.authors.enumerated()), id: \.offset) { _, author in
                if let url = PlacePhoto.safeURL(author.uri) {
                    Link(author.displayName ?? "사진 작성자", destination: url)
                } else if let name = author.displayName { Text(name) }
            }
        }.font(.caption2).foregroundStyle(Ink.ink)
    }
}

struct TripCoverCrop: View {
    let image: UIImage
    let zoom: CGFloat
    let position: CGPoint

    var body: some View {
        GeometryReader { geometry in
            let crop = TripCoverImage.cropRect(size: image.size, zoom: zoom, position: position)
            let scale = geometry.size.width / crop.width
            Image(uiImage: image).resizable()
                .frame(width: image.size.width * scale, height: image.size.height * scale)
                .offset(x: -crop.minX * scale, y: -crop.minY * scale)
                .frame(width: geometry.size.width, height: geometry.size.height, alignment: .topLeading)
                .clipped()
        }.aspectRatio(TripCoverImage.aspectRatio, contentMode: .fit)
    }
}
