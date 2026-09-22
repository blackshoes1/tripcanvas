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
    let storageDescription: String
    var initialImage: UIImage? = nil
    let save: (Data?) async throws -> Void
    @Environment(\.dismiss) private var dismiss
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
            Form {
                Section {
                    Text(title).font(Typeface.editorial(.title2))
                    Text(storageDescription).font(.caption).foregroundStyle(Ink.soft)
                }
                Section {
                    if let image {
                        cropPreview(image)
                        Text("테두리 안이 표지에 표시돼요. 사진을 끌어 위치를 맞추고 확대해 주세요.")
                            .font(.caption).foregroundStyle(Ink.soft)
                        Slider(value: $zoom, in: 1...4) { Text("사진 확대") }
                            .disabled(saving)
                        DisclosureGroup("위치 미세 조정") {
                            Slider(value: $position.x, in: 0...1) { Text("가로 위치") }
                            Slider(value: $position.y, in: 0...1) { Text("세로 위치") }
                        }.disabled(saving)
                        Button("구도 초기화") {
                            zoom = 1; position = CGPoint(x: 0.5, y: 0.5)
                        }.disabled(saving)
                    }
                    PhotosPicker(selection: $selection, matching: .images) {
                        Label("내 사진에서 선택", systemImage: "photo.on.rectangle")
                    }
                    .disabled(loading || saving)
                    if loading { ProgressView("사진을 준비하는 중") }
                    if let error { Text(error).foregroundStyle(Ink.danger) }
                    Button("이 구도로 표지 저장") { saveCrop() }
                        .disabled(image == nil || loading || saving)
                }
                Section {
                    Button("여행지 대표 사진으로 되돌리기") { persist(nil) }
                        .disabled(loading || saving)
                }
            }
            .paperGround()
            .navigationTitle("여행 표지")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") { dismiss() }.disabled(saving)
                }
                if saving { ToolbarItem(placement: .confirmationAction) { ProgressView() } }
            }
            .interactiveDismissDisabled(saving)
            .onAppear {
                if image == nil, selection == nil { image = initialImage }
            }
            .task(id: selection) {
                guard let selection else { return }
                loading = true; image = nil; error = nil
                zoom = 1; position = CGPoint(x: 0.5, y: 0.5); dragOrigin = nil
                defer { if self.selection == selection { loading = false } }
                do {
                    guard let data = try await selection.loadTransferable(type: Data.self),
                          let result = TripCoverImage.preview(from: data) else {
                        error = "이 사진은 읽을 수 없어요. 다른 사진을 골라 주세요."
                        return
                    }
                    guard !Task.isCancelled else { return }
                    image = result
                } catch {
                    if !Task.isCancelled { self.error = "사진을 가져오지 못했어요. 다시 선택해 주세요." }
                }
            }
        }
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
        guard let image,
              let data = TripCoverImage.jpeg(from: image, zoom: zoom, position: position) else {
            error = "표지 이미지를 만들지 못했어요. 다른 사진으로 다시 시도해 주세요."
            return
        }
        persist(data)
    }

    private func persist(_ data: Data?) {
        saving = true; error = nil
        Task {
            do { try await save(data); dismiss() }
            catch { self.error = (error as? APIError)?.errorDescription ?? "표지를 저장하지 못했어요. 다시 시도해 주세요." }
            saving = false
        }
    }
}
