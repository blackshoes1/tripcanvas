import SwiftUI

/// 선택한 장소를 열 때만 한 장을 요청한다. 목록 전체의 사진을 미리 조회하지 않는다.
struct PlacePhotoView: View {
    let placeId: String?
    let kakaoId: String?
    let name: String
    var allowsGooglePhoto = true
    @Environment(AppEnvironment.self) private var env
    @Environment(\.colorScheme) private var colorScheme
    @State private var photo: PlacePhoto?
    @State private var loading = false
    @State private var failed = false
    @State private var retry = 0

    var googleId: String? {
        guard allowsGooglePhoto, kakaoId?.isEmpty != false, let placeId,
              GooglePlaces.validPlaceId(placeId) else { return nil }
        return placeId
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            if let photo {
                Link(destination: photo.sourceURL) {
                    Image(uiImage: photo.image).resizable().scaledToFit()
                        .frame(maxWidth: .infinity, maxHeight: 220)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .accessibilityLabel("\(name) 대표 사진 · 원본 사진 열기")
                HStack {
                    Text("Google Maps").font(.system(size: 12))
                        .foregroundStyle(colorScheme == .dark ? Color.white : Color(red: 31 / 255, green: 31 / 255, blue: 31 / 255))
                        .fixedSize()
                    Spacer()
                    Link("원본 사진", destination: photo.sourceURL).font(.caption).frame(minHeight: 44)
                }
                ForEach(Array(photo.authors.enumerated()), id: \.offset) { _, author in
                    if let url = PlacePhoto.safeURL(author.uri) {
                        Link(author.displayName ?? "사진 작성자", destination: url).font(.caption).frame(minHeight: 44)
                    } else if let name = author.displayName {
                        Text(name).font(.caption).foregroundStyle(.secondary)
                    }
                }
            } else if loading {
                HStack { ProgressView(); Text("사진을 불러오는 중…").font(.caption) }.frame(minHeight: 72)
            } else if failed {
                HStack {
                    Label("사진을 불러오지 못했어요", systemImage: "photo").font(.caption)
                    Spacer()
                    Button("다시 보기") { retry += 1 }.font(.caption).frame(minHeight: 44)
                }
            } else {
                Label(kakaoId?.isEmpty == false ? "카카오에서 사진을 제공하지 않는 장소예요" : "표시할 대표 사진이 없어요", systemImage: "photo")
                    .font(.caption).foregroundStyle(.secondary)
                if let kakaoId, !kakaoId.isEmpty, kakaoId.allSatisfy(\.isNumber),
                   let url = URL(string: "https://place.map.kakao.com/\(kakaoId)") {
                    Link("카카오맵에서 보기", destination: url).font(.caption).frame(minHeight: 44)
                }
            }
        }
        .onDisappear { photo = nil }
        .task(id: "\(googleId ?? "")-\(kakaoId ?? "")-\(retry)") {
            photo = nil; failed = false; loading = false
            guard let googleId else { return }
            loading = true
            do {
                let loaded = try await env.placePhotos.photo(placeId: googleId)
                try Task.checkCancellation()
                photo = loaded; loading = false
            } catch {
                guard !Task.isCancelled else { return }
                failed = true; loading = false
            }
        }
    }
}
