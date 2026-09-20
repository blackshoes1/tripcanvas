import SwiftUI

struct TripCoverView: View {
    let city: String
    var onOpen: () -> Void
    @State private var cover: TripCoverService.Cover?

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Button(action: onOpen) {
                Color.clear
                    .aspectRatio(1.55, contentMode: .fit)
                    .overlay {
                        if let cover {
                            Image(uiImage: cover.image).resizable().scaledToFill()
                        } else {
                            Rectangle().fill(Ink.sunken)
                                .overlay {
                                    VStack(spacing: Space.s) {
                                        Image(systemName: "globe.asia.australia").font(.largeTitle)
                                        Text(city.isEmpty ? "새로운 여행" : city).font(Typeface.editorial(.title3))
                                    }
                                    .foregroundStyle(Ink.soft)
                                }
                        }
                    }
                    .clipped()
                    .clipShape(RoundedRectangle(cornerRadius: 3))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(city.isEmpty ? "여행 열기" : "\(city) 여행 열기")
            if let cover {
                Link(destination: cover.source) {
                    Text("사진: \(cover.author) · \(cover.license) · 일부 잘림")
                        .font(.caption2).foregroundStyle(Ink.soft)
                }
                .buttonStyle(.plain)
            }
        }
        .task(id: city) {
            cover = nil
            let result = await TripCoverService.shared.representative(city: city)
            guard !Task.isCancelled else { return }
            cover = result
        }
    }
}
