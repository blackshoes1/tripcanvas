import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Share Extension — Safari·메일·메시지·지도에서 TripCanvas로 보낸 것을 받는다(§11).
///
/// 여기서 파싱하지 않는다. 확장은 수명이 짧고 네트워크가 없을 수도 있어서,
/// **받은 것을 그대로 큐에 넣고 바로 닫는다**(§55). 해석과 저장은 앱이 켜졌을 때 한다.
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        Task { await intake() }
    }

    private func intake() async {
        let collected = await collect()
        guard collected.url != nil || collected.text != nil || collected.title != nil else {
            return present(state: .empty)
        }
        let input = SharedTravelInput(
            id: SharedTravelInput.makeId(url: collected.url, title: collected.title, text: collected.text),
            sourceType: collected.sourceType,
            url: collected.url, text: collected.text, title: collected.title)
        let added = ShareQueue.enqueue(input)
        present(state: added ? .saved : .duplicate)
    }

    private struct Collected {
        var url: String?
        var text: String?
        var title: String?
        var sourceType: SharedTravelInput.SourceType
    }

    /// 여러 항목이 함께 올 수 있다(주소 + 선택한 텍스트). 있는 대로 다 담는다 — 버리지 않는다.
    private func collect() async -> Collected {
        var url: String?
        var text: String?
        var title: String?

        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        for item in items {
            if title == nil, let attributed = item.attributedContentText?.string, !attributed.isEmpty {
                title = attributed
            }
            for provider in item.attachments ?? [] {
                if url == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                   let loaded = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                    url = loaded.absoluteString
                }
                if text == nil, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                   let loaded = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                    text = loaded
                }
            }
        }
        // 제목이 본문과 같으면 중복이라 지운다.
        if let t = title, t == text { title = nil }

        let sourceType: SharedTravelInput.SourceType =
            (url != nil && text != nil) ? .mixed : (url != nil ? .url : (text != nil ? .text : .unknown))
        return Collected(url: url, text: text, title: title, sourceType: sourceType)
    }

    /// 확장에서는 긴 폼을 채우게 하지 않는다(§51) — 받았다는 것만 알리고 닫는다.
    /// 확인·수정은 앱의 미리보기에서 한 번에 한다.
    private func present(state: ShareResultState) {
        let view = ShareResultView(state: state) { [weak self] openApp in
            if openApp { self?.openHostApp() }
            self?.extensionContext?.completeRequest(returningItems: nil)
        }
        let hosting = UIHostingController(rootView: view)
        addChild(hosting)
        hosting.view.frame = self.view.bounds
        hosting.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        self.view.addSubview(hosting.view)
        hosting.didMove(toParent: self)
    }

    /// 확장에서는 UIApplication.open을 쓸 수 없어 responder 체인을 타고 올라간다.
    private func openHostApp() {
        guard let url = URL(string: "tripcanvas://inbox") else { return }
        var responder: UIResponder? = self
        while let current = responder {
            if let application = current as? UIApplication {
                application.open(url)
                return
            }
            responder = current.next
        }
    }
}

struct ShareResultView: View {
    let state: ShareResultState
    let done: (Bool) -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: symbol).font(.largeTitle).foregroundStyle(.tint)
            Text(title).font(.headline).multilineTextAlignment(.center)
            Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            HStack(spacing: 8) {
                if state != .empty {
                    Button("With J에서 확인") { done(true) }.buttonStyle(.borderedProminent)
                }
                Button("닫기") { done(false) }.buttonStyle(.bordered)
            }
        }
        .padding(24)
    }

    private var symbol: String {
        switch state {
        case .saved: "tray.and.arrow.down.fill"
        case .duplicate: "checkmark.circle"
        case .empty: "questionmark.circle"
        }
    }
    private var title: String {
        switch state {
        case .saved: "With J에 담았어요"
        case .duplicate: "이미 담아 둔 내용이에요"
        case .empty: "가져올 내용을 찾지 못했어요"
        }
    }
    private var message: String {
        switch state {
        case .saved: "앱을 열면 예약인지 장소인지 확인하고 한 번에 저장할 수 있어요."
        case .duplicate: "같은 내용을 이미 받아 두었어요."
        case .empty: "주소나 텍스트를 선택한 뒤 다시 공유해 주세요."
        }
    }
}

/// 뷰와 컨트롤러가 함께 쓰는 결과 상태.
enum ShareResultState { case saved, duplicate, empty }
