import ImageIO
import PhotosUI
import SwiftUI

/// 원본·위치 메타데이터 대신 표지 크기의 JPEG만 저장 계층에 넘긴다.
enum TripCoverImage {
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
    let save: (Data?) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var selection: PhotosPickerItem?
    @State private var jpeg: Data?
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
                    if let jpeg, let image = UIImage(data: jpeg) {
                        Image(uiImage: image).resizable().scaledToFit().accessibilityLabel("선택한 표지 미리보기")
                    }
                    PhotosPicker(selection: $selection, matching: .images) {
                        Label("내 사진에서 선택", systemImage: "photo.on.rectangle")
                    }
                    .disabled(loading || saving)
                    if loading { ProgressView("사진을 준비하는 중") }
                    if let error { Text(error).foregroundStyle(Ink.danger) }
                    Button("이 사진을 표지로 사용") { persist(jpeg) }
                        .disabled(jpeg == nil || loading || saving)
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
            .task(id: selection) {
                guard let selection else { return }
                loading = true; jpeg = nil; error = nil
                defer { loading = false }
                do {
                    guard let data = try await selection.loadTransferable(type: Data.self),
                          let result = TripCoverImage.jpeg(from: data) else {
                        error = "이 사진은 읽을 수 없어요. 다른 사진을 골라 주세요."
                        return
                    }
                    guard !Task.isCancelled else { return }
                    jpeg = result
                } catch {
                    if !Task.isCancelled { self.error = "사진을 가져오지 못했어요. 다시 선택해 주세요." }
                }
            }
        }
    }

    private func persist(_ data: Data?) {
        saving = true; error = nil
        Task {
            do { try await save(data); dismiss() }
            catch { self.error = "표지를 저장하지 못했어요. 다시 시도해 주세요." }
            saving = false
        }
    }
}
