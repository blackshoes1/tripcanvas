import ImageIO
import PhotosUI
import SwiftUI

/// 원본·위치 메타데이터 대신 표지 크기의 JPEG만 저장 계층에 넘긴다.
enum TripCoverImage {
    static let aspectRatio: CGFloat = 1.55

    static func preview(from data: Data) -> UIImage? {
        guard data.count <= 40_000_000,
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 2400
              ] as CFDictionary) else { return nil }
        return UIImage(cgImage: thumbnail)
    }

    /// 미리보기와 저장이 같은 사각형을 사용한다. 위치는 잘라낼 수 있는 여백의 0...1 비율이다.
    static func cropRect(size: CGSize, zoom: CGFloat, position: CGPoint) -> CGRect {
        let scale = min(4, max(1, zoom))
        let width = min(size.width, size.height * aspectRatio) / scale
        let height = width / aspectRatio
        return CGRect(x: (size.width - width) * min(1, max(0, position.x)),
                      y: (size.height - height) * min(1, max(0, position.y)),
                      width: width, height: height)
    }

    static func jpeg(from image: UIImage, zoom: CGFloat, position: CGPoint) -> Data? {
        let crop = cropRect(size: image.size, zoom: zoom, position: position)
        guard crop.width > 0, crop.height > 0 else { return nil }
        let size = CGSize(width: 1178, height: 760)
        let scale = size.width / crop.width
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1; format.opaque = true
        let output = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            image.draw(in: CGRect(x: -crop.minX * scale, y: -crop.minY * scale,
                                  width: image.size.width * scale, height: image.size.height * scale))
        }
        for quality in [0.8, 0.6, 0.4, 0.2] {
            if let data = output.jpegData(compressionQuality: quality), data.count <= 250_000 { return data }
        }
        return nil
    }

    static func jpeg(from data: Data) -> Data? {
        guard data.count <= 40_000_000,
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 1200
              ] as CFDictionary) else { return nil }
        let image = UIImage(cgImage: thumbnail)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1; format.opaque = true
        let flattened = UIGraphicsImageRenderer(size: image.size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: image.size))
            image.draw(at: .zero)
        }
        for quality in [0.8, 0.6, 0.4, 0.2] {
            if let jpeg = flattened.jpegData(compressionQuality: quality), jpeg.count <= 250_000 { return jpeg }
        }
        return nil
    }
}

struct TripCoverEditor: View {
    let title: String
    let tripId: String
    let storageDescription: String
    var initialImage: UIImage? = nil
    var initialPlace: TripCoverPlace? = nil
    var initialPlacePhoto: PlacePhoto? = nil
    let save: (Data?, TripCoverPlace?) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(AppEnvironment.self) private var env
    @State private var place: TripCoverPlace?
    @State private var placePhoto: PlacePhoto?
    @State private var showsPlaces = false
    @State private var showsPosition = false
    @State private var initialized = false
    @State private var selection: PhotosPickerItem?
    @State private var image: UIImage?
    @State private var zoom: CGFloat = 1
    @State private var position = CGPoint(x: 0.5, y: 0.5)
    @State private var dragOrigin: CGPoint?
    @State private var loading = false
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if image == nil {
                        Text(storageDescription)
                            .font(.subheadline).foregroundStyle(Ink.soft)
                            .frame(maxWidth: .infinity).multilineTextAlignment(.center)
                        VStack(alignment: .leading, spacing: Space.l) {
                            Text(title).font(Typeface.editorial(.largeTitle))
                            Divider()
                            Text("이 여행의 표지 사진을 골라 주세요.").foregroundStyle(Ink.soft)
                        }.padding(24).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Ink.raised, in: RoundedRectangle(cornerRadius: 26))
                    }
                    VStack(alignment: .leading, spacing: 20) {
                        if let image {
                            cropPreview(image).clipShape(RoundedRectangle(cornerRadius: 12))
                            Text("사진을 움직여 표지에 보일 영역을 맞춰주세요.")
                                .font(.caption).foregroundStyle(Ink.soft)
                            if let placePhoto { TripCoverPhotoCredit(photo: placePhoto) }
                            VStack(alignment: .leading, spacing: Space.s) {
                                Text("확대/축소").font(.subheadline).foregroundStyle(Ink.soft)
                                HStack {
                                    Image(systemName: "minus.magnifyingglass")
                                    Slider(value: $zoom, in: 1...4) { Text("사진 확대") }
                                    Image(systemName: "plus.magnifyingglass")
                                }.foregroundStyle(Ink.soft)
                            }
                            HStack(spacing: Space.m) {
                                Button { showsPosition.toggle() } label: {
                                    Label("위치 미세 조정", systemImage: "arrow.up.and.down.and.arrow.left.and.right")
                                        .frame(maxWidth: .infinity, minHeight: 52)
                                        .background(Ink.paper, in: RoundedRectangle(cornerRadius: 16))
                                }.accessibilityValue(showsPosition ? "펼침" : "접힘")
                                Button { resetCrop() } label: {
                                    Label("구도 초기화", systemImage: "arrow.counterclockwise")
                                        .frame(maxWidth: .infinity, minHeight: 52)
                                        .background(Ink.paper, in: RoundedRectangle(cornerRadius: 16))
                                }
                            }.font(.subheadline).buttonStyle(.plain).foregroundStyle(Ink.accent)
                            if showsPosition {
                                VStack(alignment: .leading) {
                                    Text("가로 위치").font(.caption).foregroundStyle(Ink.soft)
                                    Slider(value: $position.x, in: 0...1) { Text("가로 위치") }
                                    Text("세로 위치").font(.caption).foregroundStyle(Ink.soft)
                                    Slider(value: $position.y, in: 0...1) { Text("세로 위치") }
                                }
                            }
                            Divider()
                        } else {
                            VStack(alignment: .leading, spacing: Space.s) {
                                Text("여행 표지 사진").font(.title3.weight(.semibold)).foregroundStyle(Ink.accent)
                                Text("사진을 선택하거나, 일정에 등록한 장소의 대표 사진을 사용할 수 있어요.")
                                    .font(.subheadline).foregroundStyle(Ink.soft)
                            }
                        }
                        PhotosPicker(selection: $selection, matching: .images) {
                            if image == nil {
                                VStack(spacing: Space.l) {
                                    Image(systemName: "photo.on.rectangle").font(.system(size: 36))
                                    Text("사진에서 선택").font(.title3.weight(.semibold))
                                    HStack(spacing: Space.s) {
                                        Text("앨범에서 원하는 사진을 선택해요.")
                                        Image(systemName: "chevron.right")
                                    }.font(.subheadline).foregroundStyle(Ink.soft)
                                }.frame(maxWidth: .infinity).padding(.vertical, 30)
                                    .background(Ink.accent.opacity(0.05), in: RoundedRectangle(cornerRadius: 22))
                            } else {
                                sourceRow("다른 사진 선택", subtitle: "앨범에서 다른 사진을 선택할 수 있어요.", icon: "photo.on.rectangle")
                            }
                        }.buttonStyle(.plain).foregroundStyle(Ink.accent)
                        Button { showsPlaces = true } label: {
                            sourceRow(image == nil ? "일정의 대표 사진 사용" : "일정의 대표 사진으로 변경",
                                      subtitle: "일정에 등록한 장소의 사진을 직접 골라요.", icon: "mappin.and.ellipse")
                        }.buttonStyle(.plain)
                        if loading { ProgressView("사진을 준비하는 중") }
                        if let error { Text(error).font(.subheadline).foregroundStyle(Ink.danger) }
                        if image != nil {
                            Button { saveCrop() } label: {
                                HStack {
                                    if saving { ProgressView().tint(.white) }
                                    else { Image(systemName: "checkmark") }
                                    Text("이 구도로 저장")
                                }.font(.body.weight(.semibold))
                                    .frame(maxWidth: .infinity, minHeight: 56)
                                    .foregroundStyle(.white)
                                    .background(Ink.accent, in: Capsule())
                            }.buttonStyle(.plain)
                        }
                    }.padding(20).background(Ink.raised, in: RoundedRectangle(cornerRadius: 26))
                        .disabled(loading || saving)
                    if initialImage != nil || initialPlace != nil {
                        Button("기본 표지로 되돌리기") { persist(nil) }
                            .font(.footnote).foregroundStyle(Ink.soft)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .disabled(loading || saving)
                    }
                }.padding(16)
            }
            .background(Ink.paper)
            .navigationTitle(image == nil ? "여행 표지" : "여행 표지 편집")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") { dismiss() }.disabled(saving)
                }
                if saving { ToolbarItem(placement: .confirmationAction) { ProgressView() } }
            }
            .interactiveDismissDisabled(saving)
            .onAppear {
                guard !initialized else { return }
                initialized = true
                place = initialPlace; placePhoto = initialPlacePhoto
                image = initialPlacePhoto?.image ?? initialImage
                zoom = initialPlace?.zoom ?? 1
                position = CGPoint(x: initialPlace?.x ?? 0.5, y: initialPlace?.y ?? 0.5)
            }
            .task {
                guard let initialPlace, initialPlacePhoto == nil else { return }
                loading = true
                defer { loading = false }
                do {
                    guard let photo = try await env.placePhotos.photo(placeId: initialPlace.placeId) else {
                        error = "이 장소의 사진을 더 이상 볼 수 없어요. 다른 사진을 골라 주세요."
                        return
                    }
                    try Task.checkCancellation()
                    placePhoto = photo; image = photo.image
                } catch {
                    guard !Task.isCancelled else { return }
                    self.error = "표지 사진을 불러오지 못했어요. 다른 사진을 선택하거나 다시 열어 주세요."
                }
            }
            .sheet(isPresented: $showsPlaces) {
                TripCoverPlacePicker(tripId: tripId) { selected, photo in
                    place = selected; placePhoto = photo; image = photo.image
                    error = nil; resetCrop()
                }
            }
            .task(id: selection) {
                guard let selection else { return }
                loading = true; error = nil
                defer { if self.selection == selection { loading = false } }
                do {
                    guard let data = try await selection.loadTransferable(type: Data.self),
                          let result = TripCoverImage.preview(from: data) else {
                        error = "이 사진은 읽을 수 없어요. 다른 사진을 골라 주세요."
                        return
                    }
                    guard !Task.isCancelled else { return }
                    image = result; place = nil; placePhoto = nil
                    resetCrop()
                } catch {
                    if !Task.isCancelled { self.error = "사진을 가져오지 못했어요. 다시 선택해 주세요." }
                }
            }
        }
    }

    private func sourceRow(_ title: String, subtitle: String, icon: String) -> some View {
        HStack(spacing: Space.m) {
            Image(systemName: icon).font(.title2).foregroundStyle(Ink.accent)
                .frame(width: 40, height: 40)
                .background(Ink.accent.opacity(0.06), in: Circle())
            VStack(alignment: .leading, spacing: Space.xs) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Ink.ink)
                Text(subtitle).font(.caption).foregroundStyle(Ink.soft)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(Ink.soft)
        }.padding(12).frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
            .background(Ink.paper.opacity(0.7), in: RoundedRectangle(cornerRadius: 20))
    }

    private func resetCrop() {
        zoom = 1; position = CGPoint(x: 0.5, y: 0.5); dragOrigin = nil
    }

    private func cropPreview(_ image: UIImage) -> some View {
        GeometryReader { geometry in
            let crop = TripCoverImage.cropRect(size: image.size, zoom: zoom, position: position)
            let scale = geometry.size.width / crop.width
            ZStack(alignment: .topLeading) {
                Color.white
                Image(uiImage: image).resizable()
                    .frame(width: image.size.width * scale, height: image.size.height * scale)
                    .offset(x: -crop.minX * scale, y: -crop.minY * scale)
            }
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .topLeading)
            .clipped()
            .overlay {
                Path { path in
                    for fraction in [CGFloat(1) / 3, CGFloat(2) / 3] {
                        let x = geometry.size.width * fraction
                        let y = geometry.size.height * fraction
                        path.move(to: CGPoint(x: x, y: 0))
                        path.addLine(to: CGPoint(x: x, y: geometry.size.height))
                        path.move(to: CGPoint(x: 0, y: y))
                        path.addLine(to: CGPoint(x: geometry.size.width, y: y))
                    }
                }.stroke(.white.opacity(0.6), lineWidth: 1)
                    .allowsHitTesting(false)
            }
            .overlay(Rectangle().strokeBorder(.white, lineWidth: 2).allowsHitTesting(false))
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 1)
                .onChanged { value in
                    guard !saving else { return }
                    let origin = dragOrigin ?? position
                    dragOrigin = origin
                    let horizontal = (image.size.width - crop.width) * scale
                    let vertical = (image.size.height - crop.height) * scale
                    position = CGPoint(
                        x: horizontal > 0 ? min(1, max(0, origin.x - value.translation.width / horizontal)) : 0.5,
                        y: vertical > 0 ? min(1, max(0, origin.y - value.translation.height / vertical)) : 0.5)
                }
                .onEnded { _ in dragOrigin = nil })
            .accessibilityLabel("실제 표지 영역 미리보기")
            .accessibilityHint("아래 확대와 위치 미세 조정으로 구도를 바꿀 수 있습니다")
        }
        .aspectRatio(TripCoverImage.aspectRatio, contentMode: .fit)
    }

    private func saveCrop() {
        if var place {
            place.zoom = zoom; place.x = position.x; place.y = position.y
            persist(nil, place: place)
            return
        }
        guard let image,
              let data = TripCoverImage.jpeg(from: image, zoom: zoom, position: position) else {
            error = "표지 이미지를 만들지 못했어요. 다른 사진으로 다시 시도해 주세요."
            return
        }
        persist(data)
    }

    private func persist(_ data: Data?, place: TripCoverPlace? = nil) {
        saving = true; error = nil
        Task {
            do { try await save(data, place); dismiss() }
            catch { self.error = (error as? APIError)?.errorDescription ?? "표지를 저장하지 못했어요. 다시 시도해 주세요." }
            saving = false
        }
    }
}
