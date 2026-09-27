import Photos
import PhotosUI
import SwiftUI

/// 비용 항목에 붙이는 영수증·품목 사진.
///
/// **사진 자체는 저장하지 않는다.** 사진 보관함의 위치(local identifier)만 여행 문서에 남긴다 —
/// 문서는 저장할 때마다 통째로 오가므로 이미지를 실으면 동기화가 무거워지고 공유 링크가 터진다.
/// 그래서 이 사진들은 **이 기기에서만 보인다.** 일행에게는 개수도 그림도 가지 않는다(문서에는
/// 참조 문자열만 있고, 그 문자열은 다른 기기에서 아무것도 가리키지 않는다). 화면이 그 사실을 말한다.
///
/// 고르는 것(PhotosPicker)에는 권한이 필요 없고, **다시 보여 줄 때만** 보관함 읽기 권한이 필요하다.
/// 권한이 없으면 그림 대신 몇 장인지만 말한다 — 권한을 받으려고 기능을 막지 않는다.
struct CostPhotosField: View {
    @Binding var refs: [String]
    @State private var picked: [PhotosPickerItem] = []
    @State private var thumbs: [String: UIImage] = [:]
    @State private var denied = false
    /// 크게 보는 사진. 64pt 썸네일로는 영수증 글자를 못 읽는다.
    @State private var viewing: PhotoRef?

    /// 문서 정규화(lib.js)와 같은 상한. 넘겨도 조용히 잘리지 않게 화면에서 먼저 막는다.
    private static let maxPhotos = 10

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            if !refs.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Space.s) {
                        ForEach(refs, id: \.self) { ref in
                            thumbnail(ref)
                        }
                    }
                }
                if denied {
                    Text("사진 \(refs.count)장을 붙여 뒀어요. 보관함 접근을 허용하면 여기에서 바로 볼 수 있어요.")
                        .font(.caption).foregroundStyle(Ink.soft)
                }
            }
            if refs.count < Self.maxPhotos {
                PhotosPicker(selection: $picked, maxSelectionCount: Self.maxPhotos - refs.count, matching: .images) {
                    Label(refs.isEmpty ? "사진 붙이기" : "사진 더 붙이기", systemImage: "photo.badge.plus")
                }
            } else {
                Text("사진은 \(Self.maxPhotos)장까지 붙일 수 있어요.").font(.caption).foregroundStyle(Ink.soft)
            }
        }
        .onChange(of: picked) { _, items in
            guard !items.isEmpty else { return }
            // 같은 사진을 두 번 고르면 두 장이 되지 않게 — 순서는 고른 순서를 지킨다
            var next = refs
            for id in items.compactMap(\.itemIdentifier) where !next.contains(id) {
                if next.count >= Self.maxPhotos { break }
                next.append(id)
            }
            refs = next
            picked = []
            Task { await loadThumbnails() }
        }
        .task { await loadThumbnails() }
        .fullScreenCover(item: $viewing) { photo in
            PhotoViewer(ref: photo.id, placeholder: thumbs[photo.id])
        }
    }

    @ViewBuilder
    private func thumbnail(_ ref: String) -> some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if let image = thumbs[ref] {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    RoundedRectangle(cornerRadius: Radius.small)
                        .fill(Ink.soft.opacity(0.12))
                        .overlay(Image(systemName: "photo").foregroundStyle(Ink.soft))
                }
            }
            .frame(width: 64, height: 64)
            .clipShape(RoundedRectangle(cornerRadius: Radius.small))
            .contentShape(Rectangle())
            .onTapGesture { if thumbs[ref] != nil { viewing = PhotoRef(id: ref) } }
            .accessibilityAddTraits(thumbs[ref] != nil ? .isButton : [])
            .accessibilityLabel("사진 크게 보기")

            Button {
                refs.removeAll { $0 == ref }
                thumbs[ref] = nil
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, .black.opacity(0.6))
            }
            .buttonStyle(.plain)
            .padding(2)
            .accessibilityLabel("사진 떼기")
        }
    }

    /// 권한이 없으면 조용히 포기하고 개수만 말한다. 사진을 붙이는 일 자체는 권한 없이도 된다.
    private func loadThumbnails() async {
        let missing = refs.filter { thumbs[$0] == nil }
        guard !missing.isEmpty else { return }
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        let allowed: Bool
        switch status {
        case .authorized, .limited: allowed = true
        case .notDetermined:
            allowed = await withCheckedContinuation { cont in
                PHPhotoLibrary.requestAuthorization(for: .readWrite) { new in
                    cont.resume(returning: new == .authorized || new == .limited)
                }
            }
        default: allowed = false
        }
        guard allowed else { denied = true; return }
        denied = false
        let assets = PHAsset.fetchAssets(withLocalIdentifiers: missing, options: nil)
        let manager = PHImageManager.default()
        let options = PHImageRequestOptions()
        options.isSynchronous = false
        options.deliveryMode = .opportunistic
        assets.enumerateObjects { asset, _, _ in
            manager.requestImage(for: asset, targetSize: CGSize(width: 192, height: 192),
                                 contentMode: .aspectFill, options: options) { image, _ in
                if let image { Task { @MainActor in thumbs[asset.localIdentifier] = image } }
            }
        }
    }
}

private struct PhotoRef: Identifiable { let id: String }

/// 한 장을 화면 가득 — 원본 해상도로 다시 받고, 두 손가락으로 키운다(영수증 글자를 읽을 수 있어야 한다).
private struct PhotoViewer: View {
    let ref: String
    let placeholder: UIImage?
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                if let shown = image ?? placeholder {
                    Image(uiImage: shown)
                        .resizable()
                        .scaledToFit()
                        .scaleEffect(scale)
                        .gesture(MagnifyGesture()
                            .onChanged { value in scale = min(5, max(1, lastScale * value.magnification)) }
                            .onEnded { _ in lastScale = scale })
                        .onTapGesture(count: 2) { scale = scale > 1 ? 1 : 2.5; lastScale = scale }
                        .accessibilityLabel("영수증·품목 사진")
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("닫기") { dismiss() }.tint(.white) }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
        }
        .task { await loadFull() }
    }

    private func loadFull() async {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [ref], options: nil).firstObject else { return }
        let options = PHImageRequestOptions()
        options.isNetworkAccessAllowed = true
        options.deliveryMode = .highQualityFormat
        PHImageManager.default().requestImage(for: asset, targetSize: PHImageManagerMaximumSize,
                                              contentMode: .aspectFit, options: options) { result, _ in
            if let result { Task { @MainActor in image = result } }
        }
    }
}
